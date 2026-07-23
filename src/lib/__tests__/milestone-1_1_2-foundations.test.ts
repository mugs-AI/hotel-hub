import { describe, expect, it } from "vitest";
import {
  isValidIsoDate,
  isValidMyDate,
  isoToMyDate,
  myDateToIso,
  formatMyTimestamp,
  isRealCalendarDate,
} from "@/lib/malaysia-date";
import {
  MALAYSIAN_STATES,
  isValidMalaysianStateCode,
  malaysianStateName,
} from "@/lib/malaysia-states";
import {
  COUNTRIES,
  isValidCountryCode,
  normalizeCountryCode,
  countryName,
  searchCountries,
} from "@/lib/iso-countries";
import {
  normalizeIdentity,
  normalizeMyKad,
  normalizePassport,
  maskIdentityNumber,
  identityTypeLabel,
  IDENTITY_TYPES,
} from "@/lib/guest-identity";
import {
  emptyGuestDraft,
  validateGuests,
  buildCreatePayload,
  normalizeExternalBookingReference,
  EXTERNAL_REF_MAX,
} from "@/lib/reservations-ui";

describe("malaysia-date", () => {
  it("accepts real ISO dates and rejects impossible ones", () => {
    expect(isValidIsoDate("2026-07-21")).toBe(true);
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026/07/21")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate(null as unknown as string)).toBe(false);
  });

  it("accepts real Malaysian dates and rejects malformed", () => {
    expect(isValidMyDate("21/07/2026")).toBe(true);
    expect(isValidMyDate("31/02/2026")).toBe(false);
    expect(isValidMyDate("1/1/2026")).toBe(false);
    expect(isValidMyDate("2026-07-21")).toBe(false);
  });

  it("round-trips ISO ↔ my-date", () => {
    expect(isoToMyDate("2026-07-21")).toBe("21/07/2026");
    expect(myDateToIso("21/07/2026")).toBe("2026-07-21");
    expect(myDateToIso("31/02/2026")).toBeNull();
    expect(isoToMyDate("")).toBe("—");
    expect(isoToMyDate(null)).toBe("—");
  });

  it("formats timestamps in Asia/Kuala_Lumpur as dd/mm/yyyy HH:mm", () => {
    // 2026-07-21T00:00:00Z → 08:00 in KL (UTC+8)
    expect(formatMyTimestamp("2026-07-21T00:00:00Z")).toBe("21/07/2026 08:00");
    expect(formatMyTimestamp("")).toBe("—");
    expect(formatMyTimestamp("not-a-date")).toBe("—");
  });

  it("rejects leap-year defects", () => {
    expect(isRealCalendarDate(2025, 2, 29)).toBe(false);
    expect(isRealCalendarDate(2024, 2, 29)).toBe(true);
  });
});

describe("malaysia-states", () => {
  it("has exactly 16 states with unique 2-digit codes", () => {
    expect(MALAYSIAN_STATES).toHaveLength(16);
    const codes = new Set(MALAYSIAN_STATES.map((s) => s.code));
    expect(codes.size).toBe(16);
    for (const s of MALAYSIAN_STATES) expect(s.code).toMatch(/^\d{2}$/);
  });
  it("validates and resolves names", () => {
    expect(isValidMalaysianStateCode("14")).toBe(true);
    expect(isValidMalaysianStateCode("99")).toBe(false);
    expect(malaysianStateName("14")).toBe("W.P. Kuala Lumpur");
    expect(malaysianStateName(null)).toBe("");
  });
});

describe("iso-countries", () => {
  it("places Malaysia first and remaining countries sorted", () => {
    expect(COUNTRIES[0]).toEqual({ alpha3: "MYS", name: "Malaysia" });
    const rest = COUNTRIES.slice(1).map((c) => c.name);
    const sorted = [...rest].sort((a, b) => a.localeCompare(b, "en"));
    expect(rest).toEqual(sorted);
  });
  it("has unique alpha-3 codes", () => {
    const codes = new Set(COUNTRIES.map((c) => c.alpha3));
    expect(codes.size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) expect(c.alpha3).toMatch(/^[A-Z]{3}$/);
  });
  it("validates, normalizes, resolves, and searches", () => {
    expect(isValidCountryCode("MYS")).toBe(true);
    expect(isValidCountryCode("mys")).toBe(true);
    expect(isValidCountryCode("ZZZ")).toBe(false);
    expect(normalizeCountryCode(" sgp ")).toBe("SGP");
    expect(normalizeCountryCode(42 as unknown as string)).toBeNull();
    expect(countryName("SGP")).toBe("Singapore");
    const res = searchCountries("malay");
    expect(res.some((c) => c.alpha3 === "MYS")).toBe(true);
  });
});

describe("guest-identity", () => {
  it("normalizes MyKad by stripping hyphens/spaces", () => {
    expect(normalizeMyKad("880101-14-5678")).toBe("880101145678");
    expect(normalizeMyKad(" 880101 14 5678 ")).toBe("880101145678");
    expect(normalizeMyKad("12345")).toBeNull();
    expect(normalizeMyKad("abcdefghijkl")).toBeNull();
  });
  it("normalizes passport with trim + max length", () => {
    expect(normalizePassport("  A1234567 ")).toBe("A1234567");
    expect(normalizePassport("")).toBeNull();
    expect(normalizePassport("x".repeat(51))).toBeNull();
  });
  it("validates identity pair rules", () => {
    expect(normalizeIdentity("", "")).toEqual({ ok: true, type: null, number: null });
    expect(normalizeIdentity("mykad", "")).toEqual({ ok: false, code: "identity_pair_required" });
    expect(normalizeIdentity("", "x")).toEqual({ ok: false, code: "identity_pair_required" });
    expect(normalizeIdentity("bogus", "x")).toEqual({ ok: false, code: "invalid_identity_type" });
    expect(normalizeIdentity("mykad", "880101-14-5678")).toEqual({
      ok: true,
      type: "mykad",
      number: "880101145678",
    });
    expect(normalizeIdentity("mypr", "12")).toEqual({ ok: false, code: "invalid_mykad" });
    expect(normalizeIdentity("passport", "A1234567")).toEqual({
      ok: true,
      type: "passport",
      number: "A1234567",
    });
  });
  it("masks identity numbers, keeping last 4 chars", () => {
    expect(maskIdentityNumber("880101145678")).toBe("••••••••5678");
    expect(maskIdentityNumber("A1234567")).toBe("••••4567");
    expect(maskIdentityNumber("12")).toBe("••");
    expect(maskIdentityNumber(null)).toBeNull();
    expect(maskIdentityNumber("")).toBeNull();
  });
  it("labels known identity types", () => {
    for (const t of IDENTITY_TYPES) expect(identityTypeLabel(t)).not.toBe("");
    expect(identityTypeLabel("bogus")).toBe("");
    expect(identityTypeLabel("")).toBe("");
  });
});

describe("reservations-ui — extended guest draft + payload", () => {
  it("emptyGuestDraft includes all Correction B fields", () => {
    const g = emptyGuestDraft(true);
    expect(g.identityType).toBe("");
    expect(g.identityNumber).toBe("");
    expect(g.dateOfBirth).toBe("");
    expect(g.addressLine1).toBe("");
    expect(g.state).toBe("");
    expect(g.addressCountry).toBe("");
    expect(g.isPrimary).toBe(true);
  });

  it("validateGuests catches invalid identity/DOB/nationality/state", () => {
    const base = { ...emptyGuestDraft(true), fullName: "Ali" };
    expect(validateGuests([{ ...base, identityType: "mykad", identityNumber: "" }]))
      .toMatchObject({ ok: false, code: "identity_pair_required" });
    expect(validateGuests([{ ...base, dateOfBirth: "2026-02-31" }])).toMatchObject({
      ok: false,
      code: "invalid_date_of_birth",
    });
    expect(validateGuests([{ ...base, nationality: "ZZZ" }])).toMatchObject({
      ok: false,
      code: "invalid_nationality",
    });
    expect(
      validateGuests([
        { ...base, addressCountry: "MYS", addressLine1: "1 Jalan", state: "99" },
      ]),
    ).toMatchObject({ ok: false, code: "invalid_state" });
    expect(validateGuests([base])).toEqual({ ok: true });
  });

  it("buildCreatePayload includes new guest fields + externalBookingReference", () => {
    const guest = {
      ...emptyGuestDraft(true),
      fullName: " Ali ",
      nationality: "MYS",
      identityType: "mykad" as const,
      identityNumber: "880101-14-5678",
      dateOfBirth: "1988-01-01",
      addressLine1: "1 Jalan Bukit",
      city: "Kuala Lumpur",
      state: "14",
      postalCode: "50000",
      addressCountry: "MYS",
    };
    const payload = buildCreatePayload({
      bookingSource: "OTA_AGODA",
      arrivalDate: "2026-07-21",
      departureDate: "2026-07-23",
      notes: "",
      externalBookingReference: "  AGD-12345 ",
      rooms: [],
      guests: [guest],
    });
    expect(payload.externalBookingReference).toBe("AGD-12345");
    expect(payload.guests[0]).toMatchObject({
      fullName: "Ali",
      nationality: "MYS",
      identityType: "mykad",
      identityNumber: "880101145678",
      dateOfBirth: "1988-01-01",
      addressLine1: "1 Jalan Bukit",
      city: "Kuala Lumpur",
      state: "14",
      postalCode: "50000",
      addressCountry: "MYS",
      isPrimary: true,
    });
  });

  it("normalizeExternalBookingReference enforces trim + max length", () => {
    expect(normalizeExternalBookingReference("")).toEqual({ ok: true, value: null });
    expect(normalizeExternalBookingReference("  ")).toEqual({ ok: true, value: null });
    expect(normalizeExternalBookingReference(" AB ")).toEqual({ ok: true, value: "AB" });
    expect(normalizeExternalBookingReference("x".repeat(EXTERNAL_REF_MAX + 1))).toEqual({
      ok: false,
      code: "external_ref_too_long",
    });
  });
});
