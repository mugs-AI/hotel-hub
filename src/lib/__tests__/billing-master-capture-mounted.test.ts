import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BillingMasterCapturePanel } from "../../components/BillingMasterCapturePanel";
import { SESSION_QUERY_KEY } from "../session-client";

const navigation = vi.hoisted(() => ({ path: "", subscribe: () => () => {} }));
vi.mock("@tanstack/react-router", async (load) => ({
  ...(await load<object>()),
  useLocation: () => ({ pathname: navigation.path, search: {} }),
  useRouter: () => ({ subscribe: navigation.subscribe }),
}));

const domPackage = process.env.HH_UI_DOM_PACKAGE;
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
// Uses the real workspace provider, form, query mutation and same-origin client.
// Only router navigation and HTTP replies are synthetic; no N3 or DB access.
describe.skipIf(!domPackage)("Owner billing master capture panel", () => {
  type DomWindow = Window & typeof globalThis & { happyDOM: { close(): Promise<void> } };
  let WindowCtor: { new (): DomWindow };
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: ReturnType<typeof createRoot>, window: DomWindow, qc: QueryClient;
  let container: HTMLElement;
  let posts: Array<{ path: string; body: Record<string, unknown> }>;
  let configuredReplies: Response[];
  let captureReplies: Response[];
  let gets: string[];
  let deferConfigured = false;
  let completeConfigured: ((response: Response) => void) | null = null;
  let deferPost = false;
  let completePost: ((response: Response) => void) | null = null;
  beforeAll(async () => {
    ({ Window: WindowCtor } = await import(/* @vite-ignore */ domPackage!));
  });
  beforeEach(async () => {
    window = new WindowCtor();
    for (const key of [
      "window",
      "document",
      "navigator",
      "HTMLElement",
      "HTMLInputElement",
      "HTMLSelectElement",
      "Event",
      "MouseEvent",
    ] as const)
      vi.stubGlobal(key, key === "window" ? window : window[key]);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", window.requestAnimationFrame.bind(window));
    vi.stubGlobal("cancelAnimationFrame", window.cancelAnimationFrame.bind(window));
    ({ createRoot } = await import("react-dom/client"));
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
    });
    qc.setQueryData(SESSION_QUERY_KEY, {
      authenticated: true,
      role: "owner",
      exceptionApprovalMode: "direct",
      housekeepingMode: "simple",
      tenant: { tenantId: "fixture-tenant" },
      user: { n3UserKey: "fixture-owner" },
    });
    posts = [];
    gets = [];
    configuredReplies = [];
    captureReplies = [];
    deferConfigured = false;
    completeConfigured = null;
    deferPost = false;
    completePost = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const path = String(url);
        if (init?.method === "POST") {
          posts.push({ path, body: JSON.parse(String(init.body)) });
          if (deferPost)
            return new Promise<Response>((resolve) => {
              completePost = resolve;
            });
          if (captureReplies.length) return captureReplies.shift()!;
          return Response.json({
            report: {
              schemaVersion: "hh-master-capture-v1",
              status: "captured",
              contractAccepted: false,
              capturedAt: "2026-10-14T01:00:00Z",
              evidence: [],
            },
          });
        }
        gets.push(path);
        if (deferConfigured)
          return new Promise<Response>((resolve) => {
            completeConfigured = resolve;
          });
        return (
          configuredReplies.shift() ??
          Response.json({
            configured: configured([
              { kind: "customer", id: 71 },
              { kind: "stock", id: 101 },
            ]),
          })
        );
      }),
    );
    container = window.document.createElement("div");
    window.document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => {
      completeConfigured?.(Response.json({ error: "operation_stale" }, { status: 409 }));
      completePost?.(Response.json({ error: "operation_stale" }, { status: 409 }));
    });
    await act(async () => root.unmount());
    qc.clear();
    await window.happyDOM.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  async function show(id: string) {
    navigation.path = `/reservations/${id}`;
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(BillingMasterCapturePanel),
        ),
      ),
    );
  }
  async function click(text: string) {
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === text,
    );
    expect(button, `button ${text}`).toBeDefined();
    await act(async () => button!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  }
  async function enter(kind: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(`input[name="master-${kind}"]`)!;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(
        input,
        value,
      );
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  }
  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  it("does not read N3 on mount and sends only the selected master identities", async () => {
    await show(ids[0]);
    await settle();
    expect(posts).toHaveLength(0);
    expect(gets).toHaveLength(0);
    await enter("customer", "71");
    await enter("stock", "101");
    await click("Capture current billing masters");
    await settle();
    expect(posts).toEqual([
      {
        path: "/api/n3/settlement-master-capture",
        body: {
          masters: [
            { kind: "customer", id: 71 },
            { kind: "stock", id: 101 },
          ],
        },
      },
    ]);
    expect(container.textContent).toContain("Captured responses require review");
  });
  it("refuses malformed IDs before any request", async () => {
    await show(ids[0]);
    await enter("stock", "../1");
    await click("Capture current billing masters");
    expect(posts).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("valid");
  });
  it("clears inputs and captured data when the authenticated identity changes", async () => {
    await show(ids[0]);
    await enter("customer", "71");
    await click("Capture current billing masters");
    await settle();
    await act(async () =>
      qc.setQueryData(SESSION_QUERY_KEY, {
        authenticated: true,
        role: "owner",
        housekeepingMode: "simple",
        tenant: { tenantId: "other-tenant" },
        user: { n3UserKey: "other-owner" },
      }),
    );
    await settle();
    expect(container.textContent).not.toContain("Captured responses require review");
    expect(container.querySelector<HTMLInputElement>('input[name="master-customer"]')!.value).toBe(
      "",
    );
  });
  it("does not expose the panel to Front Desk", async () => {
    await act(async () =>
      qc.setQueryData(SESSION_QUERY_KEY, {
        authenticated: true,
        role: "front_desk",
        tenant: { tenantId: "fixture-tenant" },
        user: { n3UserKey: "fixture-staff" },
      }),
    );
    await show(ids[0]);
    expect(container.textContent).not.toContain("Capture current billing masters");
    expect(posts).toHaveLength(0);
  });
  function configured(masters: Array<{ kind: string; id: number | string }>) {
    return {
      schemaVersion: "hh-configured-master-ids-v1",
      contractAccepted: false,
      masters,
      invalidReferenceCount: 0,
      missingKinds: ["currency"],
    };
  }
  it("loads saved IDs only when asked and does not capture N3 until a separate click", async () => {
    await show(ids[0]);
    await settle();
    expect(gets).toHaveLength(0);
    await click("Use saved billing IDs");
    await settle();
    expect(gets).toEqual(["/api/n3/settlement-master-capture"]);
    expect(container.querySelector<HTMLInputElement>('input[name="master-customer"]')!.value).toBe(
      "71",
    );
    expect(container.querySelector<HTMLInputElement>('input[name="master-stock"]')!.value).toBe(
      "101",
    );
    expect(container.querySelector<HTMLInputElement>('input[name="master-currency"]')!.value).toBe(
      "",
    );
    expect(posts).toHaveLength(0);
    await click("Capture current billing masters");
    await settle();
    expect(posts[0].body).toEqual({
      masters: [
        { kind: "customer", id: 71 },
        { kind: "stock", id: 101 },
      ],
    });
  });
  it("shows every saved ID in bounded batches without silently dropping the remainder", async () => {
    configuredReplies.push(
      Response.json({
        configured: configured(
          Array.from({ length: 25 }, (_, i) => ({ kind: "stock", id: i + 1 })),
        ),
      }),
    );
    await show(ids[0]);
    await click("Use saved billing IDs");
    await settle();
    expect(container.textContent).toContain("Batch 1 of 2");
    await click("Capture current billing masters");
    await settle();
    expect((posts[0].body.masters as unknown[]).length).toBe(20);
    await click("Next batch");
    await settle();
    expect(container.textContent).toContain("Batch 2 of 2");
    expect(container.textContent).not.toContain("Captured responses require review");
    await click("Capture current billing masters");
    await settle();
    expect(posts[1].body).toEqual({
      masters: [21, 22, 23, 24, 25].map((id) => ({ kind: "stock", id })),
    });
  });
  it("keeps entered IDs after a failed configuration read and allows deliberate retry", async () => {
    configuredReplies.push(Response.json({ error: "unavailable" }, { status: 503 }));
    await show(ids[0]);
    await enter("customer", "88");
    await click("Use saved billing IDs");
    await settle();
    expect(container.querySelector<HTMLInputElement>('input[name="master-customer"]')!.value).toBe(
      "88",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("saved billing IDs");
    await click("Use saved billing IDs");
    await settle();
    expect(container.querySelector<HTMLInputElement>('input[name="master-customer"]')!.value).toBe(
      "71",
    );
    expect(posts).toHaveLength(0);
  });
  it("discards a configuration response after switching authenticated tenant", async () => {
    deferConfigured = true;
    await show(ids[0]);
    await click("Use saved billing IDs");
    await act(async () =>
      qc.setQueryData(SESSION_QUERY_KEY, {
        authenticated: true,
        role: "owner",
        tenant: { tenantId: "other-tenant" },
        user: { n3UserKey: "other-owner" },
      }),
    );
    await act(async () =>
      completeConfigured?.(
        Response.json({ configured: configured([{ kind: "customer", id: 71 }]) }),
      ),
    );
    await settle();
    expect(container.querySelector<HTMLInputElement>('input[name="master-customer"]')!.value).toBe(
      "",
    );
    expect(container.textContent).not.toContain("Batch 1");
  });
  it("rejects an incomplete saved-ID response without replacing the draft", async () => {
    configuredReplies.push(
      Response.json({
        configured: { ...configured([{ kind: "customer", id: "../71" }]), contractAccepted: true },
      }),
    );
    await show(ids[0]);
    await enter("stock", "101");
    await click("Use saved billing IDs");
    await settle();
    expect(container.querySelector<HTMLInputElement>('input[name="master-stock"]')!.value).toBe(
      "101",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("incomplete");
    expect(posts).toHaveLength(0);
  });
  it("does not resurrect an old batch report after a failed recapture", async () => {
    configuredReplies.push(
      Response.json({
        configured: configured(
          Array.from({ length: 21 }, (_, i) => ({ kind: "stock", id: i + 1 })),
        ),
      }),
    );
    await show(ids[0]);
    await click("Use saved billing IDs");
    await settle();
    await click("Capture current billing masters");
    await settle();
    expect(container.textContent).toContain("Captured responses require review");
    captureReplies.push(Response.json({ error: "unavailable" }, { status: 503 }));
    await click("Capture current billing masters");
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to capture");
    await click("Next batch");
    await click("Previous batch");
    await settle();
    expect(container.textContent).not.toContain("Captured responses require review");
    expect(
      [...container.querySelectorAll("button")].some(
        (b) => b.textContent === "Download billing master evidence",
      ),
    ).toBe(false);
  });
});
