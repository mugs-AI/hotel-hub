/**
 * Run 5D2.6 §4/§5 — pure normalization, validation and canonical fingerprint
 * for the full reservation update (`hotelhub_update_reservation_v2`).
 *
 * Pure and side-effect free so both the API route and the unit tests can use
 * it. It NEVER accepts tenant, actor, role or fingerprint from the browser:
 * those come only from the trusted server session / URL.
 *
 * Privacy: a raw replacement identity number may pass through `normalize`,
 * but it is never included in the fingerprint input, never logged and never
 * echoed back in an error.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const IDENTITY_ACTIONS = ["keep", "replace", "clear"] as const;
export type IdentityAction = (typeof IDENTITY_ACTIONS)[number];
const IDENTITY_TYPES = ["mykad", "mypr", "passport", "other"] as const;

export const EXTERNAL_REF_MAX_LEN = 100;
export const ROOM_REMARK_MAX_LEN = 500;
export const CORRECTION_REASON_MAX_LEN = 300;
export const NOTES_MAX_LEN = 500;

export function isUuidLike(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Strict `YYYY-MM-DD` with no silent calendar rollover. */
export function isIsoDateStrict(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ISO_DATE_RE.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export type FullUpdateRoom = {
  clientKey: string;
  reservationRoomId: string | null;
  hotelRoomId: string;
  agreedRate: number;
  adults: number;
  children: number;
  rateOverrideReason: string | null;
  remark: string | null;
};

export type FullUpdateGuest = {
  clientKey: string;
  reservationGuestId: string | null;
  fullName: string;
  mobile: string | null;
  email: string | null;
  notes: string | null;
  nationalityCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressLine3: string | null;
  city: string | null;
  postcode: string | null;
  countryCode: string | null;
  stateCode: string | null;
  stateProvince: string | null;
  isPrimary: boolean;
  assignedRoomClientKey: string | null;
  identityAction: IdentityAction;
  identityType: string | null;
  identityNumber: string | null;
};

export type NormalizedFullUpdate = {
  clientRequestId: string;
  expectedUpdatedAt: string;
  bookingSource: string;
  arrivalDate: string;
  departureDate: string;
  notes: string | null;
  externalBookingReference: string | null;
  correctionReason: string | null;
  rooms: FullUpdateRoom[];
  guests: FullUpdateGuest[];
};

export type NormalizeResult =
  | { ok: true; value: NormalizedFullUpdate }
  | { ok: false; code: string };

const ALLOWED_TOP = new Set([
  "clientRequestId",
  "expectedUpdatedAt",
  "bookingSource",
  "arrivalDate",
  "departureDate",
  "notes",
  "externalBookingReference",
  "correctionReason",
  "rooms",
  "guests",
]);
const ALLOWED_ROOM = new Set([
  "clientKey",
  "reservationRoomId",
  "hotelRoomId",
  "agreedRate",
  "adults",
  "children",
  "rateOverrideReason",
  "remark",
]);
const ALLOWED_GUEST = new Set([
  "clientKey",
  "reservationGuestId",
  "fullName",
  "mobile",
  "email",
  "notes",
  "nationalityCode",
  "addressLine1",
  "addressLine2",
  "addressLine3",
  "city",
  "postcode",
  "countryCode",
  "stateCode",
  "stateProvince",
  "isPrimary",
  "assignedRoomClientKey",
  "identityAction",
  "identityType",
  "identityNumber",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function unknownKey(o: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  for (const k of Object.keys(o)) if (!allowed.has(k)) return true;
  return false;
}
function optText(v: unknown, max: number): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) return "invalid";
  return t;
}
function strictInt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) return null;
  return v;
}

/**
 * Validate + normalize a browser payload. Unknown fields are rejected at
 * every level. Returns a stable error code, never an SQL or raw value.
 */
export function normalizeFullUpdateBody(raw: unknown): NormalizeResult {
  if (!isPlainObject(raw)) return { ok: false, code: "invalid_request" };
  if (unknownKey(raw, ALLOWED_TOP)) return { ok: false, code: "unknown_field" };

  if (!isUuidLike(raw.clientRequestId)) return { ok: false, code: "invalid_request" };
  const expectedUpdatedAt = raw.expectedUpdatedAt;
  if (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt.trim())
    return { ok: false, code: "stale_reservation" };

  const bookingSource = raw.bookingSource;
  if (typeof bookingSource !== "string" || !/^[a-z0-9_]{2,40}$/.test(bookingSource))
    return { ok: false, code: "invalid_booking_source" };

  if (!isIsoDateStrict(raw.arrivalDate) || !isIsoDateStrict(raw.departureDate))
    return { ok: false, code: "invalid_stay_dates" };
  if ((raw.departureDate as string) <= (raw.arrivalDate as string))
    return { ok: false, code: "invalid_stay_dates" };

  const notes = optText(raw.notes, NOTES_MAX_LEN);
  if (notes === "invalid") return { ok: false, code: "invalid_request" };

  const extRef = optText(raw.externalBookingReference, EXTERNAL_REF_MAX_LEN);
  if (extRef === "invalid") return { ok: false, code: "external_ref_too_long" };

  const reason = optText(raw.correctionReason, CORRECTION_REASON_MAX_LEN);
  if (reason === "invalid") return { ok: false, code: "correction_reason_too_long" };

  if (!Array.isArray(raw.rooms) || raw.rooms.length === 0)
    return { ok: false, code: "room_required" };
  const rooms: FullUpdateRoom[] = [];
  const roomKeys = new Set<string>();
  const hotelRoomIds = new Set<string>();
  const reservationRoomIds = new Set<string>();
  for (const r of raw.rooms as unknown[]) {
    if (!isPlainObject(r)) return { ok: false, code: "invalid_request" };
    if (unknownKey(r, ALLOWED_ROOM)) return { ok: false, code: "unknown_field" };
    const clientKey = typeof r.clientKey === "string" ? r.clientKey.trim() : "";
    if (!clientKey || clientKey.length > 64) return { ok: false, code: "invalid_request" };
    if (roomKeys.has(clientKey)) return { ok: false, code: "duplicate_room" };
    roomKeys.add(clientKey);

    const rrId = r.reservationRoomId ?? null;
    if (rrId !== null && !isUuidLike(rrId)) return { ok: false, code: "room_not_found" };
    if (rrId !== null) {
      if (reservationRoomIds.has(rrId as string)) return { ok: false, code: "duplicate_room" };
      reservationRoomIds.add(rrId as string);
    }
    if (!isUuidLike(r.hotelRoomId)) return { ok: false, code: "room_not_found" };
    if (hotelRoomIds.has(r.hotelRoomId)) return { ok: false, code: "duplicate_room" };
    hotelRoomIds.add(r.hotelRoomId);

    const rate = r.agreedRate;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0)
      return { ok: false, code: "invalid_rate" };
    const adults = strictInt(r.adults);
    if (adults === null || adults < 1) return { ok: false, code: "invalid_occupancy" };
    const children = strictInt(r.children ?? 0);
    if (children === null || children < 0) return { ok: false, code: "invalid_occupancy" };

    const rateReason = optText(r.rateOverrideReason, CORRECTION_REASON_MAX_LEN);
    if (rateReason === "invalid") return { ok: false, code: "rate_override_reason_required" };
    const remark = optText(r.remark, ROOM_REMARK_MAX_LEN);
    if (remark === "invalid") return { ok: false, code: "room_remark_too_long" };

    rooms.push({
      clientKey,
      reservationRoomId: (rrId as string | null) ?? null,
      hotelRoomId: r.hotelRoomId,
      agreedRate: Math.round(rate * 100) / 100,
      adults,
      children,
      rateOverrideReason: rateReason,
      remark,
    });
  }

  if (!Array.isArray(raw.guests) || raw.guests.length === 0)
    return { ok: false, code: "guest_required" };
  const guests: FullUpdateGuest[] = [];
  const guestKeys = new Set<string>();
  const guestLinkIds = new Set<string>();
  let primaryCount = 0;
  for (const g of raw.guests as unknown[]) {
    if (!isPlainObject(g)) return { ok: false, code: "invalid_request" };
    if (unknownKey(g, ALLOWED_GUEST)) return { ok: false, code: "unknown_field" };
    const clientKey = typeof g.clientKey === "string" ? g.clientKey.trim() : "";
    if (!clientKey || clientKey.length > 64) return { ok: false, code: "invalid_request" };
    if (guestKeys.has(clientKey)) return { ok: false, code: "duplicate_guest" };
    guestKeys.add(clientKey);

    const linkId = g.reservationGuestId ?? null;
    if (linkId !== null && !isUuidLike(linkId)) return { ok: false, code: "guest_not_found" };
    if (linkId !== null) {
      if (guestLinkIds.has(linkId as string)) return { ok: false, code: "duplicate_guest" };
      guestLinkIds.add(linkId as string);
    }

    const fullName = typeof g.fullName === "string" ? g.fullName.trim() : "";
    if (!fullName || fullName.length > 120) return { ok: false, code: "guest_required" };

    const mobile = optText(g.mobile, 30);
    const email = optText(g.email, 255);
    const gNotes = optText(g.notes, NOTES_MAX_LEN);
    const nationalityCode = optText(g.nationalityCode, 3);
    const a1 = optText(g.addressLine1, 120);
    const a2 = optText(g.addressLine2, 120);
    const a3 = optText(g.addressLine3, 120);
    const city = optText(g.city, 80);
    const postcode = optText(g.postcode, 20);
    const countryCode = optText(g.countryCode, 3);
    const stateCode = optText(g.stateCode, 10);
    const stateProvince = optText(g.stateProvince, 80);
    for (const v of [
      mobile,
      email,
      gNotes,
      nationalityCode,
      a1,
      a2,
      a3,
      city,
      postcode,
      countryCode,
      stateCode,
      stateProvince,
    ]) {
      if (v === "invalid") return { ok: false, code: "invalid_request" };
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email as string))
      return { ok: false, code: "invalid_request" };

    if (typeof g.isPrimary !== "boolean") return { ok: false, code: "invalid_request" };
    if (g.isPrimary) primaryCount += 1;

    const assigned = g.assignedRoomClientKey ?? null;
    if (assigned !== null && typeof assigned !== "string")
      return { ok: false, code: "guest_assignment_required" };
    const assignedKey = assigned === null ? null : (assigned as string).trim() || null;
    if (!assignedKey) return { ok: false, code: "guest_assignment_required" };
    if (!roomKeys.has(assignedKey)) return { ok: false, code: "guest_assignment_required" };

    const action = g.identityAction;
    if (typeof action !== "string" || !(IDENTITY_ACTIONS as readonly string[]).includes(action))
      return { ok: false, code: "invalid_identity_action" };
    const identityAction = action as IdentityAction;

    let identityType: string | null = null;
    let identityNumber: string | null = null;
    if (identityAction === "keep") {
      // Keep only makes sense for an existing guest and must NEVER carry a
      // raw identity input. Any supplied value is dropped, not stored.
      if (linkId === null) return { ok: false, code: "invalid_identity_action" };
    } else if (identityAction === "clear") {
      if (linkId === null) return { ok: false, code: "invalid_identity_action" };
      // A supplied number is safely ignored (never echoed, never stored).
    } else {
      const t = typeof g.identityType === "string" ? g.identityType.trim() : "";
      const n = typeof g.identityNumber === "string" ? g.identityNumber.trim() : "";
      if (!t || !n) return { ok: false, code: "identity_pair_required" };
      if (!(IDENTITY_TYPES as readonly string[]).includes(t))
        return { ok: false, code: "invalid_identity_type" };
      if (t === "mykad" || t === "mypr") {
        const digits = n.replace(/[\s-]/g, "");
        if (!/^\d{12}$/.test(digits)) return { ok: false, code: "invalid_identity_number" };
        identityNumber = digits;
      } else {
        if (n.length > 50) return { ok: false, code: "invalid_identity_number" };
        identityNumber = n;
      }
      identityType = t;
    }

    guests.push({
      clientKey,
      reservationGuestId: (linkId as string | null) ?? null,
      fullName,
      mobile: mobile as string | null,
      email: email as string | null,
      notes: gNotes as string | null,
      nationalityCode: nationalityCode as string | null,
      addressLine1: a1 as string | null,
      addressLine2: a2 as string | null,
      addressLine3: a3 as string | null,
      city: city as string | null,
      postcode: postcode as string | null,
      countryCode: countryCode as string | null,
      stateCode: stateCode as string | null,
      stateProvince: stateProvince as string | null,
      isPrimary: g.isPrimary,
      assignedRoomClientKey: assignedKey,
      identityAction,
      identityType,
      identityNumber,
    });
  }

  if (primaryCount === 0) return { ok: false, code: "primary_guest_required" };
  if (primaryCount > 1) return { ok: false, code: "multiple_primary_guests" };

  return {
    ok: true,
    value: {
      clientRequestId: raw.clientRequestId,
      expectedUpdatedAt,
      bookingSource,
      arrivalDate: raw.arrivalDate as string,
      departureDate: raw.departureDate as string,
      notes: notes as string | null,
      externalBookingReference: extRef as string | null,
      correctionReason: reason as string | null,
      rooms,
      guests,
    },
  };
}

/** Deterministic JSON: object keys sorted recursively, arrays kept in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

// NOTE (Run 5D2.7): the former unkeyed `canonicalFingerprint()` lived here and
// deliberately excluded identity numbers, which let one reused clientRequestId
// cover two different replacement numbers. Fingerprinting now happens only in
// `reservation-full-update-fingerprint.server.ts` using a keyed HMAC.
