import { afterEach, describe, expect, it, vi } from "vitest";
import * as contracts from "../settlement-contracts.server";
import {
  n3BillingClient,
  billingJournalBoundTo,
  billingDocumentBoundTo,
  buildCashSalePayload,
  buildBalanceReceiptPayload,
  billingPayloadDigest,
  type BalanceReceiptInput,
  type AllocationPostRow,
} from "../n3-billing.server";
import type { DispatchClaim } from "../settlement";
import type { SettlementActor } from "../settlement-context.server";
import { settlementFixture } from "./fixtures/settlement";

const actor: SettlementActor = {
  ...settlementFixture(),
  n3UserKey: "synthetic-user",
  n3Token: "synthetic-secret",
  role: "owner",
};
const billId = "22222222-2222-4222-8222-222222222222";
const receiptId = settlementFixture().receipts[0].receiptId;
function claim(kind: DispatchClaim["kind"] = "bill"): DispatchClaim {
  return {
    attemptId: "33333333-3333-4333-8333-333333333333",
    intentId: "44444444-4444-4444-8444-444444444444",
    kind,
    expectedRevision: "9007199254740993",
    payloadDigest: "d".repeat(64),
    ...(kind.includes("allocation") ? { receiptId } : {}),
  };
}
function openGate() {
  vi.spyOn(contracts, "billingContractGate").mockImplementation((operation) => ({
    kind: "confirmed",
    value: {
      operation,
      evidenceHash: "a".repeat(64),
      concurrencyProofHash: operation.includes("allocation") ? "b".repeat(64) : null,
      allocationMode: operation.includes("allocation") ? "preserve_existing" : null,
    },
  }));
}
function billClaim() {
  const c = claim();
  c.payloadDigest = billingPayloadDigest(buildCashSalePayload(settlementFixture(), c));
  return c;
}
function http(body: string = '{"code":"0000","data":{"id":"' + billId + '"}}') {
  return vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 200 })),
  );
}
const balance: BalanceReceiptInput = {
  customerId: 7,
  currencyId: 1,
  currencyRate: 1,
  amountCents: 45000,
  accountId: "11111111-1111-4111-8111-111111111111",
  docDate: "2026-10-08",
  contact: { customerName: "Synthetic guest", remark1: "", remark2: "", remark3: "", remark4: "" },
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.N3_BILLING_ENABLED;
  delete process.env.OPEN_API_BASE_URL;
});
describe("fixed bounded billing transports", () => {
  it("receipt readers retain lossless scoped provenance without changing original deposit clients", async () => {
    http('{"code":"0000","data":{"updatedAt":9007199254740993}}');
    const client = n3BillingClient as unknown as {
      readReceipt(
        a: SettlementActor,
        id: string,
      ): Promise<import("../n3-receipts.server").N3Outcome>;
    };
    const out = await client.readReceipt(actor, receiptId);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://openapi.account.qne.cloud/api/ARReceipts/" + receiptId,
    );
    expect(out).toMatchObject({
      kind: "response",
      body: { data: { updatedAt: "9007199254740993" } },
    });
    expect(billingDocumentBoundTo(out, actor, receiptId)).toBe(false);
  });
  it("gate_closed_makes_zero_fetch_calls even with a caller/env flag", async () => {
    process.env.N3_BILLING_ENABLED = "true";
    http();
    for (const kind of [
      "bill",
      "deposit_allocation",
      "balance_receipt",
      "balance_allocation",
    ] as const)
      expect(contracts.billingContractGate(kind)).toEqual({
        kind: "unavailable",
        code: "n3_billing_contract_unverified",
      });
    await expect(
      n3BillingClient.createBill(actor, billClaim(), settlementFixture()),
    ).rejects.toThrow("n3_billing_contract_unverified");
    await expect(
      n3BillingClient.writeAllocation(actor, claim("deposit_allocation"), []),
    ).rejects.toThrow("n3_billing_contract_unverified");
    await expect(
      n3BillingClient.createBalanceReceipt(actor, claim("balance_receipt"), balance),
    ).rejects.toThrow("n3_billing_contract_unverified");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("arbitrary_url_cannot_be_supplied or selected from the environment", async () => {
    http();
    process.env.OPEN_API_BASE_URL = "https://untrusted.invalid";
    await expect(
      n3BillingClient.readBill(actor, "https://untrusted.invalid/token"),
    ).rejects.toThrow("n3_billing_invalid_input");
    expect(fetch).not.toHaveBeenCalled();
    await n3BillingClient.readBill(actor, billId);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://openapi.account.qne.cloud/api/CashSales/" + billId,
    );
  });
  it("fixed_paths_and_types posts the frozen AR bill without a payment", async () => {
    openGate();
    http();
    const c = billClaim();
    await n3BillingClient.createBill(actor, c, settlementFixture());
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    const p = JSON.parse(init!.body as string);
    expect(url).toBe("https://openapi.account.qne.cloud/api/CashSales/Create");
    expect(init!.method).toBe("POST");
    expect(init!.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer synthetic-secret",
    });
    expect(p).toMatchObject({
      customerId: 7,
      currencyId: 1,
      currencyRate: 1,
      isPostToAR: true,
      docDate: "2026-10-08",
      referenceNo: "HH-B-44444444444444448444444444444444",
      itemDetails: [
        {
          pos: 1,
          stockId: 101,
          uomId: 1,
          taxCodeId: 8,
          qty: 1,
          unitPrice: 500,
          amount: 500,
          taxAmount: 0,
          netAmount: 500,
        },
      ],
    });
    for (const key of [
      "accountId",
      "details",
      "knockoff",
      "multiPayments",
      "n3Token",
      "tenantId",
      "paymentAmount",
    ])
      expect(p).not.toHaveProperty(key);
    expect(p.referenceNo.length).toBeLessThanOrEqual(50);
  });
  it("allocation is a flat array for exactly the claimed receipt", async () => {
    openGate();
    http();
    const rows: AllocationPostRow[] = [
      {
        customerId: 7,
        receiptDocType: "OR",
        receiptDocId: receiptId,
        docType: "INV",
        docId: billId,
        paymentAmount: 50,
      },
    ];
    const c = claim("deposit_allocation");
    c.payloadDigest = billingPayloadDigest(rows);
    await n3BillingClient.writeAllocation(actor, c, rows);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://openapi.account.qne.cloud/api/ARReceipts/UpdateCustomerKnockoff",
    );
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual(rows);
    await expect(
      n3BillingClient.writeAllocation(actor, c, [{ ...rows[0], receiptDocId: billId }]),
    ).rejects.toThrow("n3_billing_invalid_input");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("allocation requires accepted concurrency evidence before any write", async () => {
    openGate();
    vi.mocked(contracts.billingContractGate).mockImplementation((operation) => ({
      kind: "confirmed",
      value: {
        operation,
        evidenceHash: "a".repeat(64),
        concurrencyProofHash: null,
        allocationMode: "preserve_existing",
      },
    }));
    http();
    await expect(
      n3BillingClient.writeAllocation(actor, claim("deposit_allocation"), []),
    ).rejects.toThrow("n3_allocation_concurrency_unverified");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("balance receipt has one account, no details or automatic knockoff", async () => {
    openGate();
    http();
    const c = claim("balance_receipt");
    c.payloadDigest = billingPayloadDigest(buildBalanceReceiptPayload(balance, c));
    await n3BillingClient.createBalanceReceipt(actor, c, balance);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://openapi.account.qne.cloud/api/ARReceipts/Create",
    );
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
      ...balance.contact,
      customerId: 7,
      currencyId: 1,
      currencyRate: 1,
      accountId: balance.accountId,
      docType: "AROR",
      docDate: "2026-10-08",
      totalAmount: 450,
      referenceNo: "HH-B-44444444444444448444444444444444",
      description: "HotelHub settlement balance",
    });
  });
  it("mismatched payload digest, scope and front desk make zero writes", async () => {
    openGate();
    http();
    await expect(
      n3BillingClient.createBill(
        actor,
        { ...billClaim(), payloadDigest: "a".repeat(64) },
        settlementFixture(),
      ),
    ).rejects.toThrow("n3_billing_invalid_claim");
    await expect(
      n3BillingClient.createBill(
        { ...actor, role: "front_desk" },
        billClaim(),
        settlementFixture(),
      ),
    ).rejects.toThrow("forbidden");
    await expect(
      n3BillingClient.createBill({ ...actor, tenantId: billId }, billClaim(), settlementFixture()),
    ).rejects.toThrow("n3_billing_scope_mismatch");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("forged_journal_is_untrusted and the real read is tenant/token/document-bound", async () => {
    http();
    const out = await n3BillingClient.readBillJournal(actor, billId);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://openapi.account.qne.cloud/api/CashSales/GLPosting?key=" + billId,
    );
    expect(billingJournalBoundTo(out, actor, billId)).toBe(true);
    expect(billingJournalBoundTo(structuredClone(out), actor, billId)).toBe(false);
    expect(billingJournalBoundTo(out, { ...actor, n3Token: "other" }, billId)).toBe(false);
    expect(billingJournalBoundTo(out, { ...actor, reservationId: receiptId }, billId)).toBe(false);
    expect(billingJournalBoundTo(out, actor, receiptId)).toBe(false);
    expect(billingDocumentBoundTo(out, actor, billId)).toBe(false);
    expect(Object.isFrozen(out)).toBe(true);
    if (out.kind === "response") expect(Object.isFrozen(out.body)).toBe(true);
  });
  it("detail cannot stand in for GL and unsafe_int64 is preserved exactly", async () => {
    http(
      '{"code":"0000","data":{"id":"' +
        billId +
        '","updatedAt":9007199254740993,"name":"9007199254740993"}}',
    );
    const out = await n3BillingClient.readBill(actor, billId);
    expect(billingDocumentBoundTo(out, actor, billId)).toBe(true);
    expect(billingJournalBoundTo(out, actor, billId)).toBe(false);
    expect(out).toMatchObject({
      kind: "response",
      body: { data: { updatedAt: "9007199254740993", name: "9007199254740993" } },
    });
  });
  it.each([
    '{"code":"0000","code":"FAIL"}',
    '{"data":{"id":1,"id":2}}',
    '{"updatedAt":9.007199254740993e15}',
  ])("ambiguous/rounded JSON is not trusted: %s", async (body) => {
    http(body);
    const out = await n3BillingClient.readBillJournal(actor, billId);
    expect(out).toMatchObject({ kind: "response", body: null });
    expect(billingJournalBoundTo(out, actor, billId)).toBe(false);
  });
  it("business-error envelope is retained for the strict prover, never confirmed by HTTP200", async () => {
    openGate();
    http('{"code":"FAIL","data":{"id":"' + billId + '"}}');
    const out = await n3BillingClient.createBill(actor, billClaim(), settlementFixture());
    expect(out).toMatchObject({ kind: "response", body: { code: "FAIL" } });
    expect(out).not.toHaveProperty("confirmed");
  });
  it("oversize response ceiling is bytes, including streamed multibyte text", async () => {
    http(JSON.stringify({ data: "中".repeat(670000) }));
    const out = await n3BillingClient.readBill(actor, billId);
    expect(out).toMatchObject({ kind: "transport_error", reason: "too_large" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["read", 20000],
    ["write", 30000],
  ] as const)("timeout covers fetch and body for %s", async (kind, ms) => {
    vi.useFakeTimers();
    openGate();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new ReadableStream({ start() {} }))),
    );
    const pending =
      kind === "read"
        ? n3BillingClient.readBill(actor, billId)
        : n3BillingClient.createBill(actor, billClaim(), settlementFixture());
    await vi.advanceTimersByTimeAsync(ms - 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ kind: "transport_error", reason: "timeout" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
