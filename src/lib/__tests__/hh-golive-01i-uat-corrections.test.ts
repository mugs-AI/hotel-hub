import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkInActionFor, OPERATION_ERROR_CODES } from "../reservation-operations.server";
import { operationErrorMessage } from "../operations-client";
import { housekeepingAuthority, SETUP_OWNER_ONLY_SHORT } from "../housekeeping";

const actionsSource = readFileSync(
  new URL("../../components/ReservationOperations.tsx", import.meta.url),
  "utf8",
);
const detailRouteSource = readFileSync(
  new URL("../../routes/api/hotel/reservations.$id.ts", import.meta.url),
  "utf8",
);
const operationsRouteSource = readFileSync(
  new URL("../../routes/api/hotel/reservations.$id.operations.ts", import.meta.url),
  "utf8",
);

describe("HH-GOLIVE-01I property-time check-in action", () => {
  const base = {
    status: "confirmed",
    arrivalDate: "2026-09-24",
    standardCheckInTime: "15:00",
    timezone: "Asia/Kuala_Lumpur",
  };

  it("offers early check-in before the property check-in time", () => {
    expect(checkInActionFor({ ...base, now: new Date("2026-09-24T06:59:00.000Z") })).toBe(
      "early_check_in",
    );
  });

  it("switches to standard check-in at the configured property time", () => {
    expect(checkInActionFor({ ...base, now: new Date("2026-09-24T07:00:00.000Z") })).toBe(
      "check_in",
    );
  });

  it("uses early check-in before the arrival date and standard check-in after it", () => {
    expect(checkInActionFor({ ...base, now: new Date("2026-09-23T12:00:00.000Z") })).toBe(
      "early_check_in",
    );
    expect(checkInActionFor({ ...base, now: new Date("2026-09-25T12:00:00.000Z") })).toBe(
      "check_in",
    );
  });

  it("fails closed for a bad timezone or a non-confirmed reservation", () => {
    expect(checkInActionFor({ ...base, timezone: "Not/AZone" })).toBeNull();
    expect(checkInActionFor({ ...base, standardCheckInTime: "25:99" })).toBeNull();
    expect(checkInActionFor({ ...base, status: "checked_in" })).toBeNull();
  });

  it("serves the action from the detail API and renders only the matching button", () => {
    expect(detailRouteSource).toContain("checkInActionFor({");
    expect(detailRouteSource).toContain("checkInAction }");
    expect(actionsSource).toContain('checkInAction === "early_check_in"');
    expect(actionsSource).toContain('checkInAction === "check_in"');
  });

  it("server-rejects a stale early-check-in submission after standard time", () => {
    expect(OPERATION_ERROR_CODES.has("early_check_in_not_required")).toBe(true);
    expect(operationsRouteSource).toContain('if (type === "early_check_in")');
    expect(operationsRouteSource).toContain('action !== "early_check_in"');
  });
});

describe("HH-GOLIVE-01I safe operation feedback", () => {
  it("explains guest prerequisites instead of showing the generic error", () => {
    expect(operationErrorMessage("primary_guest_required")).toContain("primary guest");
    expect(operationErrorMessage("guest_assignment_required")).toContain("Assign every guest");
    expect(operationErrorMessage("room_capacity_exceeded")).toContain("cannot hold");
    expect(operationErrorMessage("room_inspected")).toContain("marked Ready");
  });
});

describe("HH-GOLIVE-01I housekeeping authority explanation", () => {
  it("keeps Dedicated Housekeeper Mark Ready authority", () => {
    expect(housekeepingAuthority("dedicated", "housekeeper").roleTransitions).toContain(
      "mark_ready",
    );
  });

  it("labels only the one-time room initialization as Owner setup", () => {
    expect(SETUP_OWNER_ONLY_SHORT).toBe("Owner setup required");
  });
});
