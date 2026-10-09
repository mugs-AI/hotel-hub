import { createHash } from "node:crypto";
import {
  assertReceiptControllable,
  MAX_RECEIPT_CONTROL_CENTS,
  ReceiptControlError,
  type ReceiptSnapshot,
  type ReceiptControlProposal,
} from "./receipt-controls";
import {
  isSafeReferenceNo,
  postReceiptUpdate,
  n3Receipts,
  type N3Outcome,
  type N3ExecutionLimit,
} from "./n3-receipts.server";
import { AR_RECEIPT_UPDATE_FIELDS, AR_RECEIPT_PAYMENT_FIELDS } from "./n3-receipt-update-fields";
import type { ReceiptAutomationActor } from "./receipt-automation-gates.server";
export type N3UpdateContract = {
  proofId: string;
  receiptFields: readonly string[];
  paymentFields: readonly string[];
  conditionalWrite?: { sourceField: string; requestField: string };
  noWriteRejectionCodes: readonly string[];
};
export type PreparedReceiptUpdate = {
  body: unknown;
  payloadHash: string;
  sourceReceiptId?: string;
  sourceHash?: string;
};
// Documented endpoint/DTO contract. This is NOT a claim of live tenant acceptance or upstream CAS.
// Runtime enablement, installed schema, tenant allowlist and bounded execution remain separate.
export function productionUpdateContract(): N3UpdateContract {
  return {
    proofId: "SALES_V1_DOCUMENTED_UPDATE_20261008",
    receiptFields: AR_RECEIPT_UPDATE_FIELDS,
    paymentFields: AR_RECEIPT_PAYMENT_FIELDS,
    noWriteRejectionCodes: [],
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

const fail = (): never => {
  throw new ReceiptControlError("n3_update_unproven");
};
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  return v as Record<string, unknown>;
};
const cents = (v: unknown) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  Number.isSafeInteger(Math.round(v * 100)) &&
  Math.abs(v * 100 - Math.round(v * 100)) < 1e-6
    ? Math.round(v * 100)
    : null;
export function buildReceiptUpdatePayload(
  raw: unknown,
  original: ReceiptSnapshot,
  proposal: ReceiptControlProposal,
  contract: N3UpdateContract,
): PreparedReceiptUpdate {
  assertReceiptControllable(original);
  if (
    proposal.kind !== "correction" ||
    original.paymentLines.length !== 1 ||
    !Number.isSafeInteger(proposal.amountCents) ||
    proposal.amountCents <= 0 ||
    proposal.amountCents > MAX_RECEIPT_CONTROL_CENTS
  )
    return fail();
  const r = object(raw);
  if (Object.keys(r).some((k) => !contract.receiptFields.includes(k))) return fail();
  if (
    r.id !== original.receiptId ||
    r.docCode !== original.docCode ||
    typeof r.docDate !== "string" ||
    r.docDate.slice(0, 10) !== original.documentDate ||
    r.docType !== "AROR" ||
    String(r.customerId) !== original.customerId ||
    r.currencyCode !== original.currency ||
    r.referenceNo !== original.reference ||
    !isSafeReferenceNo(r.referenceNo) ||
    cents(r.totalAmount) !== original.amountCents ||
    cents(r.netTotalAmount) !== original.amountCents
  )
    return fail();
  if (
    r.isCancelled !== false ||
    r.cancelledDate !== null ||
    (contract.conditionalWrite ? r.isReconciled !== false : r.isReconciled === true) ||
    !Array.isArray(r.knockoff) ||
    r.knockoff.length !== 0 ||
    cents(r.refundAmount) !== 0 ||
    cents(r.outstandingAmount) !== original.amountCents
  )
    return fail();
  const conditional = contract.conditionalWrite;
  const token = conditional ? r[conditional.sourceField] : undefined;
  if (conditional && (typeof token !== "string" || !token.trim())) return fail();
  if (
    !conditional &&
    (!Number.isSafeInteger(r.updatedAt) ||
      Number(r.updatedAt) < 0 ||
      r.currencyRate !== 1 ||
      original.currency !== "MYR")
  )
    return fail();
  // Amount-only support cannot silently create tax, bank charges or currency differences.
  for (const key of [
    "taxTotalAmount",
    "taxTotalAmountLocal",
    "wTaxTotalAmount",
    "wTaxTotalAmountLocal",
    "wVatTotalAmount",
    "wVatTotalAmountLocal",
    "bankChargesAmount",
    "bankChargesAmountLocal",
    "roundingAdjustment",
    "roundingAdjustmentLocal",
    "refundAmountLocal",
  ])
    if (key in r && cents(r[key]) !== 0) return fail();
  if (r.isMultiPayment !== true || !Array.isArray(r.multiPayments) || r.multiPayments.length !== 1)
    return fail();
  const line = object(r.multiPayments[0]);
  if (
    Object.keys(line).some((k) => !contract.paymentFields.includes(k)) ||
    line.accountId !== original.paymentLines[0]!.accountId ||
    r.accountId !== line.accountId ||
    cents(line.amount) !== original.amountCents
  )
    return fail();
  for (const key of ["customerName", "remark1", "remark2", "remark3", "remark4"] as const)
    if ((r[key] ?? "") !== original.contact[key] || typeof proposal.contact[key] !== "string")
      return fail();
  if (!proposal.accountId) return fail();
  // Full original fields are preserved; unknown fields are rejected, never discarded.
  const body = {
    ...structuredClone(r),

    totalAmount: proposal.amountCents / 100,
    netTotalAmount: proposal.amountCents / 100,
    outstandingAmount: proposal.amountCents / 100,
    accountId: proposal.accountId,
    multiPayments: [
      {
        ...structuredClone(line),
        accountId: proposal.accountId,
        amount: proposal.amountCents / 100,
      },
    ],
    ...(conditional ? { [conditional.requestField]: token } : {}),
  };
  for (const key of ["customerName", "remark1", "remark2", "remark3", "remark4"] as const)
    if (proposal.contact[key] !== original.contact[key])
      (body as Record<string, unknown>)[key] = proposal.contact[key];
  const totals = [
    "totalAmountLocal",
    "netTotalAmountLocal",
    "outstandingAmountLocal",
    "subtotalAmount",
    "subtotalAmountLocal",
    "taxExclusiveTotalAmount",
    "taxExclusiveTotalAmountLocal",
  ];
  for (const key of totals)
    if (key in r) {
      if (cents(r[key]) === original.amountCents)
        (body as Record<string, unknown>)[key] = proposal.amountCents / 100;
      else if (
        ![
          "subtotalAmount",
          "subtotalAmountLocal",
          "taxExclusiveTotalAmount",
          "taxExclusiveTotalAmountLocal",
        ].includes(key) ||
        cents(r[key]) !== 0
      )
        return fail();
    }
  if ("amountLocal" in line) {
    if (cents(line.amountLocal) !== original.amountCents) return fail();
    (body.multiPayments[0] as Record<string, unknown>).amountLocal = proposal.amountCents / 100;
  }
  for (const key of ["bankChargesAmount", "bankChargesAmountLocal"])
    if (key in line && cents(line[key]) !== 0) return fail();
  // An account code cannot stay silently attached to a different immutable account.
  if (proposal.accountId.toLowerCase() !== original.paymentLines[0]!.accountId.toLowerCase())
    return fail();
  return {
    body,
    payloadHash: digest(body),
    sourceReceiptId: original.receiptId,
    sourceHash: digest(r),
  };
}
export async function updateN3Receipt(
  actor: ReceiptAutomationActor,
  prepared: PreparedReceiptUpdate,
  limit: N3ExecutionLimit,
): Promise<N3Outcome> {
  if (actor.role !== "owner") throw new ReceiptControlError("forbidden");
  if (limit.signal.aborted || limit.deadlineAt <= Date.now())
    return { kind: "transport_error", reason: "timeout", durationMs: 0 };
  if (!prepared.sourceReceiptId || !prepared.sourceHash) return fail();
  const current = await n3Receipts.getById(actor.n3Token, prepared.sourceReceiptId, limit);
  if (current.kind !== "response") return current;
  if (current.status === 401) throw new ReceiptControlError("unauthorized");
  const envelope = object(current.body);
  if (
    current.status < 200 ||
    current.status >= 300 ||
    envelope.success !== true ||
    envelope.code !== "0000" ||
    !envelope.data
  )
    throw new ReceiptControlError("n3_evidence_unavailable");
  if (digest(envelope.data) !== prepared.sourceHash)
    throw new ReceiptControlError("n3_changed_since_request");
  // The read/write interval still permits an outside race. Both overrides remain false;
  // coordinator readback must prove the result before any effective local update.
  return postReceiptUpdate(actor.n3Token, prepared.body, limit);
}
