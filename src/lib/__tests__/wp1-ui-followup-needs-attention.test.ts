/**
 * WP1 APPROVED UI CORRECTION — FOLLOW-UP
 * Needs-attention must include Ready rooms with operational blockers (DND,
 * handoff_pending) and must NOT promote an inactive-but-ready room solely for
 * `room_inactive`. The same helper drives both visible filtering and the
 * summary tally.
 *
 * Pure presentation-only guard tests: no business rule, lifecycle, gate or
 * server-safety change is asserted or introduced here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { HousekeepingRoomDTO } from "@/lib/housekeeping-store.server";
import { needsHousekeepingAttention } from "@/components/HousekeepingBoard";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const BOARD = read("../../components/HousekeepingBoard.tsx");

/** Minimal room factory so each case only states what it is testing. */
function room(overrides: Partial<HousekeepingRoomDTO>): HousekeepingRoomDTO {
  return {
    roomId: "r1",
    roomLabel: "101",
    roomNumber: "101",
    floor: "1",
    roomType: "Standard",
    maxOccupancy: 2,
    isActive: true,
    initialized: true,
    condition: "ready",
    dndActive: false,
    dndSetAt: null,
    lastAction: null,
    lastActorLabel: null,
    lastTransitionAt: null,
    occupancy: "vacant",
    occupancyReservationId: null,
    group: "ready",
    nextStep: "Nothing to do — housekeeping is complete.",
    availableTransitions: [],
    canSetDnd: false,
    canClearDnd: false,
    checkInBlockers: [],
    ...overrides,
  };
}

describe("A. plain Ready + no DND + no blockers -> NOT Needs attention", () => {
  it("a clean ready room is excluded", () => {
    expect(needsHousekeepingAttention(room({}))).toBe(false);
  });
});

describe("B. Ready + DND -> IS Needs attention", () => {
  it("dnd alone promotes a ready room", () => {
    expect(needsHousekeepingAttention(room({ dndActive: true }))).toBe(true);
  });
});

describe("C. Ready + handoff_pending -> IS Needs attention", () => {
  it("an operational blocker promotes a ready room", () => {
    expect(needsHousekeepingAttention(room({ checkInBlockers: ["handoff_pending"] }))).toBe(true);
  });

  it("operational blockers stack with ready", () => {
    expect(
      needsHousekeepingAttention(room({ checkInBlockers: ["room_not_ready", "handoff_pending"] })),
    ).toBe(true);
  });
});

describe("D. Ready + only room_inactive -> does NOT become Needs attention", () => {
  it("room_inactive alone is non-operational for the housekeeping queue", () => {
    expect(needsHousekeepingAttention(room({ checkInBlockers: ["room_inactive"] }))).toBe(false);
  });

  it("an inactive-but-ready room with no other blocker is not promoted", () => {
    expect(
      needsHousekeepingAttention(room({ isActive: false, checkInBlockers: ["room_inactive"] })),
    ).toBe(false);
  });

  it("room_inactive plus a real blocker still needs attention", () => {
    expect(
      needsHousekeepingAttention(room({ checkInBlockers: ["room_inactive", "handoff_pending"] })),
    ).toBe(true);
  });
});

describe("E. Dirty / Cleaning / Inspected / Not set up remain Needs attention", () => {
  it("dirty needs attention", () => {
    expect(needsHousekeepingAttention(room({ condition: "dirty", group: "needs_attention" }))).toBe(
      true,
    );
  });
  it("cleaning needs attention", () => {
    expect(needsHousekeepingAttention(room({ condition: "cleaning", group: "in_progress" }))).toBe(
      true,
    );
  });
  it("inspected needs attention", () => {
    expect(needsHousekeepingAttention(room({ condition: "inspected", group: "in_progress" }))).toBe(
      true,
    );
  });
  it("not set up needs attention", () => {
    expect(
      needsHousekeepingAttention(
        room({ initialized: false, condition: null, group: "not_set_up" }),
      ),
    ).toBe(true);
  });
});

describe("F. the same helper drives both visible filtering and tally", () => {
  it("matchesFilter(needs_action) calls needsHousekeepingAttention", () => {
    expect(BOARD).toMatch(/case "needs_action":\s*\n\s*return needsHousekeepingAttention\(room\);/);
  });

  it("tally.needs_action calls needsHousekeepingAttention", () => {
    expect(BOARD).toMatch(/if \(needsHousekeepingAttention\(r\)\) t\.needs_action \+= 1;/);
  });

  it("the old condition-only group !== ready shortcut is gone from both paths", () => {
    expect(BOARD).not.toMatch(/r\.group !== "ready"/);
  });
});
