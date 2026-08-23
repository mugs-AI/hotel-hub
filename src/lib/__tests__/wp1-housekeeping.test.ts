/**
 * HotelHub WP1 — Housekeeping & Room Turnaround.
 *
 * These tests lock the rules that protect a guest: an unverified room can
 * never receive a check-in, the lifecycle cannot be short-cut, and Do Not
 * Disturb is an occupied-room overlay that freezes cleaning rather than a
 * condition that replaces it.
 */
import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  boardGroup,
  canClearDnd,
  canSetDnd,
  checkInBlockers,
  isBootstrapCondition,
  isHousekeepingMode,
  isHousekeepingTransition,
  isReadyForCheckIn,
  nextCondition,
  nextStepHint,
  type HousekeepingCondition,
  type RoomTurnaroundState,
} from "@/lib/housekeeping";
import { hasPermission, type HotelRole } from "@/lib/rbac";
import { statusForOperationError } from "@/lib/operations-api.server";
import { statusForHousekeepingError } from "@/lib/housekeeping-store.server";

function state(over: Partial<RoomTurnaroundState> = {}): RoomTurnaroundState {
  return {
    initialized: true,
    condition: "ready",
    dndActive: false,
    occupancy: "vacant",
    isActive: true,
    ...over,
  };
}

describe("condition lifecycle", () => {
  it("walks Ready -> Dirty -> Cleaning -> Inspected -> Ready", () => {
    expect(nextCondition("ready", "mark_dirty")).toBe("dirty");
    expect(nextCondition("dirty", "start_cleaning")).toBe("cleaning");
    expect(nextCondition("cleaning", "finish_cleaning")).toBe("inspected");
    expect(nextCondition("inspected", "mark_ready")).toBe("ready");
  });

  it("allows a failed inspection to go back to cleaning", () => {
    expect(nextCondition("inspected", "revert_to_cleaning")).toBe("cleaning");
  });

  it("allows abandoning a clean back to dirty", () => {
    expect(nextCondition("cleaning", "mark_dirty")).toBe("dirty");
  });

  it("refuses every illegal short-cut", () => {
    const illegal: Array<[HousekeepingCondition, Parameters<typeof nextCondition>[1]]> = [
      ["dirty", "mark_ready"],
      ["dirty", "finish_cleaning"],
      ["dirty", "mark_dirty"],
      ["cleaning", "mark_ready"],
      ["cleaning", "start_cleaning"],
      ["inspected", "start_cleaning"],
      ["inspected", "finish_cleaning"],
      ["ready", "start_cleaning"],
      ["ready", "mark_ready"],
      ["ready", "finish_cleaning"],
      ["ready", "revert_to_cleaning"],
    ];
    for (const [from, action] of illegal) {
      expect(nextCondition(from, action), `${from} + ${action}`).toBeNull();
    }
  });

  it("offers exactly the legal transitions per condition", () => {
    expect(allowedTransitions(state({ condition: "ready" }))).toEqual(["mark_dirty"]);
    expect(allowedTransitions(state({ condition: "dirty" }))).toEqual(["start_cleaning"]);
    expect(allowedTransitions(state({ condition: "cleaning" })).sort()).toEqual([
      "finish_cleaning",
      "mark_dirty",
    ]);
    expect(allowedTransitions(state({ condition: "inspected" })).sort()).toEqual([
      "mark_ready",
      "revert_to_cleaning",
    ]);
  });

  it("offers nothing for an uninitialized or inactive room", () => {
    expect(allowedTransitions(state({ initialized: false, condition: null }))).toEqual([]);
    expect(allowedTransitions(state({ isActive: false }))).toEqual([]);
  });
});

describe("Do Not Disturb overlay", () => {
  it("freezes the cleaning lifecycle while active", () => {
    expect(allowedTransitions(state({ condition: "dirty", dndActive: true }))).toEqual([]);
    expect(allowedTransitions(state({ condition: "inspected", dndActive: true }))).toEqual([]);
  });

  it("can only be set on an occupied room", () => {
    expect(canSetDnd(state({ occupancy: "occupied" }))).toBe(true);
    expect(canSetDnd(state({ occupancy: "departing" }))).toBe(false);
    expect(canSetDnd(state({ occupancy: "vacant" }))).toBe(false);
    expect(canSetDnd(state({ occupancy: "arriving" }))).toBe(false);
  });

  it("cannot be set over an in-progress clean", () => {
    expect(canSetDnd(state({ occupancy: "occupied", condition: "cleaning" }))).toBe(false);
  });

  it("cannot be set on an uninitialized room", () => {
    expect(canSetDnd(state({ occupancy: "occupied", initialized: false, condition: null }))).toBe(
      false,
    );
  });

  it("is clearable only when actually active", () => {
    expect(canClearDnd(state({ dndActive: true }))).toBe(true);
    expect(canClearDnd(state({ dndActive: false }))).toBe(false);
  });

  it("never replaces the underlying condition", () => {
    const s = state({ condition: "dirty", dndActive: true, occupancy: "occupied" });
    expect(s.condition).toBe("dirty");
    expect(boardGroup(s)).toBe("needs_attention");
  });
});

describe("check-in gate fails closed", () => {
  it("blocks a room that was never initialized", () => {
    const blockers = checkInBlockers(state({ initialized: false, condition: null }));
    expect(blockers).toContain("housekeeping_not_initialized");
    expect(isReadyForCheckIn(state({ initialized: false, condition: null }))).toBe(false);
  });

  it("blocks every non-Ready condition", () => {
    for (const c of ["dirty", "cleaning", "inspected"] as const) {
      // Same rule, now stated with the concrete condition (WP1 final gaps).
      expect(checkInBlockers(state({ condition: c }))).toContain(`room_${c}`);
    }
  });

  it("blocks a Ready room that is under Do Not Disturb", () => {
    expect(checkInBlockers(state({ condition: "ready", dndActive: true }))).toContain("dnd_active");
  });

  it("permits only a Ready, initialized, undisturbed room", () => {
    expect(isReadyForCheckIn(state({ condition: "ready" }))).toBe(true);
  });
});

describe("board grouping and guidance", () => {
  it("separates uninitialized rooms from clean ones", () => {
    expect(boardGroup(state({ initialized: false, condition: null }))).toBe("not_set_up");
    expect(boardGroup(state({ condition: "dirty" }))).toBe("needs_attention");
    expect(boardGroup(state({ condition: "cleaning" }))).toBe("in_progress");
    expect(boardGroup(state({ condition: "inspected" }))).toBe("in_progress");
    expect(boardGroup(state({ condition: "ready" }))).toBe("ready");
  });

  it("always gives a plain-language next step", () => {
    expect(nextStepHint(state({ initialized: false, condition: null }))).toMatch(/set up/i);
    expect(nextStepHint(state({ condition: "dirty" }))).toMatch(/start cleaning/i);
    expect(nextStepHint(state({ dndActive: true }))).toMatch(/do not disturb/i);
  });
});

describe("input guards", () => {
  it("accepts only Ready or Dirty as a bootstrap condition", () => {
    expect(isBootstrapCondition("ready")).toBe(true);
    expect(isBootstrapCondition("dirty")).toBe(true);
    expect(isBootstrapCondition("cleaning")).toBe(false);
    expect(isBootstrapCondition("inspected")).toBe(false);
    expect(isBootstrapCondition(null)).toBe(false);
  });

  it("accepts only the five lifecycle transitions", () => {
    expect(isHousekeepingTransition("start_cleaning")).toBe(true);
    expect(isHousekeepingTransition("set_dnd")).toBe(false);
    expect(isHousekeepingTransition("initialize")).toBe(false);
  });

  it("accepts only the two workflow modes", () => {
    expect(isHousekeepingMode("simple")).toBe(true);
    expect(isHousekeepingMode("dedicated")).toBe(true);
    expect(isHousekeepingMode("hybrid")).toBe(false);
  });
});

describe("RBAC — one engine, role-shaped access", () => {
  const cases: Array<[HotelRole | null, string, boolean]> = [
    ["owner", "hotel:housekeeping:view", true],
    ["front_desk", "hotel:housekeeping:view", true],
    ["housekeeper", "hotel:housekeeping:view", true],
    [null, "hotel:housekeeping:view", false],

    ["owner", "hotel:housekeeping:update", true],
    ["front_desk", "hotel:housekeeping:update", true],
    ["housekeeper", "hotel:housekeeping:update", true],

    // DND is a guest-facing promise every operational role may record; the
    // property's workflow narrows it (a housekeeper has no authority at all in
    // Simple mode — see the mode-authority tests).
    ["owner", "hotel:housekeeping:dnd", true],
    ["front_desk", "hotel:housekeeping:dnd", true],
    ["housekeeper", "hotel:housekeeping:dnd", true],

    // Bootstrapping existing rooms is a property-setup act.
    ["owner", "hotel:housekeeping:initialize", true],
    ["front_desk", "hotel:housekeeping:initialize", false],
    ["housekeeper", "hotel:housekeeping:initialize", false],
  ];
  for (const [role, permission, expected] of cases) {
    it(`${String(role)} → ${permission} = ${expected}`, () => {
      expect(hasPermission(role, permission as never)).toBe(expected);
    });
  }

  it("does not widen the housekeeper beyond housekeeping", () => {
    for (const p of [
      "hotel:reservations:view",
      "hotel:rooms:view",
      "hotel:checkout:view",
      "hotel:setup",
    ] as const) {
      expect(hasPermission("housekeeper", p)).toBe(false);
    }
  });
});

describe("error surfacing", () => {
  it("maps housekeeping refusals to 409 on the check-in path", () => {
    expect(statusForOperationError("housekeeping_not_initialized")).toBe(409);
    expect(statusForOperationError("room_not_ready")).toBe(409);
    expect(statusForOperationError("dnd_active")).toBe(409);
  });

  it("maps housekeeping store errors to meaningful statuses", () => {
    expect(statusForHousekeepingError("room_not_found")).toBe(404);
    expect(statusForHousekeepingError("illegal_transition")).toBe(409);
    expect(statusForHousekeepingError("room_not_occupied")).toBe(409);
    expect(statusForHousekeepingError("cleaning_in_progress")).toBe(409);
    expect(statusForHousekeepingError("invalid_condition")).toBe(400);
    expect(statusForHousekeepingError("housekeeping_failed")).toBe(500);
  });
});
