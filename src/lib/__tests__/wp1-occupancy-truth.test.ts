/**
 * WP1 HOUSEKEEPING UX + OCCUPANCY CORRECTION — OCCUPANCY TRUTH.
 *
 * Physical truth wins: a stay that is still `checked_in` with a physically
 * `occupied` allocation is occupancy, even when its planned departure date has
 * already passed. Such a room must NEVER display as Vacant; it displays as
 * Occupied with a presentation-only "Departure overdue" flag.
 *
 * Pure display-truth tests. No reservation lifecycle is mutated anywhere to
 * satisfy them.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveOccupancyByRoom,
  resolveOccupancyRow,
  type OccupancyRow,
} from "@/lib/housekeeping-occupancy";
import { OCCUPANCY_LABELS, OVERDUE_STAY_LABEL } from "@/lib/housekeeping";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const STORE = read("../housekeeping-store.server.ts");
const BOARD = read("../../components/HousekeepingBoard.tsx");

const TODAY = "2026-08-23";

function row(overrides: Partial<OccupancyRow> = {}): OccupancyRow {
  return {
    tenantId: "t1",
    hotelRoomId: "room-108",
    reservationId: "res-1",
    reservationStatus: "checked_in",
    allocationStatus: "occupied",
    arrivalDate: "2026-08-01",
    departureDate: "2026-08-30",
    ...overrides,
  };
}

describe("WP1 occupancy truth — pure resolver", () => {
  it("1. checked_in + occupied + past departure is Occupied and overdue, never Vacant", () => {
    const r = resolveOccupancyRow(row({ departureDate: "2026-08-10" }), TODAY);
    expect(r).not.toBeNull();
    expect(r!.occupancy).toBe("occupied");
    expect(r!.occupancy).not.toBe("vacant");
    expect(r!.overdue).toBe(true);
    expect(r!.reservationId).toBe("res-1");
  });

  it("2. checked_in + occupied + departure today is Departing today, not overdue", () => {
    const r = resolveOccupancyRow(row({ departureDate: TODAY }), TODAY);
    expect(r!.occupancy).toBe("departing");
    expect(r!.overdue).toBe(false);
    expect(OCCUPANCY_LABELS[r!.occupancy]).toBe("Departing today");
  });

  it("3. checked_in + occupied + future departure is Occupied", () => {
    const r = resolveOccupancyRow(row({ departureDate: "2026-09-05" }), TODAY);
    expect(r!.occupancy).toBe("occupied");
    expect(r!.overdue).toBe(false);
  });

  it("4. confirmed / tentative arriving today is Arriving today", () => {
    for (const status of ["confirmed", "tentative"]) {
      const r = resolveOccupancyRow(
        row({
          reservationStatus: status,
          allocationStatus: "allocated",
          arrivalDate: TODAY,
          departureDate: "2026-08-26",
        }),
        TODAY,
      );
      expect(r!.occupancy).toBe("arriving");
      expect(r!.overdue).toBe(false);
    }
  });

  it("5. confirmed / tentative future arrival contributes no current occupancy", () => {
    const r = resolveOccupancyRow(
      row({
        reservationStatus: "confirmed",
        allocationStatus: "allocated",
        arrivalDate: "2026-08-30",
        departureDate: "2026-09-01",
      }),
      TODAY,
    );
    expect(r).toBeNull();
  });

  it("6. released allocations are ignored entirely", () => {
    expect(resolveOccupancyRow(row({ allocationStatus: "released" }), TODAY)).toBeNull();
    const map = resolveOccupancyByRoom([row({ allocationStatus: "released" })], "t1", TODAY);
    expect(map.size).toBe(0);
  });

  it("7. physical checked-in occupancy outranks an arriving booking for the same room", () => {
    const rows = [
      row({
        reservationId: "arriving",
        reservationStatus: "confirmed",
        allocationStatus: "allocated",
        arrivalDate: TODAY,
        departureDate: "2026-08-25",
      }),
      row({ reservationId: "staying", departureDate: "2026-08-10" }),
    ];
    for (const ordered of [rows, [...rows].reverse()]) {
      const resolved = resolveOccupancyByRoom(ordered, "t1", TODAY).get("room-108");
      expect(resolved!.occupancy).toBe("occupied");
      expect(resolved!.reservationId).toBe("staying");
      expect(resolved!.overdue).toBe(true);
    }
  });

  it("8. a cross-tenant row can never affect this tenant's board", () => {
    const map = resolveOccupancyByRoom([row({ tenantId: "other" })], "t1", TODAY);
    expect(map.size).toBe(0);
    expect(map.get("room-108")).toBeUndefined();
    // And an empty tenant id resolves nothing at all (deny by default).
    expect(resolveOccupancyByRoom([row()], "", TODAY).size).toBe(0);
  });

  it("10. Room 108-style stale planned departure cannot display Vacant", () => {
    // Authoritative truth: still checked_in, still physically occupied, the
    // planned departure date is long past. Generic rule, no room hard-coding.
    const stale = row({
      hotelRoomId: "any-room",
      arrivalDate: "2026-07-01",
      departureDate: "2026-07-04",
    });
    const resolved = resolveOccupancyByRoom([stale], "t1", TODAY).get("any-room");
    expect(resolved).toBeDefined();
    expect(resolved!.occupancy).toBe("occupied");
    expect(OCCUPANCY_LABELS[resolved!.occupancy]).toBe("Occupied");
    expect(resolved!.overdue).toBe(true);
    expect(BOARD).not.toMatch(/\b108\b/);
    expect(STORE).not.toMatch(/\b108\b/);
  });
});

describe("WP1 occupancy truth — DTO and presentation", () => {
  it("9. the shared room DTO builder surfaces occupancyOverdue from the resolver", () => {
    expect(STORE).toContain("function buildRoomDTO");
    expect(STORE).toContain("occupancyOverdue: input.occupancy.overdue");
    expect(STORE).toContain("occupancy: state.occupancy");
    expect(STORE).toContain("occupancyReservationId: input.occupancy.reservationId");
  });

  it("the board renders Occupied · Departure overdue and no guest PII", () => {
    expect(OVERDUE_STAY_LABEL).toBe("Departure overdue");
    expect(BOARD).toContain("OCCUPANCY_LABELS[room.occupancy]");
    expect(BOARD).toContain("room.occupancyOverdue");
    expect(BOARD).toContain("OVERDUE_STAY_LABEL");
    // No guest identity fields on the housekeeping board.
    expect(BOARD).not.toMatch(/guestName|guestMobile|passport|guestEmail|icNumber/);
  });

  it("occupancy is read tenant-scoped from authoritative reservation rows only", () => {
    expect(STORE).toContain('.eq("tenant_id", tenantId)');
    expect(STORE).toContain('.eq("allocation_status", "occupied")');
    expect(STORE).toContain('.eq("hotel_reservations.status", "checked_in")');
    expect(STORE).toContain("resolveOccupancyByRoom(");
  });
});
