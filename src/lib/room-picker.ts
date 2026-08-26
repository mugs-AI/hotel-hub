// UX helpers for the Rooms & Rates N3 stock picker.
// Purely client/UX logic — server-side unique constraint + 409 remain the
// authoritative duplicate protection.

export function normalizeStockCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function buildMappedStockSet(rooms: ReadonlyArray<{ n3StockCode: string }>): Set<string> {
  const set = new Set<string>();
  for (const r of rooms) {
    const n = normalizeStockCode(r.n3StockCode);
    if (n) set.add(n);
  }
  return set;
}

export function isStockMapped(code: string, mapped: ReadonlySet<string>): boolean {
  return mapped.has(normalizeStockCode(code));
}

// Guarded picker: refuses to invoke onPick when the code is already mapped.
// Returns true when the row was picked, false when the click was suppressed.
export function selectIfAllowed<T extends { code: string }>(
  row: T,
  mapped: ReadonlySet<string>,
  onPick: (r: T) => void,
): boolean {
  if (isStockMapped(row.code, mapped)) return false;
  onPick(row);
  return true;
}

// ---------------------------------------------------------------------------
// Housekeeping badge (informational only — see reservations.new.tsx step 2).
//
// Housekeeping status is NEVER allowed to influence booking availability or
// selection. This helper only turns server-authoritative housekeeping board
// data into a display label; it never filters or disables anything.
// ---------------------------------------------------------------------------

import type { HousekeepingCondition } from "@/lib/housekeeping";

export type HousekeepingBadgeTone =
  | "ready"
  | "dirty"
  | "cleaning"
  | "inspected"
  | "unset"
  | "dnd"
  | "unknown";

export interface HousekeepingBadge {
  label: string;
  tone: HousekeepingBadgeTone;
}

export const HOUSEKEEPING_UNKNOWN_BADGE: HousekeepingBadge = {
  label: "Housekeeping unknown",
  tone: "unknown",
};

const CONDITION_TO_LABEL: Record<HousekeepingCondition, string> = {
  dirty: "Dirty",
  cleaning: "Cleaning",
  inspected: "Inspected",
  ready: "Ready",
};

/**
 * Minimal shape this helper needs from a housekeeping board room — kept
 * structural (rather than importing the full server DTO type set) so it
 * stays cheap to unit test.
 */
export interface HousekeepingRoomLike {
  roomId: string;
  condition: HousekeepingCondition | null;
  dndActive: boolean;
}

/**
 * Resolves the informational housekeeping badge for a room from the
 * server-authoritative board. Returns "Housekeeping unknown" whenever the
 * board could not be loaded (network error, unauthorized, still loading) or
 * the room isn't present on the board — never a guess.
 *
 * IMPORTANT: this value must be read-only presentation. Callers must not use
 * it to filter, disable, or otherwise gate room selection/availability.
 */
export function resolveHousekeepingBadge(
  roomId: string,
  board: { rooms: ReadonlyArray<HousekeepingRoomLike> } | null | undefined,
  hasError: boolean,
): HousekeepingBadge {
  if (hasError || !board) return HOUSEKEEPING_UNKNOWN_BADGE;
  const room = board.rooms.find((r) => r.roomId === roomId);
  if (!room) return HOUSEKEEPING_UNKNOWN_BADGE;
  if (room.dndActive) return { label: "DND", tone: "dnd" };
  if (room.condition === null) return { label: "Not set up", tone: "unset" };
  return { label: CONDITION_TO_LABEL[room.condition], tone: room.condition };
}
