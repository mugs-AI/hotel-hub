import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildReceiptUpdatePayload,
  productionUpdateContract,
  updateN3Receipt,
} from "../n3-receipt-update.server";
import { canAutoUpdate } from "../receipt-automation-gates.server";
import {
  RECEIPT_50,
  RECEIPT_50_RAW,
  PROPOSAL_65,
  UPDATE_CONTRACT_TEST_ONLY,
} from "./fixtures/receipt-automation";
const actor = {
  tenantId: "hh-local",
  n3TenantKey: "sandbox",
  n3UserKey: "owner",
  n3Token: "secret-test",
  role: "owner" as const,
};
afterEach(() => vi.unstubAllGlobals());
describe("dormant receipt Update adapter", () => {
  it("changes amount and exactly one payment line while preserving identity and unrelated fields", () => {
    const p = buildReceiptUpdatePayload(
      RECEIPT_50_RAW,
      RECEIPT_50,
      PROPOSAL_65,
      UPDATE_CONTRACT_TEST_ONLY,
    );
    expect(p.body).toMatchObject({
      ...RECEIPT_50_RAW,
      totalAmount: 65,
      netTotalAmount: 65,
      outstandingAmount: 65,
      multiPayments: [{ ...RECEIPT_50_RAW.multiPayments[0], amount: 65 }],
    });
    expect(p.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(RECEIPT_50_RAW.totalAmount).toBe(50);
  });
  it("maps only proposed contact fields, preserving original amount/account", () => {
    const contact = { ...RECEIPT_50.contact, remark3: "0110000000" };
    const p = buildReceiptUpdatePayload(
      RECEIPT_50_RAW,
      RECEIPT_50,
      { ...PROPOSAL_65, amountCents: 5000, contact },
      UPDATE_CONTRACT_TEST_ONLY,
    );
    expect(p.body).toMatchObject({
      totalAmount: 50,
      accountId: PROPOSAL_65.accountId,
      remark3: "0110000000",
    });
  });
  it.each([
    { isReconciled: true },
    { isReconciled: undefined },
    { knockoff: [{}] },
    { refundAmount: 1 },
    { isCancelled: true },
    { cancelledDate: "2026-10-02" },
    { expectedVersion: null },
    { unknownExtension: {} },
    { TotalAmount: 999 },
    { multiPayments: [] },
    { multiPayments: [...RECEIPT_50_RAW.multiPayments, ...RECEIPT_50_RAW.multiPayments] },
    { customerId: "alien" },
    { totalAmount: 60 },
    { referenceNo: "other" },
  ])("rejects restricted, conflicting, split or unpreservable evidence %j", (patch) => {
    expect(() =>
      buildReceiptUpdatePayload(
        { ...RECEIPT_50_RAW, ...patch },
        RECEIPT_50,
        PROPOSAL_65,
        UPDATE_CONTRACT_TEST_ONLY,
      ),
    ).toThrow();
  });
  it("production contract remains null even with environment flags", () => {
    expect(productionUpdateContract()).toBe(null);
    expect(canAutoUpdate(actor, false, null, {})).toBe(false);
    expect(
      canAutoUpdate({ ...actor, role: "front_desk" }, true, UPDATE_CONTRACT_TEST_ONLY, {}),
    ).toBe(false);
  });
  it("refuses expired/aborted transport before any POST", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const p = buildReceiptUpdatePayload(
      RECEIPT_50_RAW,
      RECEIPT_50,
      PROPOSAL_65,
      UPDATE_CONTRACT_TEST_ONLY,
    );
    expect(
      (
        await updateN3Receipt(actor, p, {
          deadlineAt: Date.now() - 1,
          signal: new AbortController().signal,
        })
      ).kind,
    ).toBe("transport_error");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses only fixed Update path with both overrides false and server bearer", async () => {
    const fetch = vi.fn(
      async (_url: string, _options?: RequestInit) =>
        new Response(JSON.stringify({ code: "0000", data: {} })),
    );
    vi.stubGlobal("fetch", fetch);
    const p = buildReceiptUpdatePayload(
      RECEIPT_50_RAW,
      RECEIPT_50,
      PROPOSAL_65,
      UPDATE_CONTRACT_TEST_ONLY,
    );
    await updateN3Receipt(actor, p, {
      deadlineAt: Date.now() + 1000,
      signal: new AbortController().signal,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://openapi.account.qne.cloud/api/ARReceipts/Update?confirmedForBankRecon=false&confirmedForKnockOff=false",
    );
  });
});
