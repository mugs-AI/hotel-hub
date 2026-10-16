import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SavedDocumentsCheckPanel } from "../../components/SavedDocumentsCheckPanel";
import { SESSION_QUERY_KEY } from "../session-client";
import { fixtureActor as actor, fixtureIntentId as intentId } from "./fixtures/settlement-evidence";
// Optional isolated DOM tooling; app dependencies/lockfile are unchanged.
// Run with HH_UI_DOM_PACKAGE=/absolute/path/happy-dom/lib/index.js.
const domPackage = process.env.HH_UI_DOM_PACKAGE;
describe.skipIf(!domPackage)("mounted saved-document recovery", () => {
  type DomWindow = Window & typeof globalThis & { happyDOM: { close(): Promise<void> } };
  let WindowCtor: { new (): DomWindow };
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: ReturnType<typeof createRoot>,
    window: DomWindow,
    qc: QueryClient,
    container: HTMLElement;
  let failure = 0,
    sessionRefreshes = 0;
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
    ({ createRoot } = await import("react-dom/client"));
    failure = 0;
    sessionRefreshes = 0;
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    qc.setQueryData(SESSION_QUERY_KEY, {
      authenticated: true,
      role: "owner",
      tenant: { tenantId: actor.tenantId },
      user: { n3UserKey: actor.n3UserKey },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const path = String(url);
        if (path.startsWith("https://openapi.")) throw new Error("unexpected N3 call");
        if (path === "/api/session/me") {
          sessionRefreshes++;
          return Response.json({ authenticated: false }, { status: 401 });
        }
        if (path.includes("saved-documents-check")) {
          if (failure) return Response.json({ error: "unavailable" }, { status: failure });
          if (init?.method === "POST")
            return Response.json({
              tenantId: actor.tenantId,
              reservationId: actor.reservationId,
              intentId,
              status: "confirmed",
              code: "saved_document_observations_confirmed",
              checkedAt: "2026-10-12T04:00:00Z",
              observations: 1,
              persistenceProven: false,
              billOutstandingCents: 50000,
              documents: [],
              attempts: [],
              responses: [],
              checks: [],
            });
          return Response.json({
            tenantId: actor.tenantId,
            reservationId: actor.reservationId,
            intentId,
            currency: "MYR",
          });
        }
        if (path.startsWith("/api/hotel/reservations?"))
          return Response.json({
            total: 1,
            items: [
              {
                id: actor.reservationId,
                bookingReference: "BK-SYNTHETIC",
                primaryGuestName: "Synthetic guest",
                primaryGuestMobile: null,
                bookingSource: "walk_in",
                status: "checked_in",
                arrivalDate: "2026-10-10",
                departureDate: "2026-10-12",
                roomCount: 1,
                roomLabels: ["101"],
                guestCount: 1,
                createdAt: "2026-10-09T04:00:00Z",
              },
            ],
          });
        throw new Error("unexpected same-origin endpoint");
      }),
    );
    container = window.document.createElement("div");
    window.document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(SavedDocumentsCheckPanel, {
            identityKey: `${actor.tenantId}:${actor.n3UserKey}:owner`,
          }),
        ),
      );
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    qc.clear();
    await window.happyDOM.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  async function settle() {
    for (let n = 0; n < 3; n++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
  }
  async function select() {
    await settle();
    await act(async () => {
      const select = container.querySelector("select")!;
      select.value = actor.reservationId;
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await settle();
  }
  it.each([401, 503])(
    "initial metadata %s has recovery instead of a false absent intent",
    async (status) => {
      failure = status;
      await select();
      expect(container.textContent).not.toContain("No saved settlement intent");
      expect(container.textContent).toContain(
        status === 401 ? "Reopen HotelHub" : "could not be loaded",
      );
      if (status === 401) expect(sessionRefreshes).toBeGreaterThan(0);
    },
  );
  it("background metadata failure hides the earlier observed amount and explains recovery", async () => {
    await select();
    await act(async () => {
      container
        .querySelector("button")!
        .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(container.textContent).toContain("500.00");
    failure = 503;
    await act(async () => {
      await qc.refetchQueries({ queryKey: ["saved-document-selection"] });
    });
    await settle();
    expect(container.textContent).not.toContain("500.00");
    expect(container.textContent).not.toContain("No saved settlement intent");
    expect(container.textContent).toContain("could not be loaded");
  });
});
