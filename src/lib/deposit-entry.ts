import type { PaymentLine } from "./deposits-client";

export type DepositInputLine = { accountId: string; amount: string };
const LIMIT_CENTS = 100_000_000;

function cents(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return null;
  const [whole, decimals = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(result) && result >= 0 && result <= LIMIT_CENTS ? result : null;
}

/** Format valid money on blur; invalid precision stays visible for correction. */
export function formatDepositInput(raw: string): string {
  const value = cents(raw);
  return value === null ? raw : (value / 100).toFixed(2);
}

/** Derive the total in cents; the server still independently verifies every line. */
export function depositEntry(
  lines: readonly DepositInputLine[],
  canSplit: boolean,
):
  | { ok: true; amount: number; paymentLines: PaymentLine[] }
  | { ok: false; reason: "split_disabled" | "invalid_lines"; message: string } {
  if (lines.length > 1 && !canSplit)
    return {
      ok: false,
      reason: "split_disabled",
      message: "Only one payment method is enabled for this property.",
    };
  const paymentLines: PaymentLine[] = [];
  let total = 0;
  for (const line of lines) {
    const value = cents(line.amount);
    if (
      !line.accountId ||
      value === null ||
      value <= 0 ||
      paymentLines.some((p) => p.accountId === line.accountId)
    )
      return {
        ok: false,
        reason: "invalid_lines",
        message:
          "Choose a payment method and enter a positive amount with at most 2 decimals. Each method must be different.",
      };
    total += value;
    paymentLines.push({ accountId: line.accountId, amount: value / 100 });
  }
  if (!lines.length || lines.length > 10 || total > LIMIT_CENTS)
    return {
      ok: false,
      reason: "invalid_lines",
      message: "The deposit total must be between 0.01 and 1,000,000.00.",
    };
  return { ok: true, amount: total / 100, paymentLines };
}
