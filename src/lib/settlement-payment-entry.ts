import { MAX_MONEY_CENTS, sumCents } from "./checkout-money";
import { isN3Guid } from "./n3-guid";
import type { EvidenceResult } from "./settlement";

export type SettlementPaymentLine = { accountId: string; amountCents: number };
export const MAX_SETTLEMENT_PAYMENT_LINES = 10;

/** Actual amounts use plain decimal input; no rounding, exponent or hex coercion. */
export function parsePaymentAmount(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_MONEY_CENTS ? cents : null;
}

export function parseSettlementPaymentLines(value: unknown): SettlementPaymentLine[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SETTLEMENT_PAYMENT_LINES)
    return null;
  const seen = new Set<string>();
  const result: SettlementPaymentLine[] = [];
  for (const row of value) {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).sort().join(",") !== "accountId,amountCents" ||
      !isN3Guid(row.accountId) ||
      !Number.isSafeInteger(row.amountCents) ||
      row.amountCents <= 0 ||
      row.amountCents > MAX_MONEY_CENTS
    )
      return null;
    const id = row.accountId.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    result.push({ accountId: id, amountCents: row.amountCents });
  }
  return sumCents(result.map((row) => row.amountCents)) === null ? null : result;
}

/** The server supplies fresh outstanding; the browser never supplies balance authority. */
export function validateSettlementPaymentLines(
  value: unknown,
  outstandingCents: number,
): EvidenceResult<SettlementPaymentLine[]> {
  const rows = parseSettlementPaymentLines(value);
  if (!rows) return { kind: "unavailable", code: "settlement_payment_invalid" };
  if (
    !Number.isSafeInteger(outstandingCents) ||
    outstandingCents <= 0 ||
    outstandingCents > MAX_MONEY_CENTS ||
    sumCents(rows.map((row) => row.amountCents)) !== outstandingCents
  )
    return { kind: "unavailable", code: "settlement_payment_total_mismatch" };
  return { kind: "confirmed", value: rows };
}
