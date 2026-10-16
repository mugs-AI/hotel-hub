import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ReservationActionsCard,
  PendingApprovalsCard,
} from "../../components/ReservationOperations";
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
describe.skipIf(!domPackage)("independent reservation action tabs", () => {
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
        if (path === "/api/hotel/operation-controls")
          return Response.json({
            controls: {
              tenantId: "fixture-tenant",
              rateChangeEnabled: rateEnabled,
              revision: "0",
              available: true,
            },
          });
        if (init?.method === "POST") {
          posts.push({ path, body: JSON.parse(String(init.body)) });
          if (deferPost)
            return new Promise<Response>((resolve) => {
              completePost = resolve;
            });
          return Response.json({ requestId: "synthetic-request", state: "applied" });
        }
        if (/\/reservations\/[^/]+\/operations$/.test(path))
          return Response.json({
            requests: [
              {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                state: "pending",
                operationType: "late_checkout",
                summary: "Synthetic late checkout",
                requestedAt: "2026-10-14T00:00:00Z",
              },
            ],
          });
        if (path.startsWith("/api/hotel/rooms") || path.startsWith("/api/hotel/housekeeping"))
          return Response.json({ rooms: [] });
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
  async function show(id: string, keyed = false, approval = false) {
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
            approval
              ? createElement(PendingApprovalsCard, {
                  ...(keyed ? { key: id } : {}),
                  reservationId: id,
                  canView: true,
                  canApprove: true,
                })
              : createElement(ReservationActionsCard, {
                  ...(keyed ? { key: id } : {}),
                  reservationId: id,
                  updatedAt: "2026-10-14T00:00:00Z",
                  status: "checked_in",
                  checkedInAt: "2026-10-13T06:00:00Z",
                  departureDate: "2026-10-15",
                  checkInAction: null,
                  canCheckIn: false,
                  canRequest: true,
                  rooms: [],
                }),
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
  async function enterTime(value: string) {
    const input = container.querySelector<HTMLInputElement>('input[type="time"]')!;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(
        input,
        value,
      );
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    expect(input.value).toBe(value);
  }
  it("does not carry an open Late checkout form to the next booking", async () => {
    await show(ids[0]);
    await click("Late checkout");
    await enterTime("14:10");
    await show(ids[1]);
    expect(container.querySelector('input[type="time"]')).toBeNull();
    expect(posts).toHaveLength(0);
  });
  it.each([false, true])(
    "keeps an in-flight action and its result across tab remounts, approval=%s",
    async (approval) => {
      deferPost = true;
      await show(ids[0], true, approval);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
      });
      if (approval) {
        await click("Approve");
        await click("Confirm");
      } else {
        await click("Late checkout");
        await enterTime("14:10");
        await click("Apply change");
      }
      await show(ids[1], true, approval);
      await show(ids[0], true, approval);
      const cancel = [...container.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Cancel",
      )!;
      expect(cancel.disabled).toBe(true);
      expect(store.close(`reservation:${ids[0]}`, true)).toBe(false);
      await show(ids[1], true, approval);
      await act(async () => {
        completePost!(Response.json({ requestId: "synthetic-request", state: "applied" }));
        await new Promise((resolve) => setTimeout(resolve, 15));
      });
      await show(ids[0], true, approval);
      if (approval)
        expect(
          store.getDraft(`reservation:${ids[0]}`, "operation-decision", { confirm: null }).confirm,
        ).toBeNull();
      else expect(container.querySelector('input[type="time"]')).toBeNull();
      expect(posts).toHaveLength(1);
      expect(store.close(`reservation:${ids[0]}`, true)).toBe(true);
    },
  );
  it.each([false, true])(
    "retains a saved action failure after unmount, approval=%s",
    async (approval) => {
      deferPost = true;
      await show(ids[0], true, approval);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
      });
      if (approval) {
        await click("Approve");
        await click("Confirm");
      } else {
        await click("Late checkout");
        await enterTime("14:10");
        await click("Apply change");
      }
      const original = posts[0].body.clientRequestId;
      await show(ids[1], true, approval);
      await act(async () => {
        completePost!(Response.json({ error: "operation_stale" }, { status: 409 }));
        await new Promise((resolve) => setTimeout(resolve, 15));
      });
      await show(ids[0], true, approval);
      expect(container.textContent).toContain("out of date");
      expect(
        [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cancel")!
          .disabled,
      ).toBe(false);
      const saved = approval
        ? store.getDraft(`reservation:${ids[0]}`, "operation-decision", {
            confirm: null as { id: string } | null,
          }).confirm
        : store.getDraft(`reservation:${ids[0]}`, "reservation-action", {
            flow: null as { id: string } | null,
          }).flow;
      expect(saved?.id).toBe(original);
    },
  );
  it("does not expose Change rate when the saved control is OFF", async () => {
    rateEnabled = false;
    await show(ids[0]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Change rate",
      ),
    ).toBe(false);
  });
  it("retains three keyed drafts, cancels only one and submits each booking's own time", async () => {
    await show(ids[0], true);
    await click("Late checkout");
    await enterTime("14:10");
    await show(ids[1], true);
    await click("Late checkout");
    await enterTime("15:20");
    await show(ids[2], true);
    await click("Late checkout");
    await enterTime("16:30");
    await show(ids[1], true);
    expect(container.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe("15:20");
    await click("Cancel");
    await show(ids[0], true);
    expect(container.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe("14:10");
    await click("Apply change");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe(`/api/hotel/reservations/${ids[0]}/operations`);
    expect(posts[0].body.payload).toMatchObject({ expectedCheckOutLocal: "2026-10-15T14:10" });
    await show(ids[2], true);
    expect(container.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe("16:30");
    await show(ids[1], true);
    expect(container.querySelector('input[type="time"]')).toBeNull();
    await act(async () => {
      expect(store.close(`reservation:${ids[2]}`, true)).toBe(true);
    });
    await show(ids[2], true);
    expect(container.querySelector('input[type="time"]')).toBeNull();
  });
});
