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
export { formatMyDate as formatIsoDate, formatMyTimestamp as formatCreatedAt } from "@/lib/malaysia-date";


// ---------- List filters ----------
export type ListFilters = {
  bookingReference: string;
  guestName: string;
  bookingSource: string; // "" = all
  status: string; // "" = all
  arrivalFrom: string;
  arrivalTo: string;
};

export const EMPTY_FILTERS: ListFilters = {
  bookingReference: "",
  guestName: "",
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
  if (filters.bookingSource) p.set("bookingSource", filters.bookingSource);
  if (filters.status) p.set("status", filters.status);
  if (filters.arrivalFrom) p.set("arrivalFrom", filters.arrivalFrom);
  if (filters.arrivalTo) p.set("arrivalTo", filters.arrivalTo);
  p.set("limit", String(page.limit));
  p.set("offset", String(page.offset));
  return p;
}

// ---------- Guest helpers ----------
export type GuestDraft = {
  fullName: string;
  mobile: string;
  email: string;
  nationality: string;
  notes: string;
  isPrimary: boolean;
};

export function emptyGuestDraft(isPrimary = false): GuestDraft {
  return { fullName: "", mobile: "", email: "", nationality: "", notes: "", isPrimary };
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

/** Whitelist-only payload — never sends tenant, status, reference, snapshot, timestamps. */
export function buildCreatePayload(input: {
  bookingSource: string;
  arrivalDate: string;
  departureDate: string;
  notes: string;
  rooms: RoomDraft[];
  guests: GuestDraft[];
}) {
  return {
    bookingSource: input.bookingSource,
    arrivalDate: input.arrivalDate,
    departureDate: input.departureDate,
    notes: input.notes.trim() || null,
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
    guests: input.guests.map((g) => ({
      fullName: g.fullName.trim(),
      mobile: g.mobile.trim() || null,
      email: g.email.trim() || null,
      nationality: g.nationality.trim() || null,
      notes: g.notes.trim() || null,
      isPrimary: g.isPrimary === true,
    })),
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
  // Booking Sources (Settings)
  display_name_required: "Enter a display name.",
  display_name_too_long: "Display name must be 60 characters or fewer.",
  duplicate_source_code: "A booking source with this code already exists.",
  source_not_found: "That booking source could not be found.",
  cannot_reorder: "That source is already at the edge of the list.",
  cannot_deactivate_last_source: "You must keep at least one active booking source.",
  invalid_source_code: "Booking source code is invalid.",
  booking_source_update_failed: "Unable to update the booking source. Please try again.",
  booking_source_create_failed: "Unable to add the booking source. Please try again.",
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
