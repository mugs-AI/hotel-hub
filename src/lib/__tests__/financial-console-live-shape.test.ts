import { describe, expect, it } from "vitest";
import {
  compareReceiptKnockoffs,
  compareRefundKnockoffs,
  evaluateGlAccount,
  normalizeCashSaleDetail,
  normalizeReceiptDetail,
  normalizeRefundDetail,
  validateContract,
} from "../n3-financial.server";

// Minimal non-secret reproductions of the Owner's 08/10/2026 GET export.
// IDs/customer identities are synthetic; amounts and response field names
// retain the observed distinction between document totals and payments.
const bill = {
  id: "bill-synthetic",
  docCode: "CS-SYNTHETIC",
  customerId: 7,
  netTotalAmount: 324.03,
  outstandingAmount: 114.02,
  isPostToAR: true,
};
const receipts = [60.01, 150].map((paymentAmount, i) => ({
  id: `receipt-synthetic-${i}`,
  customerId: 7,
  knockoff: [{ docType: "INV", docId: bill.id, amount: 324.03, paymentAmount }],
}));

describe("Financial console — observed N3 matching fields", () => {
  it("shows the two actual partial payments rather than the original bill total", () => {
    const matches = compareReceiptKnockoffs(receipts, [bill]);
    expect(matches.map((m) => m.appliedAmount)).toEqual([60.01, 150]);
    expect(matches.map((m) => m.sameUuid)).toEqual([true, true]);
  });

  it("shows a refund's matched payment instead of its source receipt amount", () => {
    const refund = {
      id: "refund-synthetic",
      customerId: 7,
      knockoff: [{ docType: "OR", docId: receipts[0].id, amount: 100.01, paymentAmount: 40 }],
    };
    expect(compareRefundKnockoffs([refund], receipts)[0].appliedAmount).toBe(40);
  });

  it.each([
    [{ amount: 324.03 }, null],
    [{ amount: 324.03, paymentAmount: 0 }, 0],
    [{ amount: 324.03, PaymentAmount: "60.01" }, 60.01],
    [{ paymentAmount: 60.01, appliedAmount: 150 }, null],
    [{ paymentAmount: "invalid", appliedAmount: 60.01 }, null],
    [{ paymentAmount: 60.01, paidAmount: "60.01" }, 60.01],
  ])("does not invent an applied amount from ambiguous fields: %j", (fields, expected) => {
    const r = { id: "receipt", knockoff: [{ docType: "INV", docId: bill.id, ...fields }] };
    expect(compareReceiptKnockoffs([r], [bill])[0].appliedAmount).toBe(expected);
  });

  it("retains numeric customer identity across normalized bill, receipt and refund details", () => {
    const r = normalizeReceiptDetail({ data: receipts[0] })!;
    const b = normalizeCashSaleDetail({ data: bill })!;
    const f = normalizeRefundDetail({
      data: {
        id: "refund-synthetic",
        customerId: 7,
        knockoff: [{ docType: "OR", docId: r.id, amount: 100.01, paymentAmount: 40 }],
      },
    })!;
    expect(compareReceiptKnockoffs([r], [b])[0].customerMatch).toBe(true);
    expect(compareRefundKnockoffs([f], [r])[0].customerMatch).toBe(true);
    expect(compareReceiptKnockoffs([r], [{ ...b, customerId: "8" }])[0].correlation).toBe(
      "mismatch",
    );
    expect(compareRefundKnockoffs([f], [{ ...r, customerId: "8" }])[0].correlation).toBe(
      "mismatch",
    );
  });

  it("reports a refund linked to a different customer as a mismatch", () => {
    const f = {
      id: "refund",
      customerId: 8,
      knockoff: [{ docType: "OR", docId: receipts[0].id, paymentAmount: 40 }],
    };
    expect(compareRefundKnockoffs([f], receipts)[0]).toMatchObject({
      sameUuid: true,
      customerMatch: false,
      correlation: "mismatch",
    });
  });

  it("does not normalize an unsafe numeric customer ID into matching authority", () => {
    expect(
      normalizeReceiptDetail({ data: { ...receipts[0], customerId: 9007199254740992 } })!
        .customerId,
    ).toBeNull();
  });

  it.each([
    { CustomerId: 7, customerId: "8" },
    { customerId: 7, customer: { id: 8 } },
    { customerId: 7, customer: { Id: 7, id: 8 } },
  ])(
    "reports conflicting customer identities consistently before and after normalization: %j",
    (fields) => {
      const r = { ...receipts[0], ...fields };
      const f = {
        id: "refund",
        ...fields,
        knockoff: [{ docType: "OR", docId: receipts[0].id, paymentAmount: 40 }],
      };
      const b = { ...bill, ...fields };
      for (const receipt of [r, normalizeReceiptDetail({ data: r })!])
        expect(compareReceiptKnockoffs([receipt], [bill])[0].correlation).toBe("mismatch");
      for (const refund of [f, normalizeRefundDetail({ data: f })!])
        expect(compareRefundKnockoffs([refund], receipts)[0].correlation).toBe("mismatch");
      for (const candidate of [b, normalizeCashSaleDetail({ data: b })!])
        expect(compareReceiptKnockoffs(receipts, [candidate])[0].correlation).toBe("mismatch");
    },
  );
});

describe("Financial console — observed leaf GL accounts", () => {
  const account = {
    id: "account-synthetic",
    code: "SYNTHETIC-BANK",
    name: "Synthetic bank",
    specialCode: "BAC",
    hasChildren: false,
    isActive: true,
    accountType: { typeCode: "BCA" },
  };

  it.each([
    ["BAC", "bank"],
    ["CAC", "cash"],
  ])(
    "recognizes active leaf %s accounts without guessing from their names",
    (specialCode, expected) => {
      expect(evaluateGlAccount({ ...account, specialCode })).toMatchObject({
        eligibility: expected,
        active: true,
        posting: true,
      });
    },
  );

  it("records the observed specialCode field in the GL list contract", () => {
    expect(validateContract("gl_accounts", [account]).requiredHits.hasSpecial).toBe(true);
  });

  it.each([
    { hasChildren: true },
    { isActive: false },
    { hasChildren: undefined },
    { specialCode: "" },
    { SpecialType: "Cash Account" },
    { IsLeaf: false },
    { Active: false },
    { isActive: 2 },
    { hasChildren: -1 },
  ])("keeps unsupported or contradictory account facts unavailable: %j", (changes) => {
    expect(["bank", "cash"]).not.toContain(
      evaluateGlAccount({ ...account, ...changes }).eligibility,
    );
  });
});
