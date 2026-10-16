import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useInitialBookingPayer } from "../source-policy-client";
import { SESSION_QUERY_KEY } from "../session-client";
import { actor, plan } from "./fixtures/source-billing";
import { InitialBookingPayerControl } from "../../components/InitialBookingPayerControl";
const domPackage = process.env.HH_UI_DOM_PACKAGE;
describe.skipIf(!domPackage)("initial booking payer selection lifecycle", () => {
  let win: Window & typeof globalThis & { happyDOM: { close(): Promise<void> } },
    root: import("react-dom/client").Root,
    container: HTMLElement,
    qc: QueryClient;
  let currentPolicy = plan().payer.policy,
    code: string,
    required: boolean,
    reads: string[];
  let current: ReturnType<typeof useInitialBookingPayer>;
  function Harness() {
    current = useInitialBookingPayer(code);
    return h(InitialBookingPayerControl, { payer: current, sourceCode: code });
  }
  beforeEach(async () => {
    const { Window } = await import(/* @vite-ignore */ domPackage!);
    win = new Window();
    for (const k of ["window", "document", "navigator", "HTMLElement", "Event"] as const)
      vi.stubGlobal(k, k === "window" ? win : win[k]);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
    });
    qc.setQueryData(SESSION_QUERY_KEY, {
      authenticated: true,
      tenant: { tenantId: actor.tenantId, tenantCode: "TEST", companyName: "Hotel" },
      user: { n3UserKey: actor.n3UserKey },
      role: "front_desk",
    });
    currentPolicy = structuredClone(plan().payer.policy);
    code = "agoda";
    required = true;
    reads = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        expect(init?.method ?? "GET").toBe("GET");
        reads.push(String(input));
        return Response.json({
          tenantId: actor.tenantId,
          sourceCode: code,
          required,
          policy: required ? currentPolicy : null,
        });
      }),
    );
    container = win.document.createElement("div");
    win.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    qc.clear();
    vi.unstubAllGlobals();
    await win.happyDOM.close();
  });
  afterAll(() => vi.restoreAllMocks());
  async function render() {
    await act(async () => {
      root.render(h(QueryClientProvider, { client: qc }, h(Harness)));
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  it("shows the configured default but requires explicit confirmation", async () => {
    await render();
    expect(container.textContent).toContain("Billing collection");
    expect(container.querySelector("select")?.value).toBe(currentPolicy.defaultCollectionMode);
    expect(current.collectionMode).toBe(currentPolicy.defaultCollectionMode);
    expect(current.ready).toBe(false);
    await act(async () => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    expect(current.ready).toBe(true);
    expect(current.selection).toEqual({
      sourceId: currentPolicy.sourceId,
      policyVersion: currentPolicy.version,
      collectionMode: currentPolicy.defaultCollectionMode,
    });
    expect(reads).toHaveLength(1);
  });
  it("changing the mode requires a new confirmation", async () => {
    await render();
    await act(async () => current.confirm(true));
    await act(async () => current.choose("guest"));
    expect(current.ready).toBe(false);
    await act(async () => current.confirm(true));
    expect(current.selection?.collectionMode).toBe("guest");
  });
  it("a changed policy invalidates the previous review", async () => {
    await render();
    await act(async () => current.confirm(true));
    currentPolicy = { ...currentPolicy, version: "2", guestCustomerId: 12 };
    await act(async () => {
      await current.refetch();
    });
    // Query completion precedes React Query's batched observer notification.
    for (let n = 0; n < 60 && (!current.data?.required || current.data.policy.version !== "2"); n++)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    expect(current.data?.required && current.data.policy.version).toBe("2");
    expect(current.ready).toBe(false);
  });
  it("switching source or identity cannot reuse a confirmed payer", async () => {
    await render();
    await act(async () => current.confirm(true));
    code = "walk_in";
    await render();
    expect(current.ready).toBe(false);
    await act(async () => current.confirm(true));
    qc.setQueryData(SESSION_QUERY_KEY, { authenticated: false });
    await render();
    expect(current.ready).toBe(false);
    expect(current.selection).toBeNull();
  });
  it("preserves booking before candidate installation without inventing a payer", async () => {
    required = false;
    await render();
    expect(current.ready).toBe(true);
    expect(current.selection).toBeNull();
  });
});
