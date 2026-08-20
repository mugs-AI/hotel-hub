/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only reservations store. All operations run under the service-role
// client and require an explicit tenantId supplied by the trusted server
// context (NEVER accepted from the browser).
import { resolveActorLabels } from "./tenant-store.server";

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
    remark?: string | null;
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
  "room_remark_too_long",
  "guest_full_name_required",
  "tenant_required",
  "creator_required",
  "identity_pair_required",
  "invalid_identity_type",
  "invalid_identity_number",
  "guest_assignment_required",
  "guest_assignment_invalid_room",
  "room_capacity_exceeded",
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
      remark: r.remark ?? null,
    })),
    p_guests: input.guests.map((g) => ({
      full_name: g.fullName,
      mobile: g.mobile ?? null,
      email: g.email ?? null,
      nationality: g.nationality ?? null,
      notes: g.notes ?? null,
      is_primary: g.isPrimary,
      // P1-RES-ASSIGN-01 — the RPC resolves this to the new
      // hotel_reservation_rooms.id created in the same transaction.
      assigned_hotel_room_id: g.assignedHotelRoomId ?? null,
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

/**
 * Tenant-scoped room availability.
 *
 * `excludeReservationId` (Run 5D2.5 §7) supports the Edit flow: allocations
 * that belong to the reservation being edited do not block its own rooms.
 * Every other reservation's reserved/occupied overlap still blocks. The
 * caller must have already verified the reservation belongs to `tenantId`;
 * the allocation query is tenant-scoped regardless. The v2 update RPC
 * remains the atomic authority and rechecks overlaps on write.
 */
export async function checkAvailability(input: {
  tenantId: string;
  arrival: string;
  departure: string;
  adults?: number | null;
  children?: number | null;
  excludeReservationId?: string | null;
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
      "id, tenant_id, room_number, display_name, n3_stock_code, n3_stock_name, room_type, floor, max_occupancy, base_rate, is_active",
    )
    .eq("tenant_id", input.tenantId)
    .eq("is_active", true);
  if (roomsRes.error) throw new Error(`rooms read failed: ${roomsRes.error.message}`);
  const rooms = (roomsRes.data ?? []) as Array<{
    id: string;
    room_number: string;
    display_name: string | null;
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
  let allocQuery = sb
    .from("hotel_reservation_rooms")
    .select("hotel_room_id, arrival_date, departure_date, allocation_status")
    .eq("tenant_id", input.tenantId)
    .in("hotel_room_id", roomIds)
    .in("allocation_status", ["reserved", "occupied"])
    .lt("arrival_date", input.departure)
    .gt("departure_date", input.arrival);
  if (input.excludeReservationId) {
    // Edit flow: the reservation being edited must not block its own rooms.
    allocQuery = allocQuery.neq("reservation_id", input.excludeReservationId);
  }
  const allocRes = await allocQuery;
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
      displayName: r.display_name ?? null,
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
    if (guestNeedle) gq = gq.ilike("full_name", `%${guestNeedle.replace(/[%_]/g, "")}%`);
    if (mobileNeedle) gq = gq.ilike("mobile", `%${mobileNeedle.replace(/[%_]/g, "")}%`);
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
  updatedAt: string;
  /**
   * Raw N3 user key. Server-internal — routes must NOT forward this to the
   * browser; use `createdByLabel` instead.
   */
  createdByN3UserKey: string;
  /**
   * Safe creator label resolved from the tenant staff directory, or `null`
   * when no real name/email exists. Never a raw or derived key.
   */
  createdByLabel: string | null;

  checkedInAt: string | null;
  checkedInByLabel: string | null;
  expectedCheckOutAt: string | null;

  rooms: Array<{
    id: string;
    hotelRoomId: string;
    roomNumber: string;
    displayName: string | null;
    n3StockName: string | null;
    baseRateSnapshot: number;
    agreedRate: number;
    adults: number;
    children: number;
    /** Real capacity from `hotel_rooms.max_occupancy` — never a UI guess. */
    maxOccupancy: number;
    allocationStatus: string;
    rateOverrideReason: string | null;
    remark: string | null;
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
    notes: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    addressLine3: string | null;
    city: string | null;
    postcode: string | null;
    countryCode: string | null;
    stateCode: string | null;
    stateProvince: string | null;
    isPrimary: boolean;
    /** Reservation-room this guest is assigned to, or null when unassigned. */
    assignedReservationRoomId: string | null;
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
      "id, booking_reference, booking_source, status, arrival_date, departure_date, currency, notes, external_booking_reference, created_at, updated_at, created_by_n3_user_key, checked_in_at, checked_in_by_n3_user_key, expected_check_out_at",
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
      "id, hotel_room_id, base_rate_snapshot, agreed_rate, adults, children, allocation_status, rate_override_reason, remark, hotel_rooms(room_number, display_name, n3_stock_name, max_occupancy)",
    )
    .eq("tenant_id", tenantId)
    .eq("reservation_id", id);
  if (rooms.error)
    throw new ReservationReadError(`reservation rooms failed: ${rooms.error.message}`);
  const guests = await sb
    .from("hotel_reservation_guests")
    .select(
      "id, guest_id, is_primary, reservation_room_id, hotel_guests(full_name, mobile, email, nationality, nationality_code, identity_type, identity_number, notes, address_line_1, address_line_2, address_line_3, city, postcode, country_code, state_code, state_province)",
    )
    .eq("tenant_id", tenantId)
    .eq("reservation_id", id);
  if (guests.error)
    throw new ReservationReadError(`reservation guests failed: ${guests.error.message}`);
  const roomRows = (rooms.data ?? []) as any[];
  const guestRows = (guests.data ?? []) as any[];
  const actorLabels = await resolveActorLabels(tenantId, [
    r.created_by_n3_user_key,
    r.checked_in_by_n3_user_key,
  ]);
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
    updatedAt: r.updated_at,
    createdByN3UserKey: r.created_by_n3_user_key,
    createdByLabel: actorLabels.get(r.created_by_n3_user_key) ?? null,
    checkedInAt: r.checked_in_at ?? null,
    checkedInByLabel: r.checked_in_by_n3_user_key
      ? (actorLabels.get(r.checked_in_by_n3_user_key) ?? null)
      : null,

    expectedCheckOutAt: r.expected_check_out_at ?? null,

    rooms: roomRows.map((row) => {
      const nested = Array.isArray(row.hotel_rooms) ? row.hotel_rooms[0] : row.hotel_rooms;
      return {
        id: row.id,
        hotelRoomId: row.hotel_room_id,
        roomNumber: nested?.room_number ?? "",
        displayName: nested?.display_name ?? null,
        n3StockName: nested?.n3_stock_name ?? null,
        baseRateSnapshot:
          typeof row.base_rate_snapshot === "string"
            ? Number(row.base_rate_snapshot)
            : row.base_rate_snapshot,
        agreedRate: typeof row.agreed_rate === "string" ? Number(row.agreed_rate) : row.agreed_rate,
        adults: row.adults,
        children: row.children,
        maxOccupancy:
          typeof nested?.max_occupancy === "number"
            ? nested.max_occupancy
            : Number(nested?.max_occupancy ?? 0),
        allocationStatus: row.allocation_status,

        rateOverrideReason: row.rate_override_reason,
        remark: row.remark ?? null,
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
        notes: nested?.notes ?? null,
        addressLine1: nested?.address_line_1 ?? null,
        addressLine2: nested?.address_line_2 ?? null,
        addressLine3: nested?.address_line_3 ?? null,
        city: nested?.city ?? null,
        postcode: nested?.postcode ?? null,
        countryCode: nested?.country_code ?? null,
        stateCode: nested?.state_code ?? null,
        stateProvince: nested?.state_province ?? null,
        isPrimary: !!row.is_primary,
        assignedReservationRoomId: row.reservation_room_id ?? null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Atomic update for a pre-check-in confirmed reservation.
// See migration hotelhub_update_reservation for the SQL contract.
// ---------------------------------------------------------------------------
export const RESERVATION_UPDATE_ERROR_CODES = new Set([
  "tenant_required",
  "creator_required",
  "invalid_stay_dates",
  "not_found",
  "reservation_not_editable",
  "stale_reservation",
  "invalid_booking_source",
  "room_remark_too_long",
  "room_not_found",
  "invalid_occupancy",
  "occupancy_exceeded",
  "invalid_rate",
  "rate_override_reason_required",
]);

export class ReservationUpdateError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ReservationUpdateError";
  }
}

export type UpdateReservationInput = {
  tenantId: string;
  reservationId: string;
  actorN3UserKey: string;
  expectedUpdatedAt: string;
  bookingSource: string;
  arrivalDate: string;
  departureDate: string;
  notes: string | null;
  externalBookingReference: string | null;
  rooms: Array<{
    id: string;
    agreedRate: number;
    adults: number;
    children: number;
    rateOverrideReason: string | null;
    remark: string | null;
  }>;
};

export async function updateReservationAtomic(
  input: UpdateReservationInput,
): Promise<{ reservationId: string; updatedAt: string }> {
  const sb = await admin();
  const res = await sb.rpc("hotelhub_update_reservation", {
    p_tenant_id: input.tenantId,
    p_reservation_id: input.reservationId,
    p_actor_n3_user_key: input.actorN3UserKey,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_booking_source: input.bookingSource,
    p_arrival_date: input.arrivalDate,
    p_departure_date: input.departureDate,
    p_notes: input.notes,
    p_external_booking_reference: input.externalBookingReference,
    p_rooms: input.rooms.map((r) => ({
      id: r.id,
      agreed_rate: r.agreedRate,
      adults: r.adults,
      children: r.children,
      rate_override_reason: r.rateOverrideReason ?? null,
      remark: r.remark ?? null,
    })),
  });
  if (res.error) {
    const msg = (res.error.message ?? "").toString();
    const match = msg.match(/[a-z_]+/g)?.find((w: string) => RESERVATION_UPDATE_ERROR_CODES.has(w));
    throw new ReservationUpdateError(match ?? "reservation_update_failed");
  }
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  return { reservationId: row.out_reservation_id, updatedAt: row.out_updated_at };
}

// ---------------------------------------------------------------------------
// Run 5D2.6 §4 — full reservation update bridge to
// `public.hotelhub_update_reservation_v2` (v2 ONLY).
//
// Tenant, actor N3 user key and actor role come exclusively from the trusted
// server session; the reservation ID from the validated URL; the fingerprint
// is generated server-side from the normalized payload. None of these may be
// supplied by the browser.
// ---------------------------------------------------------------------------
export const RESERVATION_FULL_UPDATE_ERROR_CODES = new Set([
  "invalid_request",
  "unauthorized",
  "idempotency_conflict",
  "stale_reservation",
  "reservation_not_found",
  "reservation_not_editable",
  "guest_edit_locked",
  "correction_reason_required",
  "correction_reason_too_long",
  "primary_guest_change_not_allowed",
  "invalid_stay_dates",
  "invalid_booking_source",
  "room_required",
  "room_not_found",
  "room_unavailable",
  "duplicate_room",
  "duplicate_client_key",
  "invalid_room",
  "invalid_occupancy",
  "room_capacity_exceeded",
  "room_remark_too_long",
  "invalid_rate",
  "rate_override_reason_required",
  "guest_required",
  "invalid_guest",
  "guest_not_found",
  "duplicate_guest",
  "primary_guest_required",
  "multiple_primary_guests",
  "guest_assignment_required",
  "invalid_identity_action",
  "identity_pair_required",
  "invalid_identity_type",
  "invalid_identity_number",
  "external_ref_too_long",
  "reservation_update_failed",
]);

export type UpdateReservationFullInput = {
  /** From the trusted server session — never the browser. */
  tenantId: string;
  /** From the validated URL. */
  reservationId: string;
  /** From the trusted server session — never the browser. */
  actorN3UserKey: string;
  /** From the trusted server session — never the browser. */
  actorRole: string;
  payload: import("./reservation-full-update").NormalizedFullUpdate;
};

export async function updateReservationFull(
  input: UpdateReservationFullInput,
): Promise<{ reservationId: string; updatedAt: string; replayed: boolean }> {
  const { fullUpdateFingerprint } = await import("./reservation-full-update-fingerprint.server");
  const p = input.payload;
  // Server-derived, keyed, identity-bound. The browser can never supply it.
  const fingerprint = fullUpdateFingerprint(input.reservationId, p);
  const sb = await admin();
  const res = await sb.rpc("hotelhub_update_reservation_v2", {
    p_tenant_id: input.tenantId,
    p_reservation_id: input.reservationId,
    p_actor_n3_user_key: input.actorN3UserKey,
    p_actor_role: input.actorRole,
    p_client_request_id: p.clientRequestId,
    p_fingerprint: fingerprint,
    p_expected_updated_at: p.expectedUpdatedAt,
    p_booking_source: p.bookingSource,
    p_arrival_date: p.arrivalDate,
    p_departure_date: p.departureDate,
    p_notes: p.notes,
    p_external_booking_reference: p.externalBookingReference,
    p_rooms: p.rooms.map((r) => ({
      client_key: r.clientKey,
      reservation_room_id: r.reservationRoomId,
      hotel_room_id: r.hotelRoomId,
      agreed_rate: r.agreedRate,
      adults: r.adults,
      children: r.children,
      rate_override_reason: r.rateOverrideReason,
      remark: r.remark,
    })),
    p_guests: p.guests.map((g) => ({
      client_key: g.clientKey,
      reservation_guest_id: g.reservationGuestId,
      full_name: g.fullName,
      mobile: g.mobile,
      email: g.email,
      notes: g.notes,
      nationality_code: g.nationalityCode,
      address_line_1: g.addressLine1,
      address_line_2: g.addressLine2,
      address_line_3: g.addressLine3,
      city: g.city,
      postcode: g.postcode,
      country_code: g.countryCode,
      state_code: g.stateCode,
      state_province: g.stateProvince,
      is_primary: g.isPrimary,
      assigned_room_client_key: g.assignedRoomClientKey,
      identity_action: g.identityAction,
      identity_type: g.identityType,
      identity_number: g.identityNumber,
    })),
    p_correction_reason: p.correctionReason,
  });
  if (res.error) {
    // Map to an allow-listed code only; the raw SQL message never escapes.
    const msg = (res.error.message ?? "").toString();
    const match = msg
      .match(/[a-z_]+/g)
      ?.find((w: string) => RESERVATION_FULL_UPDATE_ERROR_CODES.has(w));
    throw new ReservationUpdateError(match ?? "reservation_update_failed");
  }
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row?.out_reservation_id) throw new ReservationUpdateError("reservation_update_failed");
  return {
    reservationId: row.out_reservation_id,
    updatedAt: row.out_updated_at,
    replayed: !!row.out_replayed,
  };
}
