import type { Cents, EvidenceResult } from "./settlement";
import { MAX_MONEY_CENTS, sumCents } from "./checkout-money";

const valid = (n: number): boolean => Number.isSafeInteger(n) && n >= 0 && n <= MAX_MONEY_CENTS;

export function receiptRemainder(input: {
  amountCents: Cents;
  allocatedCents: Cents;
  refundCents: Cents | null;
}): EvidenceResult<Cents> {
  const { amountCents, allocatedCents, refundCents } = input;
  if (!valid(amountCents) || !valid(allocatedCents))
    return { kind: "contradiction", code: "invalid_money_cents" };
  if (refundCents === null) return { kind: "unavailable", code: "receipt_refund_unproven" };
  if (!valid(refundCents)) return { kind: "contradiction", code: "invalid_money_cents" };
  const consumed = sumCents([allocatedCents, refundCents]);
  if (consumed === null || consumed > amountCents)
    return { kind: "contradiction", code: "receipt_conservation_mismatch" };
  return { kind: "confirmed", value: amountCents - consumed };
}

export function planAllocation(input: {
  receiptRemainderCents: Cents;
  billOutstandingCents: Cents;
}): EvidenceResult<Cents> {
  const { receiptRemainderCents, billOutstandingCents } = input;
  if (!valid(receiptRemainderCents) || !valid(billOutstandingCents))
    return { kind: "contradiction", code: "invalid_money_cents" };
  return { kind: "confirmed", value: Math.min(receiptRemainderCents, billOutstandingCents) };
}
