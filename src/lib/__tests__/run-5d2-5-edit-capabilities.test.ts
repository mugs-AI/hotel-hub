/**
 * Run 5D2.5 — server-derived edit capabilities.
 * Locks the deny-by-default policy matrix used by the editor UI.
 */
import { describe, expect, it } from "vitest";
import { computeEditCapabilities } from "../reservation-edit-capabilities";

const base = {
  postCheckInGuestEditPolicy: "locked" as const,
  allowOwnerPrimaryGuestChangeAfterCheckIn: false,
};

describe("computeEditCapabilities", () => {
  it("housekeeper and unauthenticated actors can never open the editor", () => {
    for (const role of ["housekeeper", null] as const) {
      const c = computeEditCapabilities({ ...base, role, status: "confirmed" });
      expect(c.canOpenEditor).toBe(false);
      expect(c.mode).toBe("none");
      expect(c.reasonCode).toBe("role_not_permitted");
    }
  });

  it("confirmed reservations are fully editable by owner and front desk", () => {
    for (const role of ["owner", "front_desk"] as const) {
      const c = computeEditCapabilities({ ...base, role, status: "confirmed" });
      expect(c.mode).toBe("full");
      expect(c.canEditStayAndRooms).toBe(true);
      expect(c.canEditGuestIdentity).toBe(true);
      expect(c.canAssignGuestRooms).toBe(true);
      expect(c.correctionReasonRequired).toBe(false);
    }
  });

  it("terminal statuses are never editable", () => {
    for (const status of ["checked_out", "cancelled", "no_show"]) {
      const c = computeEditCapabilities({ ...base, role: "owner", status });
      expect(c.canOpenEditor).toBe(false);
      expect(c.reasonCode).toBe(`reservation_${status}`);
    }
  });

  it("front desk after check-in follows the guest policy", () => {
    const locked = computeEditCapabilities({ ...base, role: "front_desk", status: "checked_in" });
    expect(locked.canOpenEditor).toBe(false);
    expect(locked.reasonCode).toBe("guest_edit_locked");

    const contact = computeEditCapabilities({
      ...base,
      postCheckInGuestEditPolicy: "contact_only",
      role: "front_desk",
      status: "checked_in",
    });
    expect(contact.mode).toBe("contact");
    expect(contact.canEditGuestContact).toBe(true);
    expect(contact.canEditGuestIdentity).toBe(false);
    expect(contact.canEditStayAndRooms).toBe(false);
    expect(contact.canAssignGuestRooms).toBe(false);
  });

  it("owner correction after check-in requires a reason and excludes stay/rooms", () => {
    const c = computeEditCapabilities({ ...base, role: "owner", status: "checked_in" });
    expect(c.mode).toBe("owner_correction");
    expect(c.correctionReasonRequired).toBe(true);
    expect(c.canEditStayAndRooms).toBe(false);
    expect(c.canAddRemoveGuests).toBe(false);
    expect(c.canChangePrimaryGuest).toBe(false);
    expect(c.canAssignGuestRooms).toBe(true);
  });

  it("owner primary-guest change follows the settings toggle", () => {
    const c = computeEditCapabilities({
      ...base,
      allowOwnerPrimaryGuestChangeAfterCheckIn: true,
      role: "owner",
      status: "checked_in",
    });
    expect(c.canChangePrimaryGuest).toBe(true);
  });

  it("unknown statuses deny by default", () => {
    const c = computeEditCapabilities({ ...base, role: "owner", status: "weird" });
    expect(c.canOpenEditor).toBe(false);
    expect(c.reasonCode).toBe("reservation_not_editable");
  });
});
