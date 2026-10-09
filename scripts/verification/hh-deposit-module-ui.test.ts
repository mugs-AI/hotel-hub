// Real React + QueryClient + DOM events. All fetches are fixture responses.
// Test-only jsdom is installed separately, never added to application packages.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createElement, act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const requireTool = createRequire(
  resolve(
    process.env.HH_DEPOSIT_UI_TOOLS ||
      ".superpowers/sdd/2026-10-09-deposit-module-controls/ui-tools",
    "package.json",
  ),
);
const { JSDOM } = requireTool("jsdom");
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "https://hotel.test",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
const modulePath = process.env.HH_DEPOSIT_UI_BEFORE
  ? resolve(".superpowers/sdd/2026-10-09-deposit-module-controls/before-panel.tsx")
  : resolve("src/components/DepositModuleSettingsPanel.tsx");
const { DepositModuleSettingsPanel } = await import(modulePath);
const me = (tenant: string) => ({
  authenticated: true,
  tenant: { tenantId: tenant },
  user: { n3UserKey: "owner" },
  role: "owner",
});
const state = (advance = true, security = false, version = "0") => ({
  policy: { roomAdvanceEnabled: advance, securityDepositEnabled: security, version },
  available: true,
  securityReady: true,
});
const firstVersion = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondVersion = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let qc: QueryClient;
let root: ReturnType<typeof createRoot>;
let tenant: string;
let serverState: ReturnType<typeof state>;
let conflict: boolean;
let hold: boolean;
let finish: (() => void) | null;
let writes: unknown[];
const pause = () => new Promise((done) => setTimeout(done, 20));
const input = (name: string) =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
const save = () =>
  Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Save deposit settings",
  )!;
beforeEach(async () => {
  tenant = "A";
  serverState = state();
  conflict = false;
  hold = false;
  finish = null;
  writes = [];
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  qc.setQueryData(["session", "me"], me(tenant));
  vi.stubGlobal("fetch", async (url: string, options: RequestInit = {}) => {
    if (url === "/api/session/me") return Response.json(me(tenant));
    if (url !== "/api/hotel/deposit-modules") throw new Error(`Refused non-fixture fetch: ${url}`);
    if (options.method !== "PATCH") return Response.json(serverState);
    const payload = JSON.parse(String(options.body));
    writes.push(payload);
    if (hold)
      await new Promise<void>((done) => {
        finish = done;
      });
    if (conflict)
      return Response.json({ error: "deposit_module_policy_conflict" }, { status: 409 });
    serverState = { ...serverState, policy: { ...payload, version: firstVersion } };
    return Response.json(serverState);
  });
  document.getElementById("root")!.replaceChildren();
  root = createRoot(document.getElementById("root")!);
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: qc }, createElement(DepositModuleSettingsPanel)),
    );
    await pause();
  });
  await act(pause);
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  vi.unstubAllGlobals();
});
it("save feedback survives a new policy version and preserves independent selection", async () => {
  await act(async () => {
    input("Refundable Security Deposits").click();
    await pause();
  });
  await act(async () => {
    save().click();
    await pause();
  });
  await act(pause);
  expect(writes).toEqual([
    { roomAdvanceEnabled: true, securityDepositEnabled: true, version: "0" },
  ]);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Deposit settings saved.");
  expect(input("Room Advance Payments").checked).toBe(true);
  expect(input("Refundable Security Deposits").checked).toBe(true);
});
it("conflict explanation survives authoritative refetch and resets the stale draft", async () => {
  await act(async () => {
    input("Refundable Security Deposits").click();
    await pause();
  });
  conflict = true;
  serverState = state(false, false, secondVersion);
  await act(async () => {
    save().click();
    await pause();
  });
  await act(pause);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Another Owner changed these settings",
  );
  expect(input("Room Advance Payments").checked).toBe(false);
  expect(input("Refundable Security Deposits").checked).toBe(false);
  expect(save().disabled).toBe(true);
});
it("an unsaved version-0 draft and late PATCH response cannot cross Owner identities", async () => {
  await act(async () => {
    input("Refundable Security Deposits").click();
    await pause();
  });
  hold = true;
  await act(async () => {
    save().click();
    await pause();
  });
  expect(finish).not.toBeNull();
  tenant = "B";
  serverState = state();
  await act(async () => {
    qc.setQueryData(["session", "me"], me(tenant));
    await pause();
  });
  await act(pause);
  expect(input("Refundable Security Deposits").checked).toBe(false);
  await act(async () => {
    finish!();
    await pause();
  });
  await act(pause);
  expect(input("Refundable Security Deposits").checked).toBe(false);
  expect(save().disabled).toBe(true);
  expect(qc.getQueryData(["deposit-module-policy", "A:owner:owner"])).toBeUndefined();
  expect(qc.getQueryData(["deposit-module-policy", "B:owner:owner"])).toMatchObject({
    policy: { version: "0", securityDepositEnabled: false },
  });
  expect(document.querySelector('[role="status"]')).toBeNull();
});
