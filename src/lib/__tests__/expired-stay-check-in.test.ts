import { describe, expect, it } from "vitest";
import { checkInActionFor, OPERATION_ERROR_CODES } from "../reservation-operations.server";
import { operationErrorMessage } from "../operations-client";
import { statusForOperationError } from "../operations-api.server";

describe("check-in stays within the booked dates", () => {
  const booking = {
    status: "confirmed",
    arrivalDate: "2026-10-13",
    departureDate: "2026-10-15",
    standardCheckInTime: "15:00",
    timezone: "Asia/Kuala_Lumpur",
  };
  it("blocks expired stays while retaining a late arrival before departure", () => {
    expect(checkInActionFor({ ...booking, now: new Date("2026-10-14T12:00:00Z") })).toBe(
      "check_in",
    );
    expect(checkInActionFor({ ...booking, now: new Date("2026-10-20T12:00:00Z") })).toBeNull();
  });
  it("uses property midnight for the departure boundary", () => {
    expect(checkInActionFor({ ...booking, now: new Date("2026-10-14T15:59:59Z") })).toBe(
      "check_in",
    );
    expect(checkInActionFor({ ...booking, now: new Date("2026-10-14T16:00:00Z") })).toBeNull();
  });
  it.each(["2026-02-30", "", "2026-10-13", "2026-10-12"])(
    "rejects an invalid departure %j",
    (departureDate) => {
      expect(
        checkInActionFor({ ...booking, departureDate, now: new Date("2026-10-13T07:00:00Z") }),
      ).toBeNull();
    },
  );
  it("returns an actionable conflict for a forged expired check-in", () => {
    expect(OPERATION_ERROR_CODES.has("stay_dates_expired")).toBe(true);
    expect(statusForOperationError("stay_dates_expired")).toBe(409);
    expect(operationErrorMessage("stay_dates_expired")).toMatch(/dates.*expired.*availability/i);
  });
});
