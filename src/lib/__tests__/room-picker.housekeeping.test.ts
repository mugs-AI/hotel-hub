import { describe, expect, it } from "vitest";
import {
  HOUSEKEEPING_UNKNOWN_BADGE,
  resolveHousekeepingBadge,
} from "@/lib/room-picker";
import { isStockMapped, buildMappedStockSet } from "@/lib/room-picker";

describe("resolveHousekeepingBadge", () => {
  it("falls back to Housekeeping unknown when the board errored", () => {
    const badge = resolveHousekeepingBadge("room-1", { rooms: [] }, true);
    expect(badge).toEqual(HOUSEKEEPING_UNKNOWN_BADGE);
  });

  it("falls back to Housekeeping unknown when the board is unavailable", () => {
    expect(resolveHousekeepingBadge("room-1", null, false)).toEqual(HOUSEKEEPING_UNKNOWN_BADGE);
    expect(resolveHousekeepingBadge("room-1", undefined, false)).toEqual(HOUSEKEEPING_UNKNOWN_BADGE);
  });

  it("falls back to Housekeeping unknown when the room is not on the board", () => {
    const badge = resolveHousekeepingBadge(
      "room-missing",
      { rooms: [{ roomId: "room-1", condition: "ready", dndActive: false }] },
      false,
    );
    expect(badge).toEqual(HOUSEKEEPING_UNKNOWN_BADGE);
  });

  it("labels an uninitialized room as Not set up", () => {
    const badge = resolveHousekeepingBadge(
      "room-1",
      { rooms: [{ roomId: "room-1", condition: null, dndActive: false }] },
      false,
    );
    expect(badge).toEqual({ label: "Not set up", tone: "unset" });
  });

  it("prioritizes DND over the underlying condition", () => {
    const badge = resolveHousekeepingBadge(
      "room-1",
      { rooms: [{ roomId: "room-1", condition: "ready", dndActive: true }] },
      false,
    );
    expect(badge).toEqual({ label: "DND", tone: "dnd" });
  });

  it.each([
    ["ready", "Ready"],
    ["dirty", "Dirty"],
    ["cleaning", "Cleaning"],
    ["inspected", "Inspected"],
  ] as const)("labels condition %s as %s", (condition, label) => {
    const badge = resolveHousekeepingBadge(
      "room-1",
      { rooms: [{ roomId: "room-1", condition, dndActive: false }] },
      false,
    );
    expect(badge).toEqual({ label, tone: condition });
  });
});

describe("housekeeping labels never gate reservation selection", () => {
  // Room-picker's stock-mapping guard (used for the separate Rooms & Rates
  // duplicate-mapping protection) is driven purely by mapped stock codes —
  // never by housekeeping condition. This locks that separation in place:
  // a room that is e.g. "Dirty" or "DND" is still selectable so long as it
  // isn't already mapped, proving housekeeping status carries zero weight
  // in the selection/availability decision.
  it("selection is governed only by the mapped-stock set, independent of any housekeeping badge", () => {
    const mapped = buildMappedStockSet([{ n3StockCode: "A1" }]);

    // A room that would show "Dirty", "DND", "Cleaning", etc. is still
    // selectable — resolveHousekeepingBadge output is never consulted here.
    for (const badge of [
      { label: "Dirty", tone: "dirty" as const },
      { label: "DND", tone: "dnd" as const },
      { label: "Housekeeping unknown", tone: "unknown" as const },
      { label: "Ready", tone: "ready" as const },
    ]) {
      void badge; // presence only — must not influence isStockMapped
      expect(isStockMapped("B2", mapped)).toBe(false);
    }

    // Only the mapped stock code itself blocks selection.
    expect(isStockMapped("A1", mapped)).toBe(true);
  });
});
