/**
 * P1-RES-ASSIGN-01 — guest → room assignment across the reservation
 * lifecycle (create → edit repair → standard check-in).
 *
 * Handler tests mock the session, audit log and Supabase admin client so no
 * real database or N3 call is made. SQL tests assert against the committed
 * forward migration text only.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOM_A = "11111111-1111-4111-8111-111111111111";
const ROOM_B = "22222222-2222-4222-8222-222222222222";
const OTHER_ROOM = "33333333-3333-4333-8333-333333333333";
const RES_UUID = "44444444-4444-4444-8444-444444444444";

// ---------- Session mock ----------
const sessionState: { data: Record<string, unknown> } = { data: {} };
vi.mock("@/lib/session.server", () => ({
  getHotelSession: async () => ({
    get data() {
      return sessionState.data;
    },
    async update(next: Record<string, unknown>) {
      sessionState.data = { ...sessionState.data, ...next };
    },
    async clear() {
      sessionState.data = {};
    },
  }),
}));

// ---------- Audit mock ----------
const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

// ---------- supabaseAdmin mock ----------
type SupabaseResult = { data: unknown; error: unknown; count?: number };
const supabaseQueue = new Map<string, SupabaseResult[]>();
function supabaseEnqueue(table: string, result: SupabaseResult) {
  const arr = supabaseQueue.get(table) ?? [];
  arr.push(result);
  supabaseQueue.set(table, arr);
}
function makeBuilder(table: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    upsert: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    range: () => chain,
    single: async () => supabaseQueue.get(table)?.shift() ?? { data: null, error: null },
    maybeSingle: async () => supabaseQueue.get(table)?.shift() ?? { data: null, error: null },
    then: (resolve: (v: SupabaseResult) => unknown) =>
      resolve(supabaseQueue.get(table)?.shift() ?? { data: null, error: null }),
  };
  return chain;
}
let rpcCalls: unknown[][] = [];
let rpcHandler: (args: unknown[]) => Promise<SupabaseResult> = async () => ({
  data: null,
  error: null,
});
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => makeBuilder(table),
    rpc: (...args: unknown[]) => {
      rpcCalls.push(args);
      return rpcHandler(args);
    },
  },
}));

function seedOwnerSession() {
  sessionState.data = {
    n3Token: "eyJ.tok.en",
    n3TokenExpiration: null,
    n3TenantKey: "n3-tenant-1",
    tenantCode: "T-001",
    companyName: "Test Hotel",
    n3UserKey: "user-1",
    userEmail: "u@example.test",
    userName: "User",
    tenantId: "tenant-uuid-1",
    createdAt: 1,
  };
  supabaseEnqueue("hotel_user_roles", { data: { role: "owner", is_active: true }, error: null });
}
function seedActiveWalkIn() {
  supabaseEnqueue("hotel_booking_sources", {
    data: {
      id: "src-uuid-1",
      tenant_id: "tenant-uuid-1",
      source_code: "walk_in",
      display_name: "Walk-in",
      is_active: true,
      sort_order: 10,
    },
    error: null,
  });
}
function post(body: unknown) {
  return new Request("http://x.test/api/hotel/reservations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function futureDates() {
  const d = new Date(Date.now() + 30 * 86400000);
  const iso = (n: number) => new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
  return { arrivalDate: iso(0), departureDate: iso(2) };
}
function baseBody(extra: Record<string, unknown>) {
  return { bookingSource: "walk_in", ...futureDates(), notes: null, ...extra };
}

beforeEach(() => {
  sessionState.data = {};
  auditEvents.length = 0;
  supabaseQueue.clear();
  rpcCalls = [];
  rpcHandler = async () => ({
    data: [
      {
        out_reservation_id: RES_UUID,
        out_booking_reference: "BK260820001",
        out_status: "confirmed",
      },
    ],
    error: null,
  });
});
afterEach(() => vi.restoreAllMocks());

// =========================================================================
// Pure form helpers
// =========================================================================
describe("P1-RES-ASSIGN-01 — form helpers", () => {
  async function ui() {
    return await import("@/lib/reservations-ui");
  }
  function room(id: string, max = 2) {
    return {
      hotelRoomId: id,
      roomNumber: id.slice(0, 3),
      displayName: null,
      n3StockName: null,
      roomType: "standard",
      floor: "1",
      maxOccupancy: max,
      baseRate: 200,
      currency: "MYR",
      agreedRate: 200,
      adults: 1,
      children: 0,
      rateOverrideReason: "",
      remark: "",
    };
  }

  it("single selected room auto-assigns every guest", async () => {
    const { reconcileGuestAssignments, emptyGuestDraft } = await ui();
    const guests = [emptyGuestDraft(true), emptyGuestDraft(false)];
    const next = reconcileGuestAssignments(guests, [room(ROOM_A)]);
    expect(next.every((g) => g.assignedHotelRoomId === ROOM_A)).toBe(true);
  });

  it("multi-room selection leaves assignment explicit and blocks until chosen", async () => {
    const { reconcileGuestAssignments, validateGuestAssignments, emptyGuestDraft } = await ui();
    const rooms = [room(ROOM_A), room(ROOM_B)];
    const guests = reconcileGuestAssignments([emptyGuestDraft(true)], rooms);
    expect(guests[0].assignedHotelRoomId).toBe("");
    expect(validateGuestAssignments(guests, rooms)).toEqual({
      ok: false,
      code: "guest_assignment_required",
    });
    guests[0] = { ...guests[0], assignedHotelRoomId: ROOM_B };
    expect(validateGuestAssignments(guests, rooms).ok).toBe(true);
  });

  it("removing a room clears the stale assignment", async () => {
    const { reconcileGuestAssignments, emptyGuestDraft } = await ui();
    const g = { ...emptyGuestDraft(true), assignedHotelRoomId: ROOM_B };
    const next = reconcileGuestAssignments([g], [room(ROOM_A), room(OTHER_ROOM)]);
    expect(next[0].assignedHotelRoomId).toBe("");
  });

  it("assignment to a non-selected room is rejected", async () => {
    const { validateGuestAssignments, emptyGuestDraft } = await ui();
    const g = { ...emptyGuestDraft(true), assignedHotelRoomId: OTHER_ROOM };
    expect(validateGuestAssignments([g], [room(ROOM_A), room(ROOM_B)])).toEqual({
      ok: false,
      code: "guest_assignment_invalid_room",
    });
  });

  it("room capacity is enforced in the form", async () => {
    const { validateGuestAssignments, emptyGuestDraft } = await ui();
    const rooms = [room(ROOM_A, 1), room(ROOM_B, 2)];
    const guests = [
      { ...emptyGuestDraft(true), assignedHotelRoomId: ROOM_A },
      { ...emptyGuestDraft(false), assignedHotelRoomId: ROOM_A },
    ];
    expect(validateGuestAssignments(guests, rooms)).toEqual({
      ok: false,
      code: "room_capacity_exceeded",
    });
  });

  it("exactly-one-primary stays enforced alongside assignment", async () => {
    const { validateGuests, emptyGuestDraft, setPrimaryGuest } = await ui();
    const guests = [emptyGuestDraft(true), emptyGuestDraft(true)].map((g) => ({
      ...g,
      fullName: "A",
    }));
    expect(validateGuests(guests)).toEqual({ ok: false, code: "multiple_primary_guests" });
    expect(validateGuests(setPrimaryGuest(guests, 1)).ok).toBe(true);
  });

  it("buildCreatePayload sends the assignment and never the raw tenant/room ids it wasn't given", async () => {
    const { buildCreatePayload, emptyGuestDraft } = await ui();
    const payload = buildCreatePayload({
      bookingSource: "walk_in",
      arrivalDate: "2030-01-01",
      departureDate: "2030-01-03",
      notes: "",
      rooms: [room(ROOM_A), room(ROOM_B)],
      guests: [
        { ...emptyGuestDraft(true), fullName: "A", assignedHotelRoomId: ROOM_B },
        { ...emptyGuestDraft(false), fullName: "B", assignedHotelRoomId: ROOM_A },
      ],
    });
    expect(payload.guests[0].assignedHotelRoomId).toBe(ROOM_B);
    expect(payload.guests[1].assignedHotelRoomId).toBe(ROOM_A);
    expect(Object.keys(payload)).not.toContain("tenantId");
  });

  it("draft restore preserves the assignment but never the raw identity number", async () => {
    const { emptyGuestDraft } = await ui();
    const { serializeDraft } = await import("@/lib/reservation-draft");
    const g = {
      ...emptyGuestDraft(true),
      fullName: "A",
      identityNumber: "990101015555",
      assignedHotelRoomId: ROOM_A,
    };
    const record = serializeDraft({
      tenantId: "t",
      n3UserKey: "u",
      step: 3,
      arrival: "2030-01-01",
      departure: "2030-01-03",
      bookingSource: "walk_in",
      externalRef: "",
      notes: "",
      rooms: [],
      guests: [g],
    });
    expect(record.guests[0].assignedHotelRoomId).toBe(ROOM_A);
    expect(record.guests[0].identityNumber).toBe("");
    expect(JSON.stringify(record)).not.toContain("990101015555");
  });
});

// =========================================================================
// POST /api/hotel/reservations
// =========================================================================
describe("P1-RES-ASSIGN-01 — create API", () => {
  async function handler() {
    return (await import("@/routes/api/hotel/reservations")).handleCreateReservation;
  }

  it("single room + single guest is auto-assigned and reaches the RPC", async () => {
    seedOwnerSession();
    seedActiveWalkIn();
    const res = await (await handler())({
      request: post(
        baseBody({
          rooms: [{ hotelRoomId: ROOM_A, agreedRate: 200, adults: 1, children: 0 }],
          guests: [{ fullName: "Primary", isPrimary: true }],
        }),
      ),
    });
    expect(res.status).toBe(201);
    const args = rpcCalls[0][1] as { p_guests: Array<Record<string, unknown>> };
    expect(args.p_guests[0].assigned_hotel_room_id).toBe(ROOM_A);
  });

  it("multi-room requires an explicit assignment", async () => {
    seedOwnerSession();
    const res = await (await handler())({
      request: post(
        baseBody({
          rooms: [
            { hotelRoomId: ROOM_A, agreedRate: 200, adults: 1, children: 0 },
            { hotelRoomId: ROOM_B, agreedRate: 200, adults: 1, children: 0 },
          ],
          guests: [{ fullName: "Primary", isPrimary: true }],
        }),
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("guest_assignment_required");
    expect(rpcCalls).toHaveLength(0);
  });

  it("multi-room explicit assignment is forwarded per guest", async () => {
    seedOwnerSession();
    seedActiveWalkIn();
    const res = await (await handler())({
      request: post(
        baseBody({
          rooms: [
            { hotelRoomId: ROOM_A, agreedRate: 200, adults: 1, children: 0 },
            { hotelRoomId: ROOM_B, agreedRate: 200, adults: 1, children: 0 },
          ],
          guests: [
            { fullName: "Primary", isPrimary: true, assignedHotelRoomId: ROOM_A },
            { fullName: "Companion", isPrimary: false, assignedHotelRoomId: ROOM_B },
          ],
        }),
      ),
    });
    expect(res.status).toBe(201);
    const args = rpcCalls[0][1] as { p_guests: Array<Record<string, unknown>> };
    expect(args.p_guests.map((g) => g.assigned_hotel_room_id)).toEqual([ROOM_A, ROOM_B]);
  });

  it("assignment to a room outside this reservation is rejected before the RPC", async () => {
    seedOwnerSession();
    const res = await (await handler())({
      request: post(
        baseBody({
          rooms: [{ hotelRoomId: ROOM_A, agreedRate: 200, adults: 1, children: 0 }],
          guests: [{ fullName: "Primary", isPrimary: true, assignedHotelRoomId: OTHER_ROOM }],
        }),
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("guest_assignment_invalid_room");
    expect(rpcCalls).toHaveLength(0);
  });

  it("malformed room key is rejected", async () => {
    seedOwnerSession();
    const res = await (await handler())({
      request: post(
        baseBody({
          rooms: [{ hotelRoomId: ROOM_A, agreedRate: 200, adults: 1, children: 0 }],
          guests: [{ fullName: "Primary", isPrimary: true, assignedHotelRoomId: "not-a-uuid" }],
        }),
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("guest_assignment_invalid_room");
  });

  it("browser cannot smuggle a reservation_room_id or tenant", async () => {
    seedOwnerSession();
    const res = await (await handler())({
      request: post(
        baseBody({
          rooms: [{ hotelRoomId: ROOM_A, agreedRate: 200, adults: 1, children: 0 }],
          guests: [
            { fullName: "Primary", isPrimary: true, reservationRoomId: OTHER_ROOM },
          ] as unknown,
        }),
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown_field");
  });

  it("database assignment errors surface as allow-listed codes", async () => {
    seedOwnerSession();
    seedActiveWalkIn();
    rpcHandler = async () => ({
      data: null,
      error: { message: "guest_assignment_invalid_room" },
    });
    const res = await (await handler())({
      request: post(
        baseBody({
          rooms: [{ hotelRoomId: ROOM_A, agreedRate: 200, adults: 1, children: 0 }],
          guests: [{ fullName: "Primary", isPrimary: true }],
        }),
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("guest_assignment_invalid_room");
  });
});

// =========================================================================
// Edit repair contract
// =========================================================================
describe("P1-RES-ASSIGN-01 — edit repair contract", () => {
  it("normalizes an existing unassigned guest being assigned to an existing room with an adults correction", async () => {
    const { normalizeFullUpdate } = await import("@/lib/reservation-full-update");
    const result = normalizeFullUpdate({
      clientRequestId: "55555555-5555-4555-8555-555555555555",
      expectedUpdatedAt: "2026-08-20T00:00:00.000Z",
      arrivalDate: "2030-01-01",
      departureDate: "2030-01-03",
      bookingSource: "walk_in",
      externalBookingReference: null,
      notes: null,
      rooms: [
        {
          clientKey: "rr-existing",
          reservationRoomId: "66666666-6666-4666-8666-666666666666",
          hotelRoomId: ROOM_A,
          agreedRate: 200,
          adults: 1,
          children: 0,
          rateOverrideReason: null,
          remark: null,
        },
      ],
      guests: [
        {
          clientKey: "rg-existing",
          reservationGuestId: "77777777-7777-4777-8777-777777777777",
          fullName: "Primary",
          isPrimary: true,
          assignedRoomClientKey: "rr-existing",
          identityAction: "keep",
        },
      ],
    } as unknown as Parameters<typeof normalizeFullUpdate>[0]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.guests[0].assignedRoomClientKey).toBe("rr-existing");
      expect(result.value.rooms[0].adults).toBe(1);
      // No new guest row is implied: the existing reservation guest id is kept.
      expect(result.value.guests[0].reservationGuestId).toBe(
        "77777777-7777-4777-8777-777777777777",
      );
    }
  });

  it("rejects an assignment key that is not one of this reservation's rooms", async () => {
    const { normalizeFullUpdate } = await import("@/lib/reservation-full-update");
    const result = normalizeFullUpdate({
      clientRequestId: "55555555-5555-4555-8555-555555555555",
      expectedUpdatedAt: "2026-08-20T00:00:00.000Z",
      arrivalDate: "2030-01-01",
      departureDate: "2030-01-03",
      bookingSource: "walk_in",
      externalBookingReference: null,
      notes: null,
      rooms: [
        {
          clientKey: "rr-existing",
          reservationRoomId: null,
          hotelRoomId: ROOM_A,
          agreedRate: 200,
          adults: 1,
          children: 0,
          rateOverrideReason: null,
          remark: null,
        },
      ],
      guests: [
        {
          clientKey: "rg-existing",
          reservationGuestId: null,
          fullName: "Primary",
          isPrimary: true,
          assignedRoomClientKey: "rr-somewhere-else",
          identityAction: "keep",
        },
      ],
    } as unknown as Parameters<typeof normalizeFullUpdate>[0]);
    expect(result.ok).toBe(false);
  });

  it("update failures stay atomic behind an allow-listed code", async () => {
    const { RESERVATION_FULL_UPDATE_ERROR_CODES } = await import(
      "@/lib/reservations-store.server"
    );
    expect(RESERVATION_FULL_UPDATE_ERROR_CODES.has("stale_reservation")).toBe(true);
    expect(RESERVATION_FULL_UPDATE_ERROR_CODES.has("guest_assignment_required")).toBe(true);
  });
});

// =========================================================================
// Forward migration SQL
// =========================================================================
describe("P1-RES-ASSIGN-01 — forward migration", () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const sql = readdirSync(dir)
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  const latest = readdirSync(dir)
    .sort()
    .slice(-1)
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");

  it("creates reservation rooms before guests and stores the resolved room id", async () => {
    const roomsAt = latest.indexOf("INSERT INTO public.hotel_reservation_rooms");
    const guestsAt = latest.indexOf("INSERT INTO public.hotel_reservation_guests");
    expect(roomsAt).toBeGreaterThan(-1);
    expect(guestsAt).toBeGreaterThan(roomsAt);
    expect(latest).toContain("reservation_room_id");
    expect(latest).toContain("v_assigned_alloc");
  });

  it("fails closed on a missing or unknown assignment and enforces capacity", () => {
    expect(latest).toContain("MESSAGE='guest_assignment_required'");
    expect(latest).toContain("MESSAGE='guest_assignment_invalid_room'");
    expect(latest).toContain("MESSAGE='room_capacity_exceeded'");
  });

  it("keeps tenant predicates, SECURITY DEFINER and a safe search_path", () => {
    expect(latest).toContain("SECURITY DEFINER");
    expect(latest).toContain("SET search_path TO 'public'");
    expect(latest).toContain("hr.tenant_id = p_tenant_id");
  });

  it("corrects the invalid reservation history event type used by the v2 update RPC", () => {
    expect(latest).toContain("'reservation_edited'");
    expect(latest).toContain("hotelhub_update_reservation_v2");
  });

  it("does not weaken the standard check-in assignment gate", () => {
    expect(sql).toContain("guest_assignment_required");
    expect(latest).not.toContain("hotelhub_check_in_reservation");
  });

  it("never edits an already-applied migration to add assignment support", () => {
    const files = readdirSync(dir).sort();
    const older = files.slice(0, -1).map((f) => readFileSync(join(dir, f), "utf8"));
    expect(older.some((t) => t.includes("assigned_hotel_room_id"))).toBe(false);
  });
});
