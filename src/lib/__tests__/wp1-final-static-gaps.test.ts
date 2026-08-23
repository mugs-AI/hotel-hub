// WP1 live-acceptance — final static gaps.
// 1. Pending room change exposes a structured, safe destination id (never the
//    raw payload, never inferred from summary text).
// 2. Readiness refusals name the actual housekeeping condition.
// 3. The room-change picker never offers the current physical room, and a
//    one-room reservation preselects its room.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  destinationBlockerCode,
  destinationHotelRoomIdOf,
  summarizeOperation,
  HOUSEKEEPING_BLOCKER_CODES,
  OPERATION_ERROR_CODES,
} from "@/lib/reservation-operations.server";
import { statusForOperationError } from "@/lib/operations-api.server";
import { operationErrorMessage } from "@/lib/operations-client";
import { checkInBlockers, blockerLabel } from "@/lib/housekeeping";

const OPS = readFileSync("src/components/ReservationOperations.tsx", "utf8");
const DETAIL = readFileSync("src/routes/reservations.$id.tsx", "utf8");
const SERVER = readFileSync("src/lib/reservation-operations.server.ts", "utf8");

const ROOM_A = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// 1 — structured destination
// ---------------------------------------------------------------------------

describe("room_change destination is server-derived and safe", () => {
  it("extracts only the validated destination id", () => {
    expect(destinationHotelRoomIdOf("room_change", { to_hotel_room_id: ROOM_A })).toBe(ROOM_A);
  });

  it("returns null for a malformed or missing destination — never a guess", () => {
    expect(destinationHotelRoomIdOf("room_change", { to_hotel_room_id: "501" })).toBeNull();
    expect(destinationHotelRoomIdOf("room_change", {})).toBeNull();
    expect(destinationHotelRoomIdOf("room_change", null)).toBeNull();
    expect(destinationHotelRoomIdOf("room_change", { to_hotel_room_id: 501 })).toBeNull();
  });

  it("never exposes a destination for other operation types", () => {
    expect(destinationHotelRoomIdOf("rate_change", { to_hotel_room_id: ROOM_A })).toBeNull();
    expect(destinationHotelRoomIdOf("early_check_in", { to_hotel_room_id: ROOM_A })).toBeNull();
  });

  it("keeps the generic server summary — the destination is not encoded in text", () => {
    expect(summarizeOperation("room_change", { preserve_rate: true })).toBe(
      "Move rooms, keep rate",
    );
  });

  it("exposes only the safe field on the DTO, never the raw payload", () => {
    expect(SERVER).toContain("destinationHotelRoomId: string | null;");
    expect(SERVER).not.toMatch(/payload:\s*r\.payload/);
    // The DTO row mapper only ever ships the derived id.
    expect(SERVER).toContain(
      "destinationHotelRoomId: destinationHotelRoomIdOf(r.operation_type, r.payload ?? {}),",
    );
  });

  it("reads operation rows positively scoped to tenant AND reservation", () => {
    expect(SERVER).toContain('.eq("tenant_id", tenantId)');
    expect(SERVER).toContain('.eq("reservation_id", reservationId)');
  });

  it("matches the destination by exact id, with tenant-scoped room data only", () => {
    expect(OPS).not.toContain("pendingRoomChangeDestinationLabel");
    expect(OPS).not.toContain("request.summary.includes");
    expect(OPS).toContain("(propertyRooms ?? []).find((r) => r.id === destinationHotelRoomId)");
    // Rooms always come from the tenant-scoped property endpoint.
    expect(OPS).toContain('hotelJson<{ rooms: PropertyRoom[] }>("/api/hotel/rooms")');
  });

  it("shows readable destination info plus current housekeeping readiness", () => {
    expect(OPS).toContain("Destination room:");
    expect(OPS).toContain("Housekeeping now:");
    expect(OPS).toContain("Base rate");
    // Unresolvable destination (cross-tenant or malformed id) stays unknown.
    expect(OPS).toContain("does not carry a recognised destination room");
  });
});

// ---------------------------------------------------------------------------
// 2 — specific readiness conditions
// ---------------------------------------------------------------------------

const state = (over: Partial<Parameters<typeof checkInBlockers>[0]> = {}) => ({
  initialized: true,
  condition: "ready" as const,
  dndActive: false,
  occupancy: "vacant" as const,
  isActive: true,
  ...over,
});

describe("readiness refusals name the actual condition", () => {
  it("maps each concrete condition to its own stable code", () => {
    expect(checkInBlockers(state({ condition: "dirty" }))).toContain("room_dirty");
    expect(checkInBlockers(state({ condition: "cleaning" }))).toContain("room_cleaning");
    expect(checkInBlockers(state({ condition: "inspected" }))).toContain("room_inspected");
  });

  it("keeps the uninitialized, DND and no-blocker rules unchanged", () => {
    expect(checkInBlockers(state({ initialized: false, condition: null }))).toEqual([
      "housekeeping_not_initialized",
    ]);
    expect(checkInBlockers(state({ dndActive: true }))).toEqual(["dnd_active"]);
    expect(checkInBlockers(state())).toEqual([]);
  });

  it("still blocks a non-Ready room that is also DND", () => {
    const b = checkInBlockers(state({ condition: "dirty", dndActive: true }));
    expect(b[0]).toBe("room_dirty");
    expect(b).toContain("dnd_active");
  });

  it("restates each condition from the destination room's side", () => {
    expect(destinationBlockerCode("room_dirty")).toBe("destination_room_dirty");
    expect(destinationBlockerCode("room_cleaning")).toBe("destination_room_cleaning");
    expect(destinationBlockerCode("room_inspected")).toBe("destination_room_inspected");
    expect(destinationBlockerCode("housekeeping_not_initialized")).toBe(
      "destination_housekeeping_not_initialized",
    );
    expect(destinationBlockerCode("dnd_active")).toBe("destination_dnd_active");
    expect(destinationBlockerCode("handoff_pending")).toBe("handoff_pending");
  });

  it("treats them as known 409 housekeeping refusals, not server faults", () => {
    for (const code of [
      "room_dirty",
      "room_cleaning",
      "room_inspected",
      "destination_room_dirty",
      "destination_room_cleaning",
      "destination_room_inspected",
    ]) {
      expect(OPERATION_ERROR_CODES.has(code)).toBe(true);
      expect(statusForOperationError(code)).toBe(409);
    }
  });

  it("classifies concrete conditions as housekeeping-blocked check-ins", () => {
    for (const code of ["housekeeping_not_initialized", "room_dirty", "room_cleaning", "room_inspected", "dnd_active"]) {
      expect(HOUSEKEEPING_BLOCKER_CODES.has(code)).toBe(true);
    }
    expect(HOUSEKEEPING_BLOCKER_CODES.has("reservation_not_found")).toBe(false);
    const checkin = readFileSync("src/routes/api/hotel/reservations.$id.check-in.ts", "utf8");
    expect(checkin).toContain("HOUSEKEEPING_BLOCKER_CODES.has(code)");
  });

  it("speaks plain language, never a raw code", () => {
    const cases: Array<[string, RegExp]> = [
      ["room_dirty", /Dirty/],
      ["room_cleaning", /still being cleaned/],
      ["room_inspected", /waiting to be marked Ready/],
      ["destination_room_dirty", /destination room is Dirty/],
      ["destination_room_cleaning", /destination room is still being cleaned/],
      ["destination_room_inspected", /destination room is still waiting/],
    ];
    for (const [code, re] of cases) {
      const msg = operationErrorMessage(code);
      expect(msg).toMatch(re);
      expect(msg).not.toContain("_");
    }
    expect(blockerLabel("room_dirty")).toMatch(/Dirty/);
    expect(blockerLabel("room_cleaning")).toMatch(/cleaned/);
    expect(blockerLabel("room_inspected")).toMatch(/Ready/);
  });
});

// ---------------------------------------------------------------------------
// 3 — room-change picker
// ---------------------------------------------------------------------------

describe("room-change picker never offers the current room", () => {
  it("carries the current physical room id through ActionRoom", () => {
    expect(OPS).toContain("hotelRoomId: string;");
    expect(OPS).toContain("currentReservationRoom?.hotelRoomId ?? null");
    expect(DETAIL).toContain("hotelRoomId: r.hotelRoomId,");
  });

  it("excludes exactly that hotel room from the destination list", () => {
    expect(OPS).toContain(".filter((r) => r.id !== currentHotelRoomId)");
  });

  it("preselects the only reservation room when there is just one", () => {
    expect(OPS).toContain("setReservationRoomId(rooms.length === 1 ? rooms[0]!.id : \"\")");
  });

  it("keeps not-ready rooms visible with their housekeeping badge", () => {
    expect(OPS).toContain(".filter((r) => r.isActive)");
    expect(OPS).toContain("housekeepingBadge(r.id, hkBoard.data)");
  });
});
