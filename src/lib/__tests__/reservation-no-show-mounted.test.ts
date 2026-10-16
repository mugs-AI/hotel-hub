import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NoShowAction } from "../../components/NoShowAction";
import { SESSION_QUERY_KEY } from "../session-client";
import { WorkspaceProvider, useWorkspace } from "../workspace-context";
import type { WorkspaceStore } from "../workspace-tabs";

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
describe.skipIf(!domPackage)("manual no-show tab workflow", () => {
  type DomWindow = Window & typeof globalThis & { happyDOM: { close(): Promise<void> } };
  let WindowCtor: { new (): DomWindow };
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: ReturnType<typeof createRoot>, window: DomWindow, qc: QueryClient;
  let container: HTMLElement, store: WorkspaceStore;
  let posts: Array<{ path: string; body: Record<string, unknown> }>;
  let rateEnabled = true;
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
    rateEnabled = true;
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
          return Response.json({
            result: {
              reservationId: path.split("/")[4],
              status: "no_show",
              updatedAt: "2026-10-14T01:00:00Z",
              releasedRoomIds: [],
              accountingReviewRequired: false,
            },
          });
        }
        if (path.endsWith("/no-show"))
          return Response.json({
            state: {
              eligible: rateEnabled,
              propertyDate: "2026-10-14",
              updatedAt: "2026-10-13T00:00:00.123456Z",
            },
          });
        throw new Error(`Unexpected read ${path}`);
      }),
    );
    container = window.document.createElement("div");
    window.document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => {
      completePost?.(Response.json({ error: "operation_stale" }, { status: 409 }));
    });
    await act(async () => root.unmount());
    qc.clear();
    await window.happyDOM.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  function Capture() {
    store = useWorkspace()!.store;
    return null;
  }
  async function show(id: string) {
    navigation.path = `/reservations/${id}`;
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(
            WorkspaceProvider,
            { children: null },
            createElement(Capture),
            createElement(NoShowAction, { key: id, reservationId: id, canEdit: true }),
          ),
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
  async function reason(value: string) {
    const input = container.querySelector<HTMLInputElement>('input[name="no-show-reason"]')!;
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
  it("opening does not post and another tab retains its own confirmation", async () => {
    await show(ids[0]);
    await settle();
    await click("Mark no-show and release rooms");
    await reason("No arrival");
    await show(ids[1]);
    await settle();
    expect(container.querySelector('input[name="no-show-reason"]')).toBeNull();
    await show(ids[0]);
    expect(container.querySelector<HTMLInputElement>('input[name="no-show-reason"]')!.value).toBe(
      "No arrival",
    );
    expect(posts).toHaveLength(0);
  });
  it("pending confirmation cannot be discarded or repeated after remount", async () => {
    deferPost = true;
    await show(ids[0]);
    await settle();
    await click("Mark no-show and release rooms");
    await reason("No arrival");
    await click("Confirm no-show");
    await show(ids[1]);
    await show(ids[0]);
    expect(store.close(`reservation:${ids[0]}`, true)).toBe(false);
    expect(
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!.disabled,
    ).toBe(true);
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toContain(ids[0]);
    await show(ids[1]);
    await act(async () =>
      completePost!(
        Response.json({
          result: {
            reservationId: ids[0],
            status: "no_show",
            updatedAt: "2026-10-14T01:00:00Z",
            releasedRoomIds: [],
            accountingReviewRequired: true,
          },
        }),
      ),
    );
    await settle();
    await show(ids[0]);
    expect(container.textContent).toContain("Deposits are retained for accounting review");
    expect(store.close(`reservation:${ids[0]}`, true)).toBe(true);
  });
  it("does not offer no-show for an ineligible arrival", async () => {
    rateEnabled = false;
    await show(ids[0]);
    await settle();
    expect(container.textContent).not.toContain("Mark no-show and release rooms");
    expect(posts).toHaveLength(0);
  });
});
