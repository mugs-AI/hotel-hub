import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  emptyGuestDraft,
  validateGuests,
  validateGuestsForNewReservation,
  type GuestDraft,
} from "../reservations-ui";

const completeGuest = (): GuestDraft => ({
  ...emptyGuestDraft(true),
  fullName: "A Guest",
  mobile: "0123456789",
  email: "guest@example.com",
  nationalityCode: "MYS",
  identityType: "passport",
  identityNumber: "A1234567",
  addressLine1: "12 Jalan Hotel",
  city: "Ipoh",
  postcode: "30000",
  countryCode: "MYS",
  stateCode: "08",
});

describe("HH-GOLIVE-01J new reservation completeness", () => {
  it("requires every intake field, while notes and address lines 2/3 stay optional", () => {
    const guest = completeGuest();
    expect(validateGuestsForNewReservation([guest])).toEqual({ ok: true });
    const cases: Array<[keyof GuestDraft, string]> = [
      ["mobile", "guest_mobile_required"],
      ["email", "guest_email_required"],
      ["nationalityCode", "guest_nationality_required"],
      ["identityType", "guest_identity_type_required"],
      ["identityNumber", "guest_identity_number_required"],
      ["addressLine1", "guest_address_required"],
      ["city", "guest_city_required"],
      ["postcode", "guest_postcode_required"],
      ["countryCode", "guest_country_required"],
      ["stateCode", "guest_state_required"],
    ];
    for (const [field, code] of cases) {
      expect(validateGuestsForNewReservation([{ ...guest, [field]: "" }])).toMatchObject({
        ok: false,
        code,
      });
    }
    expect(validateGuestsForNewReservation([{ ...guest, email: "not-an-email" }])).toMatchObject({
      ok: false,
      code: "invalid_guest_email",
    });
    expect(
      validateGuestsForNewReservation([{ ...guest, countryCode: "GBR", stateCode: "" }]),
    ).toMatchObject({
      ok: false,
      code: "guest_state_required",
    });
    expect(
      validateGuestsForNewReservation([
        { ...guest, countryCode: "GBR", stateCode: "", stateProvince: "London" },
      ]),
    ).toEqual({ ok: true });
  });

  it("does not retroactively require intake details on historical guest edits", () => {
    const oldGuest = { ...emptyGuestDraft(true), fullName: "Historical Guest" };
    expect(validateGuests([oldGuest])).toEqual({ ok: true });
    expect(validateGuestsForNewReservation([oldGuest])).toMatchObject({
      ok: false,
      code: "guest_mobile_required",
    });
  });
});

describe("HH-GOLIVE-01J pending early check-in recovery migration", () => {
  const sql = readFileSync(
    new URL(
      "../../../supabase/migrations/20260925160000_hh_golive_01j_early_check_in_pending_recovery.sql",
      import.meta.url,
    ),
    "utf8",
  );

  it("only resumes the same actor and payload within the same reservation and tenant", () => {
    expect(sql).toContain("EXCEPTION WHEN SQLSTATE 'HH225'");
    expect(sql).toContain("p_operation_type <> 'early_check_in'");
    expect(sql).toContain("reservation_id = p_reservation_id");
    expect(sql).toContain("requested_by_n3_user_key IS DISTINCT FROM p_actor_n3_user_key");
    expect(sql).toContain("payload IS DISTINCT FROM COALESCE(p_payload, '{}'::jsonb)");
    expect(sql).toContain("MESSAGE = 'idempotency_conflict'");
  });

  it("performs the locked readiness gate before applying the recovered request", () => {
    const pending = sql.indexOf("v_request_id := v_pending.id");
    const ready = sql.indexOf("hotelhub_hk_readiness_blocker_locked(p_tenant_id, v_room_ids)");
    const apply = sql.indexOf("hotelhub_decide_operation(");
    expect(pending).toBeGreaterThan(0);
    expect(ready).toBeGreaterThan(pending);
    expect(apply).toBeGreaterThan(ready);
    expect(sql).toContain("TO service_role");
  });

  it("serializes a retry and replays the applied decision for the same click", () => {
    const lock = sql.indexOf("pg_advisory_xact_lock(");
    const replay = sql.indexOf("decision_idempotency_key = p_idempotency_key || ':direct'");
    const request = sql.indexOf("FROM public.hotelhub_request_operation(");
    expect(lock).toBeGreaterThan(0);
    expect(replay).toBeGreaterThan(lock);
    expect(request).toBeGreaterThan(replay);
    expect(sql).toContain("v_replay.state IS DISTINCT FROM 'applied'");
  });
});
