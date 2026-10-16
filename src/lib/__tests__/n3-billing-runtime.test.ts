import { createServer, type Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import * as contracts from "../settlement-contracts.server";
import {
  n3BillingClient,
  billingDocumentBoundTo,
  billingReceiptBoundTo,
  billingPayloadDigest,
  buildCashSalePayload,
  buildBalanceReceiptPayload,
  type BalanceReceiptInput,
  type AllocationPostRow,
} from "../n3-billing.server";
import type { DispatchClaim } from "../settlement";
import type { N3Outcome } from "../n3-receipts.server";
import { settlementFixture } from "./fixtures/settlement";

const actor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  n3UserKey: "synthetic-runtime-owner",
  n3Token: "synthetic-runtime-token",
  role: "owner" as const,
};
const documentId = "22222222-2222-4222-8222-222222222222";
const nativeFetch = globalThis.fetch;
let server: Server | undefined;
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  }
});

// Only loopback HTTP is dispatched. The shim models workerd's unsupported
// redirect:error Request mode; it never contacts N3 or uses real credentials.
async function fixture(status = 200) {
  const requests: Array<{ path: string; method: string; authorization: string }> = [];
  server = createServer((req, res) => {
    requests.push({
      path: req.url!,
      method: req.method!,
      authorization: req.headers.authorization!,
    });
    req.resume();
    if (status >= 300 && status < 400) res.setHeader("Location", "/must-not-follow");
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end('{"code":"0000","data":{"id":"' + documentId + '"}}');
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture_not_listening");
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    if (init.redirect === "error") throw TypeError("workerd rejects redirect:error");
    const u = new URL(url);
    if (u.origin !== "https://openapi.account.qne.cloud") throw Error("unexpected_origin");
    return nativeFetch(`http://127.0.0.1:${address.port}${u.pathname}${u.search}`, init);
  });
  return requests;
}

function openTestGate() {
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
function write(mode: "bill" | "receipt" | "allocation") {
  const claim: DispatchClaim = {
    attemptId: "33333333-3333-4333-8333-333333333333",
    intentId: "44444444-4444-4444-8444-444444444444",
    kind: mode === "bill" ? "bill" : mode === "receipt" ? "balance_receipt" : "deposit_allocation",
    expectedRevision: "1",
    payloadDigest: "d".repeat(64),
    ...(mode === "allocation" ? { receiptId: documentId } : {}),
  };
  if (mode === "bill") {
    const snapshot = settlementFixture();
    claim.payloadDigest = billingPayloadDigest(buildCashSalePayload(snapshot, claim));
    return n3BillingClient.createBill(actor, claim, snapshot);
  }
  if (mode === "receipt") {
    const input: BalanceReceiptInput = {
      customerId: 7,
      currencyId: 1,
      currencyRate: 1,
      amountCents: 45000,
      accountId: "11111111-1111-4111-8111-111111111111",
      docDate: "2026-10-14",
      contact: { customerName: "Synthetic", remark1: "", remark2: "", remark3: "", remark4: "" },
    };
    claim.payloadDigest = billingPayloadDigest(buildBalanceReceiptPayload(input, claim));
    return n3BillingClient.createBalanceReceipt(actor, claim, input);
  }
  const rows: AllocationPostRow[] = [
    {
      customerId: 7,
      receiptDocType: "OR",
      receiptDocId: documentId,
      docType: "INV",
      docId: "55555555-5555-4555-8555-555555555555",
      paymentAmount: 50,
    },
  ];
  claim.payloadDigest = billingPayloadDigest(rows);
  return n3BillingClient.writeAllocation(actor, claim, rows);
}

it.each([
  ["readBill", "/api/CashSales/"],
  ["readBillJournal", "/api/CashSales/GLPosting?key="],
  ["readReceipt", "/api/ARReceipts/"],
  ["readReceiptJournal", "/api/ARReceipts/GLPosting?key="],
  ["readPaymentAccount", "/api/AccountCodes/"],
] as const)("%s reads real HTTP with a supported Request mode", async (method, prefix) => {
  const requests = await fixture();
  const outcome = await n3BillingClient[method](actor, documentId);
  expect(outcome).toMatchObject({
    kind: "response",
    status: 200,
    body: { data: { id: documentId } },
  });
  expect(requests).toEqual([
    { path: prefix + documentId, method: "GET", authorization: "Bearer synthetic-runtime-token" },
  ]);
});
it.each(["bill", "receipt", "allocation"] as const)(
  "%s sends one loopback POST with a supported Request mode when its test contract is accepted",
  async (mode) => {
    const requests = await fixture();
    openTestGate();
    expect(await write(mode)).toMatchObject({ kind: "response", status: 200 });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
  },
);
it.each([301, 302, 303, 307, 308])(
  "refuses GET redirect %i without provenance or follow",
  async (status) => {
    const requests = await fixture(status);
    const outcome = await n3BillingClient.readBill(actor, documentId);
    expect(outcome).toMatchObject({ kind: "response", status, body: null });
    expect(billingDocumentBoundTo(outcome, actor, documentId)).toBe(false);
    expect(requests.map((r) => r.path)).toEqual(["/api/CashSales/" + documentId]);
  },
);
it.each([301, 302, 303, 307, 308])(
  "refuses POST redirect %i without following or retrying",
  async (status) => {
    const requests = await fixture(status);
    openTestGate();
    expect(await write("bill")).toMatchObject({ kind: "response", status, body: null });
    expect(requests.map((r) => [r.method, r.path])).toEqual([["POST", "/api/CashSales/Create"]]);
  },
);

it("caller cancellation promptly settles an uncooperative GET", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const controller = new AbortController();
  const pending = n3BillingClient.readBill(actor, documentId, {
    deadlineAt: Date.now() + 20000,
    signal: controller.signal,
    budget: { remainingBytes: 10000 },
  });
  let outcome: N3Outcome | undefined;
  void pending.then((value) => {
    outcome = value;
  });
  controller.abort();
  await vi.advanceTimersByTimeAsync(1);
  expect(outcome).toMatchObject({ kind: "transport_error", reason: "timeout" });
});
it("late fetch cannot consume a timed-out request's shared response budget", async () => {
  vi.useFakeTimers();
  let complete!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  const budget = { remainingBytes: 10000 };
  const pending = n3BillingClient.readBill(actor, documentId, {
    deadlineAt: Date.now() + 20000,
    signal: new AbortController().signal,
    budget,
  });
  await vi.advanceTimersByTimeAsync(20000);
  const outcome = await pending;
  expect(outcome).toMatchObject({ kind: "transport_error", reason: "timeout" });
  complete(Response.json({ code: "0000", data: { id: documentId } }));
  await vi.advanceTimersByTimeAsync(1);
  expect(budget.remainingBytes).toBe(10000);
  expect(billingDocumentBoundTo(outcome, actor, documentId)).toBe(false);
});
it("late body chunks cannot consume a timed-out request's shared response budget", async () => {
  vi.useFakeTimers();
  let finish!: (chunk: ReadableStreamReadResult<Uint8Array>) => void;
  const reader = {
    read: () =>
      new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
        finish = resolve;
      }),
    cancel: async () => {},
    releaseLock: () => {},
  };
  vi.stubGlobal("fetch", async () => ({
    status: 200,
    headers: new Headers(),
    body: { getReader: () => reader },
  }));
  const budget = { remainingBytes: 10000 };
  const pending = n3BillingClient.readBill(actor, documentId, {
    deadlineAt: Date.now() + 20000,
    signal: new AbortController().signal,
    budget,
  });
  await vi.advanceTimersByTimeAsync(20000);
  expect(await pending).toMatchObject({ kind: "transport_error", reason: "timeout" });
  finish({ done: false, value: new TextEncoder().encode("late") });
  await vi.advanceTimersByTimeAsync(1);
  expect(budget.remainingBytes).toBe(10000);
});
it("provenance retains the identity that dispatched the read despite caller mutation", async () => {
  const mutable = { ...actor },
    original = { ...actor };
  let complete!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  const pending = n3BillingClient.readReceipt(mutable, documentId);
  mutable.n3Token = "different-token";
  mutable.tenantId = "66666666-6666-4666-8666-666666666666";
  complete(Response.json({ code: "0000", data: { id: documentId } }));
  const outcome = await pending;
  expect(billingReceiptBoundTo(outcome, original, documentId)).toBe(true);
  expect(billingReceiptBoundTo(outcome, mutable, documentId)).toBe(false);
});
