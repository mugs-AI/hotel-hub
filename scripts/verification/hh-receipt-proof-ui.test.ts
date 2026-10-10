import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createElement, act } from "react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const req = createRequire(
  resolve(".superpowers/sdd/2026-10-03-automatic-receipt-correction/dom-tools/package.json"),
);
const { JSDOM } = req("jsdom");
const dom = new JSDOM("<html><body></body></html>", { url: "https://fixture.test" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  sessionStorage: dom.window.sessionStorage,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
const { ReceiptUpdateProofPanel } = await import("../../src/components/ReceiptUpdateProofPanel");
let root: ReturnType<typeof createRoot>, div: HTMLDivElement, writes: string[];
const sample = {
  caseId: "increase",
  companyName: "Test company",
  receiptId: "11111111-1111-4111-8111-111111111111",
  docCode: "OR-TEST/001",
  documentDate: "2026-10-10",
  beforeCents: 5000,
  afterCents: 6500,
  packageHash: "a".repeat(64),
  sourceReference: "a".repeat(40),
  expiresAt: Date.now() + 60000,
};
let cases: unknown[], lost: boolean;
let phase: string;
const pause = () => new Promise((r) => setTimeout(r, 10));
beforeEach(() => {
  phase = "unknown";
  writes = [];
  cases = [sample];
  lost = false;
  sessionStorage.clear();
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      writes.push(body.action);
      if (body.action === "prepare")
        return Response.json({ permitId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", summary: sample });
      if (lost) throw Error("lost");
      return Response.json({ outcome: "verified", safeReport: null });
    }
    return Response.json(
      url.includes("permitId")
        ? {
            phase,
            summary: sample,
            outcome: phase === "verified" ? "verified" : "needs_review",
            safeReport: phase === "verified" ? { ...sample, outcome: "verified" } : null,
          }
        : { cases, enabled: cases.length > 0 },
    );
  });
  div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
});
afterEach(async () => {
  await act(async () => root.unmount());
  div.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    root.render(createElement(ReceiptUpdateProofPanel, { identityKey: "t:owner:owner" }));
    await pause();
  });
  await act(pause);
}
async function click(label: string) {
  const button = Array.from(div.querySelectorAll("button")).find((b) => b.textContent === label)!;
  await act(async () => {
    button.click();
    await pause();
  });
}
it("defaults to disabled with no configured cases", async () => {
  cases = [];
  await mount();
  expect(div.textContent).toContain("Disabled");
  expect((div.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
  expect(writes).toEqual([]);
});
it("shows exact comparison and prevents double dispatch after a lost response", async () => {
  await mount();
  const select = div.querySelector("select")!;
  await act(async () => {
    select.value = "increase";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  expect(div.textContent).toContain("RM50.00 → RM65.00");
  await click("Prepare test");
  lost = true;
  await click("Update this test OR once");
  expect(div.textContent).toContain("Result unknown");
  expect(
    Array.from(div.querySelectorAll("button")).some(
      (b) => b.textContent === "Update this test OR once",
    ),
  ).toBe(false);
  await click("Check N3 result");
  expect(writes).toEqual(["prepare", "run"]);
});
it("restores only the prior permit check action on reload", async () => {
  sessionStorage.setItem("hh-receipt-proof:t:owner:owner", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  await mount();
  expect(div.textContent).toContain("Check N3 result");
  expect(div.textContent).not.toContain("Update this test OR once");
  expect(writes).toEqual([]);
});

it("restores a prepared permit with the exact comparison and explicit Run action", async () => {
  phase = "prepared";
  sessionStorage.setItem("hh-receipt-proof:t:owner:owner", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  await mount();
  expect(div.textContent).toContain("RM50.00 → RM65.00");
  expect(div.textContent).toContain("Update this test OR once");
  expect(writes).toEqual([]);
});
it("permits a new test only after verified terminal recovery", async () => {
  phase = "verified";
  sessionStorage.setItem("hh-receipt-proof:t:owner:owner", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  await mount();
  await click("Next approved test");
  expect(div.querySelector("select")).not.toBeNull();
  expect(sessionStorage.getItem("hh-receipt-proof:t:owner:owner")).toBeNull();
  expect(writes).toEqual([]);
});
