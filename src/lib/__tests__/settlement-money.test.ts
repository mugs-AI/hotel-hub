import { describe, expect, it } from "vitest";
import { planAllocation, receiptRemainder } from "../settlement-money";

// Independent expectations: allocating/refunding already used money, accepting
// fractional minor units, or assuming a missing refund is zero breaks these.
describe("settlement receipt conservation", () => {
  it("conserves_refunded_receipt", () => {
    expect(
      receiptRemainder({ amountCents: 10001, allocatedCents: 6001, refundCents: 4000 }),
    ).toEqual({ kind: "confirmed", value: 0 });
  });

  it("returns the unapplied remainder after both allocation and refund", () => {
    expect(
      receiptRemainder({ amountCents: 10000, allocatedCents: 4000, refundCents: 2000 }),
    ).toEqual({ kind: "confirmed", value: 4000 });
  });

  it("missing_refund_is_unavailable", () => {
    expect(
      receiptRemainder({ amountCents: 10001, allocatedCents: 6001, refundCents: null }),
    ).toEqual({ kind: "unavailable", code: "receipt_refund_unproven" });
  });

  it("rejects allocation and refund exceeding the receipt", () => {
    expect(
      receiptRemainder({ amountCents: 5000, allocatedCents: 4000, refundCents: 2000 }),
    ).toEqual({ kind: "contradiction", code: "receipt_conservation_mismatch" });
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 1_000_000_001])(
    "rejects_unsafe_or_fractional_cents: %s in every receipt field",
    (invalid) => {
      for (const field of ["amountCents", "allocatedCents", "refundCents"] as const) {
        expect(
          receiptRemainder({
            amountCents: 5000,
            allocatedCents: 0,
            refundCents: 0,
            [field]: invalid,
          }),
        ).toEqual({ kind: "contradiction", code: "invalid_money_cents" });
      }
    },
  );

  it("does not hide an invalid receipt behind an unknown refund", () => {
    expect(receiptRemainder({ amountCents: -1, allocatedCents: 0, refundCents: null }).kind).toBe(
      "contradiction",
    );
  });

  it("accepts zero and the existing maximum money boundary", () => {
    expect(receiptRemainder({ amountCents: 0, allocatedCents: 0, refundCents: 0 })).toEqual({
      kind: "confirmed",
      value: 0,
    });
    expect(
      receiptRemainder({ amountCents: 1_000_000_000, allocatedCents: 0, refundCents: 0 }),
    ).toEqual({ kind: "confirmed", value: 1_000_000_000 });
  });
});

describe("settlement allocation planning", () => {
  it.each([
    [5000, 3000, 3000],
    [3000, 5000, 3000],
    [5000, 5000, 5000],
    [0, 5000, 0],
    [5000, 0, 0],
    [1, 5000, 1],
  ])("never_allocates_over_remaining: receipt %i, bill %i", (receipt, bill, want) => {
    expect(planAllocation({ receiptRemainderCents: receipt, billOutstandingCents: bill })).toEqual({
      kind: "confirmed",
      value: want,
    });
  });

  it.each([NaN, Infinity, -1, 0.01, Number.MAX_SAFE_INTEGER + 1, 1_000_000_001])(
    "rejects invalid receipt or bill amount %s",
    (invalid) => {
      expect(
        planAllocation({ receiptRemainderCents: invalid, billOutstandingCents: 5000 }).kind,
      ).toBe("contradiction");
      expect(
        planAllocation({ receiptRemainderCents: 5000, billOutstandingCents: invalid }).kind,
      ).toBe("contradiction");
    },
  );
});
