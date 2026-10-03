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
  type N3Outcome,
  type N3ExecutionLimit,
} from "./n3-receipts.server";
import type { ReceiptAutomationActor } from "./receipt-automation-gates.server";
export type N3UpdateContract = {
  proofId: string;
  receiptFields: readonly string[];
  paymentFields: readonly string[];
  conditionalWrite: { sourceField: string; requestField: string };
  noWriteRejectionCodes: readonly string[];
};
export type PreparedReceiptUpdate = { body: unknown; payloadHash: string };
// Owner sandbox proof, upstream conditional write and managed deadline are NOT proven.
export function productionUpdateContract(): N3UpdateContract | null {
  return null;
}
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
    r.docDate !== original.documentDate ||
    r.docType !== "AROR" ||
    r.customerId !== original.customerId ||
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
    r.isReconciled !== false ||
    !Array.isArray(r.knockoff) ||
    r.knockoff.length !== 0 ||
    cents(r.refundAmount) !== 0 ||
    cents(r.outstandingAmount) !== original.amountCents
  )
    return fail();
  const token = r[contract.conditionalWrite.sourceField];
  if (typeof token !== "string" || !token.trim()) return fail();
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
    if (r[key] !== original.contact[key] || typeof proposal.contact[key] !== "string")
      return fail();
  if (!proposal.accountId) return fail();
  // Full original fields are preserved; unknown fields are rejected, never discarded.
  const body = {
    ...structuredClone(r),
    ...proposal.contact,
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
    [contract.conditionalWrite.requestField]: token,
  };
  // An account code cannot stay silently attached to a different immutable account.
  if (proposal.accountId.toLowerCase() !== original.paymentLines[0]!.accountId.toLowerCase())
    return fail();
  return { body, payloadHash: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}
export async function updateN3Receipt(
  actor: ReceiptAutomationActor,
  prepared: PreparedReceiptUpdate,
  limit: N3ExecutionLimit,
): Promise<N3Outcome> {
  if (actor.role !== "owner") throw new ReceiptControlError("forbidden");
  return postReceiptUpdate(actor.n3Token, prepared.body, limit);
}
