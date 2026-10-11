// Real mounted dialog, QueryClient and browser client; fixture HTTP only, never N3.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createElement, act } from "react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { DepositDTO } from "../../src/lib/deposits-client";
import type { ReceiptAutomationDTO } from "../../src/lib/receipt-automation";
import { RECEIPT_50, PROPOSAL_65 } from "../../src/lib/__tests__/fixtures/receipt-automation";
const req = createRequire(
  resolve(".superpowers/sdd/2026-10-03-automatic-receipt-correction/dom-tools/package.json"),
);
const { JSDOM } = req("jsdom");
const dom = new JSDOM("<html><body></body></html>", { url: "https://fixture.test" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
const { ReceiptControlRequestDialog } =
  await import("../../src/components/ReceiptControlRequestDialog");
const { ReceiptApprovalQueue } = await import("../../src/components/ReceiptApprovalQueue");
const { SESSION_QUERY_KEY } = await import("../../src/lib/session-client");
const originalKey = ["receipt-controls", "t:owner:owner", "original", "r", "d"];
const deposit: DepositDTO = {
  id: "d",
  status: "posted",
  amount: 50,
  currency: "MYR",
  n3DocCode: "OR-TEST/001",
  n3ReceiptId: "11111111-1111-4111-8111-111111111111",
  customerLabel: "Guest",
  accountLabel: "Bank",
  paymentLines: [],
  effectiveState: "active",
  description: "Deposit",
  createdByLabel: "Owner",
  createdAt: "2026-10-01T00:00:00Z",
  errorCode: null,
};
const original = (amountCents = 6500) => ({
  amountCents,
  currency: "MYR",
  accountId: "bank",
  accountLabel: "Bank",
  journal: { exact: true, reasons: [] },
  contact: {
    customerName: "Saved guest",
    remark1: "Saved address",
    remark2: "",
    remark3: "123",
    remark4: "guest@example.test",
  },
});
let root: ReturnType<typeof createRoot>, div: HTMLDivElement, qc: QueryClient;
let readsFail: boolean, writes: Array<Record<string, unknown>>, response: object;
let deferredRead: Promise<Response> | null, deferredWrite: Promise<Response> | null;
let closeCount: number;
let lostWrite: boolean;
let queueRows: ReceiptAutomationDTO[];
const queueRequest: ReceiptAutomationDTO = {
  id: "request",
  reservationId: "r",
  depositId: "d",
  bookingReference: "BK-TEST",
  reason: "Correction",
  requestedByLabel: "Front Desk",
  requestedAt: "2026-10-03T00:00:00Z",
  state: "pending",
  version: 1,
  original: RECEIPT_50,
  proposal: PROPOSAL_65,
  comparison: {
    fields: [{ label: "Amount", original: "RM50.00", requested: "RM65.00" }],
    depositDeltaCents: 1500,
    balanceDeltaCents: -1500,
  },
  executionMode: "direct",
  decidedByLabel: null,
  decidedAt: null,
  selfApproved: false,
  canApprove: true,
  canReject: true,
  canVerify: false,
  canRecover: false,
  outcomeMessage: null,
  alert: null,
  automation: {
    generation: 2,
    policy: { revision: "0", depositApprovalRequired: true, contactApprovalRequired: false },
    categories: { deposit: true, contact: false },
    authorizationKind: null,
    authorizedBy: null,
    authorizedAt: null,
  },
  canApply: false,
  canCheckResult: false,
};
const pause = () => new Promise((r) => setTimeout(r, 20));
beforeEach(() => {
  onlineManager.setOnline(true);
  readsFail = false;
  writes = [];
  deferredRead = null;
  deferredWrite = null;
  closeCount = 0;
  lostWrite = false;
  queueRows = [queueRequest];
  response = { request: { id: "request", state: "pending", outcomeMessage: null } };
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  qc.setQueryData(SESSION_QUERY_KEY, {
    authenticated: true,
    tenant: { tenantId: "t" },
    user: { n3UserKey: "owner" },
    role: "owner",
  });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/hotel/payment-accounts")
      return Response.json({ accounts: [{ id: "bank", label: "Bank", isActive: true }] });
    if (url.startsWith("/api/hotel/receipt-controls?"))
      return Response.json({ requests: queueRows, total: queueRows.length, nextOffset: null });
    if (url.endsWith("/decision")) {
      writes.push(JSON.parse(init!.body as string));
      return deferredWrite ?? Response.json(response);
    }
    if (!url.endsWith("/receipt-requests")) throw Error(`Unexpected request: ${url}`);
    if (init?.method === "POST") {
      writes.push(JSON.parse(init.body as string));
      if (lostWrite) throw new Error("Connection interrupted after dispatch");
      return deferredWrite ?? Response.json(response);
    }
    return (
      deferredRead ??
      (readsFail
        ? Response.json({ error: "n3_evidence_unavailable" }, { status: 503 })
        : Response.json({ original: original() }))
    );
  });
  div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  div.remove();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});
async function mount() {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(ReceiptControlRequestDialog, {
          reservationId: "r",
          deposit,
          kind: "correction",
          onClose: () => {
            closeCount++;
          },
        }),
      ),
    );
    await pause();
  });
  await act(pause);
}
async function enter(selector: string, value: string) {
  const node = div.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  await act(async () => {
    const proto =
      node.tagName === "TEXTAREA"
        ? dom.window.HTMLTextAreaElement.prototype
        : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
    node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    node.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const sendButton = () =>
  Array.from(div.querySelectorAll("button")).find((b) =>
    /Send request|Save change|Sending/.test(b.textContent!),
  )!;
async function submit() {
  await enter('input[inputmode="decimal"]', "80.00");
  await enter("textarea", "Guest changed amount");
  await act(async () => {
    sendButton().click();
    await pause();
  });
  await act(pause);
}
it("uses the fresh N3 amount for both the Original column and initial edit value", async () => {
  await mount();
  expect(div.querySelector("tbody tr td:nth-child(2)")!.textContent).toBe("RM65.00");
  expect((div.querySelector('input[inputmode="decimal"]') as HTMLInputElement).value).toBe("65.00");
});
it("blocks submission while cached receipt evidence is being re-read", async () => {
  qc.setQueryData(originalKey, { original: original(5000) });
  deferredRead = new Promise(() => {});
  await mount();
  await enter("textarea", "Correction");
  expect(sendButton().disabled).toBe(true);
  expect(writes).toEqual([]);
});
it("blocks submission if refreshing cached receipt evidence fails", async () => {
  qc.setQueryData(originalKey, { original: original(5000) });
  readsFail = true;
  await mount();
  await enter("textarea", "Correction");
  expect(div.textContent).toContain("could not be read from N3");
  expect(sendButton().disabled).toBe(true);
});
it("keeps a direct-save needs-review result visible and prevents another submission", async () => {
  response = {
    request: { id: "request", state: "needs_review", outcomeMessage: null },
    outcome: "needs_review",
    code: "n3_update_unknown",
  };
  await mount();
  await submit();
  expect(writes).toHaveLength(1);
  expect(closeCount).toBe(0);
  expect(div.textContent).toContain("Check N3 result");
  expect(div.textContent).toContain("do not resend");
  expect(sendButton().disabled).toBe(true);
});
it("distinguishes verified direct save from a pending approval without closing silently", async () => {
  response = {
    request: { id: "request", state: "applied", outcomeMessage: null },
    outcome: "applied",
    code: "verified",
  };
  await mount();
  await submit();
  expect(closeCount).toBe(0);
  expect(div.textContent).toContain("N3 change verified");
  expect(sendButton().disabled).toBe(true);
});
it("gives pending approval a Dashboard next step and keeps contact omitted for amount-only change", async () => {
  await mount();
  await submit();
  expect(closeCount).toBe(0);
  expect(div.textContent).toContain("Owner Dashboard");
  expect(writes[0]!.proposal).toEqual({ kind: "correction", amount: 80, accountId: "bank" });
});
it("ignores a late submission result after the signed-in identity changes", async () => {
  let finish!: (v: Response) => void;
  deferredWrite = new Promise((done) => {
    finish = done;
  });
  await mount();
  await submit();
  await act(async () => {
    qc.setQueryData(SESSION_QUERY_KEY, { authenticated: false });
    await pause();
  });
  await act(async () => {
    finish(Response.json({ request: { state: "applied" }, outcome: "applied", code: "verified" }));
    await pause();
  });
  expect(closeCount).toBe(0);
  expect(div.textContent).not.toContain("N3 change verified");
  expect(div.querySelector('[role="dialog"]')).toBeNull();
});
it("blocks changed N3 evidence rather than silently rebasing an open draft", async () => {
  await mount();
  await enter("textarea", "Correction");
  await act(async () => {
    qc.setQueryData(originalKey, { original: original(7000) });
    await pause();
  });
  expect(div.textContent).toContain("Close and reopen Edit receipt");
  expect(sendButton().disabled).toBe(true);
  expect(div.querySelector("tbody tr td:nth-child(2)")!.textContent).toBe("RM65.00");
});
it("does not send an edit when the fresh journal is unproven", async () => {
  deferredRead = Promise.resolve(
    Response.json({
      original: {
        ...original(),
        journal: { exact: false, reasons: ["journal_credit_amount_mismatch"] },
      },
    }),
  );
  await mount();
  await enter("textarea", "Correction");
  expect(sendButton().disabled).toBe(true);
  expect(writes).toEqual([]);
  expect(div.textContent).toContain("customer amount differs");
});
async function mountQueue() {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(ReceiptApprovalQueue, { enabled: true }),
      ),
    );
    await pause();
  });
  await act(pause);
}
async function approve() {
  await act(async () => {
    Array.from(div.querySelectorAll("button"))
      .find((b) => b.textContent === "Approve")!
      .click();
    await pause();
  });
  await act(pause);
}
it("one Owner Approve posts the expected version and renders the verified result", async () => {
  response = {
    request: { ...queueRequest, state: "applied", outcomeMessage: "N3 change verified." },
  };
  await mountQueue();
  expect(div.textContent).toContain("RM50.00");
  expect(div.textContent).toContain("RM65.00");
  expect(div.querySelector('input[type="checkbox"]')).toBeNull();
  await approve();
  expect(writes).toEqual([{ decision: "approve", expectedVersion: 1 }]);
  expect(div.textContent).toContain("N3 change verified.");
});
it("does not show the previous Owner's late decision result in a new Owner session", async () => {
  let finish!: (v: Response) => void;
  deferredWrite = new Promise((done) => {
    finish = done;
  });
  await mountQueue();
  await approve();
  queueRows = [];
  await act(async () => {
    qc.setQueryData(SESSION_QUERY_KEY, {
      authenticated: true,
      tenant: { tenantId: "t" },
      user: { n3UserKey: "other" },
      role: "owner",
    });
    await pause();
  });
  await act(async () => {
    finish(
      Response.json({
        request: {
          ...queueRequest,
          state: "applied",
          outcomeMessage: "Prior Owner's private result",
        },
      }),
    );
    await pause();
  });
  expect(div.textContent).not.toContain("Prior Owner's private result");
});
it("does not show the previous Owner's late decision error in a new Owner session", async () => {
  let finish!: (v: Response) => void;
  deferredWrite = new Promise((done) => {
    finish = done;
  });
  await mountQueue();
  await approve();
  queueRows = [];
  await act(async () => {
    qc.setQueryData(SESSION_QUERY_KEY, {
      authenticated: true,
      tenant: { tenantId: "t" },
      user: { n3UserKey: "other" },
      role: "owner",
    });
    await pause();
  });
  await act(async () => {
    finish(Response.json({ error: "n3_update_unknown" }, { status: 409 }));
    await pause();
  });
  expect(div.textContent).not.toContain("Use Check N3 result");
});
it("holds a lost submission response with existing-request guidance instead of inviting a resend", async () => {
  lostWrite = true;
  await mount();
  await submit();
  expect(writes).toHaveLength(1);
  expect(div.textContent).toContain("Owner Dashboard");
  expect(div.textContent).toContain("do not resend");
  expect(sendButton().disabled).toBe(true);
});
it("a rapid double click submits the dialog only once", async () => {
  deferredWrite = new Promise(() => {});
  await mount();
  await enter('input[inputmode="decimal"]', "80.00");
  await enter("textarea", "Correction");
  await act(async () => {
    sendButton().click();
    sendButton().click();
    await pause();
  });
  expect(writes).toHaveLength(1);
});
it("does not initialize or submit cached evidence when its first fresh GET is offline-paused", async () => {
  qc.setQueryData(originalKey, { original: original(5000) });
  onlineManager.setOnline(false);
  await mount();
  await enter("textarea", "Correction");
  expect(sendButton().disabled).toBe(true);
  expect(writes).toEqual([]);
});
