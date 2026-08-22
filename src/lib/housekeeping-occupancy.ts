// HotelHub WP1 — occupancy truth for the housekeeping board.
//
// PURE. No I/O, no database, no browser input. The server reads authoritative
// tenant-scoped reservation rows and hands them here; this module decides what
// a room's occupancy actually IS.
//
// The rule this module exists to enforce: PHYSICAL TRUTH WINS. A stay that is
// still `checked_in` with a physically `occupied` allocation is occupancy, even
// if its planned departure date has already passed. A room somebody is still
// living in must never be presented as Vacant because a date slipped. When the
// planned departure is in the past we say Occupied AND flag the stay as
// overdue, so the desk sees the discrepancy instead of losing it.
//
// This module never mutates reservation or allocation state; it only reports.

import type { RoomOccupancy } from "./housekeeping";

export type OccupancyRow = {
  tenantId: string;
  hotelRoomId: string;
  reservationId: string;
  reservationStatus: string;
  allocationStatus: string;
  arrivalDate: string;
  departureDate: string;
};

export type OccupancyResolution = {
  occupancy: RoomOccupancy;
  reservationId: string | null;
  /** Presentation-only: checked in, still occupied, planned departure past. */
  overdue: boolean;
};

export const VACANT: OccupancyResolution = {
  occupancy: "vacant",
  reservationId: null,
  overdue: false,
};

/** Physical presence outranks a booking that has not arrived yet. */
function rankOf(occupancy: RoomOccupancy): number {
  switch (occupancy) {
    case "occupied":
    case "departing":
      return 2;
    case "arriving":
      return 1;
    default:
      return 0;
  }
}

/** Decide one row's contribution, or `null` when it says nothing about today. */
export function resolveOccupancyRow(row: OccupancyRow, today: string): OccupancyResolution | null {
  if (row.allocationStatus === "released") return null;

  if (row.reservationStatus === "checked_in") {
    const physicallyOccupied = row.allocationStatus === "occupied";
    const inPlannedWindow = row.arrivalDate <= today && row.departureDate >= today;
    // Physical occupancy is authoritative regardless of the planned dates.
    if (!physicallyOccupied && !inPlannedWindow) return null;
    return {
      occupancy: row.departureDate === today ? "departing" : "occupied",
      reservationId: row.reservationId,
      overdue: physicallyOccupied && row.departureDate < today,
    };
  }

  if (row.reservationStatus === "confirmed" || row.reservationStatus === "tentative") {
    // A reserved booking never makes a physically empty room occupied; it only
    // announces an arrival, and only on the property's own today.
    if (row.arrivalDate !== today) return null;
    return { occupancy: "arriving", reservationId: row.reservationId, overdue: false };
  }

  return null;
}

/**
 * Fold authoritative rows into one occupancy per room.
 *
 * `tenantId` is re-checked here as defence in depth: a row belonging to another
 * property can never influence this property's board even if a query were ever
 * widened by mistake.
 */
export function resolveOccupancyByRoom(
  rows: readonly OccupancyRow[],
  tenantId: string,
  today: string,
): Map<string, OccupancyResolution> {
  const out = new Map<string, OccupancyResolution>();
  for (const row of rows) {
    if (!tenantId || row.tenantId !== tenantId) continue;
    const resolved = resolveOccupancyRow(row, today);
    if (!resolved) continue;
    const existing = out.get(row.hotelRoomId);
    if (existing && rankOf(existing.occupancy) >= rankOf(resolved.occupancy)) continue;
    out.set(row.hotelRoomId, resolved);
  }
  return out;
}
