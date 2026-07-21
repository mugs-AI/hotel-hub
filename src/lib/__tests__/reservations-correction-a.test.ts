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
  const record =
    (op: string) =>
    (column?: string, value?: unknown) => {
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
  arrivalDate: "2026-07-20",
  departureDate: "2026-07-22",
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
        arrival_date: "2026-07-20",
        departure_date: "2026-07-22",
        currency: "MYR",
        notes: null,
        created_at: "2026-07-20T00:00:00Z",
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
        arrival_date: "2026-07-20",
        departure_date: "2026-07-22",
        currency: "MYR",
        notes: null,
        created_at: "2026-07-20T00:00:00Z",
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
    enqueue("hotel_reservations", {
      data: null,
      error: { message: 'ERROR: syntax at "SELECT"' },
    });
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
  it("guest search resolves all matching reservation IDs BEFORE reservation query and returns filtered total", async () => {
    await seed("owner");
    // Guest search returns two guest IDs (some may be non-primary).
    enqueue("hotel_guests", {
      data: [{ id: "g-1" }, { id: "g-2" }],
      error: null,
    });
    // Link resolution — 3 reservation IDs match, well beyond the first
    // reservation page limit.
    enqueue("hotel_reservation_guests", {
      data: [
        { reservation_id: "res-A" },
        { reservation_id: "res-B" },
        { reservation_id: "res-C" },
      ],
      error: null,
    });
    // Reservations page: server returns just the filtered subset with the
    // true filtered total = 3.
    enqueue("hotel_reservations", {
      data: [
        {
          id: "res-A",
          booking_reference: "BK-A",
          booking_source: "walk_in",
          status: "confirmed",
          arrival_date: "2026-07-20",
          departure_date: "2026-07-22",
          created_at: "2026-07-20T00:00:00Z",
          created_by_n3_user_key: "user-1",
        },
      ],
      error: null,
      count: 3,
    });
    // Per-reservation guest join (non-primary guest attached to res-A).
    enqueue("hotel_reservation_guests", {
      data: [
        {
          reservation_id: "res-A",
          is_primary: false,
          guest_id: "g-2",
          hotel_guests: { full_name: "Jane Match" },
        },
      ],
      error: null,
    });
    enqueue("hotel_reservation_rooms", {
      data: [{ reservation_id: "res-A" }],
      error: null,
    });
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request(
        "http://x.test/api/hotel/reservations?guestName=jane&limit=1&offset=0",
      ),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3); // filtered total, not the tenant total
    expect(body.items).toHaveLength(1);

    // Prove ordering: guest search happened BEFORE the reservation list
    // query, and the reservation query was restricted to the resolved IDs.
    const tables = calls.map((c) => c.table);
    const guestIdx = tables.indexOf("hotel_guests");
    const reservationIdx = tables.indexOf("hotel_reservations");
    expect(guestIdx).toBeGreaterThanOrEqual(0);
    expect(reservationIdx).toBeGreaterThan(guestIdx);
    const reservationCall = calls[reservationIdx];
    // The `.in("id", restrictIds)` filter must appear on the reservation query.
    expect(
      reservationCall.filters.some(
        (f) =>
          f.op === "in" &&
          f.column === "id" &&
          Array.isArray(f.value) &&
          (f.value as string[]).sort().join(",") === "res-A,res-B,res-C",
      ),
    ).toBe(true);
  });
  it("guest search with zero matches returns empty items and total=0", async () => {
    await seed("owner");
    enqueue("hotel_guests", { data: [], error: null });
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations?guestName=nobody"),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });
  it("guest search is scoped to the authenticated tenant", async () => {
    await seed("owner");
    enqueue("hotel_guests", { data: [], error: null });
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations?guestName=jane"),
    });
    // The very first call for `hotel_guests` must include eq tenant_id filter.
    const guestCall = calls.find((c) => c.table === "hotel_guests")!;
    expect(
      guestCall.filters.some((f) => f.op === "eq" && f.column === "tenant_id" && f.value === "tenant-uuid-1"),
    ).toBe(true);
  });
});

// =========================================================================
// Defect 6 — API no longer emits success audits (RPC owns them atomically)
// =========================================================================
describe("Correction A / Defect 6 — no duplicate success audits from API", () => {
  it("success writes zero API audits; failure still writes one create_failed", async () => {
    await seed("owner");
    rpcHandler = async () => ({
      data: [
        { out_reservation_id: RES_UUID, out_booking_reference: "BK260720099", out_status: "confirmed" },
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
    };
    const res = await handleCreateReservation({ request: post(body) });
    expect(res.status).toBe(201);
    expect(auditEvents.filter((e) => e.eventType === "hotel.reservation.created")).toHaveLength(0);
    expect(
      auditEvents.filter((e) => e.eventType === "hotel.reservation.rate_overridden"),
    ).toHaveLength(0);

    // Failure path still audits once.
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
