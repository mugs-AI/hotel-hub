import { centsToAmount, isCents, parseCents, sumCents } from "./folio-money";

type RecordedDeposit = {
  status: string;
  amount: number;
  currencyCode: string;
  n3DocCode: string | null;
  createdAt: string;
  /** Receipt-controls effective state; voided receipts never count. */
  effectiveState?: "active" | "voided";
  /** Warning only; never changes whether a confirmed receipt counts. */
  needsReview?: boolean;
};
const counts = (row: RecordedDeposit) => row.status === "posted" && row.effectiveState !== "voided";
export type RecordedDepositSummary = {
  total: number;
  currency: string | null;
  count: number;
  hasUnconfirmed: boolean;
};
export type RecordedDepositStatement = RecordedDepositSummary & {
  netFigure: number;
  items: Array<{ n3DocCode: string | null; createdAt: string; amount: number; currency: string }>;
};
/** Posted ledger evidence only; this is a prepared figure, never an N3 knockoff. */
export function summarizePostedDeposits(
  rows: readonly RecordedDeposit[],
  expectedCurrency?: string,
): RecordedDepositSummary {
  const posted = rows.filter(counts);
  const currency = expectedCurrency?.toUpperCase() ?? posted[0]?.currencyCode.toUpperCase() ?? null;
  const amounts = posted.map((row) => {
    const cents = parseCents(row.amount);
    if (row.currencyCode.toUpperCase() !== currency || cents === null)
      throw new Error("unsafe_deposit_ledger");
    return cents;
  });
  const total = sumCents(amounts);
  if (total === null) throw new Error("unsafe_deposit_ledger");
  return {
    total: centsToAmount(total),
    currency,
    count: posted.length,
    hasUnconfirmed: rows.some(
      (row) => row.status === "unknown" || row.status === "submitting" || row.needsReview === true,
    ),
  };
}
export function recordedDepositStatement(
  rows: readonly RecordedDeposit[],
  currency: string,
  grandTotal: number,
): RecordedDepositStatement {
  const summary = summarizePostedDeposits(rows, currency);
  const grandMagnitude = parseCents(Math.abs(grandTotal));
  const grandCents = grandMagnitude === null ? null : grandMagnitude * (grandTotal < 0 ? -1 : 1),
    depositCents = parseCents(summary.total);
  if (grandCents === null || depositCents === null || !isCents(grandCents - depositCents))
    throw new Error("unsafe_deposit_ledger");
  return {
    ...summary,
    netFigure: centsToAmount(grandCents - depositCents),
    items: rows.filter(counts).map((row) => ({
      n3DocCode: row.n3DocCode,
      createdAt: row.createdAt,
      amount: row.amount,
      currency,
    })),
  };
}
