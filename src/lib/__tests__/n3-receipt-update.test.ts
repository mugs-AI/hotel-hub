import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildReceiptUpdatePayload,
  productionUpdateContract,
  updateN3Receipt,
} from "../n3-receipt-update.server";
import { postReceiptUpdate } from "../n3-receipts.server";
it("does not mark a fetch attempt when request serialization fails", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const dispatched = vi.fn();
  const body: Record<string, unknown> = {};
  body.loop = body;
  const result = await postReceiptUpdate(
    "test-token",
    body,
    {
      deadlineAt: Date.now() + 1000,
      signal: new AbortController().signal,
    },
    dispatched,
  );
  expect(result.kind).toBe("transport_error");
  expect(dispatched).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
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
  it("documented contract does not bypass runtime/schema/role activation", () => {
    expect(canAutoUpdate(actor, true, productionUpdateContract(), {})).toBe(false);
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
        new Response(
          JSON.stringify({
            success: true,
            code: "0000",
            data: _options?.method === "POST" ? {} : RECEIPT_50_RAW,
          }),
        ),
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
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://openapi.account.qne.cloud/api/ARReceipts/Update?confirmedForBankRecon=false&confirmedForKnockOff=false",
    );
  });
});

// Uses documented ARReceiptDto and ReceiptMultiPaymentDto types, not a fake version field.
function documentedRaw() {
  const { expectedVersion, isReconciled, ...raw } = RECEIPT_50_RAW;
  return {
    ...raw,
    docDate: `${raw.docDate}T00:00:00`,
    updatedAt: 1770000000000,
    currencyId: 1,
    currencyRate: 1,
    totalAmountLocal: 50,
    netTotalAmountLocal: 50,
    outstandingAmountLocal: 50,
    subtotalAmount: 50,
    subtotalAmountLocal: 50,
    taxExclusiveTotalAmount: 50,
    taxExclusiveTotalAmountLocal: 50,
    taxTotalAmount: 0,
    bankChargesAmount: 0,
    multiPayments: [
      {
        id: 7,
        receiptId: raw.id,
        accountId: raw.accountId,
        amount: 50,
        amountLocal: 50,
        description: "Preserve payment memo",
      },
    ],
  };
}
it("documented receipt Update corrects local amounts and preserves numeric IDs without inventing a CAS token", () => {
  const contract = productionUpdateContract();
  expect(contract).not.toBeNull();
  const raw = documentedRaw();
  const p = buildReceiptUpdatePayload(raw, RECEIPT_50, PROPOSAL_65, contract!);
  expect(p.body).toMatchObject({
    id: raw.id,
    docCode: raw.docCode,
    docDate: raw.docDate,
    updatedAt: 1770000000000,
    totalAmount: 65,
    totalAmountLocal: 65,
    netTotalAmountLocal: 65,
    outstandingAmountLocal: 65,
    subtotalAmount: 65,
    taxExclusiveTotalAmount: 65,
    multiPayments: [
      {
        id: 7,
        receiptId: raw.id,
        amount: 65,
        amountLocal: 65,
        description: "Preserve payment memo",
      },
    ],
  });
  expect(p.body).not.toHaveProperty("expectedVersion");
  expect(raw.totalAmount).toBe(50);
});
it.each([
  "taxTotalAmountLocal",
  "wTaxTotalAmountLocal",
  "wVatTotalAmountLocal",
  "bankChargesAmountLocal",
  "roundingAdjustmentLocal",
  "refundAmountLocal",
])("rejects nonzero or unproven local companion %s before dispatch", (key) => {
  for (const value of [10, null, "0", Number.NaN])
    expect(() =>
      buildReceiptUpdatePayload(
        { ...documentedRaw(), [key]: value },
        RECEIPT_50,
        PROPOSAL_65,
        productionUpdateContract(),
      ),
    ).toThrow("n3_update_unproven");
});
it("rejects a nonzero local payment bank charge before dispatch", () => {
  const raw = documentedRaw();
  expect(() =>
    buildReceiptUpdatePayload(
      { ...raw, multiPayments: [{ ...raw.multiPayments[0], bankChargesAmountLocal: 10 }] },
      RECEIPT_50,
      PROPOSAL_65,
      productionUpdateContract(),
    ),
  ).toThrow("n3_update_unproven");
});
it("pre-send read refuses an outside edit and sends no Update", async () => {
  const raw = documentedRaw();
  const contract = productionUpdateContract();
  expect(contract).not.toBeNull();
  const p = buildReceiptUpdatePayload(raw, RECEIPT_50, PROPOSAL_65, contract!);
  const fetch = vi.fn(async () =>
    Response.json({
      success: true,
      code: "0000",
      data: { ...raw, notes: "Accounting changed this" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    updateN3Receipt(actor, p, {
      deadlineAt: Date.now() + 1000,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("n3_changed_since_request");
  expect(fetch.mock.calls).toHaveLength(1);
});
it("documented Update reads once then posts the preserved same receipt once", async () => {
  const raw = documentedRaw();
  const contract = productionUpdateContract();
  expect(contract).not.toBeNull();
  const p = buildReceiptUpdatePayload(raw, RECEIPT_50, PROPOSAL_65, contract!);
  const methods: string[] = [];
  const dispatched = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      methods.push(init?.method || "GET");
      expect(dispatched).toHaveBeenCalledTimes(init?.method === "POST" ? 1 : 0);
      return Response.json({
        success: true,
        code: "0000",
        data: init?.method === "POST" ? { ...raw, totalAmount: 65 } : raw,
      });
    }),
  );
  const result = await updateN3Receipt(
    actor,
    p,
    {
      deadlineAt: Date.now() + 1000,
      signal: new AbortController().signal,
    },
    dispatched,
  );
  expect(result.kind).toBe("response");
  expect(methods).toEqual(["GET", "POST"]);
  expect(dispatched).toHaveBeenCalledTimes(1);
});
