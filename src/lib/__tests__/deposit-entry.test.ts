import { describe, expect, it } from "vitest";
import { depositEntry, formatDepositInput } from "@/lib/deposit-entry";

describe("deposit entry from chosen payment lines", () => {
  it("uses a single payment amount as the deposit total without a second input", () => {
    expect(depositEntry([{ accountId: "bank", amount: "50" }], false)).toEqual({
      ok: true,
      amount: 50,
      paymentLines: [{ accountId: "bank", amount: 50 }],
    });
  });
  it.each([
    ["50", "50.00"],
    ["40.3", "40.30"],
    ["0.10", "0.10"],
    ["", ""],
    ["-1", "-1"],
    ["40.333", "40.333"],
  ])("formats %s on blur without rounding invalid precision", (raw, want) => {
    expect(formatDepositInput(raw)).toBe(want);
  });
  it("adds enabled split amounts in cents", () => {
    expect(
      depositEntry(
        [
          { accountId: "a", amount: "0.10" },
          { accountId: "b", amount: "0.20" },
        ],
        true,
      ),
    ).toMatchObject({ ok: true, amount: 0.3 });
  });
  it("rejects a split when its financial gate is closed", () => {
    expect(
      depositEntry(
        [
          { accountId: "a", amount: "50" },
          { accountId: "b", amount: "20" },
        ],
        false,
      ),
    ).toMatchObject({ ok: false, reason: "split_disabled" });
  });
  it.each([
    { accountId: "", amount: "50" },
    { accountId: "a", amount: "0" },
    { accountId: "a", amount: "40.333" },
    { accountId: "a", amount: "1e2" },
    { accountId: "a", amount: "1000000.01" },
  ])("rejects invalid entries %j", (line) => {
    expect(depositEntry([line], true).ok).toBe(false);
  });
  it("rejects duplicate accounts and an aggregate above the server limit", () => {
    expect(
      depositEntry(
        [
          { accountId: "a", amount: "50" },
          { accountId: "a", amount: "20" },
        ],
        true,
      ).ok,
    ).toBe(false);
    expect(
      depositEntry(
        [
          { accountId: "a", amount: "600000" },
          { accountId: "b", amount: "600000" },
        ],
        true,
      ).ok,
    ).toBe(false);
  });
});
