/**
 * Run 5D2.7 §6 — server-only, identity-bound idempotency fingerprint for
 * `hotelhub_update_reservation_v2`.
 *
 * Why keyed HMAC and not a plain hash: the fingerprint input contains a
 * replacement MyKad/MyPR/passport number. Those identifiers are guessable,
 * so an unkeyed SHA-256 stored in the mutation ledger would be a reversible
 * record of the identity. A keyed HMAC (domain-separated from the session
 * cookie use of the same secret) is not.
 *
 * The output is the ONLY value that leaves this module: `hhv3:<64 hex>`.
 * The secret, the canonical input and the identity number are never
 * returned, logged or serialized.
 */
import { createHmac } from "node:crypto";
import { canonicalJson, type NormalizedFullUpdate } from "./reservation-full-update";

/** Domain separation — this secret is also the session-cookie password. */
const DOMAIN = "hotelhub:reservation-update-fingerprint:v3\n";

export class FingerprintConfigError extends Error {
  code = "reservation_update_failed";
  constructor() {
    // Generic: never mentions the secret name/value or any identity value.
    super("reservation_update_failed");
    this.name = "FingerprintConfigError";
  }
}

function requireKey(): string {
  const key = process.env["HOTELHUB_SESSION_SECRET"];
  if (typeof key !== "string" || key.length < 32) throw new FingerprintConfigError();
  return key;
}

/**
 * Canonical HMAC input. Includes every normalized update field plus — for
 * `identityAction === "replace"` — the normalized identity type and the FULL
 * replacement number, so replacing with A and replacing with B can never
 * collide under one reused `clientRequestId`.
 */
export function canonicalFingerprintInput(
  reservationId: string,
  input: NormalizedFullUpdate,
): string {
  const shaped = {
    v: 3,
    reservationId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    bookingSource: input.bookingSource,
    arrivalDate: input.arrivalDate,
    departureDate: input.departureDate,
    notes: input.notes,
    externalBookingReference: input.externalBookingReference,
    correctionReason: input.correctionReason,
    rooms: input.rooms.map((r) => ({
      clientKey: r.clientKey,
      reservationRoomId: r.reservationRoomId,
      hotelRoomId: r.hotelRoomId,
      agreedRate: r.agreedRate,
      adults: r.adults,
      children: r.children,
      rateOverrideReason: r.rateOverrideReason,
      remark: r.remark,
    })),
    guests: input.guests.map((g) => {
      const replacing = g.identityAction === "replace";
      return {
        clientKey: g.clientKey,
        reservationGuestId: g.reservationGuestId,
        fullName: g.fullName,
        mobile: g.mobile,
        email: g.email,
        notes: g.notes,
        nationalityCode: g.nationalityCode,
        addressLine1: g.addressLine1,
        addressLine2: g.addressLine2,
        addressLine3: g.addressLine3,
        city: g.city,
        postcode: g.postcode,
        countryCode: g.countryCode,
        stateCode: g.stateCode,
        stateProvince: g.stateProvince,
        isPrimary: g.isPrimary,
        assignedRoomClientKey: g.assignedRoomClientKey,
        identityAction: g.identityAction,
        // Keep/Clear canonicalize to null; Replace binds type + full number.
        identityType: replacing ? g.identityType : null,
        identityNumber: replacing ? g.identityNumber : null,
      };
    }),
  };
  return DOMAIN + canonicalJson(shaped);
}

/** Opaque, versioned, keyed fingerprint: `hhv3:<64 hex chars>`. */
export function fullUpdateFingerprint(reservationId: string, input: NormalizedFullUpdate): string {
  const key = requireKey();
  const mac = createHmac("sha256", key)
    .update(canonicalFingerprintInput(reservationId, input), "utf8")
    .digest("hex");
  return `hhv3:${mac}`;
}
