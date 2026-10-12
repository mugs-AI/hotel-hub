import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gates from "../settlement-contracts.server";
import {
  buildAllocationRows,
  buildBalanceIntent,
  orderedSettlementReceipts,
  verifySettlementPaymentAccount,
} from "../settlement-allocation.server";
import {
  evidenceSnapshot,
  evidenceBill,
  evidenceReceipt,
  evidenceValue,
  priorRow,
  fixtureBillId,
  fixtureActor,
  accountResponse,
} from "./fixtures/settlement-evidence";
import type { AcceptedContract } from "../settlement";
const contract: AcceptedContract = {
  operation: "deposit_allocation",
  evidenceHash: "a".repeat(64),
  concurrencyProofHash: "b".repeat(64),
  allocationMode: "preserve_existing",
  billTarget: "same_id_INV",
};
beforeEach(() =>
  vi
    .spyOn(gates, "billingContractGate")
    .mockImplementation((operation) => ({ kind: "confirmed", value: { ...contract, operation } })),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function account(override: Record<string, unknown> = {}) {
  const raw = { ...accountResponse(), ...override };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ code: "0000", data: raw }))),
  );
  return verifySettlementPaymentAccount(evidenceSnapshot(), fixtureActor, accountResponse().id);
}
describe("conserved allocation and explicit balance planning", () => {
  it("balance receipt date uses the payment day in the property timezone independently of the bill", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T16:30:00Z"));
    const s = evidenceSnapshot(),
      b = await evidenceBill(450, s),
      a = evidenceValue(await account());
    const p = evidenceValue(buildBalanceIntent(s, b, a));
    expect(p.payload.docDate).toBe("2026-10-09");
    expect(b.documentDate).toBe("2026-10-08");
    vi.useRealTimers();
  });
  it("unsupported withholding does not silently lose earlier allocation meaning", async () => {
    const b = await evidenceBill(),
      r = await evidenceReceipt([{ ...priorRow(), totalWTaxAmount: 1 }], 40);
    expect(buildAllocationRows(evidenceSnapshot(), b, r, contract)).toEqual({
      kind: "unavailable",
      code: "receipt_prior_matching_requires_review",
    });
  });
  it("stable_receipt_order by actual receipt date then immutable ID", () => {
    const s = evidenceSnapshot(),
      r = s.receipts[0];
    s.receipts = [
      { ...r, receiptDate: "2026-10-08", receiptId: fixtureBillId },
      r,
      { ...r, receiptId: "11111111-1111-4111-8111-111111111111" },
    ];
    expect(orderedSettlementReceipts(s).map((x) => x.receiptId)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      r.receiptId,
      fixtureBillId,
    ]);
    expect(s.receipts[0].receiptDate).toBe("2026-10-08");
  });
  it("partial_never_consumes_excess:5000 remainder/3000 outstanding plans3000", async () => {
    const b = await evidenceBill(),
      r = await evidenceReceipt();
    const p = evidenceValue(buildAllocationRows(evidenceSnapshot(), b, r, contract));
    expect(p).toMatchObject({
      newAmountCents: 3000,
      expectedTotalToBillCents: 3000,
      rows: [
        {
          customerId: 7,
          receiptDocType: "OR",
          receiptDocId: r.receipt.receiptId,
          docType: "INV",
          docId: fixtureBillId,
          paymentAmount: 30,
        },
      ],
    });
    expect(p.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(p.expectedAfterFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(p.rows)).toBe(true);
  });
  it("prior_rows_preserved only under an accepted concurrency and preservation contract", async () => {
    const b = await evidenceBill(),
      r = await evidenceReceipt([priorRow()], 40);
    const p = evidenceValue(buildAllocationRows(evidenceSnapshot(), b, r, contract));
    expect(p.rows.map((x) => [x.docId, x.paymentAmount])).toEqual([
      ["88888888-8888-4888-8888-888888888888", 10],
      [fixtureBillId, 30],
    ]);
    expect(
      buildAllocationRows(evidenceSnapshot(), b, r, { ...contract, concurrencyProofHash: null })
        .kind,
    ).toBe("unavailable");
    expect(
      buildAllocationRows(evidenceSnapshot(), b, r, { ...contract, allocationMode: null }).kind,
    ).toBe("unavailable");
  });
  it("empty_clear_never_sent when no money can be allocated", async () => {
    const b = await evidenceBill(0),
      r = await evidenceReceipt();
    expect(buildAllocationRows(evidenceSnapshot(), b, r, contract)).toEqual({
      kind: "unavailable",
      code: "settlement_no_allocation_required",
    });
  });
  it("already_applied_is_get_recovery_only", async () => {
    const b = await evidenceBill(450),
      r = await evidenceReceipt([priorRow(50, fixtureBillId)], 0);
    expect(buildAllocationRows(evidenceSnapshot(), b, r, contract)).toEqual({
      kind: "unavailable",
      code: "settlement_allocation_already_applied",
    });
  });
  it("balance_uses_actual_selected_account and never a /New routing default", async () => {
    const b = await evidenceBill(450),
      a = evidenceValue(await account());
    const p = evidenceValue(buildBalanceIntent(evidenceSnapshot(), b, a));
    expect(p).toMatchObject({
      purpose: "settlement",
      intentId: b.intentId,
      amountCents: 45000,
      accountId: a.id,
      payload: { amountCents: 45000, accountId: a.id },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://openapi.account.qne.cloud/api/AccountCodes/" + a.id,
    );
    expect(Object.isFrozen(a)).toBe(true);
  });
  it("forged evidence and a stale/zero balance cannot create a plan", async () => {
    const b = await evidenceBill(0),
      a = evidenceValue(await account());
    expect(buildBalanceIntent(evidenceSnapshot(), b, a).kind).not.toBe("confirmed");
    const positive = await evidenceBill(450);
    expect(buildBalanceIntent(evidenceSnapshot(), positive, structuredClone(a)).kind).toBe(
      "unavailable",
    );
    const r = await evidenceReceipt();
    expect(
      buildAllocationRows(evidenceSnapshot(), structuredClone(positive), r, contract).kind,
    ).toBe("unavailable");
  });
  it.each([
    { isActive: false },
    { hasChildren: true },
    { specialCode: "OTHER" },
    { currencyId: 2 },
    { Id: fixtureBillId },
    { accountType: { typeCode: "OTHER" } },
  ])("rejects ineligible/contradictory selected account %j", async (override) => {
    expect((await account(override)).kind).not.toBe("confirmed");
  });
  it("split_gate_closed, stock warnings and production contract gate block a balance claim", async () => {
    const s = evidenceSnapshot(),
      b = await evidenceBill(450, s),
      a = evidenceValue(await account());
    vi.mocked(gates.billingContractGate).mockReturnValue({
      kind: "unavailable",
      code: "n3_billing_contract_unverified",
    });
    expect(buildBalanceIntent(s, b, a).kind).toBe("unavailable");
    expect(buildBalanceIntent(s, b, [a, a] as unknown as typeof a).kind).toBe("unavailable");
    s.lines[0].mappingEvidence.stockAvailabilityWarning = true;
    expect(buildBalanceIntent(s, b, a).kind).toBe("unavailable");
  });
});
