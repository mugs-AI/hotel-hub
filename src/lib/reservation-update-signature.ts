/**
 * Run 5D2.7 §5.3 — safe client-side idempotency signature.
 *
 * The browser needs a stable signature so an unchanged retry reuses the same
 * `clientRequestId`. That signature must NOT contain a raw replacement
 * identity number (nor a masked/hashed/derivable form of it).
 *
 * Instead each guest draft carries an opaque, client-only `identityRevision`
 * token that rotates whenever the replacement input (or the identity action)
 * changes. The signature binds the revision, never the value.
 *
 * `identityRevision` is never sent to the server.
 */
import { canonicalJson } from "./reservation-full-update";

export type SafeSignatureRoom = {
  clientKey: string;
  reservationRoomId: string | null;
  hotelRoomId: string;
  agreedRate: number;
  adults: number;
  children: number;
  rateOverrideReason: string | null;
  remark: string | null;
};

export type SafeSignatureGuest = {
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
  identityAction: "keep" | "replace" | "clear";
  identityType: string | null;
  /** Opaque client-only token; NOT derived from the identity number. */
  identityRevision: string;
};

export type SafeSignatureInput = {
  reservationId: string;
  expectedUpdatedAt: string;
  bookingSource: string;
  arrivalDate: string;
  departureDate: string;
  notes: string | null;
  externalBookingReference: string | null;
  correctionReason: string | null;
  rooms: SafeSignatureRoom[];
  guests: SafeSignatureGuest[];
};

/** Opaque revision token. Never derived from an identity value. */
export function newIdentityRevision(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Build the signature from non-sensitive fields only. Constructed field by
 * field — never by stringifying the API payload and deleting keys after.
 */
export function buildSafeUpdateSignature(input: SafeSignatureInput): string {
  return canonicalJson({
    v: 1,
    reservationId: input.reservationId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    bookingSource: input.bookingSource,
    arrivalDate: input.arrivalDate,
    departureDate: input.departureDate,
    notes: input.notes,
    externalBookingReference: input.externalBookingReference,
    correctionReason: input.correctionReason,
    rooms: input.rooms.map((r) => ({ ...r })),
    guests: input.guests.map((g) => ({ ...g })),
  });
}
