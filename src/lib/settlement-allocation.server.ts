import type {
  EvidenceResult,
  SettlementSnapshot,
  AcceptedContract,
  LinkedReceipt,
} from "./settlement";
import type { SettlementActor } from "./settlement-context.server";
import {
  verifiedBillBoundTo,
  verifiedEvidencePair,
  verifiedBillActorMatches,
  type VerifiedBill,
  type VerifiedReceiptBefore,
} from "./settlement-evidence.server";
import {
  billingPayloadDigest,
  buildBalanceReceiptPayload,
  n3BillingClient,
  billingPaymentAccountBoundTo,
  type AllocationPostRow,
  type BalanceReceiptInput,
} from "./n3-billing.server";
import { parseDepositAccount, successfulEnvelope, valuesFor } from "./deposits-store.server";
import { billingContractGate } from "./settlement-contracts.server";
import { formatReceiptContact } from "./receipt-contact";
import { planAllocation } from "./settlement-money";
import { propertyTodayIso } from "./checkout-preview";
export type VerifiedPaymentAccount = {
  id: string;
  code: string;
  name: string;
  kind: "bank" | "cash";
  currencyId: number;
  evidenceFingerprint: string;
};
export type AllocationPlan = {
  rows: AllocationPostRow[];
  newAmountCents: number;
  expectedTotalToBillCents: number;
  expectedAfterFingerprint: string;
  payloadDigest: string;
};
export type BalanceIntent = {
  purpose: "settlement";
  intentId: string;
  amountCents: number;
  accountId: string;
  payload: BalanceReceiptInput;
  payloadDigest: string;
};
const accounts = new WeakMap<
  object,
  { actor: SettlementActor; snapshotHash: string; verifiedAt: number }
>();
const unavailable = (code: string): EvidenceResult<never> => ({ kind: "unavailable", code });
const hash = (s: string | null | undefined) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v;
}
const mappingBlocked = (s: SettlementSnapshot) =>
  s.lines.some((l) =>
    ["stockWarning", "stockAvailabilityWarning", "unsupportedMapping"].some(
      (k) => l.mappingEvidence[k] === true,
    ),
  );
export function orderedSettlementReceipts(s: SettlementSnapshot): LinkedReceipt[] {
  return [...s.receipts].sort(
    (a, b) => a.receiptDate.localeCompare(b.receiptDate) || a.receiptId.localeCompare(b.receiptId),
  );
}
function priorSupported(r: VerifiedReceiptBefore): boolean {
  const fields = new Set(
    "customerId receiptDocType receiptDocId docType docId paymentAmount docDate taxDate docCode description referenceNo projectCode termCode phoneNo1 reason attention agentCode agentName locationCode reference1 reference2 reference3 reference4 remark1 remark2 remark3 remark4 currencyCode currencyRate billingAddress amount amountLocal outstandingAmount paymentAmountLocal payForAmountLocal totalPaidByOtherDocs uuid eInvoiceStatus"
      .toLowerCase()
      .split(" "),
  );
  const zeroOnly = new Set(
    "totalWTaxAmount totalWTaxAmountLocal totalWVatAmount totalWVatAmountLocal svtD6TaxAmount svtD6TaxAmountLocal svtD8TaxAmount svtD8TaxAmountLocal"
      .toLowerCase()
      .split(" "),
  );
  for (const allocation of r.allocations)
    for (const [key, value] of Object.entries(allocation.source)) {
      const k = key.toLowerCase();
      if (zeroOnly.has(k)) {
        if (value !== 0 && value !== "0" && value !== "0.00") return false;
      } else if (k === "armatchedbywtaxdata" || k === "armatchedbywvatdata") {
        if (!Array.isArray(value) || value.length) return false;
      } else if (k === "hassvt6" || k === "hassvt8") {
        if (value !== false) return false;
      } else if (!fields.has(k)) return false;
      if (
        (k === "paymentamountlocal" || k === "payforamountlocal") &&
        Number(value) * 100 !== allocation.amountCents
      )
        return false;
    }
  return true;
}
export function buildAllocationRows(
  s: SettlementSnapshot,
  b: VerifiedBill,
  r: VerifiedReceiptBefore,
  c: AcceptedContract,
): EvidenceResult<AllocationPlan> {
  try {
    if (!verifiedEvidencePair(b, r, s)) return unavailable("n3_evidence_untrusted");
    const operation = "purpose" in r.receipt ? "balance_allocation" : "deposit_allocation";
    if (
      c.operation !== operation ||
      !hash(c.evidenceHash) ||
      !hash(c.concurrencyProofHash) ||
      c.allocationMode !== "preserve_existing"
    )
      return unavailable("n3_allocation_concurrency_unverified");
    if (mappingBlocked(s)) return unavailable("n3_stock_or_mapping_warning");
    if ("purpose" in r.receipt && r.receipt.intentId !== b.intentId)
      return unavailable("receipt_scope_mismatch");
    if (r.allocations.some((a) => a.docId === b.targetId && a.docType === b.targetType))
      return unavailable("settlement_allocation_already_applied");
    if (r.refundCents !== 0 || !priorSupported(r))
      return unavailable("receipt_prior_matching_requires_review");
    const planned = planAllocation({
      receiptRemainderCents: r.remainderCents,
      billOutstandingCents: b.outstandingCents,
    });
    if (planned.kind !== "confirmed") return planned;
    if (planned.value <= 0) return unavailable("settlement_no_allocation_required");
    const row = (type: "INV" | "DN", docId: string, cents: number): AllocationPostRow => ({
      customerId: s.customerId,
      receiptDocType: "OR",
      receiptDocId: r.receipt.receiptId,
      docType: type,
      docId,
      paymentAmount: cents / 100,
    });
    const rows = [
      ...r.allocations.map((a) => row(a.docType, a.docId, a.amountCents)),
      row(b.targetType, b.targetId, planned.value),
    ];
    const after = {
      receiptId: r.receipt.receiptId,
      amountCents: r.amountCents,
      refundCents: r.refundCents,
      remainderCents: r.remainderCents - planned.value,
      allocations: rows
        .map((x) => ({
          docType: x.docType,
          docId: x.docId,
          amountCents: Math.round(x.paymentAmount * 100),
        }))
        .sort((a, b) => (a.docType + ":" + a.docId).localeCompare(b.docType + ":" + b.docId)),
    };
    return {
      kind: "confirmed",
      value: freeze({
        rows,
        newAmountCents: planned.value,
        expectedTotalToBillCents: planned.value,
        expectedAfterFingerprint: billingPayloadDigest(after),
        payloadDigest: billingPayloadDigest(rows),
      }),
    };
  } catch {
    return unavailable("settlement_allocation_unavailable");
  }
}
export async function verifySettlementPaymentAccount(
  s: SettlementSnapshot,
  a: SettlementActor,
  selectedId: string,
): Promise<EvidenceResult<VerifiedPaymentAccount>> {
  try {
    if (s.tenantId !== a.tenantId || s.reservationId !== a.reservationId)
      return unavailable("settlement_scope_mismatch");
    const out = await n3BillingClient.readPaymentAccount(a, selectedId);
    if (out.kind === "response" && out.status === 401) return unavailable("unauthorized");
    if (
      !billingPaymentAccountBoundTo(out, a, selectedId) ||
      out.kind !== "response" ||
      out.status < 200 ||
      out.status >= 300 ||
      !successfulEnvelope(out.body)
    )
      return unavailable("n3_payment_account_unavailable");
    const data = valuesFor(out.body, ["data"]);
    if (!data.length || data.some((x) => billingPayloadDigest(x) !== billingPayloadDigest(data[0])))
      return unavailable("n3_payment_account_invalid");
    let detail = data[0];
    const wrappers = valuesFor(detail, ["value"]);
    if (wrappers.length) {
      if (wrappers.some((x) => billingPayloadDigest(x) !== billingPayloadDigest(wrappers[0])))
        return unavailable("n3_payment_account_invalid");
      detail = wrappers[0];
    }
    const coherent = (keys: string[], normalize: (v: unknown) => unknown = (v) => v): boolean => {
      const vs = valuesFor(detail, keys);
      if (!vs.length) return false;
      const cs = vs.map(normalize);
      return cs.every((x) => billingPayloadDigest(x) === billingPayloadDigest(cs[0]));
    };
    if (
      !coherent(["id"], (v) => (typeof v === "string" ? v.toLowerCase() : v)) ||
      !coherent(["code"]) ||
      !coherent(["name"]) ||
      !coherent(["specialCode"]) ||
      !coherent(["isActive"]) ||
      !coherent(["hasChildren"]) ||
      !coherent(["currencyId"], (v) =>
        typeof v === "string" && /^[1-9]\d*$/.test(v) ? Number(v) : v,
      )
    )
      return unavailable("n3_payment_account_invalid");
    const types = valuesFor(detail, ["accountType"]);
    if (
      !types.length ||
      types.some((t) => {
        const codes = valuesFor(t, ["typeCode"]);
        return !codes.length || codes.some((c) => c !== "BCA");
      })
    )
      return unavailable("n3_payment_account_invalid");
    for (const currency of valuesFor(detail, ["currency"])) {
      const ids = valuesFor(currency, ["id"]);
      if (!ids.length || ids.some((v) => Number(v) !== s.currencyId))
        return unavailable("n3_payment_account_invalid");
    }
    const parsed = parseDepositAccount(
      {
        kind: "response",
        status: 200,
        body: { code: "0000", data: detail },
        durationMs: out.durationMs,
      },
      selectedId,
      String(s.currencyId),
    );
    if (!parsed) return unavailable("n3_payment_account_invalid");
    const value = freeze({
      ...parsed,
      id: parsed.id.toLowerCase(),
      currencyId: s.currencyId,
      evidenceFingerprint: billingPayloadDigest(detail),
    });
    accounts.set(value, {
      actor: { ...a },
      snapshotHash: billingPayloadDigest(s),
      verifiedAt: Date.now(),
    });
    return { kind: "confirmed", value };
  } catch {
    return unavailable("n3_payment_account_unavailable");
  }
}
export function buildBalanceIntent(
  s: SettlementSnapshot,
  b: VerifiedBill,
  a: VerifiedPaymentAccount,
): EvidenceResult<BalanceIntent> {
  try {
    const meta = accounts.get(a);
    if (
      !meta ||
      Date.now() < meta.verifiedAt ||
      Date.now() - meta.verifiedAt > 60000 ||
      meta.snapshotHash !== billingPayloadDigest(s) ||
      !verifiedBillBoundTo(b, s) ||
      !verifiedBillActorMatches(b, s, meta.actor)
    )
      return unavailable("n3_evidence_untrusted");
    const gate = billingContractGate("balance_receipt");
    if (gate.kind !== "confirmed") return gate;
    if (gate.value.operation !== "balance_receipt" || !hash(gate.value.evidenceHash))
      return unavailable("n3_billing_contract_unverified");
    if (mappingBlocked(s)) return unavailable("n3_stock_or_mapping_warning");
    if (
      !Number.isSafeInteger(b.outstandingCents) ||
      b.outstandingCents <= 0 ||
      b.outstandingCents > s.totalCents
    )
      return unavailable("settlement_no_balance_required");
    const paymentDate = propertyTodayIso(s.propertyTimezone, new Date());
    if (!paymentDate) return unavailable("settlement_payment_date_unavailable");
    const payload: BalanceReceiptInput = {
      customerId: s.customerId,
      currencyId: s.currencyId,
      currencyRate: s.currencyRate,
      amountCents: b.outstandingCents,
      accountId: a.id,
      docDate: paymentDate,
      contact: formatReceiptContact(s.billTo),
    };
    const wire = buildBalanceReceiptPayload(payload, { intentId: b.intentId });
    return {
      kind: "confirmed",
      value: freeze({
        purpose: "settlement",
        intentId: b.intentId,
        amountCents: b.outstandingCents,
        accountId: a.id,
        payload,
        payloadDigest: billingPayloadDigest(wire),
      }),
    };
  } catch {
    return unavailable("settlement_balance_unavailable");
  }
}
