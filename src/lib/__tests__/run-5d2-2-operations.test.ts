// Run 5D2.2 — focused correctness tests for the hardened operation layer.
import { describe, expect, it } from "vitest";
import {
  validateLateCheckoutWindow,
  validateOperationPayload,
} from "@/lib/reservation-operations.server";
import { statusForOperationError } from "@/lib/operations-api.server";

describe("validateOperationPayload — unknown fields are rejected", () => {
  it("rejects an unknown key instead of silently dropping it", () => {
    const r = validateOperationPayload("early_check_in", { reason: "vip", sneaky: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unknown_field");
  });

  it("rejects unknown keys on rate_change", () => {
    const r = validateOperationPayload("rate_change", {
      reservationRoomId: "11111111-1111-4111-8111-111111111111",
      newAgreedRate: 100,
      reason: "long stay",
      approvedBy: "owner",
    });
    expect(r.ok).toBe(false);
  });

  it("accepts a clean payload", () => {
    const r = validateOperationPayload("stay_extension", { newDepartureDate: "2026-08-20" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.new_departure_date).toBe("2026-08-20");
  });

  it("rejects a non-object payload", () => {
    expect(validateOperationPayload("early_check_in", "nope").ok).toBe(false);
  });
});

describe("validateLateCheckoutWindow", () => {
  const base = {
    departureDate: "2026-08-10",
    standardCheckOutTime: "12:00",
    timezone: "Asia/Kuala_Lumpur",
  };

  it("accepts a later time on the departure date", () => {
    expect(
      validateLateCheckoutWindow({ ...base, expectedCheckOutAtIso: "2026-08-10T16:00:00+08:00" }),
    ).toMatchObject({ ok: true });
  });

  it("rejects a time earlier than the standard checkout", () => {
    const r = validateLateCheckoutWindow({
      ...base,
      expectedCheckOutAtIso: "2026-08-10T09:00:00+08:00",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("late_checkout_not_later");
  });

  it("rejects a different calendar day in the property timezone", () => {
    const r = validateLateCheckoutWindow({
      ...base,
      expectedCheckOutAtIso: "2026-08-11T16:00:00+08:00",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("late_checkout_out_of_range");
  });

  it("evaluates the day in the property timezone, not UTC", () => {
    // 2026-08-10T20:00+08:00 is 12:00 UTC on the same KL day.
    expect(
      validateLateCheckoutWindow({ ...base, expectedCheckOutAtIso: "2026-08-10T12:00:00Z" }),
    ).toMatchObject({ ok: true });
  });
});

describe("statusForOperationError", () => {
  it("maps the new validation codes to 400", () => {
    expect(statusForOperationError("unknown_field")).toBe(400);
    expect(statusForOperationError("late_checkout_out_of_range")).toBe(400);
    expect(statusForOperationError("late_checkout_not_later")).toBe(400);
  });
});
