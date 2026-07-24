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

/**
 * Strict `YYYY-MM-DD` calendar validator.
 *
 * `Date.parse("2026-02-31")` succeeds (rolls to March 3). We reject that
 * kind of silent rollover by re-serialising the parsed UTC date and
 * checking every component still matches the input. Leap years are handled
 * automatically because they follow standard UTC calendar rules.
 */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ISO_DATE_RE.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export type CreateReservationInput = {
  tenantId: string;
  createdByN3UserKey: string;
  bookingSource: string;
  arrivalDate: string;
  departureDate: string;
  notes: string | null;
  externalBookingReference?: string | null;
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
    identityType?: string | null;
    identityNumber?: string | null;
    nationalityCode?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    addressLine3?: string | null;
    city?: string | null;
    postcode?: string | null;
    countryCode?: string | null;
    stateCode?: string | null;
    stateProvince?: string | null;
  }>;
};

export type CreateReservationResult = {
  reservationId: string;
  bookingReference: string;
  status: "confirmed";
};

export const RESERVATION_ERROR_CODES = new Set([
  "invalid_stay_dates",
  "arrival_date_in_past",
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
  "identity_pair_required",
  "invalid_identity_type",
  "invalid_identity_number",
]);

export class ReservationCreateError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ReservationCreateError";
  }
}

export class ReservationReadError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ReservationReadError";
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
    p_external_booking_reference: input.externalBookingReference ?? null,
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
      identity_type: g.identityType ?? null,
      identity_number: g.identityNumber ?? null,
      nationality_code: g.nationalityCode ?? null,
      address_line_1: g.addressLine1 ?? null,
      address_line_2: g.addressLine2 ?? null,
      address_line_3: g.addressLine3 ?? null,
      city: g.city ?? null,
      postcode: g.postcode ?? null,
      country_code: g.countryCode ?? null,
      state_code: g.stateCode ?? null,
      state_province: g.stateProvince ?? null,
    })),
  };
  const res = await sb.rpc("hotelhub_create_reservation", rpcArgs);
  if (res.error) {
    const msg = (res.error.message ?? "").toString();
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
  displayName: string | null;
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
  const settingsRes = await sb
    .from("hotel_settings")
    .select("currency")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  const currency = (settingsRes?.data as { currency?: string } | null)?.currency ?? "MYR";

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
  guestMobile?: string;
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

  // Guest search resolves ALL matching reservation IDs first (across the
  // full authenticated-tenant dataset, matching primary OR non-primary
  // guests), then reservation pagination is applied to that filtered set.
  // Never page reservations first and filter guests inside the page.
  let restrictIds: string[] | null = null;
  const guestNeedle = input.guestName?.trim() ?? "";
  const mobileNeedle = input.guestMobile?.trim() ?? "";
  if (guestNeedle || mobileNeedle) {
    let gq = sb.from("hotel_guests").select("id").eq("tenant_id", input.tenantId);
    if (guestNeedle)
      gq = gq.ilike("full_name", `%${guestNeedle.replace(/[%_]/g, "")}%`);
    if (mobileNeedle)
      gq = gq.ilike("mobile", `%${mobileNeedle.replace(/[%_]/g, "")}%`);
    const g = await gq;
    if (g.error) throw new ReservationReadError(`guest search failed: ${g.error.message}`);
    const guestIds = ((g.data ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (guestIds.length === 0) return { items: [], total: 0 };
    const link = await sb
      .from("hotel_reservation_guests")
      .select("reservation_id")
      .eq("tenant_id", input.tenantId)
      .in("guest_id", guestIds);
    if (link.error) throw new ReservationReadError(`guest link failed: ${link.error.message}`);
    restrictIds = Array.from(
      new Set(
        ((link.data ?? []) as Array<{ reservation_id: string }>).map((r) => r.reservation_id),
      ),
    );
    if (restrictIds.length === 0) return { items: [], total: 0 };
  }


  let q = sb
    .from("hotel_reservations")
    .select(
      "id, booking_reference, booking_source, status, arrival_date, departure_date, created_at, created_by_n3_user_key",
      { count: "exact" },
    )
    .eq("tenant_id", input.tenantId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (restrictIds) q = q.in("id", restrictIds);
  if (input.bookingReference)
    q = q.ilike("booking_reference", `%${input.bookingReference.replace(/[%_]/g, "")}%`);
  if (input.status) q = q.eq("status", input.status);
  if (input.bookingSource) q = q.eq("booking_source", input.bookingSource);
  if (input.arrivalFrom) q = q.gte("arrival_date", input.arrivalFrom);
  if (input.arrivalTo) q = q.lte("arrival_date", input.arrivalTo);

  q = q.range(offset, offset + limit - 1);
  const res = await q;
  if (res.error) throw new ReservationReadError(`reservations list failed: ${res.error.message}`);
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
    if (rgRes.error)
      throw new ReservationReadError(`reservation guests failed: ${rgRes.error.message}`);
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
    if (rrRes.error)
      throw new ReservationReadError(`reservation rooms failed: ${rrRes.error.message}`);
    for (const r of (rrRes.data ?? []) as Array<{ reservation_id: string }>) {
      roomCounts.set(r.reservation_id, (roomCounts.get(r.reservation_id) ?? 0) + 1);
    }
  }

  const items = rows.map((r) => ({
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

  return { items, total: (res.count as number) ?? items.length };
}

/** Mask an identity number for display; keep the last 4 chars only. */
export function maskIdentityNumberServer(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v);
  if (s.length === 0) return null;
  if (s.length <= 4) return "•".repeat(Math.max(s.length, 1));
  return "•".repeat(s.length - 4) + s.slice(-4);
}

export type ReservationDetail = {
  id: string;
  bookingReference: string;
  bookingSource: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  currency: string;
  notes: string | null;
  externalBookingReference: string | null;
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
    nationality: string | null; // legacy fallback
    nationalityCode: string | null;
    identityType: string | null;
    /** ALWAYS masked; raw values never leave the server. */
    identityNumberMasked: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    addressLine3: string | null;
    city: string | null;
    postcode: string | null;
    countryCode: string | null;
    stateCode: string | null;
    stateProvince: string | null;
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
      "id, booking_reference, booking_source, status, arrival_date, departure_date, currency, notes, external_booking_reference, created_at, created_by_n3_user_key",
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (head.error) throw new ReservationReadError(`reservation read failed: ${head.error.message}`);
  if (!head.data) return null;
  const r = head.data as any;
  const rooms = await sb
    .from("hotel_reservation_rooms")
    .select(
      "id, hotel_room_id, base_rate_snapshot, agreed_rate, adults, children, allocation_status, rate_override_reason, hotel_rooms(room_number)",
    )
    .eq("tenant_id", tenantId)
    .eq("reservation_id", id);
  if (rooms.error)
    throw new ReservationReadError(`reservation rooms failed: ${rooms.error.message}`);
  const guests = await sb
    .from("hotel_reservation_guests")
    .select(
      "id, guest_id, is_primary, hotel_guests(full_name, mobile, email, nationality, nationality_code, identity_type, identity_number, address_line_1, address_line_2, address_line_3, city, postcode, country_code, state_code, state_province)",
    )
    .eq("tenant_id", tenantId)
    .eq("reservation_id", id);
  if (guests.error)
    throw new ReservationReadError(`reservation guests failed: ${guests.error.message}`);
  const roomRows = (rooms.data ?? []) as any[];
  const guestRows = (guests.data ?? []) as any[];
  return {
    id: r.id,
    bookingReference: r.booking_reference,
    bookingSource: r.booking_source,
    status: r.status,
    arrivalDate: r.arrival_date,
    departureDate: r.departure_date,
    currency: r.currency,
    notes: r.notes,
    externalBookingReference: r.external_booking_reference ?? null,
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
        nationalityCode: nested?.nationality_code ?? null,
        identityType: nested?.identity_type ?? null,
        identityNumberMasked: maskIdentityNumberServer(nested?.identity_number ?? null),
        addressLine1: nested?.address_line_1 ?? null,
        addressLine2: nested?.address_line_2 ?? null,
        addressLine3: nested?.address_line_3 ?? null,
        city: nested?.city ?? null,
        postcode: nested?.postcode ?? null,
        countryCode: nested?.country_code ?? null,
        stateCode: nested?.state_code ?? null,
        stateProvince: nested?.state_province ?? null,
        isPrimary: !!row.is_primary,
      };
    }),
  };
}
