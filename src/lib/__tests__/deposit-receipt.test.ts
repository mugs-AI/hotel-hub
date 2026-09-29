import { describe, expect, it } from "vitest";
import { verifyDepositReceipt, type ReceiptExpectation } from "../deposit-receipt";

const expected: ReceiptExpectation = {
  id: "11111111-1111-4111-8111-111111111111",
  docCode: "OR-100",
  referenceNo: "HH-111111111111111111111111",
  customerId: "42",
  currency: "MYR",
  amountCents: 25000,
};

function live(overrides: Record<string, unknown> = {}) {
  return {
    code: "0000",
    data: {
      value: {
        id: expected.id,
        docCode: expected.docCode,
        docType: "AROR",
        referenceNo: expected.referenceNo,
        customerId: 42,
        currencyCode: "MYR",
        totalAmount: 250,
        knockoff: [{ docType: "INV", appliedAmount: 100 }],
        ...overrides,
      },
    },
  };
}

describe("printable N3 deposit receipt evidence", () => {
  it("accepts a real allocated AROR without implying the booking is settled", () => {
    expect(
      verifyDepositReceipt(
        { kind: "response", status: 200, body: live(), durationMs: 1 },
        expected,
      ),
    ).toEqual({ ok: true });
  });

  it.each([
    ["wrong identity", { id: "22222222-2222-4222-8222-222222222222" }],
    ["wrong customer", { customerId: 43 }],
    ["wrong currency", { currencyCode: "USD" }],
    ["wrong amount", { totalAmount: 251 }],
    ["wrong reference", { referenceNo: "HH-222222222222222222222222" }],
    ["missing type", { docType: null }],
    ["void", { isVoid: true }],
    ["void string", { isVoid: "true" }],
  ])("blocks %s", (_name, change) => {
    expect(
      verifyDepositReceipt(
        { kind: "response", status: 200, body: live(change), durationMs: 1 },
        expected,
      ),
    ).toEqual({ ok: false, code: "n3_receipt_mismatch" });
  });

  it("blocks ambiguous or unavailable N3 detail", () => {
    expect(
      verifyDepositReceipt(
        { kind: "response", status: 200, body: { code: "0000" }, durationMs: 1 },
        expected,
      ),
    ).toEqual({ ok: false, code: "n3_receipt_mismatch" });
    expect(
      verifyDepositReceipt({ kind: "transport_error", reason: "timeout", durationMs: 1 }, expected),
    ).toEqual({ ok: false, code: "n3_receipt_unavailable" });
    expect(
      verifyDepositReceipt({ kind: "response", status: 401, body: null, durationMs: 1 }, expected),
    ).toEqual({ ok: false, code: "unauthorized" });
  });
});
