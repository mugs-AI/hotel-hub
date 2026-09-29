// A printable deposit receipt requires live N3 AROR evidence. It never proves
// the stay's final balance, and an allocated receipt remains a valid receipt.
import { isRealN3Id, type N3Outcome } from "./n3-receipts.server";

export type ReceiptExpectation = {
  id: string;
  docCode: string;
  referenceNo: string;
  customerId: string;
  currency: string;
  amountCents: number;
};

type Verdict =
  | { ok: true }
  | { ok: false; code: "unauthorized" | "n3_receipt_unavailable" | "n3_receipt_mismatch" };

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function field(v: Record<string, unknown>, key: string): unknown {
  const found = Object.keys(v).find((k) => k.toLowerCase() === key.toLowerCase());
  return found === undefined ? undefined : v[found];
}

function string(v: unknown): string | null {
  return typeof v === "string" && v.trim()
    ? v.trim()
    : typeof v === "number" && Number.isFinite(v)
      ? String(v)
      : null;
}

function affirmative(v: unknown): boolean {
  return (
    v === true ||
    v === 1 ||
    (typeof v === "string" && ["true", "yes", "y", "1"].includes(v.trim().toLowerCase()))
  );
}

export function verifyDepositReceipt(outcome: N3Outcome, expected: ReceiptExpectation): Verdict {
  if (outcome.kind !== "response") return { ok: false, code: "n3_receipt_unavailable" };
  if (outcome.status === 401) return { ok: false, code: "unauthorized" };
  if (outcome.status < 200 || outcome.status >= 300)
    return { ok: false, code: "n3_receipt_unavailable" };
  const envelope = record(outcome.body);
  const data = record(envelope?.data);
  const value = record(data?.value) ?? data;
  if (!envelope || envelope.code !== "0000" || envelope.success === false || !value)
    return { ok: false, code: "n3_receipt_mismatch" };

  const money =
    field(value, "netTotalAmount") ??
    field(value, "totalAmount") ??
    field(value, "amount") ??
    field(value, "paymentAmount");
  const amount =
    typeof money === "number"
      ? money
      : typeof money === "string" && money.trim()
        ? Number(money)
        : NaN;
  const currencyObj = record(field(value, "currency"));
  const customerObj = record(field(value, "customer"));
  const currency =
    string(field(value, "currencyCode")) ??
    (currencyObj ? string(field(currencyObj, "code")) : null);
  const customer =
    string(field(value, "customerId")) ?? (customerObj ? string(field(customerObj, "id")) : null);
  const status = string(field(value, "status") ?? field(value, "documentStatus"))?.toLowerCase();
  const voided =
    ["void", "voided", "cancelled", "canceled"].includes(status ?? "") ||
    affirmative(field(value, "isVoid")) ||
    affirmative(field(value, "isVoided")) ||
    affirmative(field(value, "isCancelled"));

  if (
    !isRealN3Id(expected.id) ||
    string(field(value, "id")) !== expected.id ||
    string(field(value, "docCode") ?? field(value, "docNo")) !== expected.docCode ||
    string(field(value, "docType")) !== "AROR" ||
    string(field(value, "referenceNo")) !== expected.referenceNo ||
    customer !== expected.customerId ||
    currency?.toUpperCase() !== expected.currency.toUpperCase() ||
    !Number.isFinite(amount) ||
    Math.abs(amount * 100 - expected.amountCents) > 0.001 ||
    voided
  ) {
    return { ok: false, code: "n3_receipt_mismatch" };
  }
  return { ok: true };
}
