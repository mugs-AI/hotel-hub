/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only reservations store. All operations run under the service-role
// client and require an explicit tenantId supplied by the trusted server
// context (NEVER accepted from the browser).

export const BOOKING_SOURCES = [
  "walk_in",
  "phone",
  "whatsapp",
  "hotel_website",
  "agoda",
  "booking_com",
] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export function isBookingSource(v: unknown): v is BookingSource {
  return typeof v === "string" && (BOOKING_SOURCES as readonly string[]).includes(v);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE_RE.test(v)) return false;
  const t = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(t);
}

export type CreateReservationInput = {
  tenantId: string;
  createdByN3UserKey: string;
  bookingSource: BookingSource;
  arrivalDate: string; // ISO yyyy-mm-dd
  departureDate: string;
  notes: string | null;
  rooms: Array<{
    hotelRoomId: string;
    agreedRate: number;
    adults: number;
    children: number;
    rateOverrideReason?: string | null;
  }>;
  guests: Array<{
    fullName: string;
    mobile?: string | null;
    email?: string | null;
    nationality?: string | null;
    notes?: string | null;
    isPrimary: boolean;
  }>;
};

export type CreateReservationResult = {
  reservationId: string;
  bookingReference: string;
  status: "confirmed";
};

// Stable safe error codes surfaced to the API. The RPC raises these via
// MESSAGE=<code>; anything else collapses to `reservation_create_failed`.
export const RESERVATION_ERROR_CODES = new Set([
  "invalid_stay_dates",
  "invalid_booking_source",
  "setup_incomplete",
  "room_required",
  "guest_required",
  "primary_guest_required",
  "multiple_primary_guests",
  "duplicate_room",
  "room_not_found",
  "room_inactive",
  "occupancy_exceeded",
  "invalid_occupancy",
  "invalid_rate",
  "rate_override_reason_required",
  "room_not_available",
  "guest_full_name_required",
  "tenant_required",
  "creator_required",
]);

export class ReservationCreateError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ReservationCreateError";
  }
}

async function admin() {
  const { supabaseAdmin: _sa } = await import("@/integrations/supabase/client.server");
  return _sa as unknown as { from: (t: string) => any; rpc: (n: string, args: any) => any };
}

export async function createReservationAtomic(
  input: CreateReservationInput,
): Promise<CreateReservationResult> {
  const sb = await admin();
  const rpcArgs = {
    p_tenant_id: input.tenantId,
    p_created_by_n3_user_key: input.createdByN3UserKey,
    p_booking_source: input.bookingSource,
    p_arrival_date: input.arrivalDate,
    p_departure_date: input.departureDate,
    p_notes: input.notes,
    p_rooms: input.rooms.map((r) => ({
      hotel_room_id: r.hotelRoomId,
      agreed_rate: r.agreedRate,
      adults: r.adults,
      children: r.children,
      rate_override_reason: r.rateOverrideReason ?? null,
    })),
    p_guests: input.guests.map((g) => ({
      full_name: g.fullName,
      mobile: g.mobile ?? null,
      email: g.email ?? null,
      nationality: g.nationality ?? null,
      notes: g.notes ?? null,
      is_primary: g.isPrimary,
    })),
  };
  const res = await sb.rpc("hotelhub_create_reservation", rpcArgs);
  if (res.error) {
    const msg = (res.error.message ?? "").toString();
    // The RPC raises with MESSAGE=<stable code>. Extract exactly that code
    // and never leak SQL, stack traces or Postgres details.
    const match = msg.match(/[a-z_]+/g)?.find((w: string) => RESERVATION_ERROR_CODES.has(w));
    throw new ReservationCreateError(match ?? "reservation_create_failed");
  }
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row?.out_reservation_id) throw new ReservationCreateError("reservation_create_failed");
  return {
    reservationId: row.out_reservation_id,
    bookingReference: row.out_booking_reference,
    status: "confirmed",
  };
}

export type AvailabilityRoom = {
  hotelRoomId: string;
  roomNumber: string;
  n3StockCode: string;
  n3StockName: string | null;
  roomType: string;
  floor: string | null;
  maxOccupancy: number;
  baseRate: number;
  currency: string;
  isActive: boolean;
};

export async function checkAvailability(input: {
  tenantId: string;
  arrival: string;
  departure: string;
  adults?: number | null;
  children?: number | null;
}): Promise<AvailabilityRoom[]> {
  const sb = await admin();
  // Currency from settings (already provisioned per tenant on first read).
  const settingsRes = await sb
    .from("hotel_settings")
    .select("currency")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  const currency = (settingsRes?.data as { currency?: string } | null)?.currency ?? "MYR";

  // Active rooms for the tenant.
  const roomsRes = await sb
    .from("hotel_rooms")
    .select(
      "id, tenant_id, room_number, n3_stock_code, n3_stock_name, room_type, floor, max_occupancy, base_rate, is_active",
    )
    .eq("tenant_id", input.tenantId)
    .eq("is_active", true);
  if (roomsRes.error) throw new Error(`rooms read failed: ${roomsRes.error.message}`);
  const rooms = (roomsRes.data ?? []) as Array<{
    id: string;
    room_number: string;
    n3_stock_code: string;
    n3_stock_name: string | null;
    room_type: string;
    floor: string | null;
    max_occupancy: number;
    base_rate: string | number;
    is_active: boolean;
  }>;
  if (rooms.length === 0) return [];

  // Blocking allocations overlapping [arrival, departure).
  const roomIds = rooms.map((r) => r.id);
  const allocRes = await sb
    .from("hotel_reservation_rooms")
    .select("hotel_room_id, arrival_date, departure_date, allocation_status")
    .eq("tenant_id", input.tenantId)
    .in("hotel_room_id", roomIds)
    .in("allocation_status", ["reserved", "occupied"])
    .lt("arrival_date", input.departure)
    .gt("departure_date", input.arrival);
  if (allocRes.error) throw new Error(`allocations read failed: ${allocRes.error.message}`);
  const blocked = new Set<string>(
    ((allocRes.data ?? []) as Array<{ hotel_room_id: string }>).map((r) => r.hotel_room_id),
  );

  const needed = Math.max(0, input.adults ?? 0) + Math.max(0, input.children ?? 0);
  return rooms
    .filter((r) => !blocked.has(r.id))
    .filter((r) => needed === 0 || r.max_occupancy >= needed)
    .map((r) => ({
      hotelRoomId: r.id,
      roomNumber: r.room_number,
      n3StockCode: r.n3_stock_code,
      n3StockName: r.n3_stock_name,
      roomType: r.room_type,
      floor: r.floor,
      maxOccupancy: r.max_occupancy,
      baseRate: typeof r.base_rate === "string" ? Number(r.base_rate) : r.base_rate,
      currency,
      isActive: r.is_active,
    }));
}

export type ReservationSummary = {
  id: string;
  bookingReference: string;
  primaryGuestName: string | null;
  bookingSource: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  roomCount: number;
  guestCount: number;
  createdAt: string;
  createdByN3UserKey: string;
};

export async function listReservations(input: {
  tenantId: string;
  bookingReference?: string;
  guestName?: string;
  status?: string;
  arrivalFrom?: string;
  arrivalTo?: string;
  bookingSource?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ReservationSummary[]; total: number }> {
  const sb = await admin();
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);

  let q = sb
    .from("hotel_reservations")
    .select(
      "id, booking_reference, booking_source, status, arrival_date, departure_date, created_at, created_by_n3_user_key",
      { count: "exact" },
    )
    .eq("tenant_id", input.tenantId)
    .order("created_at", { ascending: false });

  if (input.bookingReference)
    q = q.ilike("booking_reference", `%${input.bookingReference.replace(/[%_]/g, "")}%`);
  if (input.status) q = q.eq("status", input.status);
  if (input.bookingSource) q = q.eq("booking_source", input.bookingSource);
  if (input.arrivalFrom) q = q.gte("arrival_date", input.arrivalFrom);
  if (input.arrivalTo) q = q.lte("arrival_date", input.arrivalTo);

  q = q.range(offset, offset + limit - 1);
  const res = await q;
  if (res.error) throw new Error(`reservations list failed: ${res.error.message}`);
  const rows = (res.data ?? []) as Array<{
    id: string;
    booking_reference: string;
    booking_source: string;
    status: string;
    arrival_date: string;
    departure_date: string;
    created_at: string;
    created_by_n3_user_key: string;
  }>;
  const ids = rows.map((r) => r.id);
  const primaries = new Map<string, string>();
  const roomCounts = new Map<string, number>();
  const guestCounts = new Map<string, number>();

  if (ids.length > 0) {
    const rgRes = await sb
      .from("hotel_reservation_guests")
      .select("reservation_id, is_primary, guest_id, hotel_guests(full_name)")
      .eq("tenant_id", input.tenantId)
      .in("reservation_id", ids);
    if (rgRes.error) throw new Error(`reservation guests failed: ${rgRes.error.message}`);
    for (const g of (rgRes.data ?? []) as Array<{
      reservation_id: string;
      is_primary: boolean;
      hotel_guests?: { full_name?: string } | Array<{ full_name?: string }>;
    }>) {
      guestCounts.set(g.reservation_id, (guestCounts.get(g.reservation_id) ?? 0) + 1);
      if (g.is_primary) {
        const nested = Array.isArray(g.hotel_guests) ? g.hotel_guests[0] : g.hotel_guests;
        primaries.set(g.reservation_id, nested?.full_name ?? "");
      }
    }
    const rrRes = await sb
      .from("hotel_reservation_rooms")
      .select("reservation_id")
      .eq("tenant_id", input.tenantId)
      .in("reservation_id", ids);
    if (rrRes.error) throw new Error(`reservation rooms failed: ${rrRes.error.message}`);
    for (const r of (rrRes.data ?? []) as Array<{ reservation_id: string }>) {
      roomCounts.set(r.reservation_id, (roomCounts.get(r.reservation_id) ?? 0) + 1);
    }
  }

  let items = rows.map((r) => ({
    id: r.id,
    bookingReference: r.booking_reference,
    primaryGuestName: primaries.get(r.id) ?? null,
    bookingSource: r.booking_source,
    status: r.status,
    arrivalDate: r.arrival_date,
    departureDate: r.departure_date,
    roomCount: roomCounts.get(r.id) ?? 0,
    guestCount: guestCounts.get(r.id) ?? 0,
    createdAt: r.created_at,
    createdByN3UserKey: r.created_by_n3_user_key,
  }));

  if (input.guestName) {
    const q2 = input.guestName.trim().toLowerCase();
    items = items.filter((i) => (i.primaryGuestName ?? "").toLowerCase().includes(q2));
  }

  return { items, total: (res.count as number) ?? items.length };
}

export type ReservationDetail = {
  id: string;
  tenantId: string;
  bookingReference: string;
  bookingSource: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  currency: string;
  notes: string | null;
  createdAt: string;
  createdByN3UserKey: string;
  rooms: Array<{
    id: string;
    hotelRoomId: string;
    roomNumber: string;
    baseRateSnapshot: number;
    agreedRate: number;
    adults: number;
    children: number;
    allocationStatus: string;
    rateOverrideReason: string | null;
  }>;
  guests: Array<{
    id: string;
    guestId: string;
    fullName: string;
    mobile: string | null;
    email: string | null;
    nationality: string | null;
    isPrimary: boolean;
  }>;
};

export async function getReservationById(
  tenantId: string,
  id: string,
): Promise<ReservationDetail | null> {
  const sb = await admin();
  const head = await sb
    .from("hotel_reservations")
    .select(
      "id, tenant_id, booking_reference, booking_source, status, arrival_date, departure_date, currency, notes, created_at, created_by_n3_user_key",
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (head.error) throw new Error(`reservation read failed: ${head.error.message}`);
  if (!head.data) return null;
  const r = head.data as any;
  const rooms = await sb
    .from("hotel_reservation_rooms")
    .select(
      "id, hotel_room_id, base_rate_snapshot, agreed_rate, adults, children, allocation_status, rate_override_reason, hotel_rooms(room_number)",
    )
    .eq("tenant_id", tenantId)
    .eq("reservation_id", id);
  const guests = await sb
    .from("hotel_reservation_guests")
    .select("id, guest_id, is_primary, hotel_guests(full_name, mobile, email, nationality)")
    .eq("tenant_id", tenantId)
    .eq("reservation_id", id);
  const roomRows = (rooms.data ?? []) as any[];
  const guestRows = (guests.data ?? []) as any[];
  return {
    id: r.id,
    tenantId: r.tenant_id,
    bookingReference: r.booking_reference,
    bookingSource: r.booking_source,
    status: r.status,
    arrivalDate: r.arrival_date,
    departureDate: r.departure_date,
    currency: r.currency,
    notes: r.notes,
    createdAt: r.created_at,
    createdByN3UserKey: r.created_by_n3_user_key,
    rooms: roomRows.map((row) => {
      const nested = Array.isArray(row.hotel_rooms) ? row.hotel_rooms[0] : row.hotel_rooms;
      return {
        id: row.id,
        hotelRoomId: row.hotel_room_id,
        roomNumber: nested?.room_number ?? "",
        baseRateSnapshot:
          typeof row.base_rate_snapshot === "string"
            ? Number(row.base_rate_snapshot)
            : row.base_rate_snapshot,
        agreedRate: typeof row.agreed_rate === "string" ? Number(row.agreed_rate) : row.agreed_rate,
        adults: row.adults,
        children: row.children,
        allocationStatus: row.allocation_status,
        rateOverrideReason: row.rate_override_reason,
      };
    }),
    guests: guestRows.map((row) => {
      const nested = Array.isArray(row.hotel_guests) ? row.hotel_guests[0] : row.hotel_guests;
      return {
        id: row.id,
        guestId: row.guest_id,
        fullName: nested?.full_name ?? "",
        mobile: nested?.mobile ?? null,
        email: nested?.email ?? null,
        nationality: nested?.nationality ?? null,
        isPrimary: !!row.is_primary,
      };
    }),
  };
}
