import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SESSION_QUERY_KEY } from "../session-client";
import { computeEditCapabilities } from "../reservation-edit-capabilities";
import type { ReservationDetailDTO, UpdateReservationFullPayload } from "../reservations-client";
import { Route } from "../../routes/reservations.$id_.edit";
import { GuestRoomAssignmentCard } from "../../components/GuestRoomAssignmentCard";

const navigation = vi.hoisted(() => ({
  id: "test-booking",
  navigate: vi.fn(),
  subscribe: () => () => {},
}));
vi.mock("@tanstack/react-router", async (load) => ({
  ...(await load<object>()),
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ id: navigation.id }),
  }),
  useNavigate: () => navigation.navigate,
  useRouter: () => ({
    subscribe: navigation.subscribe,
    state: { location: { pathname: `/reservations/${navigation.id}/edit` } },
  }),
  Link: ({ children, to }: { children: ReactNode; to: string }) =>
    createElement("a", { href: to }, children),
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/WorkspaceHeader", () => ({
  WorkspaceHeader: ({ children }: { children: ReactNode }) => children,
}));

const domPackage = process.env.HH_UI_DOM_PACKAGE;
// Mount the actual route, draft state, validation and same-origin HTTP client.
// Removing room replacement, its allocation reset, or guest-key preservation breaks these tests.
describe.skipIf(!domPackage)("reservation booked-room replacement", () => {
  type DomWindow = Window & typeof globalThis & { happyDOM: { close(): Promise<void> } };
  let WindowCtor: { new (): DomWindow }, window: DomWindow;
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: ReturnType<typeof createRoot>, container: HTMLElement, qc: QueryClient;
  let data: ReservationDetailDTO;
  let posts: UpdateReservationFullPayload[];
  let availabilityError: boolean, capacity: number, rejectSave: boolean;
  const caps = (status = data.status) =>
    computeEditCapabilities({
      role: "owner",
      status,
      postCheckInGuestEditPolicy: "locked",
      allowOwnerPrimaryGuestChangeAfterCheckIn: false,
    });
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
      tenant: { tenantId: "test-tenant" },
      user: { n3UserKey: "test-owner" },
    });
    data = {
      id: navigation.id,
      bookingReference: "SYNTHETIC-ROOM-TEST",
      bookingSource: "walk_in",
      status: "confirmed",
      arrivalDate: "2026-10-16",
      departureDate: "2026-10-17",
      currency: "MYR",
      notes: null,
      externalBookingReference: null,
      createdAt: "2026-10-16T00:00:00Z",
      updatedAt: "2026-10-16T00:00:00Z",
      createdByLabel: null,
      checkedInAt: null,
      checkedInByLabel: null,
      expectedCheckOutAt: null,
      rooms: [
        {
          id: "allocation-101",
          hotelRoomId: "room-101",
          roomNumber: "101",
          displayName: "Room 101",
          n3StockName: null,
          baseRateSnapshot: 188,
          agreedRate: 188,
          adults: 1,
          children: 0,
          maxOccupancy: 2,
          allocationStatus: "reserved",
          rateOverrideReason: null,
          remark: "Keep this remark",
        },
      ],
      guests: [
        {
          id: "guest-1",
          guestId: "profile-1",
          fullName: "Synthetic Guest",
          mobile: null,
          email: null,
          nationality: null,
          nationalityCode: "MYS",
          identityType: "passport",
          identityNumberMasked: "****TEST",
          notes: null,
          addressLine1: null,
          addressLine2: null,
          addressLine3: null,
          city: null,
          postcode: null,
          countryCode: "MYS",
          stateCode: null,
          stateProvince: null,
          isPrimary: true,
          assignedReservationRoomId: "allocation-101",
        },
      ],
    };
    posts = [];
    availabilityError = false;
    capacity = 2;
    rejectSave = false;
    navigation.navigate.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const path = String(url);
        if (init?.method === "PATCH") {
          posts.push(JSON.parse(String(init.body)));
          return rejectSave
            ? Response.json({ error: "room_unavailable" }, { status: 409 })
            : Response.json({ updatedAt: "2026-10-16T00:01:00Z", replayed: false });
        }
        if (path.startsWith("/api/hotel/availability"))
          return availabilityError
            ? Response.json({ error: "unavailable" }, { status: 503 })
            : Response.json({
                rooms: [
                  {
                    hotelRoomId: "room-101",
                    roomNumber: "101",
                    displayName: "Room 101",
                    n3StockName: null,
                    baseRate: 188,
                    maxOccupancy: 2,
                    currency: "MYR",
                    isActive: true,
                  },
                  {
                    hotelRoomId: "room-202",
                    roomNumber: "202",
                    displayName: "Room 202",
                    n3StockName: null,
                    baseRate: 300,
                    maxOccupancy: capacity,
                    currency: "MYR",
                    isActive: true,
                  },
                ],
              });
        if (path.startsWith("/api/hotel/booking-sources"))
          return Response.json({
            sources: [{ sourceCode: "walk_in", displayName: "Walk-in", isActive: true }],
          });
        if (path === `/api/hotel/reservations/${navigation.id}`)
          return Response.json({ reservation: data, editCapabilities: caps() });
        throw new Error(`Unexpected HTTP ${path}`);
      }),
    );
    container = window.document.createElement("div");
    window.document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    qc.clear();
    await window.happyDOM.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  async function show() {
    await act(async () =>
      root.render(
        createElement(QueryClientProvider, { client: qc }, createElement(Route.options.component!)),
      ),
    );
    await settle();
    await settle();
  }
  function select(label: string) {
    const el = [...container.querySelectorAll("label")]
      .find((el) => el.textContent?.includes(label))
      ?.querySelector("select");
    expect(el, label).toBeTruthy();
    return el!;
  }
  async function choose(el: HTMLSelectElement, value: string) {
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
  }
  async function save() {
    const button = [...container.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === "Save changes",
    )!;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    await settle();
  }
  it("replaces the only booked room with 202 at its displayed normal rate, retaining guest assignment", async () => {
    await show();
    const room = select("Change booked room");
    expect([...room.options].map((x) => x.value)).toEqual(["room-101", "room-202"]);
    expect(room.textContent).toContain("300.00");
    await choose(room, "room-202");
    expect(select("Assigned room").value).toBe("rr-allocation-101");
    expect(select("Assigned room").selectedOptions[0].textContent).toContain("202");
    await save();
    expect(posts).toHaveLength(1);
    expect(posts[0].rooms).toEqual([
      {
        clientKey: "rr-allocation-101",
        reservationRoomId: null,
        hotelRoomId: "room-202",
        agreedRate: 300,
        adults: 1,
        children: 0,
        rateOverrideReason: null,
        remark: "Keep this remark",
      },
    ]);
    expect(posts[0].guests[0].assignedRoomClientKey).toBe(posts[0].rooms[0].clientKey);
    expect(posts[0].expectedUpdatedAt).toBe(data.updatedAt);
    expect(posts[0]).not.toHaveProperty("tenantId");
  });
  it("restores the existing allocation when the user changes back before saving", async () => {
    await show();
    await choose(select("Change booked room"), "room-202");
    await choose(select("Change booked room"), "room-101");
    await save();
    expect(posts[0].rooms[0]).toMatchObject({
      reservationRoomId: "allocation-101",
      hotelRoomId: "room-101",
      agreedRate: 188,
    });
  });
  it("keeps the placeholder disabled in the editor so a valid assignment cannot be cleared", async () => {
    await show();
    expect(
      select("Assigned room").querySelector('option[value=""]')?.hasAttribute("disabled"),
    ).toBe(true);
  });
  it("allows availability recovery through the visible retry button", async () => {
    availabilityError = true;
    await show();
    expect(select("Change booked room").disabled).toBe(true);
    availabilityError = false;
    const retry = [...container.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === "Retry availability",
    )!;
    await act(async () => retry.click());
    await settle();
    expect(select("Change booked room").disabled).toBe(false);
    await choose(select("Change booked room"), "room-202");
    await save();
    expect(posts[0].rooms[0].hotelRoomId).toBe("room-202");
  });
  it("reuses the original allocation when keeping 101 as an additional room after replacing it", async () => {
    await show();
    await choose(select("Change booked room"), "room-202");
    await choose(select("Add a room"), "room-101");
    await save();
    expect(posts[0].rooms).toHaveLength(2);
    expect(posts[0].rooms[0]).toMatchObject({
      reservationRoomId: null,
      hotelRoomId: "room-202",
      agreedRate: 300,
    });
    expect(posts[0].rooms[1]).toMatchObject({
      reservationRoomId: "allocation-101",
      hotelRoomId: "room-101",
      agreedRate: 188,
    });
    expect(posts[0].guests[0].assignedRoomClientKey).toBe(posts[0].rooms[0].clientKey);
  });
  it("does not offer a room that is already booked in another row", async () => {
    data.rooms.push({
      ...data.rooms[0],
      id: "allocation-202",
      hotelRoomId: "room-202",
      roomNumber: "202",
      displayName: "Room 202",
      agreedRate: 300,
    });
    await show();
    expect([...select("Change booked room").options].map((x) => x.value)).toEqual(["room-101"]);
  });
  it("blocks selection when availability fails", async () => {
    availabilityError = true;
    await show();
    expect(select("Change booked room").disabled).toBe(true);
    expect(container.textContent).toContain("Unable to check room availability");
    expect(posts).toEqual([]);
  });
  it("disables a destination too small for the current occupants", async () => {
    data.rooms[0].adults = 2;
    capacity = 1;
    await show();
    expect(
      [...select("Change booked room").options].find((x) => x.value === "room-202")?.disabled,
    ).toBe(true);
  });
  it("keeps room inventory read-only after check-in", async () => {
    data.status = "checked_in";
    await show();
    expect(container.textContent).not.toContain("Change booked room");
    expect(container.textContent).toContain("Read-only after check-in");
  });
  it("keeps the edited room and shows the server rejection if another booking takes it", async () => {
    rejectSave = true;
    await show();
    await choose(select("Change booked room"), "room-202");
    await save();
    expect(posts).toHaveLength(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(select("Change booked room").value).toBe("room-202");
    expect(container.textContent).toMatch(/room.*(available|unavailable)/i);
  });
  it("refreshes guest assignments when a saved room replacement has a new allocation", async () => {
    const render = () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(GuestRoomAssignmentCard, {
            reservationId: data.id,
            data,
            capabilities: caps(),
          }),
        ),
      );
    await act(async () => render());
    data = {
      ...data,
      updatedAt: "2026-10-16T00:01:00Z",
      rooms: [
        {
          ...data.rooms[0],
          id: "new-allocation",
          hotelRoomId: "room-202",
          displayName: "Room 202",
          roomNumber: "202",
        },
      ],
      guests: [{ ...data.guests[0], assignedReservationRoomId: "new-allocation" }],
    };
    await act(async () => render());
    expect(container.querySelector("select")?.value).toBe("new-allocation");
    expect(
      [...container.querySelectorAll("button")].find(
        (el) => el.textContent?.trim() === "Save assignment",
      )?.disabled,
    ).toBe(true);
  });
  it("makes physical room replacement discoverable from the assignment card and prevents clearing a valid assignment", async () => {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(GuestRoomAssignmentCard, {
            reservationId: data.id,
            data,
            capabilities: caps(),
          }),
        ),
      ),
    );
    expect(container.querySelector("a")?.textContent).toContain("Change booked room");
    expect(container.querySelector("a")?.getAttribute("href")).toContain("edit");
    expect(container.querySelector('option[value=""]')?.hasAttribute("disabled")).toBe(true);
  });
});
