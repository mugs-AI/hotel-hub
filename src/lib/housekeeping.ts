// HotelHub WP1 — Housekeeping & Room Turnaround.
//
// ONE engine, TWO experiences. This module is the single source of truth for
// the condition lifecycle and for which actions a given room offers right
// now. It is pure (no I/O), so the server store, the API routes, the Simple
// (Front Desk) surface and the Dedicated Housekeeping workspace all agree by
// construction — a room can never look actionable in one experience and be
// rejected by another.
//
// Lifecycle:  Ready -> Dirty -> Cleaning -> Inspected -> Ready
// DND is a TEMPORARY OVERLAY on occupied rooms only. It never replaces a
// condition and never survives the room being vacated.

import { hasPermission, type HotelRole } from "./rbac";

export const HOUSEKEEPING_CONDITIONS = ["dirty", "cleaning", "inspected", "ready"] as const;
export type HousekeepingCondition = (typeof HOUSEKEEPING_CONDITIONS)[number];

export function isHousekeepingCondition(v: unknown): v is HousekeepingCondition {
  return typeof v === "string" && (HOUSEKEEPING_CONDITIONS as readonly string[]).includes(v);
}

/** Conditions an Owner may bootstrap an existing room into. */
export const BOOTSTRAP_CONDITIONS = ["ready", "dirty"] as const;
export type BootstrapCondition = (typeof BOOTSTRAP_CONDITIONS)[number];

export function isBootstrapCondition(v: unknown): v is BootstrapCondition {
  return v === "ready" || v === "dirty";
}

/** Lifecycle transitions only. DND and initialise are separate verbs. */
export const HOUSEKEEPING_TRANSITIONS = [
  "mark_dirty",
  "start_cleaning",
  "finish_cleaning",
  "mark_ready",
  "revert_to_cleaning",
] as const;
export type HousekeepingTransition = (typeof HOUSEKEEPING_TRANSITIONS)[number];

export function isHousekeepingTransition(v: unknown): v is HousekeepingTransition {
  return typeof v === "string" && (HOUSEKEEPING_TRANSITIONS as readonly string[]).includes(v);
}

export type RoomOccupancy = "vacant" | "occupied" | "arriving" | "departing";

export const HOUSEKEEPING_MODES = ["simple", "dedicated"] as const;
export type HousekeepingMode = (typeof HOUSEKEEPING_MODES)[number];

export function isHousekeepingMode(v: unknown): v is HousekeepingMode {
  return v === "simple" || v === "dedicated";
}

/**
 * The authoritative transition table. Mirrors `hotelhub_hk_transition` in the
 * database exactly; the database remains the enforcer, this is the same rule
 * expressed once for the UI so buttons never offer an illegal shortcut.
 */
export function nextCondition(
  current: HousekeepingCondition,
  transition: HousekeepingTransition,
): HousekeepingCondition | null {
  switch (transition) {
    case "mark_dirty":
      return current === "ready" || current === "cleaning" ? "dirty" : null;
    case "start_cleaning":
      return current === "dirty" ? "cleaning" : null;
    case "finish_cleaning":
      return current === "cleaning" ? "inspected" : null;
    case "mark_ready":
      return current === "inspected" ? "ready" : null;
    case "revert_to_cleaning":
      return current === "inspected" ? "cleaning" : null;
    default:
      return null;
  }
}

export type RoomTurnaroundState = {
  initialized: boolean;
  condition: HousekeepingCondition | null;
  dndActive: boolean;
  occupancy: RoomOccupancy;
  isActive: boolean;
};

/**
 * Which lifecycle transitions this room offers right now.
 *
 * DND freezes the cleaning lifecycle — a guest asking not to be disturbed
 * must never be overridden by a staff tap. Clearing DND is the explicit,
 * separate act that unfreezes it.
 */
export function allowedTransitions(state: RoomTurnaroundState): HousekeepingTransition[] {
  if (!state.initialized || !state.condition || !state.isActive) return [];
  if (state.dndActive) return [];
  return HOUSEKEEPING_TRANSITIONS.filter((t) => nextCondition(state.condition!, t) !== null);
}

/** DND is an occupied-room overlay only, and never over an active clean. */
export function canSetDnd(state: RoomTurnaroundState): boolean {
  if (!state.initialized || !state.isActive || state.dndActive) return false;
  if (state.occupancy !== "occupied") return false;
  return state.condition !== "cleaning";
}

export function canClearDnd(state: RoomTurnaroundState): boolean {
  return state.initialized && state.isActive && state.dndActive;
}

/**
 * Check-in readiness. Fails CLOSED for rooms that were never initialised:
 * an unknown room condition is not a clean room, and letting a guest into an
 * unverified room is the exact failure WP1 exists to prevent.
 */
export function checkInBlockers(state: RoomTurnaroundState): string[] {
  const blockers: string[] = [];
  if (!state.isActive) blockers.push("room_inactive");
  if (!state.initialized || !state.condition) {
    blockers.push("housekeeping_not_initialized");
    return blockers;
  }
  if (state.condition !== "ready") blockers.push("room_not_ready");
  if (state.dndActive) blockers.push("dnd_active");
  return blockers;
}

export function isReadyForCheckIn(state: RoomTurnaroundState): boolean {
  return checkInBlockers(state).length === 0;
}

// ---------------------------------------------------------------------------
// Presentation vocabulary — shared by both experiences.
// ---------------------------------------------------------------------------

export const CONDITION_LABELS: Record<HousekeepingCondition, string> = {
  dirty: "Dirty",
  cleaning: "Cleaning",
  inspected: "Inspected",
  ready: "Ready",
};

export const CONDITION_HELP: Record<HousekeepingCondition, string> = {
  dirty: "Needs cleaning before anyone can check in.",
  cleaning: "A housekeeper is working in this room now.",
  inspected: "Cleaning is finished and waiting for a final check.",
  ready: "Clean, checked and safe to sell.",
};

/** Navy / Teal / Gold palette — kept in one place so both surfaces match. */
export const CONDITION_STYLE: Record<HousekeepingCondition, { bg: string; fg: string }> = {
  dirty: { bg: "#FDECEC", fg: "#9B1C1C" },
  cleaning: { bg: "#FFF6E0", fg: "#8A6100" },
  inspected: { bg: "#E7F1FB", fg: "#1B4F86" },
  ready: { bg: "#E3F6F1", fg: "#0B6B5C" },
};

export const TRANSITION_LABELS: Record<HousekeepingTransition, string> = {
  mark_dirty: "Mark dirty",
  start_cleaning: "Start cleaning",
  finish_cleaning: "Finish cleaning",
  mark_ready: "Mark ready",
  revert_to_cleaning: "Send back to cleaning",
};

/** Plain-language confirmation shown after an action succeeds. */
export function confirmationFor(
  roomLabel: string,
  transition: HousekeepingTransition,
  resulting: HousekeepingCondition,
): string {
  return `${roomLabel} is now ${CONDITION_LABELS[resulting]}.` + confirmSuffix(transition);
}

function confirmSuffix(transition: HousekeepingTransition): string {
  switch (transition) {
    case "mark_ready":
      return " It can be sold and checked into.";
    case "finish_cleaning":
      return " It still needs a final check before it can be sold.";
    case "start_cleaning":
      return " It cannot be checked into until cleaning is finished and checked.";
    default:
      return "";
  }
}

export const OCCUPANCY_LABELS: Record<RoomOccupancy, string> = {
  vacant: "Vacant",
  occupied: "Occupied",
  arriving: "Arriving today",
  departing: "Departing today",
};

export const BLOCKER_LABELS: Record<string, string> = {
  housekeeping_not_initialized: "Housekeeping has not been set up for this room yet.",
  room_not_ready: "This room is not marked Ready.",
  dnd_active: "Do Not Disturb is on for this room.",
  room_inactive: "This room is not active.",
};

export function blockerLabel(code: string): string {
  return BLOCKER_LABELS[code] ?? code.replace(/_/g, " ");
}

/**
 * Recognise → Act → Confirm: the one thing this room needs next, in words a
 * new staff member understands without training.
 */
export function nextStepHint(state: RoomTurnaroundState): string {
  if (!state.isActive) return "Inactive room — no housekeeping needed.";
  if (!state.initialized) return "Set up housekeeping for this room to start tracking it.";
  if (state.dndActive) return "Guest asked not to be disturbed. Clear Do Not Disturb to continue.";
  switch (state.condition) {
    case "dirty":
      return "Start cleaning this room.";
    case "cleaning":
      return "Finish cleaning, then it goes for a check.";
    case "inspected":
      return "Check the room, then mark it Ready.";
    case "ready":
      return state.occupancy === "vacant" ? "Nothing to do — ready to sell." : "Nothing to do.";
    default:
      return "Nothing to do.";
  }
}

/** Board grouping used by both experiences. */
export type BoardGroup = "needs_attention" | "in_progress" | "ready" | "not_set_up";

export function boardGroup(state: RoomTurnaroundState): BoardGroup {
  if (!state.initialized) return "not_set_up";
  if (state.condition === "dirty") return "needs_attention";
  if (state.condition === "cleaning" || state.condition === "inspected") return "in_progress";
  return "ready";
}

export const BOARD_GROUP_LABELS: Record<BoardGroup, string> = {
  needs_attention: "Needs attention",
  in_progress: "In progress",
  ready: "Ready",
  not_set_up: "Not set up",
};

// ---------------------------------------------------------------------------
// Mode-aware authority — the workflow the property actually runs decides who
// may move a room, NOT the static role matrix alone.
//
// Simple (Front Desk): the desk turns rooms around itself. There is no
// housekeeping team, so a housekeeper has no board and no authority at all.
// Dedicated: the housekeeping team owns the cleaning lifecycle. The desk may
// still report a room as dirty (a guest complained, a walk-through found it),
// but must never advance a clean it did not perform or verify.
//
// This is pure and shared: the server enforces it, the board only renders what
// the server already authorised.
// ---------------------------------------------------------------------------

export type HousekeepingAuthority = {
  mode: HousekeepingMode;
  role: HotelRole | null;
  canViewBoard: boolean;
  canUseDedicatedWorkspace: boolean;
  canInitialize: boolean;
  canToggleDnd: boolean;
  /** Lifecycle transitions this role may ever perform in this mode. */
  roleTransitions: HousekeepingTransition[];
  /** In dedicated mode the desk may only report a sellable room as dirty. */
  markDirtyOnlyFromReady: boolean;
};

export function housekeepingAuthority(
  mode: HousekeepingMode,
  role: HotelRole | null,
): HousekeepingAuthority {
  // Static matrix is the OUTER gate; mode can only narrow it, never widen it.
  const staticView = hasPermission(role, "hotel:housekeeping:view");
  const staticUpdate = hasPermission(role, "hotel:housekeeping:update");
  const staticDnd = hasPermission(role, "hotel:housekeeping:dnd");
  const staticInit = hasPermission(role, "hotel:housekeeping:initialize");

  const housekeeperInSimple = mode === "simple" && role === "housekeeper";
  const canViewBoard = staticView && !housekeeperInSimple;

  let roleTransitions: HousekeepingTransition[] = [];
  let markDirtyOnlyFromReady = false;
  if (staticUpdate && !housekeeperInSimple) {
    if (mode === "dedicated" && role === "front_desk") {
      roleTransitions = ["mark_dirty"];
      markDirtyOnlyFromReady = true;
    } else {
      roleTransitions = [...HOUSEKEEPING_TRANSITIONS];
    }
  }

  return {
    mode,
    role,
    canViewBoard,
    canUseDedicatedWorkspace: canViewBoard && mode === "dedicated",
    canInitialize: staticInit,
    canToggleDnd: staticDnd && !housekeeperInSimple,
    roleTransitions,
    markDirtyOnlyFromReady,
  };
}

/**
 * The transitions this actor may perform on THIS room right now: legal by the
 * lifecycle AND permitted by the property's workflow.
 */
export function authorizedTransitions(
  authority: HousekeepingAuthority,
  state: RoomTurnaroundState,
): HousekeepingTransition[] {
  return allowedTransitions(state).filter((t) => {
    if (!authority.roleTransitions.includes(t)) return false;
    if (authority.markDirtyOnlyFromReady && t === "mark_dirty" && state.condition !== "ready") {
      return false;
    }
    return true;
  });
}

export function canPerformTransition(
  authority: HousekeepingAuthority,
  state: RoomTurnaroundState,
  transition: HousekeepingTransition,
): boolean {
  return authorizedTransitions(authority, state).includes(transition);
}

/** Why the dedicated workspace is unavailable, in the property's own terms. */
export const DEDICATED_UNAVAILABLE_SIMPLE =
  "This property runs simple front-desk housekeeping, so there is no separate housekeeping workspace. Room readiness lives on Rooms & Rates. The Owner can switch to a dedicated housekeeping team in Settings.";
