// GET  /api/hotel/reservations — Owner + Front Desk. Tenant-scoped list.
// POST /api/hotel/reservations — Owner + Front Desk. Atomic create.
//
// The POST body is validated with a **strict allow-list**: only the exact
// camelCase fields below are accepted; snake_case aliases and every
// server-controlled field (tenantId, n3Token, n3UserKey, role,
// bookingReference, status, createdAt, audit, raw identity) are rejected
// with the stable `unknown_field` code.
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
import { isValidCountryCode, normalizeCountryCode } from "@/lib/iso-countries";
import { isValidMalaysianStateCode } from "@/lib/malaysia-states";
import { logAudit } from "@/lib/audit.server";
import { todayInKualaLumpurIso } from "@/lib/malaysia-date";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function toStrictBoolean(v: unknown, def: boolean): boolean | null {
  if (v === undefined) return def;
  if (v === true || v === false) return v;
  return null;
}
function toStrictInt(v: unknown): number | null {
  if (typeof v !== "number") return null;
  if (!Number.isFinite(v) || !Number.isInteger(v)) return null;
  return v;
}
function normStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}
const IDENTITY_TYPES = new Set(["mykad", "mypr", "passport", "other"]);

// Strict allow-lists — any key outside these sets is rejected.
const ALLOWED_TOP = new Set([
  "bookingSource",
  "arrivalDate",
  "departureDate",
  "notes",
  "externalBookingReference",
  "rooms",
  "guests",
]);
const ALLOWED_ROOM = new Set([
  "hotelRoomId",
  "agreedRate",
  "adults",
  "children",
  "rateOverrideReason",
]);
const ALLOWED_GUEST = new Set([
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

function rejectUnknown(obj: Record<string, unknown>, allowed: ReadonlySet<string>): string | null {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) return k;
  }
  return null;
}

/** Strict pagination parser. */
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
    // For historical filtering: allow ANY tenant-scoped source (active or inactive).
    if (!found) return deny(400, "invalid_booking_source");
  }
  try {
    const result = await listReservations({
      tenantId: ctx.session.tenantId!,
      bookingReference: url.searchParams.get("bookingReference") ?? undefined,
      guestName: url.searchParams.get("guestName") ?? undefined,
      guestMobile: url.searchParams.get("guestMobile") ?? undefined,
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

  // Strict top-level allow-list — reject snake_case aliases and every
  // server-controlled field (tenantId, n3Token, n3UserKey, role,
  // bookingReference, status, createdAt, ...).
  const unknownTop = rejectUnknown(body, ALLOWED_TOP);
  if (unknownTop !== null) return deny(400, "unknown_field");

  const source = body.bookingSource;
  if (typeof source !== "string" || !isSourceCodeFormat(source))
    return deny(400, "invalid_booking_source");
  const arrival = body.arrivalDate;
  const departure = body.departureDate;
  if (!isIsoDate(arrival) || !isIsoDate(departure) || departure <= arrival) {
    return deny(400, "invalid_stay_dates");
  }
  // Server-independent guard: arrival cannot be earlier than today in KL.
  if (arrival < todayInKualaLumpurIso()) {
    return deny(400, "arrival_date_in_past");
  }
  const notes =
    body.notes === undefined || body.notes === null
      ? null
      : typeof body.notes === "string"
        ? body.notes.trim() || null
        : null;
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string")
    return deny(400, "invalid_notes");

  // External booking reference — optional; trimmed; max 100 chars.
  const extRaw = body.externalBookingReference;
  let externalBookingReference: string | null = null;
  if (extRaw !== undefined && extRaw !== null && extRaw !== "") {
    if (typeof extRaw !== "string") return deny(400, "invalid_external_reference");
    const t = extRaw.trim();
    if (t.length > 100) return deny(400, "external_ref_too_long");
    externalBookingReference = t || null;
  }

  if (!Array.isArray(body.rooms)) return deny(400, "room_required");
  if (!Array.isArray(body.guests)) return deny(400, "guest_required");
  const roomsRaw = body.rooms as unknown[];
  const guestsRaw = body.guests as unknown[];
  if (roomsRaw.length === 0) return deny(400, "room_required");
  if (guestsRaw.length === 0) return deny(400, "guest_required");

  const rooms: Parameters<typeof createReservationAtomic>[0]["rooms"] = [];
  for (const r of roomsRaw) {
    if (!isPlainObject(r)) return deny(400, "invalid_room");
    const unk = rejectUnknown(r as Record<string, unknown>, ALLOWED_ROOM);
    if (unk !== null) return deny(400, "unknown_field");
    const hotelRoomId = (r as Record<string, unknown>).hotelRoomId;
    if (!isUuid(hotelRoomId)) return deny(400, "invalid_room_id");
    const agreed = (r as Record<string, unknown>).agreedRate;
    if (typeof agreed !== "number" || !Number.isFinite(agreed) || agreed < 0)
      return deny(400, "invalid_rate");
    const adults = toStrictInt((r as Record<string, unknown>).adults);
    if (adults === null || adults < 1) return deny(400, "invalid_occupancy");
    const childrenRaw = (r as Record<string, unknown>).children ?? 0;
    const children = toStrictInt(childrenRaw);
    if (children === null || children < 0) return deny(400, "invalid_occupancy");
    const reasonRaw = (r as Record<string, unknown>).rateOverrideReason;
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
    const unk = rejectUnknown(g as Record<string, unknown>, ALLOWED_GUEST);
    if (unk !== null) return deny(400, "unknown_field");
    const gg = g as Record<string, unknown>;

    const fullNameRaw = gg.fullName;
    if (typeof fullNameRaw !== "string" || fullNameRaw.trim().length === 0)
      return deny(400, "guest_full_name_required");
    const primary = toStrictBoolean(gg.isPrimary, false);
    if (primary === null) return deny(400, "invalid_primary_flag");

    // Nationality — controlled ISO alpha-3.
    let nationalityCode: string | null = null;
    if (
      gg.nationalityCode !== undefined &&
      gg.nationalityCode !== null &&
      gg.nationalityCode !== ""
    ) {
      if (typeof gg.nationalityCode !== "string") return deny(400, "invalid_nationality");
      const nc = normalizeCountryCode(gg.nationalityCode);
      if (!nc || !isValidCountryCode(nc)) return deny(400, "invalid_nationality");
      nationalityCode = nc;
    }

    const identityType = normStr(gg.identityType);
    const identityNumberRaw = normStr(gg.identityNumber);
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

    let countryCode: string | null = null;
    if (gg.countryCode !== undefined && gg.countryCode !== null && gg.countryCode !== "") {
      if (typeof gg.countryCode !== "string") return deny(400, "invalid_address_country");
      const cc = normalizeCountryCode(gg.countryCode);
      if (!cc || !isValidCountryCode(cc)) return deny(400, "invalid_address_country");
      countryCode = cc;
    }

    let stateCode = normStr(gg.stateCode);
    let stateProvince = normStr(gg.stateProvince);
    if (countryCode === "MYS") {
      // Malaysian: only stateCode is allowed; ignore any stray stateProvince.
      stateProvince = null;
      if (stateCode !== null && !isValidMalaysianStateCode(stateCode))
        return deny(400, "invalid_state");
    } else {
      // Non-Malaysian: only stateProvince is allowed; ignore any stray stateCode.
      stateCode = null;
    }

    guests.push({
      fullName: fullNameRaw.trim(),
      mobile: typeof gg.mobile === "string" ? gg.mobile.trim() || null : null,
      email: typeof gg.email === "string" ? gg.email.trim() || null : null,
      nationality: null, // legacy field never accepted for new guests
      notes: typeof gg.notes === "string" ? gg.notes.trim() || null : null,
      isPrimary: primary,
      identityType,
      identityNumber,
      nationalityCode,
      addressLine1: normStr(gg.addressLine1),
      addressLine2: normStr(gg.addressLine2),
      addressLine3: normStr(gg.addressLine3),
      city: normStr(gg.city),
      postcode: normStr(gg.postcode),
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
      externalBookingReference,
      rooms,
      guests,
    });
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
