import { describe, expect, it } from "vitest";
import { recordedDepositStatement } from "../recorded-deposits";
const row = (amount: number) => ({
  status: "posted",
  amount,
  currencyCode: "MYR",
  n3DocCode: "OR2610/001",
  createdAt: "2026-10-01T00:00:00Z",
});
describe("recorded deposit cent calculation", () => {
  it("adds fractional amounts exactly and preserves a negative net as credit", () => {
    expect(recordedDepositStatement([row(0.1), row(0.2)], "MYR", 0.25)).toMatchObject({
      total: 0.3,
      netFigure: -0.05,
    });
  });
  it("supports a signed prepared total", () => {
    expect(recordedDepositStatement([row(0.1)], "MYR", -0.25)).toMatchObject({ netFigure: -0.35 });
  });
  it("rejects an overflowing posted total", () => {
    expect(() => recordedDepositStatement([row(10000000), row(0.01)], "MYR", 1)).toThrow(
      "unsafe_deposit_ledger",
    );
  });
});
