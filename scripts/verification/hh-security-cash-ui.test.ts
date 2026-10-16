// Real React/QueryClient/DOM. All fetches are fixtures; no operational or N3 calls.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createElement, act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const req = createRequire(
  resolve(
    process.env.HH_SECURITY_SQL_TOOLS || ".superpowers/sdd/2026-10-09-security-cash/sql-tools",
    "package.json",
  ),
);
const { JSDOM } = req("jsdom");
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
  url: "https://hotel.test",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
const { SecurityCashCard } = await import("../../src/components/SecurityCashCard");
const h = {
  id: "11111111-1111-4111-8111-111111111111",
  reservationId: "44444444-4444-4444-8444-444444444444",
  roomStayId: "55555555-5555-4555-8555-555555555555",
  receiptNumber: "SD261000001",
  originalCents: 5000,
  payer: "Guest",
  recipient: "Guest",
  storage: "Envelope A",
  roomNumber: "101",
  bookingReference: "BK1",
  terms: "Cash only",
  waived: false,
  inspectionClear: true,
  openCase: false,
  version: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  createdAt: "2026-10-09T08:00:00Z",
  createdBy: "staff",
  heldCents: 5000,
  returnableCents: 3000,
  pendingDispositionCents: 2000,
  pendingReturn: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    cents: 3000,
    recipient: "Guest",
    reservedBy: "staff",
  },
};
let qc: QueryClient,
  root: ReturnType<typeof createRoot>,
  writes: Array<{ body: Record<string, unknown>; headers: HeadersInit | undefined }>,
  hold: boolean,
  finish: (() => void) | null,
  tenant: string;
const pause = () => new Promise((done) => setTimeout(done, 20));
const session = () => ({
  authenticated: true,
  tenant: { tenantId: tenant },
  user: { n3UserKey: "staff" },
  role: "front_desk",
});
const render = () =>
  root.render(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(SecurityCashCard, { reservationId: h.reservationId }),
    ),
  );
const click = async (text: string) => {
  const b = [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
  expect(b).toBeTruthy();
  await act(async () => {
    b.click();
    await pause();
  });
};
const fill = async (name: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await pause();
  });
};
beforeEach(async () => {
  writes = [];
  hold = false;
  finish = null;
  tenant = "22222222-2222-4222-8222-222222222222";
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  qc.setQueryData(["session", "me"], session());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes.push({ body: JSON.parse(init.body as string), headers: init.headers });
        if (hold)
          await new Promise<void>((r) => {
            finish = r;
          });
        return Response.json({ ...h, pendingReturn: null, heldCents: 2000, returnableCents: 0 });
      }
      if (url.includes("/api/session/me")) return Response.json(session());
      if (url.includes("/api/hotel/security-cash?"))
        return Response.json({
          policy: { amountCents: 5000, required: true, terms: "Cash", version: "0" },
          report: {
            from: "2026-10-01",
            asAt: "2026-10-09",
            openingCents: 0,
            collectionsCents: 5000,
            returnsCents: 0,
            transfersCents: 0,
            adjustmentsCents: 0,
            closingCents: 5000,
            holdings: [],
            events: [],
          },
          statements: [],
        });
      if (url.includes("/security-cash"))
        return Response.json({
          available: true,
          enabled: false,
          policy: { amountCents: 5000, required: true, terms: "Cash", version: "0" },
          holdings: tenant.startsWith("222") ? [h] : [],
        });
      throw new Error("Unexpected network route " + url);
    }),
  );
  root = createRoot(document.getElementById("root")!);
  await act(async () => {
    render();
    await pause();
  });
  await act(pause);
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  vi.unstubAllGlobals();
});
it("uses saved cash amount and recipient for physical handover confirmation", async () => {
  await click("Confirm cash handed");
  expect(document.querySelector('input[name="cents"]')).toBeNull();
  expect(document.querySelector<HTMLInputElement>('input[name="recipient"]')!.readOnly).toBe(true);
  await fill("acknowledgment", "Signed paper return #1");
  await act(async () => {
    document
      .querySelector<HTMLFormElement>("form")!
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click();
    await pause();
  });
  await act(async () => {
    document
      .querySelector<HTMLFormElement>("form")!
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await pause();
  });
  expect(writes).toHaveLength(1);
  expect(writes[0].body.command).toEqual({
    action: "confirm_return",
    holdingId: h.id,
    version: h.version,
    operationId: h.pendingReturn.id,
    recipient: "Guest",
    acknowledgment: "Signed paper return #1",
  });
  expect(writes[0].body.key).toMatch(/^[0-9a-f-]{36}$/);
});
it("drops a late handover result and receipt after property switch", async () => {
  hold = true;
  await click("Confirm cash handed");
  await fill("acknowledgment", "Signed paper #2");
  await act(async () => {
    document
      .querySelector<HTMLFormElement>("form")!
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click();
    document
      .querySelector<HTMLFormElement>("form")!
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await pause();
  });
  expect(writes).toHaveLength(1);
  await act(async () => {
    tenant = "33333333-3333-4333-8333-333333333333";
    qc.setQueryData(["session", "me"], session());
    render();
    await pause();
  });
  await act(async () => {
    finish?.();
    await pause();
  });
  expect(document.body.textContent).not.toContain("SD261000001");
  expect(document.body.textContent).not.toContain("Recorded.");
});
