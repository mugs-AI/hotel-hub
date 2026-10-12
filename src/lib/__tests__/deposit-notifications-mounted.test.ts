import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useHotelChangeRevision } from "../hotel-change-revision-client";
import { SESSION_QUERY_KEY } from "../session-client";
const notice = vi.hoisted(() => ({ success: vi.fn(), dismiss: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: notice }));
const domPackage = process.env.HH_UI_DOM_PACKAGE;
describe.skipIf(!domPackage)("mounted verified deposit feedback", () => {
  type DomWindow = Window & typeof globalThis & { happyDOM: { close(): Promise<void> } };
  let WindowCtor: { new (): DomWindow }, window: DomWindow;
  let root: ReturnType<typeof import("react-dom/client").createRoot>,
    qc: QueryClient,
    container: HTMLElement;
  let revision: string, amount: number, denied: boolean, failFolio: boolean, failRevision: boolean;

  const event = {
    revision: "2",
    requestId: "saved-request",
    bookingReference: "BK-TEST",
    docCode: "OR-TEST",
    currency: "MYR",
    beforeCents: 7000,
    afterCents: 6000,
  };
  const session = {
    authenticated: true,
    role: "front_desk",
    tenant: { tenantId: "t" },
    user: { n3UserKey: "staff" },
  };
  let currentSession = session;
  function Observer() {
    useHotelChangeRevision();
    return null;
  }
  function Harness() {
    const q = useQuery({
      queryKey: ["folio", "r"],
      queryFn: async () => {
        const res = await fetch("/fixture/folio");
        if (!res.ok) throw new Error("folio refresh failed");
        return res.json();
      },
    });
    return createElement(
      "div",
      null,
      createElement(Observer),
      createElement(Observer),
      createElement("span", null, q.data?.amount ?? "Loading"),
    );
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
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
      "Event",
      "MouseEvent",
    ] as const)
      vi.stubGlobal(key, key === "window" ? window : window[key]);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(window.document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    revision = "1";
    amount = 70;
    denied = false;
    failFolio = false;
    failRevision = false;
    currentSession = session;
    notice.dismiss.mockClear();
    notice.warning.mockClear();
    notice.success.mockClear();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    qc.setQueryData(SESSION_QUERY_KEY, session);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = String(url);
        if (path.startsWith("/api/hotel/change-revision"))
          return failRevision
            ? Response.json({ error: "unavailable" }, { status: 503 })
            : denied
              ? Response.json({ error: "unauthorized" }, { status: 401 })
              : Response.json({
                  available: true,
                  revision,
                  notification: {
                    cursor: revision,
                    events: revision === "2" && path.includes("after=1") ? [event] : [],
                  },
                });
        if (path === "/fixture/folio")
          return failFolio
            ? Response.json({ error: "unavailable" }, { status: 503 })
            : Response.json({ amount });
        if (path === "/api/session/me")
          return Response.json(denied ? { authenticated: false } : currentSession);
        throw new Error(`Unexpected endpoint ${path}`);
      }),
    );
    container = document.createElement("div");
    document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(Harness)));
      await settle();
    });
    await act(settle);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    qc.clear();
    await window.happyDOM.close();
    vi.unstubAllGlobals();
  });
  it("two mounted observers refresh folio and announce one verified success", async () => {
    expect(notice.success).not.toHaveBeenCalled();
    revision = "2";
    amount = 60;
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["hotel-change-revision"] });
      await settle();
    });
    await act(settle);
    expect(container.textContent).toContain("60");
    expect(notice.success).toHaveBeenCalledTimes(1);
    expect(notice.success.mock.calls[0]?.[1]).toMatchObject({ position: "bottom-right" });
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["hotel-change-revision"] });
      await settle();
    });
    expect(notice.success).toHaveBeenCalledTimes(1);
  });
  it("dismisses already visible receipt money when identity changes", async () => {
    revision = "2";
    amount = 60;
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["hotel-change-revision"] });
      await settle();
    });
    expect(notice.success).toHaveBeenCalledTimes(1);
    const id = notice.success.mock.calls[0]?.[1]?.id;
    currentSession = { ...session, user: { n3UserKey: "other" } };
    await act(async () => {
      qc.setQueryData(SESSION_QUERY_KEY, currentSession);
      await settle();
    });
    expect(notice.dismiss).toHaveBeenCalledWith(id);
  });
  it("failed reader refresh hides stale money and produces no success or chime replay", async () => {
    revision = "2";
    amount = 60;
    failFolio = true;
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["hotel-change-revision"] });
      await settle();
    });
    await act(settle);
    expect(notice.success).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("70");
    failFolio = false;
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["folio"] });
      await settle();
    });
    expect(container.textContent).toContain("60");
    expect(notice.success).not.toHaveBeenCalled();
  });
  it("A to failed B to A baselines the intervening historical event", async () => {
    failRevision = true;
    currentSession = { ...session, user: { n3UserKey: "other" } };
    await act(async () => {
      qc.setQueryData(SESSION_QUERY_KEY, currentSession);
      await settle();
    });
    revision = "2";
    amount = 60;
    failRevision = false;
    currentSession = session;
    await act(async () => {
      qc.setQueryData(SESSION_QUERY_KEY, currentSession);
      await settle();
    });
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["hotel-change-revision"] });
      await settle();
    });
    expect(notice.success).not.toHaveBeenCalled();
  });
  it("session loss stops success feedback and clears sensitive money", async () => {
    denied = true;
    revision = "2";
    amount = 60;
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["hotel-change-revision"] });
      await settle();
    });
    expect(notice.success).not.toHaveBeenCalled();
    expect(qc.getQueryData(["hotel-change-revision", "t:staff:front_desk"])).toBeUndefined();
  });
});
