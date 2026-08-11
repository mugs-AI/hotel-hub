/**
 * Run 5D2.5 §5 — server-derived reservation edit capabilities.
 *
 * Pure and browser-safe so the editor UI and the server can agree on what is
 * shown. The server (route + `hotelhub_update_reservation_v2`) remains the
 * ONLY authority: a tampered DTO cannot widen what a write actually does.
 */

export type ReservationEditMode = "full" | "contact" | "owner_correction" | "none";

export type ReservationEditCapabilities = {
  mode: ReservationEditMode;
  canOpenEditor: boolean;
  canEditStayAndRooms: boolean;
  canEditGuestContact: boolean;
  canEditGuestIdentity: boolean;
  canAddRemoveGuests: boolean;
  canChangePrimaryGuest: boolean;
  canAssignGuestRooms: boolean;
  correctionReasonRequired: boolean;
  reasonCode: string | null;
};

export type EditCapabilityInput = {
  /** Authenticated HotelHub role for the current actor. */
  role: "owner" | "front_desk" | "housekeeper" | null;
  /** Reservation status: confirmed | checked_in | checked_out | cancelled | no_show */
  status: string;
  /** Guest Controls: what Front Desk may touch after check-in. */
  postCheckInGuestEditPolicy: "locked" | "contact_only";
  /** Guest Controls: Owner primary-guest change after check-in. */
  allowOwnerPrimaryGuestChangeAfterCheckIn: boolean;
};

const NONE: ReservationEditCapabilities = {
  mode: "none",
  canOpenEditor: false,
  canEditStayAndRooms: false,
  canEditGuestContact: false,
  canEditGuestIdentity: false,
  canAddRemoveGuests: false,
  canChangePrimaryGuest: false,
  canAssignGuestRooms: false,
  correctionReasonRequired: false,
  reasonCode: null,
};

export function computeEditCapabilities(input: EditCapabilityInput): ReservationEditCapabilities {
  const role = input.role;
  if (role !== "owner" && role !== "front_desk") {
    return { ...NONE, reasonCode: "role_not_permitted" };
  }

  const status = (input.status ?? "").toLowerCase();

  // Terminal states are never editable through this editor.
  if (status === "checked_out" || status === "cancelled" || status === "no_show") {
    return { ...NONE, reasonCode: `reservation_${status}` };
  }

  if (status === "confirmed") {
    return {
      mode: "full",
      canOpenEditor: true,
      canEditStayAndRooms: true,
      canEditGuestContact: true,
      canEditGuestIdentity: true,
      canAddRemoveGuests: true,
      canChangePrimaryGuest: true,
      canAssignGuestRooms: true,
      correctionReasonRequired: false,
      reasonCode: null,
    };
  }

  if (status === "checked_in") {
    if (role === "owner") {
      // Controlled correction: guest data only, reason mandatory. Stay and
      // room inventory stay immutable — approved operations own those.
      return {
        mode: "owner_correction",
        canOpenEditor: true,
        canEditStayAndRooms: false,
        canEditGuestContact: true,
        canEditGuestIdentity: true,
        canAddRemoveGuests: false,
        canChangePrimaryGuest: input.allowOwnerPrimaryGuestChangeAfterCheckIn === true,
        canAssignGuestRooms: true,
        correctionReasonRequired: true,
        reasonCode: "owner_correction_after_check_in",
      };
    }
    // Front Desk after check-in follows the Guest Controls policy.
    if (input.postCheckInGuestEditPolicy === "contact_only") {
      return {
        mode: "contact",
        canOpenEditor: true,
        canEditStayAndRooms: false,
        canEditGuestContact: true,
        canEditGuestIdentity: false,
        canAddRemoveGuests: false,
        canChangePrimaryGuest: false,
        canAssignGuestRooms: false,
        correctionReasonRequired: false,
        reasonCode: "contact_only_after_check_in",
      };
    }
    return { ...NONE, reasonCode: "guest_edit_locked" };
  }

  // Unknown status — deny by default.
  return { ...NONE, reasonCode: "reservation_not_editable" };
}
