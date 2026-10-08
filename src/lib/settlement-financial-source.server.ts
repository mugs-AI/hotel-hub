// Complete discovery is a separate accepted contract. A local settlement
// ledger supplies ownership, never proof that a monthly N3 source is complete.
import {
  financialMonth,
  FinancialReportError,
  UNAVAILABLE_FINAL_BILLING,
  type FinancialMonth,
  type FinancialSource,
  type HotelFinancialEvent,
} from "./financial-reporting";
import { Deadline, FINANCIAL_LIMITS } from "./financial-reporting-store.server";
import { ReceiptControlError } from "./receipt-controls";
import type { ReceiptControlActor } from "./receipt-controls-evidence.server";
import type { EvidenceResult, SettlementSnapshot } from "./settlement";
import {
  verifiedBillActorMatches,
  verifiedReceiptActorMatches,
  type VerifiedBill,
  type VerifiedReceiptBefore,
} from "./settlement-evidence.server";
import { billingPayloadDigest } from "./n3-billing.server";

export type SettlementCandidate = {
  snapshot: SettlementSnapshot;
  intentId: string;
  documentId: string;
  bookingReference: string;
  purpose: "sale" | "settlement" | "deposit" | "allocation";
};
export type SettlementSourceDeps = {
  /** Must discover every document in the date range, with immutable ledger links. */
  discover(
    actor: ReceiptControlActor,
    period: FinancialMonth,
    kind: "sale" | "settlement",
    signal?: AbortSignal,
  ): Promise<EvidenceResult<{ complete: boolean; candidates: SettlementCandidate[] }>>;
  /** Current authenticated detail + GL reads; no cached or JSON-cast proof. */
  prove(
    actor: ReceiptControlActor,
    candidate: SettlementCandidate,
    signal?: AbortSignal,
  ): Promise<EvidenceResult<VerifiedBill | VerifiedReceiptBefore>>;
  now(): number;
};
const unavailable = (reasonCode: string): FinancialSource<HotelFinancialEvent> => ({
  status: "unavailable",
  rows: [],
  verifiedAt: null,
  reasonCode,
});
function event(
  c: SettlementCandidate,
  p: VerifiedBill | VerifiedReceiptBefore,
  actor: ReceiptControlActor,
  kind: "sale" | "settlement",
): HotelFinancialEvent {
  const a = { ...actor, reservationId: c.snapshot.reservationId };
  if (c.snapshot.tenantId !== actor.tenantId || c.snapshot.currency !== "MYR")
    throw new Error("source_scope_mismatch");
  let date: string,
    code: string,
    amount: number,
    accountId: string | null = null,
    accountCode: string | null = null;
  if (kind === "sale") {
    if (
      !("id" in p) ||
      !verifiedBillActorMatches(p, c.snapshot, a) ||
      p.id.toLowerCase() !== c.documentId.toLowerCase() ||
      p.intentId !== c.intentId
    )
      throw new Error("n3_evidence_untrusted");
    date = p.documentDate;
    code = p.code;
    amount = p.totalCents;
  } else {
    if (
      !("receipt" in p) ||
      !verifiedReceiptActorMatches(p, c.snapshot, a) ||
      !("purpose" in p.receipt) ||
      p.receipt.purpose !== "settlement" ||
      p.receipt.intentId !== c.intentId ||
      p.receipt.receiptId.toLowerCase() !== c.documentId.toLowerCase() ||
      p.refundCents !== 0
    )
      throw new Error("n3_evidence_untrusted");
    date = p.receipt.receiptDate;
    code = p.code;
    amount = p.amountCents;
    accountId = p.receipt.payments[0].accountId;
    accountCode = p.receipt.payments[0].accountCode;
  }
  return {
    transactionId: `${c.intentId}:${kind}:${c.documentId.toLowerCase()}`,
    documentId: c.documentId.toLowerCase(),
    documentCode: code,
    documentDate: date,
    bookingReference: c.bookingReference,
    customerLabel: c.snapshot.billTo.company || c.snapshot.billTo.name,
    currency: c.snapshot.currency,
    amountCents: amount,
    creationAmountCents: amount,
    kind,
    state: "active",
    receiptStatus: "active",
    savedPaymentName: null,
    paymentAccountId: accountId,
    accountCode,
    replacementOf: null,
    replacementReceiptId: null,
    requesterLabel: null,
    approverLabel: null,
    reason: null,
    confirmedVoidAt: null,
  };
}
async function read(
  actor: ReceiptControlActor,
  period: FinancialMonth,
  kind: "sale" | "settlement",
  deps?: SettlementSourceDeps,
): Promise<FinancialSource<HotelFinancialEvent>> {
  if (actor.role !== "owner" || !actor.tenantId) throw new FinancialReportError("forbidden");
  const canonical = financialMonth(period.month, period.timezone);
  if (canonical.startDate !== period.startDate || canonical.endExclusive !== period.endExclusive)
    throw new FinancialReportError("invalid_month");
  if (!deps) return unavailable(UNAVAILABLE_FINAL_BILLING);
  const deadline = new Deadline(deps.now, deps.now() + FINANCIAL_LIMITS.totalBudgetMs);
  try {
    const discovery = await deadline.run(() =>
      deps.discover(actor, period, kind, deadline.controller.signal),
    );
    if (
      discovery.kind !== "confirmed" &&
      ["unauthorized", "n3_session_expired"].includes(discovery.code)
    )
      throw new ReceiptControlError("unauthorized");
    if (discovery.kind !== "confirmed" || !discovery.value.complete)
      return unavailable("source_incomplete");
    const unique = new Map<string, SettlementCandidate>();
    for (const c of discovery.value.candidates) {
      if (c.purpose !== kind) continue;
      const id = c.documentId.toLowerCase(),
        old = unique.get(id);
      if (old && billingPayloadDigest(old) !== billingPayloadDigest(c))
        return unavailable("source_scope_mismatch");
      unique.set(id, c);
      if (unique.size > FINANCIAL_LIMITS.verifyCap) return unavailable("verification_cap");
    }
    const candidates = [...unique.values()],
      rows: HotelFinancialEvent[] = [];
    let next = 0;
    await Promise.all(
      Array.from(
        { length: Math.min(FINANCIAL_LIMITS.verifyConcurrency, candidates.length) },
        async () => {
          while (next < candidates.length) {
            const c = candidates[next++];
            const proof = await deadline.run(() =>
              deps.prove(actor, c, deadline.controller.signal),
            );
            if (proof.kind !== "confirmed") {
              if (["unauthorized", "n3_session_expired"].includes(proof.code))
                throw new ReceiptControlError("unauthorized");
              throw new Error(proof.code);
            }
            const row = event(c, proof.value, actor, kind);
            if (row.documentDate >= period.startDate && row.documentDate < period.endExclusive)
              rows.push(row);
          }
        },
      ),
    );
    return {
      status: "complete",
      rows: rows.sort((a, b) => a.documentId.localeCompare(b.documentId)),
      verifiedAt: new Date(deps.now()).toISOString(),
      reasonCode: null,
    };
  } catch (e) {
    deadline.controller.abort();
    if (e instanceof ReceiptControlError && e.code === "unauthorized") throw e;
    return unavailable("source_incomplete");
  }
}
export const readSettlementSales = (
  actor: ReceiptControlActor,
  p: FinancialMonth,
  deps?: SettlementSourceDeps,
) => read(actor, p, "sale", deps);
export const readSettlementCollections = (
  actor: ReceiptControlActor,
  p: FinancialMonth,
  deps?: SettlementSourceDeps,
) => read(actor, p, "settlement", deps);
