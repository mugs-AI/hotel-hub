// WP1 live-acceptance: reservation operations usability (source-level guards).
// The server remains authoritative for every permission and readiness rule;
// these assertions only protect the usability layer from regressing.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { operationErrorMessage } from "@/lib/operations-client";

const OPS = readFileSync("src/components/ReservationOperations.tsx", "utf8");
const ASSIGN = readFileSync("src/components/GuestRoomAssignmentCard.tsx", "utf8");

describe("WP1 ops UX — room-change picker", () => {
  it("uses a rich room picker instead of a bare select", () => {
    expect(OPS).toContain("aria-pressed={selected}");
    expect(OPS).toContain("housekeepingBadge(r.id, hkBoard.data)");
    expect(OPS).toContain("Base rate");
    expect(OPS).toContain("max");
  });

  it("shows rate context without changing the preserved agreed rate", () => {
    expect(OPS).toContain("Current agreed rate will be preserved");
    expect(OPS).toContain("rateDiff");
    expect(OPS).toContain("preserveRate: true");
  });

  it("only offers active rooms", () => {
    expect(OPS).toContain(".filter((r) => r.isActive)");
  });
});

describe("WP1 ops UX — pending approvals", () => {
  it("shows the destination room for pending room changes", () => {
    expect(OPS).toContain("pendingRoomChangeDestinationLabel(r, propertyRooms.data?.rooms)");
    expect(OPS).toContain("Destination room:");
  });

  it("explains readiness blockers without losing the pending request", () => {
    expect(OPS).toContain("isReadinessBlockerCode(decideCode)");
    expect(OPS).toContain("This request stays pending until the room is ready.");
  });

  it("uses semantic approve/reject colours with explicit labels", () => {
    expect(OPS).toContain("ACTION_COLORS.approve");
    expect(OPS).toContain("ACTION_COLORS.reject");
    expect(OPS).toContain(">\n                      Approve\n");
  });
});

describe("WP1 ops UX — friendly readiness messages", () => {
  it("maps every readiness blocker code to plain language", () => {
    for (const code of [
      "housekeeping_not_initialized",
      "room_not_ready",
      "dnd_active",
      "handoff_pending",
      "readiness_read_failed",
      "destination_room_not_ready",
      "destination_dnd_active",
      "destination_handoff_pending",
    ]) {
      const msg = operationErrorMessage(code);
      expect(msg.length).toBeGreaterThan(20);
      expect(msg).not.toContain("_");
    }
  });
});

describe("WP1 ops UX — guest assignments", () => {
  it("never offers an unassigned guest option", () => {
    expect(ASSIGN).not.toMatch(/<option value="">/);
    expect(ASSIGN).toContain("guest");
  });
});
