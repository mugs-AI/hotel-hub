import { describe, expect, it } from "vitest";
import {
  parsePaymentAmount,
  parseSettlementPaymentLines,
  validateSettlementPaymentLines,
} from "../settlement-payment-entry";

const cash = "11111111-1111-6111-f111-111111111111";
const card = "22222222-2222-6222-f222-222222222222";
describe("actual checkout payment entry", () => {
  it("keeps cash/card amounts in exact cents", () => {
    expect(parsePaymentAmount("532.27")).toBe(53227);
    expect(parsePaymentAmount("532.28")).toBe(53228);
    expect(
      validateSettlementPaymentLines(
        [
          { accountId: cash, amountCents: 53227 },
          { accountId: card, amountCents: 53228 },
        ],
        106455,
      ),
    ).toEqual({
      kind: "confirmed",
      value: [
        { accountId: cash, amountCents: 53227 },
        { accountId: card, amountCents: 53228 },
      ],
    });
  });
  it.each(["1e2", "0x20", "1.001", "-1", "0", "", "1,000", "Infinity"])(
    "refuses non-payment decimal %s",
    (amount) => {
      expect(parsePaymentAmount(amount)).toBeNull();
    },
  );
  it("allows whole notes and formats from integer cents without rounding input", () => {
    expect(parsePaymentAmount("50")).toBe(5000);
    expect(parsePaymentAmount("50.1")).toBe(5010);
  });
  it.each([106454, 106456, 0, NaN, 1.5])(
    "refuses a total different from fresh positive outstanding %s",
    (balance) => {
      expect(
        validateSettlementPaymentLines([{ accountId: cash, amountCents: 106455 }], balance).kind,
      ).toBe("unavailable");
    },
  );
  it("rejects forged authority, invalid amounts and duplicate account aliases", () => {
    for (const rows of [
      [],
      [{ accountId: cash, amountCents: 0 }],
      [{ accountId: cash, amountCents: 1.5 }],
      [{ accountId: cash, amountCents: 1, tenantId: "alien" }],
      [
        { accountId: cash, amountCents: 1 },
        { accountId: cash.toUpperCase(), amountCents: 2 },
      ],
      Array.from({ length: 11 }, () => ({ accountId: cash, amountCents: 1 })),
    ]) {
      expect(parseSettlementPaymentLines(rows)).toBeNull();
    }
  });
});
