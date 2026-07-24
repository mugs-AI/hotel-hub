/**
 * Focused tests for the arrival-date-past guard on New Reservation.
 * - today accepted
 * - yesterday rejected with stable `arrival_date_in_past` code
 * - invalid departure (<=arrival) still rejected
 */
import { describe, expect, it } from "vitest";
import { validateStayDates } from "@/lib/reservations-ui";
import { addDaysIso, todayInKualaLumpurIso } from "@/lib/malaysia-date";

describe("arrival-date-past guard (new reservation only)", () => {
  const today = todayInKualaLumpurIso();
  const tomorrow = addDaysIso(today, 1);
  const yesterday = addDaysIso(today, -1);

  it("accepts today as arrival with tomorrow as departure", () => {
    expect(validateStayDates(today, tomorrow, { today })).toEqual({ ok: true });
  });

  it("rejects yesterday as arrival with arrival_date_in_past", () => {
    expect(validateStayDates(yesterday, tomorrow, { today })).toEqual({
      ok: false,
      code: "arrival_date_in_past",
    });
  });

  it("rejects departure not later than arrival", () => {
    expect(validateStayDates(today, today, { today })).toEqual({
      ok: false,
      code: "invalid_stay_dates",
    });
  });
});
