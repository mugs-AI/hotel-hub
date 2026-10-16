import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SESSION_QUERY_KEY } from "../session-client";
import { emptyGuestDraft, makeRoomDraft } from "../reservations-ui";
import {
  saveDraft,
  draftKey,
  vaultSetIdentity,
  vaultGetIdentity,
  vaultClearForUser,
} from "../reservation-draft";
import { actor, plan } from "./fixtures/source-billing";
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", async () => {
  const { createElement } = await import("react");
  return {
    createFileRoute: () => (options: unknown) => ({ options }),
    useNavigate: () => navigate,
    Link: ({
      children,
      to,
      onClick,
      ...props
    }: {
      children: import("react").ReactNode;
      to: string;
      onClick?: () => void;
      [k: string]: unknown;
    }) =>
      createElement("a", { href: to, onClick, "aria-disabled": props["aria-disabled"] }, children),
  };
});
vi.mock("@/components/AppShell", async () => {
  const { createElement } = await import("react");
  return {
    AppShell: ({ children }: { children: import("react").ReactNode }) =>
      createElement("main", null, children),
  };
});
vi.mock("@/components/CardInfoPopover", async () => {
  const { createElement } = await import("react");
  return { CardInfoPopover: () => createElement("span") };
});
const domPackage = process.env.HH_UI_DOM_PACKAGE;
describe.skipIf(!domPackage)(
  "pending booking wizard keeps its submitted draft and payer fixed",
  () => {
    let win: Window & typeof globalThis & { happyDOM: { close(): Promise<void> } },
      container: HTMLElement,
      root: import("react-dom/client").Root,
      qc: QueryClient;
    let release: (response: Response) => void, posts: Record<string, unknown>[];
    const policy = plan().payer.policy,
      clientId = "synthetic-guest",
      room = makeRoomDraft({
        hotelRoomId: "11111111-1111-4111-8111-111111111111",
        roomNumber: "101",
        roomType: "Double",
        maxOccupancy: 2,
        baseRate: 200,
        currency: "MYR",
      });
    beforeEach(async () => {
      const { Window } = await import(/* @vite-ignore */ domPackage!);
      win = new Window();
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
        vi.stubGlobal(key, key === "window" ? win : win[key]);
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      navigate.mockReset();
      posts = [];
      qc = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
      });
      qc.setQueryData(SESSION_QUERY_KEY, {
        authenticated: true,
        tenant: { tenantId: actor.tenantId, tenantCode: "TEST", companyName: "Hotel" },
        user: { n3UserKey: actor.n3UserKey },
        role: "front_desk",
      });
      const guest = {
        ...emptyGuestDraft(true),
        clientId,
        fullName: "Synthetic guest",
        mobile: "0123456789",
        email: "guest@example.test",
        nationalityCode: "MYS",
        identityType: "mykad" as const,
        identityNumber: "900101081234",
        addressLine1: "Test street",
        city: "Ipoh",
        postcode: "30000",
        countryCode: "MYS",
        stateCode: "08",
        assignedHotelRoomId: room.hotelRoomId,
      };
      saveDraft({
        tenantId: actor.tenantId,
        n3UserKey: actor.n3UserKey,
        step: 4,
        arrival: "2027-07-20",
        departure: "2027-07-22",
        bookingSource: "agoda",
        externalRef: "OTA-TEST",
        notes: "Submitted draft",
        rooms: [room],
        guests: [{ ...guest, identityNumber: "" }],
      });
      vaultSetIdentity(actor.tenantId, actor.n3UserKey, clientId, guest.identityNumber);
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: unknown, init?: RequestInit) => {
          const url = String(input);
          if (init?.method === "POST") {
            posts.push(JSON.parse(String(init.body)));
            return new Promise<Response>((r) => {
              release = r;
            });
          }
          if (url.includes("initial-payer"))
            return Response.json({
              tenantId: actor.tenantId,
              sourceCode: "agoda",
              required: true,
              policy,
            });
          if (url.includes("availability")) return Response.json({ rooms: [room] });
          if (url.includes("booking-sources"))
            return Response.json({
              sources: [
                { id: policy.sourceId, sourceCode: "agoda", displayName: "Agoda", isActive: true },
                {
                  id: "22222222-2222-4222-8222-222222222222",
                  sourceCode: "walk_in",
                  displayName: "Walk-in",
                  isActive: true,
                },
              ],
            });
          throw Error("Unexpected GET " + url);
        }),
      );
      container = win.document.createElement("div");
      win.document.body.append(container);
      const { createRoot } = await import("react-dom/client");
      root = createRoot(container);
      const { Route } = await import("../../routes/reservations.new");
      await act(async () =>
        root.render(
          h(QueryClientProvider, { client: qc }, h(Route.options.component as ComponentType)),
        ),
      );
      await until(() => !!container.querySelector('input[type="checkbox"]'));
      await act(async () =>
        container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
      );
      await until(() => !button("Create Reservation").disabled);
      await act(async () => button("Create Reservation").click());
      await until(() => posts.length === 1 && container.textContent!.includes("Creating…"));
    });
    afterEach(async () => {
      await act(async () => root.unmount());
      qc.clear();
      vaultClearForUser(actor.tenantId, actor.n3UserKey);
      vi.unstubAllGlobals();
      await win.happyDOM.close();
    });
    function button(text: string) {
      return Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes(text),
      )!;
    }
    async function until(test: () => boolean) {
      for (let n = 0; n < 60; n++) {
        if (test()) return;
        await act(async () => {
          await new Promise((r) => setTimeout(r, 15));
        });
      }
      throw Error("Wizard did not settle: " + container.textContent);
    }
    const blocked = (el: HTMLElement) =>
      !!(el as HTMLButtonElement).disabled || !!el.closest("fieldset[disabled]");
    it("locks payer, step/source editing and discard while POST is pending, then keeps the original success visible", async () => {
      expect(blocked(container.querySelector("select")!)).toBe(true);
      expect(blocked(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!)).toBe(
        true,
      );
      expect(blocked(button("Stay details"))).toBe(true);
      expect(blocked(button("Discard draft"))).toBe(true);
      // HappyDOM's .click() ignores a disabled fieldset ancestor. Assert native
      // inherited disabled semantics above; do not synthesize impossible clicks.
      expect(container.querySelector('[role="alertdialog"]')).toBeNull();
      expect(posts).toHaveLength(1);
      expect(
        Array.from(container.querySelectorAll("a"))
          .find((a) => a.textContent === "Cancel")
          ?.getAttribute("aria-disabled"),
      ).toBe("true");
      expect(posts[0].initialPayer).toMatchObject({
        collectionMode: policy.defaultCollectionMode,
        policyVersion: policy.version,
      });
      await act(async () =>
        release(
          Response.json({
            reservationId: actor.reservationId,
            bookingReference: "BK270720001",
            status: "confirmed",
          }),
        ),
      );
      await until(() => navigate.mock.calls.length === 1);
      expect(navigate.mock.calls[0][0]).toMatchObject({
        to: "/reservations/$id",
        params: { id: actor.reservationId },
      });
      expect(win.sessionStorage.getItem(draftKey(actor.tenantId, actor.n3UserKey))).toBeNull();
      expect(vaultGetIdentity(actor.tenantId, actor.n3UserKey, clientId)).toBe("");
    });
    it("unlocks the same draft after a rejected create without deleting guest identity", async () => {
      await act(async () =>
        release(Response.json({ error: "room_not_available" }, { status: 409 })),
      );
      await until(() => container.textContent!.includes("Create Reservation"));
      expect(blocked(button("Discard draft"))).toBe(false);
      expect(vaultGetIdentity(actor.tenantId, actor.n3UserKey, clientId)).toBe("900101081234");
      expect(navigate).not.toHaveBeenCalled();
    });
  },
);
