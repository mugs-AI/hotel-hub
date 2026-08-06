/**
 * Run 5D2.3 — timezone-safe late checkout + check-in idempotency contract.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  zonedLocalToUtcMs,
  validateLateCheckoutWindow,
  OPERATION_ERROR_CODES,
} from "../reservation-operations.server";

const CHECKIN_ROUTE = readFileSync(
  resolve(__dirname, "../../routes/api/hotel/reservations.$id.check-in.ts"),
  "utf8",
);
const OPS_UI = readFileSync(resolve(__dirname, "../../components/ReservationOperations.tsx"), "utf8");

describe("zonedLocalToUtcMs", () => {
  it("resolves a KL wall clock through the IANA database", () => {
    const ms = zonedLocalToUtcMs("2026-08-10T18:30", "Asia/Kuala_Lumpur");
    expect(new Date(ms!).toISOString()).toBe("2026-08-10T10:30:00.000Z");
  });

  it("respects DST in a zone that observes it", () => {
    const summer = zonedLocalToUtcMs("2026-07-01T12:00", "Europe/London");
    const winter = zonedLocalToUtcMs("2026-01-01T12:00", "Europe/London");
    expect(new Date(summer!).toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(new Date(winter!).toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("rejects malformed or offset-bearing input", () => {
    expect(zonedLocalToUtcMs("2026-08-10T18:30+08:00", "Asia/Kuala_Lumpur")).toBeNull();
    expect(zonedLocalToUtcMs("not-a-date", "Asia/Kuala_Lumpur")).toBeNull();
  });
});

describe("validateLateCheckoutWindow with property-local input", () => {
  const base = {
    departureDate: "2026-08-10",
    standardCheckOutTime: "12:00",
    timezone: "Asia/Kuala_Lumpur",
  };

  it("accepts a later time on the departure date and returns the UTC instant", () => {
    const r = validateLateCheckoutWindow({ ...base, expectedCheckOutLocal: "2026-08-10T18:00" });
    expect(r).toEqual({ ok: true, utcIso: "2026-08-10T10:00:00.000Z" });
  });

  it("rejects a time at or before the standard checkout", () => {
    expect(
      validateLateCheckoutWindow({ ...base, expectedCheckOutLocal: "2026-08-10T11:00" }),
    ).toEqual({ ok: false, code: "late_checkout_not_later" });
  });

  it("rejects a different departure day", () => {
    expect(
      validateLateCheckoutWindow({ ...base, expectedCheckOutLocal: "2026-08-11T18:00" }),
    ).toEqual({ ok: false, code: "late_checkout_out_of_range" });
  });
});

describe("check-in idempotency and safety contract", () => {
  it("route validates clientRequestId as a UUID and forwards it", () => {
    expect(CHECKIN_ROUTE).toMatch(/isUuid\(clientRequestId\)/);
    expect(CHECKIN_ROUTE).toMatch(/clientRequestId:/);
  });

  it("new refusal codes are recognised operation errors", () => {
    expect(OPERATION_ERROR_CODES.has("primary_guest_required")).toBe(true);
    expect(OPERATION_ERROR_CODES.has("guest_assignment_required")).toBe(true);
    expect(OPERATION_ERROR_CODES.has("idempotency_conflict")).toBe(true);
  });
});

describe("Actions card status rules", () => {
  it("never hard-codes a numeric UTC offset in the browser", () => {
    expect(OPS_UI).not.toMatch(/\+08:00/);
    expect(OPS_UI).toMatch(/expectedCheckOutLocal/);
  });

  it("only terminal statuses are read-only", () => {
    expect(OPS_UI).toMatch(/TERMINAL_STATUSES\.has\(status\)/);
    expect(OPS_UI).toMatch(/statuses:\s*\["confirmed",\s*"checked_in"\]/);
  });
});
