// WP1 housekeeping usability corrections — deterministic guardrail tests.
// Covers: overdue-occupied card treatment/count/filter, floor filter + Room
// History availability in both modes with an UNCHANGED authority matrix, the
// DND hint/visibility rule, and the parallel post-write read structure with
// independently-settling pending rooms.
import { describe, expect, it } from "vitest";
import {
  isOverdueOccupied,
  needsHousekeepingAttention,
  addPendingRoom,
  removePendingRoom,
} from "@/components/HousekeepingBoard";
import {
  housekeepingAuthority,
  OVERDUE_OCCUPIED_BADGE_LABEL,
  DND_SETUP_HINT,
  canSetDnd,
  type RoomTurnaroundState,
} from "@/lib/housekeeping";
import type { HousekeepingRoomDTO } from "@/lib/housekeeping-store.server";
import fs from "node:fs";
import path from "node:path";

function room(overrides: Partial<HousekeepingRoomDTO>): HousekeepingRoomDTO {
  return {
    roomId: "r1",
    roomLabel: "101",
    roomNumber: "101",
    floor: "1",
    roomType: "standard",
    maxOccupancy: 2,
    isActive: true,
    initialized: true,
    condition: "ready",
    dndActive: false,
    dndSetAt: null,
    lastAction: null,
    lastActorLabel: null,
    lastTransitionAt: null,
    occupancy: "occupied",
    occupancyReservationId: "res1",
    occupancyOverdue: false,
    group: "ready",
    nextStep: "Nothing to do.",
    availableTransitions: [],
    canSetDnd: false,
    canClearDnd: false,
    checkInBlockers: [],
    ...overrides,
  };
}

describe("overdue-occupied visibility", () => {
  it("flags a checked-in occupied room with a stale departure date as overdue-occupied", () => {
    const r = room({ occupancy: "occupied", occupancyOverdue: true });
    expect(isOverdueOccupied(r)).toBe(true);
  });

  it("never treats a stale departure date as vacant — occupancy stays occupied", () => {
    const r = room({ occupancy: "occupied", occupancyOverdue: true, condition: "ready" });
    // The presentation helper never mutates occupancy/condition; it only reads them.
    expect(r.occupancy).toBe("occupied");
    expect(isOverdueOccupied(r)).toBe(true);
  });

  it("does not flag a vacant or non-overdue occupied room", () => {
    expect(isOverdueOccupied(room({ occupancy: "vacant", occupancyOverdue: false }))).toBe(false);
    expect(isOverdueOccupied(room({ occupancy: "occupied", occupancyOverdue: false }))).toBe(false);
    expect(isOverdueOccupied(room({ occupancy: "departing", occupancyOverdue: false }))).toBe(false);
  });

  it("the overdue-occupied count/filter derive from the same authoritative rooms as the board", () => {
    const rooms = [
      room({ roomId: "a", occupancy: "occupied", occupancyOverdue: true }),
      room({ roomId: "b", occupancy: "occupied", occupancyOverdue: false }),
      room({ roomId: "c", occupancy: "occupied", occupancyOverdue: true }),
    ];
    const count = rooms.filter(isOverdueOccupied).length;
    expect(count).toBe(2);
    expect(rooms.filter(isOverdueOccupied).map((r) => r.roomId)).toEqual(["a", "c"]);
  });

  it("exposes a prominent badge label distinct from the plain overdue-stay label", () => {
    expect(OVERDUE_OCCUPIED_BADGE_LABEL).toContain("Occupied");
    expect(OVERDUE_OCCUPIED_BADGE_LABEL).toContain("overdue");
  });

  it("an overdue-occupied room still needs attention only per the existing rule (presentation-only addition)", () => {
    // A ready, overdue-occupied room does NOT trigger needs_action by itself —
    // WP1 must not invent a new condition; overdue-occupied is a parallel lens.
    const r = room({ condition: "ready", occupancy: "occupied", occupancyOverdue: true });
    expect(needsHousekeepingAttention(r)).toBe(false);
    expect(isOverdueOccupied(r)).toBe(true);
  });
});

describe("floor filter & Room History available in both modes, authority matrix unchanged", () => {
  it("HousekeepingBoard no longer gates floor filter or history rendering on variant", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/HousekeepingBoard.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/variant === "dedicated" && floors\.length > 1/);
    expect(src).toContain("{floors.length > 1 && (");
    expect(src).not.toMatch(/onHistory=\{variant === "dedicated"/);
    expect(src).toContain("onHistory={() => setHistoryRoomId(room.roomId)}");
  });

  it("housekeepingAuthority matrix is unchanged: simple housekeeper still fully denied", () => {
    const auth = housekeepingAuthority("simple", "housekeeper");
    expect(auth.canViewBoard).toBe(false);
    expect(auth.canOpenWorkspace).toBe(false);
    expect(auth.roleTransitions).toEqual([]);
    expect(auth.canToggleDnd).toBe(false);
  });

  it("housekeepingAuthority matrix is unchanged: dedicated front_desk is mark-dirty-from-ready only", () => {
    const auth = housekeepingAuthority("dedicated", "front_desk");
    expect(auth.roleTransitions).toEqual(["mark_dirty"]);
    expect(auth.markDirtyOnlyFromReady).toBe(true);
  });

  it("housekeepingAuthority matrix is unchanged: owner has full transitions in both modes", () => {
    for (const mode of ["simple", "dedicated"] as const) {
      const auth = housekeepingAuthority(mode, "owner");
      expect(auth.roleTransitions.length).toBe(5);
      expect(auth.canInitialize).toBe(true);
    }
  });

  it("canUseDedicatedWorkspace stays gated to dedicated mode even though floor/history are now shared UI", () => {
    expect(housekeepingAuthority("simple", "owner").canUseDedicatedWorkspace).toBe(false);
    expect(housekeepingAuthority("dedicated", "owner").canUseDedicatedWorkspace).toBe(true);
  });
});

describe("Do Not Disturb discoverability rule", () => {
  const base: RoomTurnaroundState = {
    initialized: true,
    condition: "ready",
    dndActive: false,
    occupancy: "occupied",
    isActive: true,
  };

  it("offers Set DND for an occupied, initialised, non-cleaning room", () => {
    expect(canSetDnd(base)).toBe(true);
  });

  it("never offers DND for an occupied room that is not initialised", () => {
    expect(canSetDnd({ ...base, initialized: false, condition: null })).toBe(false);
  });

  it("the hint text exists and explains the initialise-first requirement", () => {
    expect(DND_SETUP_HINT).toMatch(/housekeeping condition/i);
    expect(DND_SETUP_HINT).toMatch(/Do Not Disturb/i);
  });

  it("RoomCard renders the DND hint only for the uninitialised + occupied + DND-eligible branch", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/HousekeepingBoard.tsx"),
      "utf8",
    );
    expect(src).toContain("DND_SETUP_HINT");
    expect(src).toMatch(/room\.occupancy === "occupied" && canDnd/);
  });
});

describe("independently-settling per-room pending state", () => {
  it("two overlapping room actions stay pending independently", () => {
    let pending: ReadonlySet<string> = new Set();
    pending = addPendingRoom(pending, "room-a");
    pending = addPendingRoom(pending, "room-b");
    expect(pending.has("room-a")).toBe(true);
    expect(pending.has("room-b")).toBe(true);

    // room-a settles first; room-b must remain pending, untouched.
    pending = removePendingRoom(pending, "room-a");
    expect(pending.has("room-a")).toBe(false);
    expect(pending.has("room-b")).toBe(true);

    pending = removePendingRoom(pending, "room-b");
    expect(pending.size).toBe(0);
  });
});

describe("parallel post-write read structure in getHousekeepingRoomView", () => {
  it("issues the five independent tenant-scoped reads via Promise.all, not sequential awaits", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/housekeeping-store.server.ts"),
      "utf8",
    );
    const fnStart = src.indexOf("export async function getHousekeepingRoomView");
    const fnEnd = src.indexOf("\nexport async function getHousekeepingBoard");
    const fn = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

    expect(fn).toContain(
      "const [roomRes, hkRes, physical, planned, handoffRead] = await Promise.all([",
    );
    // No sequential `await sb...` for these reads inside the parallel block.
    expect(fn).not.toMatch(/const roomRes = await sb/);
    expect(fn).not.toMatch(/const hkRes = await sb/);
  });

  it("still fails closed if the handoff read is not ok, after the parallel reads settle", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/housekeeping-store.server.ts"),
      "utf8",
    );
    const fnStart = src.indexOf("export async function getHousekeepingRoomView");
    const fnEnd = src.indexOf("\nexport async function getHousekeepingBoard");
    const fn = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    expect(fn).toContain('if (handoffRead.status !== "ok") throw new HousekeepingError("readiness_read_failed");');
  });

  it("does not rerun full-board reconciliation (no occupancyByRoom/board-wide call) inside the single-room view", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/housekeeping-store.server.ts"),
      "utf8",
    );
    const fnStart = src.indexOf("export async function getHousekeepingRoomView");
    const fnEnd = src.indexOf("\nexport async function getHousekeepingBoard");
    const fn = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    expect(fn).not.toContain("occupancyByRoom(");
  });
});
