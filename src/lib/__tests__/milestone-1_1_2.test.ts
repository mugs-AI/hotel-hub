/**
 * Milestone 1.1.2 — Reservations UI & API hardening regression tests.
 *
 * Covers the pure UI helpers (payload shape, guest primary invariant,
 * validation, date-only display, source labels), plus the API input
 * hardening (availability integer, list pagination, arrival filters,
 * booking-source filter), and static safety checks (no browser Supabase
 * or N3 imports, deleted files stay deleted, nav enabled correctly).
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

// ---------- Session mock (mirrors reservations.test.ts) ----------
type SessionState = { data: Record<string, unknown> };
const sessionState: SessionState = { data: {} };
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
vi.mock("@/lib/audit.server", () => ({ logAudit: async () => {} }));

type SupabaseResult = { data: unknown; error: unknown; count?: number };
const supabaseQueue = new Map<string, SupabaseResult[]>();
function supabaseEnqueue(t: string, r: SupabaseResult) {
  const a = supabaseQueue.get(t) ?? [];
  a.push(r);
  supabaseQueue.set(t, a);
}
function makeBuilder(t: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    eq: () => chain,
    in: () => chain,
    lt: () => chain,
    gt: () => chain,
    gte: () => chain,
    lte: () => chain,
    ilike: () => chain,
    order: () => chain,
    range: () => chain,
    single: async () => supabaseQueue.get(t)?.shift() ?? { data: null, error: null },
    maybeSingle: async () => supabaseQueue.get(t)?.shift() ?? { data: null, error: null },
    then: (resolve: (v: SupabaseResult) => unknown) =>
      resolve(supabaseQueue.get(t)?.shift() ?? { data: null, error: null }),
  };
  return chain;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => makeBuilder(t),
    rpc: async () => ({ data: null, error: null }),
  },
}));

async function seedOwner() {
  resetSession({
    n3Token: "eyJ.tok.en",
    n3TokenExpiration: null,
    n3TenantKey: "n3-tenant-1",
    tenantCode: "T-001",
    companyName: "Test",
    n3UserKey: "user-1",
    userEmail: "u@x.test",
    userName: "U",
    tenantId: "tenant-uuid-1",
    createdAt: 1,
  });
  supabaseEnqueue("hotel_user_roles", { data: { role: "owner", is_active: true }, error: null });
}

async function seedHousekeeper() {
  resetSession({
    n3Token: "eyJ.tok.en",
    n3TokenExpiration: null,
    n3TenantKey: "n3-tenant-1",
    tenantCode: "T-001",
    companyName: "Test",
    n3UserKey: "user-2",
    userEmail: "u2@x.test",
    userName: "U",
    tenantId: "tenant-uuid-1",
    createdAt: 1,
  });
  supabaseEnqueue("hotel_user_roles", {
    data: { role: "housekeeper", is_active: true },
    error: null,
  });
}

beforeEach(() => {
  resetSession();
  supabaseQueue.clear();
});
afterEach(() => vi.restoreAllMocks());

// ================================================================
// Pure UI helpers
// ================================================================
describe("reservations-ui — pure helpers", () => {
  it("bookingSourceLabel maps default codes and Title-cases unknown codes", async () => {
    const { BOOKING_SOURCE_LABELS, bookingSourceLabel } = await import("@/lib/reservations-ui");
    // Presentation-only fallback labels for the known default codes.
    expect(BOOKING_SOURCE_LABELS.walk_in).toBe("Walk-in");
    expect(BOOKING_SOURCE_LABELS.hotel_website).toBe("Hotel website");
    expect(BOOKING_SOURCE_LABELS.booking_com).toBe("Booking.com");
    expect(bookingSourceLabel("phone")).toBe("Phone");
    expect(bookingSourceLabel("agoda")).toBe("Agoda");
    expect(bookingSourceLabel("whatsapp")).toBe("WhatsApp");
    // Unknown tenant-configured codes fall back to a snake→Title rendering.
    expect(bookingSourceLabel("corporate_travel")).toBe("Corporate Travel");
    expect(bookingSourceLabel("")).toBe("");
  });

  it("formatIsoDate renders Malaysian dd/mm/yyyy (Correction B)", async () => {
    const { formatIsoDate } = await import("@/lib/reservations-ui");
    expect(formatIsoDate("2027-07-20")).toBe("20/07/2026");
    expect(formatIsoDate("2026-02-28")).toBe("28/02/2026");
    expect(formatIsoDate(null)).toBe("—");
    expect(formatIsoDate("")).toBe("—");
  });

  it("buildListQuery encodes filters without tenant, omits empty, encodes limit/offset", async () => {
    const { buildListQuery } = await import("@/lib/reservations-ui");
    const p = buildListQuery(
      {
        bookingReference: "BK",
        guestName: "  Jane  ",
        guestMobile: "",
        bookingSource: "walk_in",
        status: "",
        arrivalFrom: "2027-07-20",
        arrivalTo: "",

      },
      { limit: 25, offset: 50 },
    );
    expect(p.get("bookingReference")).toBe("BK");
    expect(p.get("guestName")).toBe("Jane");
    expect(p.get("bookingSource")).toBe("walk_in");
    expect(p.get("arrivalFrom")).toBe("2027-07-20");
    expect(p.get("status")).toBeNull();
    expect(p.get("arrivalTo")).toBeNull();
    expect(p.get("limit")).toBe("25");
    expect(p.get("offset")).toBe("50");
    expect(p.get("tenantId")).toBeNull();
    expect(p.get("n3Token")).toBeNull();
  });

  it("setPrimaryGuest enforces exactly one primary", async () => {
    const { setPrimaryGuest, emptyGuestDraft } = await import("@/lib/reservations-ui");
    const g = [emptyGuestDraft(true), emptyGuestDraft(false), emptyGuestDraft(false)];
    const after = setPrimaryGuest(g, 2);
    expect(after.map((x) => x.isPrimary)).toEqual([false, false, true]);
  });

  it("removeGuestSafe promotes first remaining when primary is removed", async () => {
    const { removeGuestSafe, emptyGuestDraft } = await import("@/lib/reservations-ui");
    const g = [
      { ...emptyGuestDraft(true), fullName: "A" },
      { ...emptyGuestDraft(false), fullName: "B" },
      { ...emptyGuestDraft(false), fullName: "C" },
    ];
    const after = removeGuestSafe(g, 0);
    expect(after.map((x) => x.isPrimary)).toEqual([true, false]);
    expect(after.map((x) => x.fullName)).toEqual(["B", "C"]);
  });

  it("addRoomIfNew rejects duplicates", async () => {
    const { addRoomIfNew, makeRoomDraft } = await import("@/lib/reservations-ui");
    const d = makeRoomDraft({
      hotelRoomId: "r1",
      roomNumber: "101",
      roomType: "std",
      maxOccupancy: 2,
      baseRate: 200,
      currency: "MYR",
    });
    const a = addRoomIfNew([], d);
    expect(a.added).toBe(true);
    const b = addRoomIfNew(a.rooms, d);
    expect(b.added).toBe(false);
    expect(b.rooms).toHaveLength(1);
  });

  it("validateRoom enforces integer adults/children, max occupancy, non-neg rate, override reason", async () => {
    const { validateRoom, makeRoomDraft } = await import("@/lib/reservations-ui");
    const base = makeRoomDraft({
      hotelRoomId: "r1",
      roomNumber: "101",
      roomType: "std",
      maxOccupancy: 2,
      baseRate: 200,
      currency: "MYR",
    });
    // ok
    expect(validateRoom({ ...base, adults: 2, children: 0, agreedRate: 200 })).toEqual({
      ok: true,
    });
    // non-integer
    expect(validateRoom({ ...base, adults: 1.5, agreedRate: 200 }).ok).toBe(false);
    // occupancy exceeded
    expect(validateRoom({ ...base, adults: 2, children: 1, agreedRate: 200 })).toMatchObject({
      ok: false,
      code: "occupancy_exceeded",
    });
    // negative rate
    expect(validateRoom({ ...base, adults: 1, agreedRate: -1 })).toMatchObject({
      ok: false,
      code: "invalid_rate",
    });
    // rate override reason required
    expect(
      validateRoom({ ...base, adults: 1, agreedRate: 150, rateOverrideReason: "" }),
    ).toMatchObject({ ok: false, code: "rate_override_reason_required" });
    // unchanged rate does NOT require reason
    expect(validateRoom({ ...base, adults: 1, agreedRate: 200, rateOverrideReason: "" })).toEqual({
      ok: true,
    });
  });

  it("validateGuests enforces exactly-one-primary and non-empty name", async () => {
    const { validateGuests, emptyGuestDraft } = await import("@/lib/reservations-ui");
    expect(validateGuests([]).ok).toBe(false);
    expect(validateGuests([{ ...emptyGuestDraft(true), fullName: "" }])).toMatchObject({
      ok: false,
      code: "guest_full_name_required",
    });
    expect(
      validateGuests([
        { ...emptyGuestDraft(false), fullName: "A" },
        { ...emptyGuestDraft(false), fullName: "B" },
      ]),
    ).toMatchObject({ ok: false, code: "primary_guest_required" });
    expect(
      validateGuests([
        { ...emptyGuestDraft(true), fullName: "A" },
        { ...emptyGuestDraft(true), fullName: "B" },
      ]),
    ).toMatchObject({ ok: false, code: "multiple_primary_guests" });
    expect(validateGuests([{ ...emptyGuestDraft(true), fullName: "A" }])).toEqual({ ok: true });
  });

  it("buildCreatePayload strips server-controlled fields and omits reason when rate unchanged", async () => {
    const { buildCreatePayload, makeRoomDraft, emptyGuestDraft } =
      await import("@/lib/reservations-ui");
    const room = {
      ...makeRoomDraft({
        hotelRoomId: "r1",
        roomNumber: "101",
        roomType: "std",
        maxOccupancy: 2,
        baseRate: 200,
        currency: "MYR",
      }),
      adults: 2,
      children: 0,
      agreedRate: 200, // unchanged — reason must be dropped
      rateOverrideReason: "leftover text",
    };
    const payload = buildCreatePayload({
      bookingSource: "walk_in",
      arrivalDate: "2027-07-20",
      departureDate: "2027-07-22",
      notes: "  vip ",
      rooms: [room],
      guests: [{ ...emptyGuestDraft(true), fullName: " John " }],
    });
    // Nothing server-controlled leaks
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(
      /tenantId|tenant_id|n3Token|n3UserKey|bookingReference|status|baseRateSnapshot|base_rate_snapshot|currency|maxOccupancy|roomNumber|createdAt/,
    );
    expect(Object.keys(payload)).toEqual([
      "bookingSource",
      "arrivalDate",
      "departureDate",
      "notes",
      "externalBookingReference",
      "rooms",
      "guests",
    ]);
    expect(payload.externalBookingReference).toBeNull();
    expect(Object.keys(payload.rooms[0])).toEqual([
      "hotelRoomId",
      "agreedRate",
      "adults",
      "children",
      "rateOverrideReason",
    ]);
    expect(payload.rooms[0].rateOverrideReason).toBeNull();
    expect(Object.keys(payload.guests[0])).toEqual([
      "fullName",
      "mobile",
      "email",
      "notes",
      "isPrimary",
      "identityType",
      "identityNumber",
      "nationalityCode",
      "addressLine1",
      "addressLine2",
      "addressLine3",
      "city",
      "postcode",
      "countryCode",
      "stateCode",
      "stateProvince",
    ]);

    expect(payload.guests[0].fullName).toBe("John");
    expect(payload.guests[0].isPrimary).toBe(true);
    expect(payload.notes).toBe("vip");
  });

  it("validateStayDates rejects invalid calendar dates and dep <= arr", async () => {
    const { validateStayDates } = await import("@/lib/reservations-ui");
    expect(validateStayDates("", "").ok).toBe(false);
    expect(validateStayDates("2026-02-31", "2026-03-01").ok).toBe(false);
    expect(validateStayDates("2027-07-22", "2027-07-22").ok).toBe(false);
    expect(validateStayDates("2027-07-22", "2027-07-20").ok).toBe(false);
    expect(validateStayDates("2027-07-20", "2027-07-22")).toEqual({ ok: true });
  });

  it("friendlyError never returns raw server strings", async () => {
    const { friendlyError } = await import("@/lib/reservations-ui");
    const raw = 'ERROR: syntax error at or near "SELECT" LINE 42; secret';
    expect(friendlyError(raw)).toBe("Something went wrong.");
    expect(friendlyError("reservation_create_failed")).toContain("couldn");
    expect(friendlyError("room_not_available")).toContain("refreshed availability");
  });
});

// ================================================================
// Availability endpoint hardening
// ================================================================
describe("GET /api/hotel/availability — hardening", () => {
  it("housekeeper is denied (403) — no data leak", async () => {
    await seedHousekeeper();
    const { handleAvailability } = await import("@/routes/api/hotel/availability");
    const res = await handleAvailability({
      request: new Request(
        "http://x.test/api/hotel/availability?arrival=2027-07-20&departure=2027-07-22",
      ),
    });
    expect(res.status).toBe(403);
  });
  it("rejects decimal adults", async () => {
    await seedOwner();
    const { handleAvailability } = await import("@/routes/api/hotel/availability");
    const res = await handleAvailability({
      request: new Request(
        "http://x.test/api/hotel/availability?arrival=2027-07-20&departure=2027-07-22&adults=1.5",
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_occupancy");
  });
  it("rejects empty adults", async () => {
    await seedOwner();
    const { handleAvailability } = await import("@/routes/api/hotel/availability");
    const res = await handleAvailability({
      request: new Request(
        "http://x.test/api/hotel/availability?arrival=2027-07-20&departure=2027-07-22&adults=",
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_occupancy");
  });
  it("rejects non-numeric children", async () => {
    await seedOwner();
    const { handleAvailability } = await import("@/routes/api/hotel/availability");
    const res = await handleAvailability({
      request: new Request(
        "http://x.test/api/hotel/availability?arrival=2027-07-20&departure=2027-07-22&children=abc",
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_occupancy");
  });
});

// ================================================================
// List hardening: pagination, date filter, booking-source filter
// ================================================================
describe("GET /api/hotel/reservations — hardening", () => {
  it("rejects non-integer limit", async () => {
    await seedOwner();
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations?limit=1.5"),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_pagination");
  });
  it("rejects negative offset", async () => {
    await seedOwner();
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations?offset=-5"),
    });
    expect((await res.json()).error).toBe("invalid_pagination");
  });
  it("rejects limit above 100", async () => {
    await seedOwner();
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations?limit=101"),
    });
    expect((await res.json()).error).toBe("invalid_pagination");
  });
  it("rejects NaN pagination", async () => {
    await seedOwner();
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations?limit=abc"),
    });
    expect((await res.json()).error).toBe("invalid_pagination");
  });
  it("rejects invalid arrivalFrom", async () => {
    await seedOwner();
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations?arrivalFrom=2026-02-31"),
    });
    expect((await res.json()).error).toBe("invalid_date_filter");
  });
  it("rejects arrivalFrom > arrivalTo", async () => {
    await seedOwner();
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request(
        "http://x.test/api/hotel/reservations?arrivalFrom=2027-07-22&arrivalTo=2027-07-20",
      ),
    });
    expect((await res.json()).error).toBe("invalid_date_filter");
  });
  it("rejects unknown bookingSource", async () => {
    await seedOwner();
    const { handleListReservations } = await import("@/routes/api/hotel/reservations");
    const res = await handleListReservations({
      request: new Request("http://x.test/api/hotel/reservations?bookingSource=airbnb"),
    });
    expect((await res.json()).error).toBe("invalid_booking_source");
  });
});

// ================================================================
// Static safety checks (files, imports, navigation)
// ================================================================
function rg(pat: string): string {
  try {
    return execFileSync(
      "rg",
      [
        "-n",
        "--no-heading",
        "--glob",
        "!**/__tests__/**",
        "--glob",
        "!**/*.test.ts",
        "--glob",
        "!**/*.test.tsx",
        pat,
        "src",
      ],
      { encoding: "utf8" },
    );
  } catch (err) {
    const e = err as { status?: number };
    if (e.status === 1) return "";
    throw err;
  }
}

describe("Milestone 1.1.2 — static safety", () => {
  it("deleted browser-auth files remain deleted", () => {
    expect(existsSync("src/integrations/supabase/auth-attacher.ts")).toBe(false);
    expect(existsSync("src/integrations/supabase/auth-middleware.ts")).toBe(false);
    expect(existsSync("src/integrations/supabase/client.ts")).toBe(false);
  });

  it("src/start.ts remains N3-only (functionMiddleware: [])", () => {
    const s = readFileSync("src/start.ts", "utf8");
    expect(s).toMatch(/functionMiddleware:\s*\[\s*\]/);
    expect(s).not.toMatch(/attachSupabaseAuth/);
  });

  it("no browser code imports Supabase client or calls N3 hosts", () => {
    expect(rg("from [\"']@/integrations/supabase/client[\"']")).toBe("");
    // No non-server module may reference the N3 host directly.
    let browserHits = "";
    try {
      browserHits = execFileSync(
        "rg",
        [
          "-l",
          "openapi.account.qne.cloud",
          "--glob",
          "!**/*.server.ts",
          "--glob",
          "!src/routes/api/**",
          "--glob",
          "!**/__tests__/**",
          "src",
        ],
        { encoding: "utf8" },
      ).trim();
    } catch (err) {
      const e = err as { status?: number };
      if (e.status !== 1) throw err;
    }
    expect(browserHits).toBe("");
  });

  it("AppShell enables Reservations with hotel:reservations:view and matches sub-paths", () => {
    const s = readFileSync("src/components/AppShell.tsx", "utf8");
    // Reservations is a real link with the correct permission
    expect(s).toMatch(/to:\s*"\/reservations"[^}]*permission:\s*"hotel:reservations:view"/s);
    // matchPrefix drives active state on /reservations, /reservations/new, /reservations/$id
    expect(s).toMatch(/matchPrefix:\s*"\/reservations"/);
    // Other deferred items remain disabled
    for (const label of ["Guests", "Housekeeping", "Folios & AR", "Reports"]) {
      const re = new RegExp(
        `label:\\s*"${label.replace(/[&]/g, "\\$&")}"[^}]*disabled:\\s*true`,
        "s",
      );
      expect(s).toMatch(re);
    }
    // Reservations must NOT be listed as disabled/soon
    expect(s).not.toMatch(/label:\s*"Reservations"[^}]*disabled:\s*true/s);
  });

  it("reservation route files exist for /reservations, /new, /$id", () => {
    expect(existsSync("src/routes/reservations.index.tsx")).toBe(true);
    expect(existsSync("src/routes/reservations.new.tsx")).toBe(true);
    expect(existsSync("src/routes/reservations.$id.tsx")).toBe(true);
  });

  it("no reservation route calls fetch without credentials: same-origin", () => {
    const files = [
      "src/routes/reservations.index.tsx",
      "src/routes/reservations.new.tsx",
      "src/routes/reservations.$id.tsx",
      "src/lib/reservations-client.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // If fetch appears in the file, credentials: "same-origin" must too.
      if (/\bfetch\s*\(/.test(src)) {
        expect(src).toMatch(/credentials:\s*["']same-origin["']/);
      }
    }
  });

  it("reservations-client tenant-aware keys include tenantId", async () => {
    const { reservationsListKey, reservationDetailKey, availabilityKey } =
      await import("@/lib/reservations-client");
    expect(reservationsListKey("t-1", new URLSearchParams("limit=25"))).toEqual([
      "reservations",
      "list",
      "t-1",
      "limit=25",
    ]);
    expect(reservationDetailKey("t-1", "abc")).toEqual(["reservations", "detail", "t-1", "abc"]);
    expect(availabilityKey("t-1", "2027-07-20", "2027-07-22")).toEqual([
      "reservations",
      "availability",
      "t-1",
      "2027-07-20",
      "2027-07-22",
    ]);
  });
});
