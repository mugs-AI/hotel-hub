import { isN3Guid } from "./n3-guid";
import type { SettlementView, SettlementStepInput } from "./settlement";
import {
  validateSettlementPaymentLines,
  type SettlementPaymentLine,
} from "./settlement-payment-entry";

/** A saved receipt must be recovered, never collected again after matching fails. */
export class SavedPaymentMatchingError extends Error {
  constructor(
    readonly cause: unknown,
    readonly receiptVerified = false,
  ) {
    super("Payment saved; matching needs checking");
  }
}
type PaymentSequenceDeps = {
  submit(input: SettlementStepInput): Promise<SettlementView>;
  isCurrent(): boolean;
};
const revision = (s: unknown): s is string =>
  typeof s === "string" && /^(0|[1-9]\d{0,18})$/.test(s) && BigInt(s) <= 9223372036854775807n;

/** Only an explicit payment click enters here. No mount, polling or retry writes. */
export async function receivePaymentAndMatch(
  initial: SettlementView,
  lines: SettlementPaymentLine[],
  deps: PaymentSequenceDeps,
): Promise<SettlementView> {
  // Copy the reviewed scope and inputs before any wait or callback.
  const original = structuredClone(initial);
  if (!deps.isCurrent()) return original;
  if (
    !original.intentId ||
    !original.bill ||
    !revision(original.revision) ||
    original.blockers.length ||
    !original.allowedActions.includes("receive_balance") ||
    original.allowedActions.some((a) => a !== "receive_balance") ||
    original.state === "needs_review" ||
    original.state === "closed"
  )
    throw new Error("settlement_action_unavailable");
  const payment = validateSettlementPaymentLines(
    structuredClone(lines),
    original.bill.outstandingCents,
  );
  if (payment.kind !== "confirmed") throw new Error(payment.code);
  const intentId = original.intentId;
  const scoped = (v: SettlementView) => {
    if (
      !v ||
      v.tenantId !== original.tenantId ||
      v.reservationId !== original.reservationId ||
      v.intentId !== intentId ||
      v.snapshotDigest !== original.snapshotDigest ||
      v.currency !== original.currency ||
      !revision(v.revision) ||
      !Array.isArray(v.blockers) ||
      !Array.isArray(v.allowedActions) ||
      !Array.isArray(v.receipts)
    )
      throw new Error("settlement_scope_mismatch");
  };
  const received = await deps.submit({
    action: "receive_balance",
    intentId,
    expectedRevision: original.revision,
    paymentLines: payment.value,
  });
  let receiptVerified = false;
  try {
    scoped(received);
    // Unknown/denied/unverified results never initiate matching.
    if (!deps.isCurrent() || received.blockers.length) return received;
    if (
      BigInt(received.revision) <= BigInt(original.revision) ||
      received.bill?.id !== original.bill.id ||
      received.bill.totalCents !== original.bill.totalCents ||
      received.bill.outstandingCents !== original.bill.outstandingCents
    )
      throw new Error("settlement_evidence_changed");
    const preserveReceipts = (v: SettlementView) => {
      const ids = v.receipts.map((r) => r.id.toLowerCase());
      if (new Set(ids).size !== ids.length) throw new Error("settlement_receipt_requires_review");
      for (const old of original.receipts) {
        const saved = v.receipts.find((r) => r.id.toLowerCase() === old.id.toLowerCase());
        if (
          !saved ||
          saved.code !== old.code ||
          saved.documentDate !== old.documentDate ||
          saved.amountCents !== old.amountCents ||
          saved.allocatedCents !== old.allocatedCents ||
          saved.remainderCents !== old.remainderCents
        )
          throw new Error("settlement_evidence_changed");
      }
    };
    preserveReceipts(received);
    const oldIds = new Set(original.receipts.map((r) => r.id.toLowerCase()));
    const ids = received.receipts.map((r) => r.id.toLowerCase());
    const added = received.receipts.filter((r) => !oldIds.has(r.id.toLowerCase()));
    if (
      new Set(ids).size !== ids.length ||
      added.length !== 1 ||
      !isN3Guid(added[0].id) ||
      added[0].id.toLowerCase() === original.bill.id.toLowerCase() ||
      added[0].amountCents !== original.bill.outstandingCents ||
      added[0].remainderCents !== original.bill.outstandingCents ||
      added[0].allocatedCents !== 0
    )
      throw new Error("settlement_receipt_requires_review");
    receiptVerified = true;
    if (
      received.state !== "balance_dispatched" ||
      received.allowedActions.some((a) => a !== "apply_balance")
    )
      throw new Error("settlement_action_unavailable");
    // A valid gate-closed saved receipt is retained without any further write.
    if (!received.allowedActions.includes("apply_balance") || !deps.isCurrent()) return received;
    // Each call still passes through server authorization, current N3 proof,
    // contract gates and the existing durable one-dispatch claim.
    const matched = await deps.submit({
      action: "apply_balance",
      intentId,
      expectedRevision: received.revision,
    });
    scoped(matched);
    if (matched.blockers.length) throw new Error(matched.blockers[0]);
    preserveReceipts(matched);
    const paid = matched.receipts.find((r) => r.id.toLowerCase() === added[0].id.toLowerCase());
    if (
      matched.bill?.id !== original.bill.id ||
      matched.bill.totalCents !== original.bill.totalCents ||
      matched.bill.outstandingCents !== 0 ||
      matched.state !== "settled" ||
      matched.allowedActions.some((a) => a !== "close") ||
      BigInt(matched.revision) <= BigInt(received.revision) ||
      !paid ||
      matched.receipts.length !== received.receipts.length ||
      paid.code !== added[0].code ||
      paid.documentDate !== added[0].documentDate ||
      paid.amountCents !== added[0].amountCents ||
      paid.allocatedCents !== added[0].amountCents ||
      paid.remainderCents !== 0
    )
      throw new Error("settlement_evidence_changed");
    return matched;
  } catch (cause) {
    throw new SavedPaymentMatchingError(cause, receiptVerified);
  }
}
