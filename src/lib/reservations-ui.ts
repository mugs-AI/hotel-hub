// Pure browser-safe helpers for the Reservations UI.
// Extracted from route components so they can be unit-tested directly.
// No React, no I/O, no side-effects.
//
// Booking sources are tenant-configurable and served by
// `/api/hotel/booking-sources`. The constants below are ONLY a
// presentation fallback for known default codes — they are NOT the
// authoritative source list and must never be used to validate input.

/** Presentation-only labels for the six default source codes. */
export const BOOKING_SOURCE_LABELS: Record<string, string> = {
  walk_in: "Walk-in",
  phone: "Phone",
  whatsapp: "WhatsApp",
  hotel_website: "Hotel website",
  agoda: "Agoda",
  booking_com: "Booking.com",
};

function titleFromCode(code: string): string {
  return code
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Fall back to a snake→Title-case rendering when a display name is missing. */
export function bookingSourceLabel(v: string): string {
  if (!v) return "";
  if (v in BOOKING_SOURCE_LABELS) return BOOKING_SOURCE_LABELS[v];
  return titleFromCode(v);
}

/**
 * Format an ISO `YYYY-MM-DD` string for display as Malaysian `dd/mm/yyyy`.
 * Re-exported from `@/lib/malaysia-date` for backwards compatibility with
 * existing call sites.
 */
export {
  formatMyDate as formatIsoDate,
  formatMyTimestamp as formatCreatedAt,
} from "@/lib/malaysia-date";

// ---------- List filters ----------
export type ListFilters = {
  bookingReference: string;
  guestName: string;
  guestMobile: string;
  bookingSource: string; // "" = all
  status: string; // "" = all
  arrivalFrom: string;
  arrivalTo: string;
};

export const EMPTY_FILTERS: ListFilters = {
  bookingReference: "",
  guestName: "",
  guestMobile: "",
  bookingSource: "",
  status: "",
  arrivalFrom: "",
  arrivalTo: "",
};

/**
 * Build a URLSearchParams for `GET /api/hotel/reservations`.
 * Empty values are omitted so the server never sees `""`. The tenant ID
 * is never passed from the browser — the server derives it from the
 * authenticated session.
 */
export function buildListQuery(
  filters: ListFilters,
  page: { limit: number; offset: number },
): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.bookingReference.trim()) p.set("bookingReference", filters.bookingReference.trim());
  if (filters.guestName.trim()) p.set("guestName", filters.guestName.trim());
  if (filters.guestMobile.trim()) p.set("guestMobile", filters.guestMobile.trim());
  if (filters.bookingSource) p.set("bookingSource", filters.bookingSource);
  if (filters.status) p.set("status", filters.status);
  if (filters.arrivalFrom) p.set("arrivalFrom", filters.arrivalFrom);
  if (filters.arrivalTo) p.set("arrivalTo", filters.arrivalTo);
  p.set("limit", String(page.limit));
  p.set("offset", String(page.offset));
  return p;
}


// ---------- Guest helpers ----------
// Correction B (Turn 2) — GuestDraft field names match the migration:
// nationality_code, address_line_{1,2,3}, city, postcode, country_code,
// state_code, state_province. Legacy `nationality` is READ-ONLY historical
// fallback surfaced in the Detail DTO; it is never part of a NEW guest
// payload from the form.
import { normalizeIdentity, type IdentityType } from "@/lib/guest-identity";
import { isValidCountryCode, normalizeCountryCode } from "@/lib/iso-countries";
import { isValidMalaysianStateCode } from "@/lib/malaysia-states";

export type GuestDraft = {
  fullName: string;
  mobile: string;
  email: string;
  nationalityCode: string; // ISO 3166-1 alpha-3 or ""
  notes: string;
  isPrimary: boolean;
  // Identity
  identityType: "" | IdentityType;
  identityNumber: string;
  // Address
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  city: string;
  postcode: string;
  countryCode: string; // ISO 3166-1 alpha-3 or ""
  stateCode: string; // 2-digit MY state code — only when countryCode === "MYS"
  stateProvince: string; // free-text — only when countryCode is non-MY
};

export function emptyGuestDraft(isPrimary = false): GuestDraft {
  return {
    fullName: "",
    mobile: "",
    email: "",
    nationalityCode: "",
    notes: "",
    isPrimary,
    identityType: "",
    identityNumber: "",
    addressLine1: "",
    addressLine2: "",
    addressLine3: "",
    city: "",
    postcode: "",
    countryCode: "",
    stateCode: "",
    stateProvince: "",
  };
}

/** Enforce exactly-one-primary invariant when selecting a new primary guest. */
export function setPrimaryGuest(guests: GuestDraft[], index: number): GuestDraft[] {
  return guests.map((g, i) => ({ ...g, isPrimary: i === index }));
}

/**
 * Remove a guest, then repair the primary invariant. If the removed guest
 * was primary, promote the first remaining guest. When zero guests remain,
 * returns an empty array (form-level validation surfaces the error).
 */
export function removeGuestSafe(guests: GuestDraft[], index: number): GuestDraft[] {
  const next = guests.filter((_, i) => i !== index);
  if (next.length === 0) return next;
  if (!next.some((g) => g.isPrimary)) next[0] = { ...next[0], isPrimary: true };
  return next;
}

/**
 * Apply a country-change to a guest, clearing the hidden state value that
 * no longer applies to the newly-selected country. Used by the form so a
 * stale `stateCode`/`stateProvince` can never be submitted after switching.
 */
export function applyGuestCountryChange(g: GuestDraft, nextCountry: string): GuestDraft {
  const cc = normalizeCountryCode(nextCountry) ?? "";
  return { ...g, countryCode: cc, stateCode: "", stateProvince: "" };
}

// ---------- Room selection ----------
export type RoomDraft = {
  hotelRoomId: string;
  roomNumber: string;
  roomType: string;
  maxOccupancy: number;
  baseRate: number;
  currency: string;
  agreedRate: number;
  adults: number;
  children: number;
  rateOverrideReason: string;
};

export function makeRoomDraft(r: {
  hotelRoomId: string;
  roomNumber: string;
  roomType: string;
  maxOccupancy: number;
  baseRate: number;
  currency: string;
}): RoomDraft {
  return {
    hotelRoomId: r.hotelRoomId,
    roomNumber: r.roomNumber,
    roomType: r.roomType,
    maxOccupancy: r.maxOccupancy,
    baseRate: r.baseRate,
    currency: r.currency,
    agreedRate: r.baseRate,
    adults: 1,
    children: 0,
    rateOverrideReason: "",
  };
}

export function addRoomIfNew(
  rooms: RoomDraft[],
  candidate: RoomDraft,
): { rooms: RoomDraft[]; added: boolean } {
  if (rooms.some((r) => r.hotelRoomId === candidate.hotelRoomId)) {
    return { rooms, added: false };
  }
  return { rooms: [...rooms, candidate], added: true };
}

export function rateOverrideRequired(baseRate: number, agreedRate: number): boolean {
  return Number.isFinite(baseRate) && Number.isFinite(agreedRate) && agreedRate !== baseRate;
}

/**
 * Trim + length-cap an optional external booking reference (max 100 chars,
 * matching the migration CHECK constraint). Returns `null` for empty. For
 * over-length the caller MUST surface a form error and NOT silently coerce
 * to null.
 */
export const EXTERNAL_REF_MAX = 100;
export function normalizeExternalBookingReference(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; code: "external_ref_too_long" } {
  if (raw == null) return { ok: true, value: null };
  const t = String(raw).trim();
  if (!t) return { ok: true, value: null };
  if (t.length > EXTERNAL_REF_MAX) return { ok: false, code: "external_ref_too_long" };
  return { ok: true, value: t };
}

/** Whitelist-only payload — never sends tenant, status, reference, snapshot, timestamps. */
export function buildCreatePayload(input: {
  bookingSource: string;
  arrivalDate: string;
  departureDate: string;
  notes: string;
  externalBookingReference?: string;
  rooms: RoomDraft[];
  guests: GuestDraft[];
}) {
  const extRef = normalizeExternalBookingReference(input.externalBookingReference ?? "");
  return {
    bookingSource: input.bookingSource,
    arrivalDate: input.arrivalDate,
    departureDate: input.departureDate,
    notes: input.notes.trim() || null,
    // On over-length the form MUST have validated first; if not, we omit
    // rather than silently truncate — the server will independently reject.
    externalBookingReference: extRef.ok ? extRef.value : null,
    rooms: input.rooms.map((r) => {
      const overridden = rateOverrideRequired(r.baseRate, r.agreedRate);
      return {
        hotelRoomId: r.hotelRoomId,
        agreedRate: r.agreedRate,
        adults: r.adults,
        children: r.children,
        rateOverrideReason: overridden ? r.rateOverrideReason.trim() || null : null,
      };
    }),
    guests: input.guests.map((g) => {
      const identity = normalizeIdentity(g.identityType || "", g.identityNumber || "");
      const cc = normalizeCountryCode(g.countryCode) ?? null;
      const isMy = cc === "MYS";
      const stateCode = isMy ? g.stateCode.trim() || null : null;
      const stateProvince = !isMy && cc ? g.stateProvince.trim() || null : null;
      return {
        fullName: g.fullName.trim(),
        mobile: g.mobile.trim() || null,
        email: g.email.trim() || null,
        notes: g.notes.trim() || null,
        isPrimary: g.isPrimary === true,
        identityType: identity.ok ? identity.type : null,
        identityNumber: identity.ok ? identity.number : null,
        nationalityCode: normalizeCountryCode(g.nationalityCode) ?? null,
        addressLine1: g.addressLine1.trim() || null,
        addressLine2: g.addressLine2.trim() || null,
        addressLine3: g.addressLine3.trim() || null,
        city: g.city.trim() || null,
        postcode: g.postcode.trim() || null,
        countryCode: cc,
        stateCode,
        stateProvince,
      };
    }),
  };
}

// ---------- Validation ----------
export type ValidationResult = { ok: true } | { ok: false; code: string; field?: string };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDateStr(v: string): boolean {
  if (!ISO_DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function validateStayDates(arrival: string, departure: string): ValidationResult {
  if (!arrival || !departure) return { ok: false, code: "invalid_stay_dates" };
  if (!isValidIsoDateStr(arrival) || !isValidIsoDateStr(departure))
    return { ok: false, code: "invalid_stay_dates" };
  if (departure <= arrival) return { ok: false, code: "invalid_stay_dates" };
  return { ok: true };
}

export function validateRoom(r: RoomDraft): ValidationResult {
  if (!Number.isInteger(r.adults) || r.adults < 1)
    return { ok: false, code: "invalid_occupancy", field: "adults" };
  if (!Number.isInteger(r.children) || r.children < 0)
    return { ok: false, code: "invalid_occupancy", field: "children" };
  if (r.adults + r.children > r.maxOccupancy)
    return { ok: false, code: "occupancy_exceeded", field: "adults" };
  if (!Number.isFinite(r.agreedRate) || r.agreedRate < 0)
    return { ok: false, code: "invalid_rate", field: "agreedRate" };
  if (rateOverrideRequired(r.baseRate, r.agreedRate) && !r.rateOverrideReason.trim())
    return { ok: false, code: "rate_override_reason_required", field: "rateOverrideReason" };
  return { ok: true };
}

export function validateGuests(guests: GuestDraft[]): ValidationResult {
  if (guests.length === 0) return { ok: false, code: "guest_required" };
  for (const g of guests) {
    if (!g.fullName.trim()) return { ok: false, code: "guest_full_name_required" };
    // Optional identity pair — validate only when either side is set.
    const identity = normalizeIdentity(g.identityType || "", g.identityNumber || "");
    if (!identity.ok) return { ok: false, code: identity.code, field: "identityNumber" };
    // Optional nationality.
    if (g.nationalityCode && !isValidCountryCode(g.nationalityCode))
      return { ok: false, code: "invalid_nationality", field: "nationalityCode" };
    // Optional address country.
    if (g.countryCode && !isValidCountryCode(g.countryCode))
      return { ok: false, code: "invalid_address_country", field: "countryCode" };
    // Malaysian address: if a stateCode is set, it must be one of the 16.
    if (g.countryCode === "MYS" && g.stateCode && !isValidMalaysianStateCode(g.stateCode))
      return { ok: false, code: "invalid_state", field: "stateCode" };
  }
  const primaries = guests.filter((g) => g.isPrimary === true).length;
  if (primaries === 0) return { ok: false, code: "primary_guest_required" };
  if (primaries > 1) return { ok: false, code: "multiple_primary_guests" };
  return { ok: true };
}

// ---------- Error labels ----------
const ERROR_MESSAGES: Record<string, string> = {
  invalid_stay_dates: "Arrival and departure dates are invalid.",
  invalid_booking_source: "Please choose a valid booking source.",
  room_required: "Select at least one room.",
  guest_required: "Add at least one guest.",
  guest_full_name_required: "Every guest needs a full name.",
  primary_guest_required: "Select a primary guest.",
  multiple_primary_guests: "Only one guest can be marked as primary.",
  invalid_occupancy: "Adults and children must be whole numbers.",
  invalid_rate: "The agreed rate must be zero or greater.",
  duplicate_room: "That room is already selected.",
  room_not_found: "One of the selected rooms is no longer available.",
  room_inactive: "One of the selected rooms is inactive.",
  occupancy_exceeded: "Guests exceed the room’s maximum occupancy.",
  rate_override_reason_required: "Please provide a reason for the rate change.",
  room_not_available:
    "Another reservation just took one of your selected rooms. We refreshed availability — please review and try again.",
  setup_incomplete:
    "Hotel setup is incomplete. Add at least one active room and a walk-in customer.",
  reservation_create_failed: "We couldn’t create the reservation. Please try again.",
  invalid_pagination: "Invalid page.",
  invalid_date_filter: "Invalid arrival date filter.",
  reservations_list_failed: "Unable to load reservations right now.",
  reservation_detail_failed: "Unable to load this reservation.",
  not_found: "Reservation not found.",
  invalid_id: "Invalid reservation link.",
  unauthenticated: "Your session has expired. Please relaunch from N3.",
  forbidden: "You don’t have permission to view this.",
  role_unassigned: "Your HotelHub role hasn’t been assigned yet.",
  // Correction B — guest identity and address
  external_ref_too_long: "External booking reference must be 100 characters or fewer.",
  identity_pair_required: "Enter both an identity type and identity number.",
  invalid_identity_type: "Select a valid identity type.",
  invalid_mykad: "MyKad/MyPR number must be 12 digits.",
  invalid_passport: "Passport number is invalid.",
  invalid_identity_number: "Identity number is invalid.",
  invalid_nationality: "Select a valid nationality.",
  invalid_address_country: "Select a valid country.",
  invalid_state: "Select a valid Malaysian state.",
  unknown_field: "That request contains a field the server does not accept.",
  invalid_primary_flag: "The primary-guest flag must be true or false.",
  invalid_room: "One of the rooms is not valid.",
  invalid_guest: "One of the guests is not valid.",
  invalid_room_id: "One of the selected rooms is invalid.",
  invalid_external_reference: "External booking reference is invalid.",
  invalid_notes: "Notes must be text.",
  // Booking Sources (Settings) — Correction B Turn 3
  invalid_source_name: "Enter a valid source name (1–80 characters).",
  source_name_exists: "A booking source with that name already exists.",
  booking_source_not_found: "That booking source could not be found.",
  last_active_booking_source: "You must keep at least one active booking source.",
  invalid_source_update: "That booking source update isn’t valid.",
  booking_source_update_failed: "Unable to update the booking source. Please try again.",
  booking_source_create_failed: "Unable to add the booking source. Please try again.",
  // Legacy Booking Source aliases (still emitted by older client paths).
  display_name_required: "Enter a display name.",
  display_name_too_long: "Display name must be 80 characters or fewer.",
  duplicate_source_code: "A booking source with this code already exists.",
  duplicate_display_name: "A booking source with that name already exists.",
  source_not_found: "That booking source could not be found.",
  cannot_reorder: "That source is already at the edge of the list.",
  cannot_deactivate_last_source: "You must keep at least one active booking source.",
  invalid_source_code: "Booking source code is invalid.",
};

export function friendlyError(
  code: string | undefined | null,
  fallback = "Something went wrong.",
): string {
  if (!code) return fallback;
  return ERROR_MESSAGES[code] ?? fallback;
}

// Codes that must preserve stay + guest input on the New page (only rooms
// are cleared/refreshed).
export const CREATE_PRESERVE_CODES = new Set(["room_not_available"]);
