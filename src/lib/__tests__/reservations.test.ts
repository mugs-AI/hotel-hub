/**
 * Milestone 1.1.1 — Reservation, Guest and Availability Engine.
 * Handler + service tests: session, audit and the reservations store are
 * mocked so tests never touch the real database or N3.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

// ---------- Session mock ----------
type SessionState = { data: Record<string, unknown>; cleared: number };
const sessionState: SessionState = { data: {}, cleared: 0 };
function resetSession(initial: Record<string, unknown> = {}) {
  sessionState.data = { ...initial };
  sessionState.cleared = 0;
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
      sessionState.cleared++;
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

// ---------- supabaseAdmin mock (role lookup only) ----------
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
    lt: () => chain,
    gt: () => chain,
    gte: () => chain,
    lte: () => chain,
    ilike: () => chain,
    order: () => chain,
    range: () => chain,
    single: async () => supabaseQueue.get(table)?.shift() ?? { data: null, error: null },
    maybeSingle: async () => supabaseQueue.get(table)?.shift() ?? { data: null, error: null },
    then: (resolve: (v: SupabaseResult) => unknown) =>
      resolve(supabaseQueue.get(table)?.shift() ?? { data: null, error: null }),
  };
  return chain;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => makeBuilder(table),
    rpc: (...args: unknown[]) => rpcHandler(args),
  },
}));
let rpcHandler: (args: unknown[]) => Promise<SupabaseResult> = async () => ({
  data: null,
  error: null,
});
function setRpcHandler(fn: (args: unknown[]) => Promise<SupabaseResult>) {
  rpcHandler = fn;
}

// ---------- Fixtures ----------
function seedRole(role: "owner" | "front_desk" | "housekeeper" | null) {
  supabaseEnqueue("hotel_user_roles", {
    data: role === null ? null : { role, is_active: true },
    error: null,
  });
}
async function seedAuthenticated(role: "owner" | "front_desk" | "housekeeper" | null) {
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
  seedRole(role);
}

beforeEach(() => {
  resetSession();
  auditEvents.length = 0;
  supabaseQueue.clear();
  setRpcHandler(async () => ({ data: null, error: null }));
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ================================================================
// RBAC
// ================================================================
describe("RBAC — reservation permissions", () => {
  it("owner + front_desk have view & create; housekeeper has neither", async () => {
    const { hasPermission } = await import("@/lib/rbac");
    for (const perm of ["hotel:reservations:view", "hotel:reservations:create"] as const) {
      expect(hasPermission("owner", perm)).toBe(true);
      expect(hasPermission("front_desk", perm)).toBe(true);
      expect(hasPermission("housekeeper", perm)).toBe(false);
      expect(hasPermission(null, perm)).toBe(false);
    }
  });
});

// ================================================================
// Availability endpoint
// ================================================================
describe("GET /api/hotel/availability", () => {
  it("housekeeper receives 403", async () => {
    await seedAuthenticated("housekeeper");
    const { handleAvailability } = await import("@/routes/api/hotel/availability");
    const res = await handleAvailability({
      request: new Request(
        "http://x.test/api/hotel/availability?arrival=2026-07-20&departure=2026-07-22",
      ),
    });
    expect(res.status).toBe(403);
  });
  it("unauthenticated → 401", async () => {
    resetSession();
    const { handleAvailability } = await import("@/routes/api/hotel/availability");
    const res = await handleAvailability({
      request: new Request(
        "http://x.test/api/hotel/availability?arrival=2026-07-20&departure=2026-07-22",
      ),
    });
    expect(res.status).toBe(401);
  });
  it("owner: rejects invalid dates", async () => {
    await seedAuthenticated("owner");
    const { handleAvailability } = await import("@/routes/api/hotel/availability");
    const res = await handleAvailability({
      request: new Request(
        "http://x.test/api/hotel/availability?arrival=2026-07-22&departure=2026-07-20",
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_stay_dates");
  });
  it("owner: filters blocked rooms and applies occupancy", async () => {
    await seedAuthenticated("owner");
    supabaseEnqueue("hotel_settings", { data: { currency: "MYR" }, error: null });
    supabaseEnqueue("hotel_rooms", {
      data: [
        {
          id: "r1",
          room_number: "101",
          n3_stock_code: "101",
          n3_stock_name: "Std",
          room_type: "standard",
          floor: "1",
          max_occupancy: 2,
          base_rate: 200,
          is_active: true,
        },
        {
          id: "r2",
          room_number: "102",
          n3_stock_code: "102",
          n3_stock_name: "Std",
          room_type: "standard",
          floor: "1",
          max_occupancy: 4,
          base_rate: 300,
          is_active: true,
        },
      ],
      error: null,
    });
    // r1 blocked
    supabaseEnqueue("hotel_reservation_rooms", {
      data: [{ hotel_room_id: "r1" }],
      error: null,
    });
    const { handleAvailability } = await import("@/routes/api/hotel/availability");
    const res = await handleAvailability({
      request: new Request(
        "http://x.test/api/hotel/availability?arrival=2026-07-20&departure=2026-07-22&adults=3",
      ),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rooms.map((r: { hotelRoomId: string }) => r.hotelRoomId)).toEqual(["r2"]);
    expect(body.rooms[0].currency).toBe("MYR");
    expect(auditEvents.some((e) => e.eventType === "hotel.availability.checked")).toBe(true);
  });
});

// ================================================================
// Create reservation
// ================================================================
describe("POST /api/hotel/reservations", () => {
  const validBody = () => ({
    bookingSource: "walk_in",
    arrivalDate: "2026-07-20",
    departureDate: "2026-07-22",
    notes: "VIP",
    rooms: [{ hotelRoomId: "room-uuid-1", agreedRate: 200, adults: 2, children: 0 }],
    guests: [{ fullName: "John Doe", isPrimary: true }],
  });
  const post = (body: unknown) =>
    new Request("http://x.test/api/hotel/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("housekeeper → 403", async () => {
    await seedAuthenticated("housekeeper");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    expect((await handleCreateReservation({ request: post(validBody()) })).status).toBe(403);
  });
  it("unauthenticated → 401", async () => {
    resetSession();
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    expect((await handleCreateReservation({ request: post(validBody()) })).status).toBe(401);
  });
  it("front_desk can create", async () => {
    await seedAuthenticated("front_desk");
    setRpcHandler(async () => ({
      data: [
        {
          out_reservation_id: "res-1",
          out_booking_reference: "BK260720001",
          out_status: "confirmed",
        },
      ],
      error: null,
    }));
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({ request: post(validBody()) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.bookingReference).toBe("BK260720001");
    expect(auditEvents.some((e) => e.eventType === "hotel.reservation.created")).toBe(true);
  });
  it("owner can create", async () => {
    await seedAuthenticated("owner");
    setRpcHandler(async () => ({
      data: [
        {
          out_reservation_id: "res-2",
          out_booking_reference: "BK260720002",
          out_status: "confirmed",
        },
      ],
      error: null,
    }));
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    expect((await handleCreateReservation({ request: post(validBody()) })).status).toBe(201);
  });
  it("rejects invalid booking source", async () => {
    await seedAuthenticated("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({
      request: post({ ...validBody(), bookingSource: "airbnb" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_booking_source");
  });
  it("rejects departure <= arrival", async () => {
    await seedAuthenticated("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({
      request: post({ ...validBody(), departureDate: "2026-07-20" }),
    });
    expect((await res.json()).error).toBe("invalid_stay_dates");
  });
  it("rejects no rooms", async () => {
    await seedAuthenticated("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({ request: post({ ...validBody(), rooms: [] }) });
    expect((await res.json()).error).toBe("room_required");
  });
  it("rejects no guests", async () => {
    await seedAuthenticated("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({ request: post({ ...validBody(), guests: [] }) });
    expect((await res.json()).error).toBe("guest_required");
  });
  it("rejects zero primary guests", async () => {
    await seedAuthenticated("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({
      request: post({
        ...validBody(),
        guests: [
          { fullName: "A", isPrimary: false },
          { fullName: "B", isPrimary: false },
        ],
      }),
    });
    expect((await res.json()).error).toBe("primary_guest_required");
  });
  it("rejects multiple primary guests", async () => {
    await seedAuthenticated("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({
      request: post({
        ...validBody(),
        guests: [
          { fullName: "A", isPrimary: true },
          { fullName: "B", isPrimary: true },
        ],
      }),
    });
    expect((await res.json()).error).toBe("multiple_primary_guests");
  });
  it("rejects adults < 1", async () => {
    await seedAuthenticated("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const body = validBody();
    body.rooms[0].adults = 0;
    const res = await handleCreateReservation({ request: post(body) });
    expect((await res.json()).error).toBe("invalid_occupancy");
  });
  it("rejects negative agreed rate", async () => {
    await seedAuthenticated("owner");
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const body = validBody();
    body.rooms[0].agreedRate = -5;
    const res = await handleCreateReservation({ request: post(body) });
    expect((await res.json()).error).toBe("invalid_rate");
  });
  it("multi-room + multi-guest with rate override reason succeeds and audits override", async () => {
    await seedAuthenticated("owner");
    setRpcHandler(async () => ({
      data: [
        {
          out_reservation_id: "res-3",
          out_booking_reference: "BK260720003",
          out_status: "confirmed",
        },
      ],
      error: null,
    }));
    const body = {
      ...validBody(),
      rooms: [
        { hotelRoomId: "room-1", agreedRate: 200, adults: 2, children: 0 },
        {
          hotelRoomId: "room-2",
          agreedRate: 150,
          adults: 1,
          children: 1,
          rateOverrideReason: "loyalty discount",
        },
      ],
      guests: [
        { fullName: "Primary", isPrimary: true },
        { fullName: "Companion", isPrimary: false },
      ],
    };
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({ request: post(body) });
    expect(res.status).toBe(201);
    expect(auditEvents.some((e) => e.eventType === "hotel.reservation.rate_overridden")).toBe(true);
  });
  it("maps RPC room_not_available to 409", async () => {
    await seedAuthenticated("owner");
    setRpcHandler(async () => ({ data: null, error: { message: "room_not_available" } }));
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({ request: post(validBody()) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("room_not_available");
    expect(auditEvents.some((e) => e.eventType === "hotel.reservation.create_failed")).toBe(true);
  });
  it("maps RPC setup_incomplete", async () => {
    await seedAuthenticated("owner");
    setRpcHandler(async () => ({ data: null, error: { message: "setup_incomplete" } }));
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({ request: post(validBody()) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("setup_incomplete");
  });
  it("collapses unknown RPC error to reservation_create_failed and never leaks SQL", async () => {
    await seedAuthenticated("owner");
    setRpcHandler(async () => ({
      data: null,
      error: {
        message:
          'ERROR:  syntax error at or near "SELECT" LINE 42\nSTATEMENT: SELECT * FROM secret;',
      },
    }));
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    const res = await handleCreateReservation({ request: post(validBody()) });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("SELECT");
    expect(text).not.toContain("secret");
    expect(JSON.parse(text).error).toBe("reservation_create_failed");
  });
  it("ignores browser-supplied tenantId, base_rate_snapshot, booking_reference, status", async () => {
    await seedAuthenticated("owner");
    let received: Record<string, unknown> = {};
    setRpcHandler(async (args) => {
      received = args[1] as Record<string, unknown>;
      return {
        data: [{ out_reservation_id: "r", out_booking_reference: "BK", out_status: "confirmed" }],
        error: null,
      };
    });
    const { handleCreateReservation } = await import("@/routes/api/hotel/reservations");
    await handleCreateReservation({
      request: post({
        ...validBody(),
        tenantId: "attacker-tenant",
        bookingReference: "HACK",
        status: "checked_out",
        rooms: [
          { hotelRoomId: "room-1", agreedRate: 200, adults: 2, children: 0, base_rate_snapshot: 1 },
        ],
      }),
    });
    expect(received.p_tenant_id).toBe("tenant-uuid-1"); // server-controlled
    expect(received.p_created_by_n3_user_key).toBe("user-1");
    expect(JSON.stringify(received)).not.toContain("base_rate_snapshot");
    expect(JSON.stringify(received)).not.toContain("HACK");
    expect(JSON.stringify(received)).not.toContain("checked_out");
  });
});

// ================================================================
// GET reservations (list & detail)
// ================================================================
describe("GET /api/hotel/reservations", () => {
  it("housekeeper → 403", async () => {
    await seedAuthenticated("housekeeper");
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations"),
    });
    expect(res.status).toBe(403);
  });
  it("owner: tenant-scoped list", async () => {
    await seedAuthenticated("owner");
    supabaseEnqueue("hotel_reservations", {
      data: [
        {
          id: "res-1",
          booking_reference: "BK260720001",
          booking_source: "walk_in",
          status: "confirmed",
          arrival_date: "2026-07-20",
          departure_date: "2026-07-22",
          created_at: "2026-07-20T00:00:00Z",
          created_by_n3_user_key: "user-1",
        },
      ],
      error: null,
      count: 1,
    });
    supabaseEnqueue("hotel_reservation_guests", {
      data: [
        {
          reservation_id: "res-1",
          is_primary: true,
          guest_id: "g1",
          hotel_guests: { full_name: "John" },
        },
      ],
      error: null,
    });
    supabaseEnqueue("hotel_reservation_rooms", {
      data: [{ reservation_id: "res-1" }],
      error: null,
    });
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations"),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].primaryGuestName).toBe("John");
    expect(body.items[0].roomCount).toBe(1);
  });
});

describe("GET /api/hotel/reservations/:id", () => {
  it("404 when belonging to another tenant / not found", async () => {
    await seedAuthenticated("owner");
    supabaseEnqueue("hotel_reservations", { data: null, error: null });
    const { handleReservationDetail } = await import("@/routes/api/hotel/reservations.$id");
    const res = await handleReservationDetail({ params: { id: "other-tenant-reservation" } });
    expect(res.status).toBe(404);
  });
});

// ================================================================
// Non-scope guards
// ================================================================
describe("N3 write / accounting integration boundary", () => {
  it("reservation source references no N3 write helpers", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/routes/api/hotel/reservations.ts", "utf8");
    expect(source).not.toMatch(
      /CashSale|CashMemo|SalesOrder|ReceivePayment|CustomerRefund|Knockoff/,
    );
    // No N3 gateway call at all from this route (accounting boundary).
    expect(source).not.toMatch(/from ['"]@\/lib\/n3-gateway/);
  });
});
