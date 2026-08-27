/**
 * Milestone 1.1.1 — Correction A regression tests.
 *
 * These tests target the seven defects called out in the correction brief:
 * global guest search before pagination, strict calendar/UUID/boolean/int
 * validation, safe DB error handling in list and detail routes, and
 * removal of duplicate success audits from the API layer.
 *
 * The Supabase client and audit sink are mocked exactly like
 * reservations.test.ts so no test in this file touches the real database
 * or the audit log.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

// N3 ownership authority has its own dedicated suite. Here it is stubbed to
// pass the LOCAL assignment through, so these handler tests keep their
// original scope (permissions, validation, N3 gateway behaviour) instead of
// also asserting the /api/Users ownership read.
vi.mock("@/lib/n3-token-validation.server", () => ({
  // HH-AUTH-04: these suites exercise behavior AFTER N3 accepted the token
  // through the permission-neutral endpoint. Dedicated HH-AUTH-04 suites
  // cover the failure branches of this module.
  validateN3TokenNeutralCached: async () => ({ status: "accepted", fromCache: false }),
  invalidateNeutralValidation: () => {},
  validateN3TokenNeutral: async () => ({ status: "accepted" }),
  __resetNeutralValidationCache: () => {},
}));

vi.mock("@/lib/n3-owner.server", () => ({
  resolveEffectiveRole: async (input: {
    localRole: { role: string; isActive: boolean } | null;
  }) => {
    const active = input.localRole?.isActive === true;
    return {
      role: active ? input.localRole!.role : null,
      reason: active ? "n3_owner" : "n3_no_local_role",
      matchedBy: active ? "id" : null,
      ownerAuthorityFailedClosed: false,
      fromCache: false,
    };
  },
}));

const sessionState: { data: Record<string, unknown> } = { data: {} };
function resetSession(initial: Record<string, unknown> = {}) {
  sessionState.data = { ...initial };
}
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

const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

// ---------- Supabase mock with per-call filter capture ----------
type Result = { data: unknown; error: unknown; count?: number };
type Call = {
  table: string;
  filters: Array<{ op: string; column?: string; value?: unknown }>;
};
const queue = new Map<string, Result[]>();
const calls: Call[] = [];
function enqueue(table: string, r: Result) {
  const arr = queue.get(table) ?? [];
  arr.push(r);
  queue.set(table, arr);
}
function builder(table: string) {
  const call: Call = { table, filters: [] };
  calls.push(call);
  const record = (op: string) => (column?: string, value?: unknown) => {
    call.filters.push({ op, column, value });
    return chain;
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    upsert: () => chain,
    eq: record("eq"),
    in: record("in"),
    lt: record("lt"),
    gt: record("gt"),
    gte: record("gte"),
    lte: record("lte"),
    ilike: record("ilike"),
    order: () => chain,
    range: () => chain,
    single: async () => queue.get(table)?.shift() ?? { data: null, error: null },
    maybeSingle: async () => queue.get(table)?.shift() ?? { data: null, error: null },
    then: (resolve: (v: Result) => unknown) =>
      resolve(queue.get(table)?.shift() ?? { data: null, error: null }),
  };
  return chain;
}
let rpcHandler: (args: unknown[]) => Promise<Result> = async () => ({ data: null, error: null });
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => builder(t),
    rpc: (...args: unknown[]) => rpcHandler(args),
  },
}));

async function seed(role: "owner" | "front_desk" | "housekeeper" | null = "owner") {
  resetSession({
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
  });
  enqueue("hotel_user_roles", {
    data: role === null ? null : { role, is_active: true },
    error: null,
  });
}

// Correction B Turn A: booking sources are DB-backed. Success-path create
// tests must enqueue an active `walk_in` row so the pre-RPC lookup passes.
function seedActiveWalkIn() {
  enqueue("hotel_booking_sources", {
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

beforeEach(() => {
  resetSession();
  auditEvents.length = 0;
  queue.clear();
  calls.length = 0;
  rpcHandler = async () => ({ data: null, error: null });
});
afterEach(() => vi.restoreAllMocks());

const ROOM_UUID = "11111111-1111-4111-8111-111111111111";
const ROOM_UUID_2 = "22222222-2222-4222-8222-222222222222";
const RES_UUID = "33333333-3333-4333-8333-333333333333";

const post = (body: unknown) =>
  new Request("http://x.test/api/hotel/reservations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const validBody = () => ({
  bookingSource: "walk_in",
  arrivalDate: "2027-07-20",
  departureDate: "2027-07-22",
  rooms: [{ hotelRoomId: ROOM_UUID, agreedRate: 200, adults: 2, children: 0 }],
  guests: [{ fullName: "John Doe", isPrimary: true }],
});

// =========================================================================
// Defect 2 — strict calendar date validator
// =========================================================================
describe("Correction A / Defect 2 — strict isIsoDate", () => {
  it.each([
    ["2026-02-28", true],
    ["2026-02-29", false],
    ["2028-02-29", true],
    ["2026-02-31", false],
    ["2026-13-01", false],
    ["2026-00-10", false],
    ["2026-7-01", false],
    ["", false],
    ["not-a-date", false],
  ])("%s → %s", async (input, expected) => {
    const { isIsoDate } = await import("@/lib/reservations-store.server");
    expect(isIsoDate(input)).toBe(expected);
  });
  it("rejects non-string values", async () => {
    const { isIsoDate } = await import("@/lib/reservations-store.server");
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
    expect(isIsoDate(20260228)).toBe(false);
    expect(isIsoDate({})).toBe(false);
  });
  it("availability endpoint rejects Feb 31", async () => {
    await seed("owner");
    const { handleAvailability } = await import("@/routes/api/hotel/availability");
    const res = await handleAvailability({
      request: new Request(
        "http://x.test/api/hotel/availability?arrival=2026-02-31&departure=2026-03-05",
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_stay_dates");
  });
  it("reservation create rejects Feb 31", async () => {
    await seed("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({
      request: post({ ...validBody(), arrivalDate: "2026-02-31" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_stay_dates");
  });
});

// =========================================================================
// Defect 3 — strict boolean primary flag + integer occupancy + UUID room id
// =========================================================================
describe("Correction A / Defect 3 — strict validation", () => {
  it('rejects string "false" as primary flag (previously coerced to true)', async () => {
    await seed("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const body = validBody();
    (body.guests[0] as any).isPrimary = "false";
    const res = await handleCreateReservation({ request: post(body) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_primary_flag");
  });
  it('rejects string "true" as primary flag', async () => {
    await seed("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const body = validBody();
    (body.guests[0] as any).isPrimary = "true";
    const res = await handleCreateReservation({ request: post(body) });
    expect((await res.json()).error).toBe("invalid_primary_flag");
  });
  it("rejects numeric 1 as primary flag", async () => {
    await seed("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const body = validBody();
    (body.guests[0] as any).isPrimary = 1;
    const res = await handleCreateReservation({ request: post(body) });
    expect((await res.json()).error).toBe("invalid_primary_flag");
  });
  it.each([1.5, "2", "abc", NaN, Number.POSITIVE_INFINITY, -1])(
    "rejects invalid adults %p",
    async (adults) => {
      await seed("owner");
      const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
      const body = validBody();
      (body.rooms[0] as any).adults = adults;
      const res = await handleCreateReservation({ request: post(body) });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_occupancy");
    },
  );
  it.each([-1, 0.5, "0"])("rejects invalid children %p", async (children) => {
    await seed("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const body = validBody();
    (body.rooms[0] as any).children = children;
    const res = await handleCreateReservation({ request: post(body) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_occupancy");
  });
  it("rejects non-UUID room id with invalid_room_id (never becomes a DB error)", async () => {
    await seed("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const body = validBody();
    (body.rooms[0] as any).hotelRoomId = "not-a-uuid";
    const res = await handleCreateReservation({ request: post(body) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_room_id");
  });
  it("rejects array body as invalid_body", async () => {
    await seed("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({ request: post([]) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });
  it("rejects null body as invalid_body", async () => {
    await seed("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({ request: post(null) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });
});

// =========================================================================
// Defect 4 — safe DB error handling
// =========================================================================
describe("Correction A / Defect 4 — safe DB errors", () => {
  it("reservation detail 400 on non-UUID id", async () => {
    await seed("owner");
    const { handleReservationDetail } = await import("@/routes/api/hotel/reservations.$id");
    const res = await handleReservationDetail({ params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_id");
  });
  it("reservation detail 500 reservation_detail_failed on header error (no SQL leak)", async () => {
    await seed("owner");
    enqueue("hotel_reservations", {
      data: null,
      error: { message: 'ERROR: relation "secret" does not exist' },
    });
    const { handleReservationDetail } = await import("@/routes/api/hotel/reservations.$id");
    const res = await handleReservationDetail({ params: { id: RES_UUID } });
    expect(res.status).toBe(500);
    const txt = await res.text();
    expect(JSON.parse(txt).error).toBe("reservation_detail_failed");
    expect(txt).not.toContain("secret");
    expect(txt).not.toContain("relation");
  });
  it("reservation detail 500 on rooms query error", async () => {
    await seed("owner");
    enqueue("hotel_reservations", {
      data: {
        id: RES_UUID,
        tenant_id: "tenant-uuid-1",
        booking_reference: "BK",
        booking_source: "walk_in",
        status: "confirmed",
        arrival_date: "2027-07-20",
        departure_date: "2027-07-22",
        currency: "MYR",
        notes: null,
        created_at: "2027-07-20T00:00:00Z",
        created_by_n3_user_key: "user-1",
      },
      error: null,
    });
    enqueue("hotel_reservation_rooms", { data: null, error: { message: "boom rooms" } });
    const { handleReservationDetail } = await import("@/routes/api/hotel/reservations.$id");
    const res = await handleReservationDetail({ params: { id: RES_UUID } });
    expect(res.status).toBe(500);
    const txt = await res.text();
    expect(JSON.parse(txt).error).toBe("reservation_detail_failed");
    expect(txt).not.toContain("boom rooms");
  });
  it("reservation detail 500 on guests query error", async () => {
    await seed("owner");
    enqueue("hotel_reservations", {
      data: {
        id: RES_UUID,
        tenant_id: "tenant-uuid-1",
        booking_reference: "BK",
        booking_source: "walk_in",
        status: "confirmed",
        arrival_date: "2027-07-20",
        departure_date: "2027-07-22",
        currency: "MYR",
        notes: null,
        created_at: "2027-07-20T00:00:00Z",
        created_by_n3_user_key: "user-1",
      },
      error: null,
    });
    enqueue("hotel_reservation_rooms", { data: [], error: null });
    enqueue("hotel_reservation_guests", { data: null, error: { message: "boom guests" } });
    const { handleReservationDetail } = await import("@/routes/api/hotel/reservations.$id");
    const res = await handleReservationDetail({ params: { id: RES_UUID } });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("reservation_detail_failed");
  });
  it("reservation list 500 reservations_list_failed on DB error (no SQL leak)", async () => {
    await seed("owner");
    rpcHandler = async () => ({ data: null, error: { message: 'ERROR: syntax at "SELECT"' } });
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations"),
    });
    expect(res.status).toBe(500);
    const txt = await res.text();
    expect(JSON.parse(txt).error).toBe("reservations_list_failed");
    expect(txt).not.toContain("SELECT");
  });
});

// =========================================================================
// Defect 1 — global guest search before pagination, filtered total
// =========================================================================
describe("Correction A / Defect 1 — global guest search", () => {
  // The list is now produced by ONE tenant-scoped database routine
  // (`hotelhub_list_reservations`) that filters over the complete tenant
  // result — including linked non-primary guests — then sorts, then pages.
  // These tests assert that contract at the handler boundary.
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  function stubList(items: unknown[], total: number) {
    rpcCalls.length = 0;
    rpcHandler = async (args: unknown[]) => {
      rpcCalls.push({
        name: args[0] as string,
        params: (args[1] ?? {}) as Record<string, unknown>,
      });
      return { data: { items, total }, error: null };
    };
  }
  const row = (id: string, ref: string, guest: string | null) => ({
    id,
    bookingReference: ref,
    primaryGuestName: guest,
    primaryGuestMobile: null,
    bookingSource: "walk_in",
    status: "confirmed",
    arrivalDate: "2027-07-20",
    departureDate: "2027-07-22",
    roomCount: 1,
    roomLabels: ["101"],
    guestCount: 1,
    createdAt: "2027-07-20T00:00:00Z",
    createdByN3UserKey: "user-1",
  });

  it("guest filter is applied to the complete filtered result, not to the page", async () => {
    await seed("owner");
    // The routine matched 3 reservations tenant-wide and returned page 1.
    stubList([row("res-A", "BK-A", "Jane Match")], 3);
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations?guestName=jane&limit=1&offset=0"),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3); // filtered total, not the tenant total
    expect(body.items).toHaveLength(1);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.name).toBe("hotelhub_list_reservations");
    expect(rpcCalls[0]!.params["p_guest_name"]).toBe("jane");
    expect(rpcCalls[0]!.params["p_limit"]).toBe(1);
    expect(rpcCalls[0]!.params["p_offset"]).toBe(0);
    // No unbounded Node-side read of the tenant's reservations.
    expect(calls.some((c) => c.table === "hotel_reservations")).toBe(false);
  });

  it("guest search with zero matches returns empty items and total=0", async () => {
    await seed("owner");
    stubList([], 0);
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations?guestName=nobody"),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("the list routine is always called with the session-derived tenant", async () => {
    await seed("owner");
    stubList([], 0);
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    // A browser-supplied tenant must never be honoured.
    await handleListReservations({
      request: new Request(
        "http://x.test/api/hotel/reservations?guestName=jane&tenantId=someone-else",
      ),
    });
    expect(rpcCalls[0]!.params["p_tenant_id"]).toBe("tenant-uuid-1");
  });

  it("rejects a sort key that is not on the allow-list", async () => {
    await seed("owner");
    stubList([], 0);
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request(
        "http://x.test/api/hotel/reservations?sortKey=created_at);drop%20table&sortDir=asc",
      ),
    });
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it("passes an allow-listed sort key and direction straight through", async () => {
    await seed("owner");
    stubList([row("res-A", "BK-A", "Jane")], 1);
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations?sortKey=arrivalDate&sortDir=asc"),
    });
    expect(res.status).toBe(200);
    expect(rpcCalls[0]!.params["p_sort_key"]).toBe("arrivalDate");
    expect(rpcCalls[0]!.params["p_sort_dir"]).toBe("asc");
  });

  it("returns only the approved list DTO fields", async () => {
    await seed("owner");
    stubList([{ ...row("res-A", "BK-A", "Jane"), secret_internal: "leak" }], 1);
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations"),
    });
    const body = await res.json();
    expect(Object.keys(body.items[0])).not.toContain("secret_internal");
    expect(body.items[0].bookingReference).toBe("BK-A");
  });
});

// =========================================================================
// Defect 6 — API no longer emits success audits (RPC owns them atomically)
// =========================================================================
describe("Correction A / Defect 6 — no duplicate success audits from API", () => {
  it("success writes zero API audits; failure still writes one create_failed", async () => {
    await seed("owner");
    seedActiveWalkIn();
    rpcHandler = async () => ({
      data: [
        {
          out_reservation_id: RES_UUID,
          out_booking_reference: "BK260720099",
          out_status: "confirmed",
        },
      ],
      error: null,
    });
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const body = {
      ...validBody(),
      rooms: [
        { hotelRoomId: ROOM_UUID, agreedRate: 200, adults: 2, children: 0 },
        {
          hotelRoomId: ROOM_UUID_2,
          agreedRate: 150,
          adults: 1,
          children: 0,
          rateOverrideReason: "discount",
        },
      ],
      guests: [{ fullName: "John Doe", isPrimary: true, assignedHotelRoomId: ROOM_UUID }],
    };
    const res = await handleCreateReservation({ request: post(body) });
    expect(res.status).toBe(201);
    expect(auditEvents.filter((e) => e.eventType === "hotel.reservation.created")).toHaveLength(0);
    expect(
      auditEvents.filter((e) => e.eventType === "hotel.reservation.rate_overridden"),
    ).toHaveLength(0);

    // Failure path still audits once.
    enqueue("hotel_user_roles", { data: { role: "owner", is_active: true }, error: null });
    enqueue("hotel_booking_sources", {
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
    rpcHandler = async () => ({ data: null, error: { message: "room_not_available" } });
    const res2 = await handleCreateReservation({ request: post(validBody()) });
    expect(res2.status).toBe(409);
    expect(
      auditEvents.filter((e) => e.eventType === "hotel.reservation.create_failed"),
    ).toHaveLength(1);
  });
});

// =========================================================================
// Non-regression — start.ts unchanged
// =========================================================================
describe("Correction A / non-regression — src/start.ts", () => {
  it("keeps functionMiddleware: [] and does not register attachSupabaseAuth", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/start.ts", "utf8");
    expect(src).toMatch(/functionMiddleware:\s*\[\s*\]/);
    expect(src).not.toMatch(/attachSupabaseAuth/);
  });
});
