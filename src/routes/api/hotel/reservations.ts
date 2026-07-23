// GET  /api/hotel/reservations — Owner + Front Desk. Tenant-scoped list.
// POST /api/hotel/reservations — Owner + Front Desk. Atomic create.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import {
  createReservationAtomic,
  isIsoDate,
  isUuid,
  listReservations,
  ReservationCreateError,
  RESERVATION_ERROR_CODES,
} from "@/lib/reservations-store.server";
import { findBookingSourceByCode, isSourceCodeFormat } from "@/lib/booking-sources-store.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
/**
 * Strict boolean: accepts JSON booleans only. The previous
 * `Boolean("false")` coercion returned `true`. We now reject non-boolean
 * values with a stable error code so no client can smuggle in the primary
 * flag via `"false"` / `0` / `1` / `"true"`.
 */
function toStrictBoolean(v: unknown, def: boolean): boolean | null {
  if (v === undefined || v === null) return def;
  if (v === true || v === false) return v;
  return null;
}
function toStrictInt(v: unknown): number | null {
  if (typeof v !== "number") return null;
  if (!Number.isFinite(v) || !Number.isInteger(v)) return null;
  return v;
}

/** Strict pagination parser — see Milestone 1.1.2 Task 6. */
export function parsePagination(
  sp: URLSearchParams,
): { limit: number; offset: number } | "invalid" {
  const lRaw = sp.get("limit");
  const oRaw = sp.get("offset");
  let limit = 25;
  let offset = 0;
  if (lRaw !== null) {
    if (!/^\d+$/.test(lRaw)) return "invalid";
    const n = Number(lRaw);
    if (!Number.isInteger(n) || n < 1 || n > 100) return "invalid";
    limit = n;
  }
  if (oRaw !== null) {
    if (!/^\d+$/.test(oRaw)) return "invalid";
    const n = Number(oRaw);
    if (!Number.isInteger(n) || n < 0) return "invalid";
    offset = n;
  }
  return { limit, offset };
}

export async function handleListReservations({ request }: { request: Request }): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:reservations:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const url = new URL(request.url);
  const pag = parsePagination(url.searchParams);
  if (pag === "invalid") return deny(400, "invalid_pagination");
  const arrivalFrom = url.searchParams.get("arrivalFrom");
  const arrivalTo = url.searchParams.get("arrivalTo");
  if (arrivalFrom !== null && arrivalFrom !== "" && !isIsoDate(arrivalFrom))
    return deny(400, "invalid_date_filter");
  if (arrivalTo !== null && arrivalTo !== "" && !isIsoDate(arrivalTo))
    return deny(400, "invalid_date_filter");
  if (arrivalFrom && arrivalTo && arrivalFrom > arrivalTo) return deny(400, "invalid_date_filter");
  const bookingSource = url.searchParams.get("bookingSource");
  if (bookingSource !== null && bookingSource !== "") {
    if (!isSourceCodeFormat(bookingSource)) return deny(400, "invalid_booking_source");
    let found;
    try {
      found = await findBookingSourceByCode(ctx.session.tenantId!, bookingSource);
    } catch (err) {
      console.error(
        "[reservations.list] source lookup failed",
        (err as Error).message?.slice(0, 200),
      );
      return deny(500, "reservations_list_failed");
    }
    if (!found) return deny(400, "invalid_booking_source");
  }
  try {
    const result = await listReservations({
      tenantId: ctx.session.tenantId!,
      bookingReference: url.searchParams.get("bookingReference") ?? undefined,
      guestName: url.searchParams.get("guestName") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      bookingSource: bookingSource ?? undefined,
      arrivalFrom: arrivalFrom ?? undefined,
      arrivalTo: arrivalTo ?? undefined,
      limit: pag.limit,
      offset: pag.offset,
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[reservations.list] failed", (err as Error).message?.slice(0, 200));
    return deny(500, "reservations_list_failed");
  }
}

// (Tenant-configurable booking sources are validated per request against
// the tenant's `hotel_booking_sources` rows — there is no hardcoded list.)

type IncomingRoom = Record<string, unknown>;
type IncomingGuest = Record<string, unknown>;

export async function handleCreateReservation({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:reservations:create");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return deny(400, "invalid_json");
  }
  if (!isPlainObject(parsed)) return deny(400, "invalid_body");
  const body = parsed as Record<string, unknown>;

  const source = body.bookingSource ?? body.booking_source;
  // Format-shape check only. The authoritative check happens against the
  // tenant's `hotel_booking_sources` rows just before the RPC call.
  if (typeof source !== "string" || !isSourceCodeFormat(source))
    return deny(400, "invalid_booking_source");
  const arrival = body.arrivalDate ?? body.arrival_date;
  const departure = body.departureDate ?? body.departure_date;
  if (!isIsoDate(arrival) || !isIsoDate(departure) || departure <= arrival) {
    return deny(400, "invalid_stay_dates");
  }
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

  // External booking reference — optional; trimmed; max 100 chars.
  const extRaw = body.externalBookingReference ?? body.external_booking_reference;
  let externalBookingReference: string | null = null;
  if (extRaw !== undefined && extRaw !== null && extRaw !== "") {
    if (typeof extRaw !== "string") return deny(400, "invalid_external_reference");
    const t = extRaw.trim();
    if (t.length > 100) return deny(400, "external_ref_too_long");
    externalBookingReference = t || null;
  }

  const roomsRaw = Array.isArray(body.rooms) ? (body.rooms as IncomingRoom[]) : [];
  const guestsRaw = Array.isArray(body.guests) ? (body.guests as IncomingGuest[]) : [];
  if (roomsRaw.length === 0) return deny(400, "room_required");
  if (guestsRaw.length === 0) return deny(400, "guest_required");

  const rooms: Parameters<typeof createReservationAtomic>[0]["rooms"] = [];
  for (const r of roomsRaw) {
    if (!isPlainObject(r)) return deny(400, "invalid_room");
    const hotelRoomId = (r.hotelRoomId ?? r.hotel_room_id) as unknown;
    if (!isUuid(hotelRoomId)) return deny(400, "invalid_room_id");
    const agreed = r.agreedRate ?? r.agreed_rate;
    if (typeof agreed !== "number" || !Number.isFinite(agreed) || agreed < 0)
      return deny(400, "invalid_rate");
    const adults = toStrictInt(r.adults);
    if (adults === null || adults < 1) return deny(400, "invalid_occupancy");
    const childrenRaw = r.children ?? 0;
    const children = toStrictInt(childrenRaw);
    if (children === null || children < 0) return deny(400, "invalid_occupancy");
    const reasonRaw = r.rateOverrideReason ?? r.rate_override_reason;
    const reason = typeof reasonRaw === "string" ? reasonRaw.trim() || null : null;
    rooms.push({
      hotelRoomId,
      agreedRate: agreed,
      adults,
      children,
      rateOverrideReason: reason,
    });
  }

  const guests: Parameters<typeof createReservationAtomic>[0]["guests"] = [];
  for (const g of guestsRaw) {
    if (!isPlainObject(g)) return deny(400, "invalid_guest");
    const fullNameRaw = g.fullName ?? g.full_name;
    if (typeof fullNameRaw !== "string" || fullNameRaw.trim().length === 0)
      return deny(400, "guest_full_name_required");
    const primary = toStrictBoolean(g.isPrimary ?? g.is_primary, false);
    if (primary === null) return deny(400, "invalid_primary_flag");

    // ---- Independent server-side validation of the extended guest fields.
    // Never accept legacy `nationality` for a NEW guest — it is read-only.
    const nationalityCode = normStr(g.nationalityCode ?? g.nationality_code);
    if (nationalityCode !== null && !ALPHA3_RE.test(nationalityCode))
      return deny(400, "invalid_nationality");

    const identityType = normStr(g.identityType ?? g.identity_type);
    const identityNumberRaw = normStr(g.identityNumber ?? g.identity_number);
    if ((identityType === null) !== (identityNumberRaw === null))
      return deny(400, "identity_pair_required");
    let identityNumber: string | null = identityNumberRaw;
    if (identityType !== null) {
      if (!IDENTITY_TYPES.has(identityType)) return deny(400, "invalid_identity_type");
      if (identityType === "mykad" || identityType === "mypr") {
        const digits = (identityNumberRaw ?? "").replace(/[\s-]/g, "");
        if (!/^\d{12}$/.test(digits)) return deny(400, "invalid_identity_number");
        identityNumber = digits;
      } else {
        if (!identityNumberRaw || identityNumberRaw.length > 50)
          return deny(400, "invalid_identity_number");
      }
    }

    const countryCode = normStr(g.countryCode ?? g.country_code);
    if (countryCode !== null && !ALPHA3_RE.test(countryCode))
      return deny(400, "invalid_address_country");

    let stateCode = normStr(g.stateCode ?? g.state_code);
    let stateProvince = normStr(g.stateProvince ?? g.state_province);
    if (countryCode === "MYS") {
      // Ignore any stray stateProvince for Malaysian addresses.
      stateProvince = null;
      if (stateCode !== null && !/^\d{2}$/.test(stateCode))
        return deny(400, "invalid_state");
    } else {
      // Non-Malaysian: ignore any stray stateCode.
      stateCode = null;
    }

    guests.push({
      fullName: fullNameRaw.trim(),
      mobile: typeof g.mobile === "string" ? g.mobile.trim() || null : null,
      email: typeof g.email === "string" ? g.email.trim() || null : null,
      nationality: null,
      notes: typeof g.notes === "string" ? g.notes.trim() || null : null,
      isPrimary: primary,
      identityType,
      identityNumber,
      nationalityCode,
      addressLine1: normStr(g.addressLine1 ?? g.address_line_1),
      addressLine2: normStr(g.addressLine2 ?? g.address_line_2),
      addressLine3: normStr(g.addressLine3 ?? g.address_line_3),
      city: normStr(g.city),
      postcode: normStr(g.postcode),
      countryCode,
      stateCode,
      stateProvince,
    });
  }
  const primaryCount = guests.filter((g) => g.isPrimary).length;
  if (primaryCount === 0) return deny(400, "primary_guest_required");
  if (primaryCount > 1) return deny(400, "multiple_primary_guests");


  // Authoritative booking-source check: must exist for this tenant AND be active.
  let sourceRow;
  try {
    sourceRow = await findBookingSourceByCode(ctx.session.tenantId!, source);
  } catch (err) {
    console.error(
      "[reservations.create] source lookup failed",
      (err as Error).message?.slice(0, 200),
    );
    return deny(500, "reservation_create_failed");
  }
  if (!sourceRow || !sourceRow.isActive) return deny(400, "invalid_booking_source");

  try {
    const result = await createReservationAtomic({
      tenantId: ctx.session.tenantId!,
      createdByN3UserKey: ctx.session.n3UserKey,
      bookingSource: source,
      arrivalDate: arrival,
      departureDate: departure,
      notes,
      rooms,
      guests,
    });
    // NOTE: success audits (`hotel.reservation.created` and
    // `hotel.reservation.rate_overridden`) are written atomically inside
    // the RPC transaction so they can never disagree with the reservation.
    // Only failure auditing is done here — a failure audit inserted inside
    // the failed transaction would roll back with it.
    return Response.json(
      {
        reservationId: result.reservationId,
        bookingReference: result.bookingReference,
        status: result.status,
        arrivalDate: arrival,
        departureDate: departure,
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const code =
      err instanceof ReservationCreateError && RESERVATION_ERROR_CODES.has(err.code)
        ? err.code
        : "reservation_create_failed";
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.reservation.create_failed",
      detail: { code, arrival, departure, source },
    });
    const status =
      code === "room_not_available"
        ? 409
        : code === "setup_incomplete"
          ? 409
          : code === "reservation_create_failed"
            ? 500
            : 400;
    return deny(status, code);
  }
}

export const Route = createFileRoute("/api/hotel/reservations")({
  server: {
    handlers: {
      GET: handleListReservations,
      POST: handleCreateReservation,
    },
  },
});
