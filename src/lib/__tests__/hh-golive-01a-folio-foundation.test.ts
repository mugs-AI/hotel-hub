/**
 * HH-GOLIVE-01A — authoritative folio, add-on catalogue and Malaysia
 * tax/levy readiness. Pure-domain proof: money safety, nightly snapshots,
 * reversal-only correction, and fail-closed tax readiness.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyBasisPoints,
  formatCents,
  multiplyCents,
  parseCents,
  roundHalfUp,
  roundingAdjustmentCents,
  sumCents,
  MAX_CENTS,
} from "../folio-money";
import {
  isUsableAddon,
  mappingStatus,
  missingMappings,
  validateAddonInput,
  type AddonItem,
} from "../charges-catalogue";
import {
  applySettingsPatch,
  defaultFinancialSettings,
  isEffectiveOn,
  resolveServiceTaxRate,
  validateSettingsPatch,
  type FinancialSettings,
} from "../financial-settings";
import {
  assessTourismTax,
  canReverseLine,
  computeFolio,
  isTourismTaxExempt,
  netByTaxClass,
  planMissingRoomNights,
  stayDates,
  type StoredFolioLine,
} from "../folio";

const settings = (over: (s: FinancialSettings) => void = () => {}): FinancialSettings => {
  const s = defaultFinancialSettings("t1");
  over(s);
  return s;
};

const line = (p: Partial<StoredFolioLine>): StoredFolioLine => ({
  id: p.id ?? "l1",
  lineType: p.lineType ?? "add_on",
  status: p.status ?? "committed",
  taxClass: p.taxClass ?? "accommodation",
  description: p.description ?? "Line",
  quantity: p.quantity ?? 1,
  unitPriceCents: p.unitPriceCents ?? 0,
  subtotalCents: p.subtotalCents ?? 0,
  reversesLineId: p.reversesLineId ?? null,
  reason: p.reason ?? null,
  stayDate: p.stayDate ?? null,
  reservationRoomId: p.reservationRoomId ?? null,
  roomLabel: p.roomLabel ?? null,
  actorLabel: p.actorLabel ?? null,
  createdAt: p.createdAt ?? "2026-09-01T00:00:00.000Z",
});

describe("folio money — integer cents only, fail closed", () => {
  it("parses at most two decimals and rejects the rest", () => {
    expect(parseCents("120.50")).toBe(12050);
    expect(parseCents(0)).toBe(0);
    expect(parseCents("120.505")).toBeNull();
    expect(parseCents(-1)).toBeNull();
    expect(parseCents("abc")).toBeNull();
    expect(parseCents(MAX_CENTS)).toBeNull();
  });

  it("rounds half up away from zero deterministically", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(applyBasisPoints(10_005, 800)).toBe(800); // 80.04 -> 800.4 cents
    expect(applyBasisPoints(1, 5000)).toBe(1); // 0.5 cent rounds up
  });

  it("refuses malformed or overflowing arithmetic", () => {
    expect(multiplyCents(100, 0)).toBeNull();
    expect(multiplyCents(MAX_CENTS, 9999)).toBeNull();
    expect(applyBasisPoints(100, 10_001)).toBeNull();
    expect(sumCents([1, Number.NaN])).toBeNull();
    expect(sumCents([10, -3])).toBe(7);
  });

  it("rounds cash totals only when a mode is configured", () => {
    expect(roundingAdjustmentCents(1003, "none")).toBe(0);
    expect(roundingAdjustmentCents(1003, "nearest_5_cents")).toBe(2);
    expect(roundingAdjustmentCents(1002, "nearest_5_cents")).toBe(-2);
    expect(roundingAdjustmentCents(1004, "nearest_10_cents")).toBe(6);
    expect(formatCents(-12345)).toBe("-MYR 123.45");
  });
});

describe("add-on catalogue — unmapped items are unusable", () => {
  const item = (over: Partial<AddonItem> = {}): AddonItem => ({
    id: "a1",
    category: "breakfast",
    taxClass: "food_and_beverage",
    displayName: "Breakfast",
    description: null,
    isActive: true,
    defaultUnitPriceCents: 2500,
    n3StockId: "s1",
    n3UomId: "u1",
    n3TaxCodeId: "tc1",
    n3StockCodeSnapshot: "BF",
    n3StockNameSnapshot: "Breakfast",
    n3UomSnapshot: "PAX",
    n3TaxCodeSnapshot: "SST6",
    sortOrder: 0,
    ...over,
  });

  it("requires every immutable N3 identifier before use", () => {
    expect(isUsableAddon(item())).toBe(true);
    expect(isUsableAddon(item({ n3UomId: null }))).toBe(false);
    expect(isUsableAddon(item({ isActive: false }))).toBe(false);
    expect(mappingStatus(item({ n3TaxCodeId: null }))).toBe("incomplete");
    expect(missingMappings(item({ n3StockId: null, n3UomId: null }))).toEqual(["stock", "uom"]);
  });

  it("validates owner input and still allows saving an unmapped draft", () => {
    const ok = validateAddonInput({
      category: "laundry",
      taxClass: "other_taxable_service",
      displayName: "  Laundry  ",
      defaultUnitPriceCents: 1500,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.displayName).toBe("Laundry");
      expect(mappingStatus(ok.value)).toBe("incomplete");
    }
    expect(validateAddonInput({ category: "nope", taxClass: "non_taxable", displayName: "x", defaultUnitPriceCents: 0 })).toEqual({
      ok: false,
      code: "invalid_category",
    });
    expect(
      validateAddonInput({ category: "other", taxClass: "non_taxable", displayName: "x", defaultUnitPriceCents: 1.5 }),
    ).toEqual({ ok: false, code: "invalid_unit_price" });
  });
});

describe("financial settings — nothing is assumed", () => {
  it("defaults to not registered, nothing enabled, no rates", () => {
    const s = defaultFinancialSettings("t1");
    expect(s.serviceTaxRegistered).toBe(false);
    expect(s.serviceTax.accommodation.rateBp).toBeNull();
    expect(s.tourismTax.enabled).toBe(false);
    expect(s.localLevy.enabled).toBe(false);
    expect(s.rounding.mode).toBe("none");
  });

  it("fails closed when a registered property has no rate or tax code", () => {
    const unmapped = settings((s) => {
      s.serviceTaxRegistered = true;
    });
    expect(resolveServiceTaxRate(unmapped, "accommodation")).toEqual({
      ok: false,
      code: "service_tax_rate_unmapped",
    });
    const noCode = settings((s) => {
      s.serviceTaxRegistered = true;
      s.serviceTax.accommodation.rateBp = 800;
    });
    expect(resolveServiceTaxRate(noCode, "accommodation")).toEqual({
      ok: false,
      code: "service_tax_code_unmapped",
    });
    expect(resolveServiceTaxRate(defaultFinancialSettings("t"), "accommodation")).toEqual({
      ok: true,
      rateBp: 0,
      source: "not_registered",
    });
  });

  it("validates and applies an owner patch, rejecting bad shapes", () => {
    const r = validateSettingsPatch({
      serviceTaxRegistered: true,
      serviceTax: { accommodation: { rateBp: 800, n3TaxCodeId: "tc-1" } },
      tourismTax: { enabled: true, centsPerRoomNight: 1000, effectiveFrom: "2026-01-01" },
      rounding: { mode: "nearest_5_cents" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const next = applySettingsPatch(defaultFinancialSettings("t1"), r.patch);
      expect(next.serviceTax.accommodation.rateBp).toBe(800);
      expect(next.tourismTax.centsPerRoomNight).toBe(1000);
      expect(next.rounding.mode).toBe("nearest_5_cents");
    }
    expect(validateSettingsPatch({ serviceTax: { accommodation: { rateBp: 20000 } } })).toEqual({
      ok: false,
      code: "invalid_tax_rate",
    });
    expect(validateSettingsPatch({ tourismTax: { enabled: true, centsPerRoomNight: 0 } })).toEqual({
      ok: false,
      code: "tourism_tax_amount_required",
    });
    expect(validateSettingsPatch({})).toEqual({ ok: false, code: "no_valid_fields" });
    expect(
      validateSettingsPatch({ localLevy: { effectiveFrom: "2026-05-01", effectiveTo: "2026-04-01" } }),
    ).toEqual({ ok: false, code: "invalid_localLevy_effective_date" });
  });

  it("honours effective dating windows", () => {
    const w = { effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" };
    expect(isEffectiveOn(w, "2026-01-01")).toBe(true);
    expect(isEffectiveOn(w, "2025-12-31")).toBe(false);
    expect(isEffectiveOn({ effectiveFrom: null, effectiveTo: null }, "2030-01-01")).toBe(true);
  });
});

describe("nightly room snapshots", () => {
  it("derives arrival-inclusive, departure-exclusive nights", () => {
    expect(stayDates("2026-09-01", "2026-09-04")).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
    expect(stayDates("2026-09-01", "2026-09-01")).toEqual([]);
  });

  it("never rewrites an existing night and never duplicates on extension", () => {
    const room = {
      reservationRoomId: "rr1",
      hotelRoomId: "r1",
      roomLabel: "101",
      arrivalDate: "2026-09-01",
      departureDate: "2026-09-03",
      nightlyRateCents: 20000,
    };
    const existing = [{ reservationRoomId: "rr1", stayDate: "2026-09-01" }];
    const planned = planMissingRoomNights([room], existing);
    expect(planned.map((p) => p.stayDate)).toEqual(["2026-09-02"]);

    // rate increased afterwards + stay extended: only new nights are planned
    const extended = { ...room, departureDate: "2026-09-04", nightlyRateCents: 30000 };
    const planned2 = planMissingRoomNights(
      [extended],
      [
        { reservationRoomId: "rr1", stayDate: "2026-09-01" },
        { reservationRoomId: "rr1", stayDate: "2026-09-02" },
      ],
    );
    expect(planned2).toHaveLength(1);
    expect(planned2[0]).toMatchObject({ stayDate: "2026-09-03", unitPriceCents: 30000 });
  });
});

describe("correction is reversal-only", () => {
  it("requires a reason, blocks double reversal and protects room nights", () => {
    const l = line({ id: "x" });
    expect(canReverseLine(l, "wrong amount", false)).toEqual({ ok: true });
    expect(canReverseLine(l, "  ", false)).toEqual({ ok: false, code: "reason_required" });
    expect(canReverseLine(l, "duplicate", true)).toEqual({ ok: false, code: "already_reversed" });
    expect(canReverseLine({ ...l, status: "reversed" }, "again", false)).toEqual({
      ok: false,
      code: "already_reversed",
    });
    expect(canReverseLine(line({ lineType: "room_night" }), "nope", false)).toEqual({
      ok: false,
      code: "room_night_not_reversible",
    });
    expect(canReverseLine(null, "x", false)).toEqual({ ok: false, code: "line_not_found" });
  });

  it("excludes reversed lines from the taxable base", () => {
    const net = netByTaxClass([
      line({ id: "a", subtotalCents: 10000 }),
      line({ id: "b", subtotalCents: 5000, status: "reversed" }),
      line({ id: "c", subtotalCents: -2000, lineType: "reversal", reversesLineId: "a", reason: "x" }),
    ]);
    expect(net.get("accommodation")).toBe(8000);
  });
});

describe("tourism tax", () => {
  const base = settings((s) => {
    s.tourismTax = {
      enabled: true,
      centsPerRoomNight: 1000,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    };
  });

  it("exempts citizens and permanent residents", () => {
    expect(isTourismTaxExempt("malaysian_citizen")).toBe(true);
    expect(isTourismTaxExempt("malaysian_pr")).toBe(true);
    expect(isTourismTaxExempt("foreign_tourist")).toBe(false);
    const r = assessTourismTax({
      settings: base,
      guestTaxClass: "malaysian_citizen",
      occupiedRoomNights: 3,
      alreadyCollectedCents: 0,
      propertyDate: "2026-09-01",
    });
    expect(r.chargeCents).toBe(0);
    expect(r.applicable).toBe(false);
  });

  it("charges per occupied room-night for foreign tourists", () => {
    const r = assessTourismTax({
      settings: base,
      guestTaxClass: "foreign_tourist",
      occupiedRoomNights: 4,
      alreadyCollectedCents: 0,
      propertyDate: "2026-09-01",
    });
    expect(r.chargeCents).toBe(4000);
  });

  it("never triggers on a deposit alone (no occupied room-nights)", () => {
    const r = assessTourismTax({
      settings: base,
      guestTaxClass: "foreign_tourist",
      occupiedRoomNights: 0,
      alreadyCollectedCents: 0,
      propertyDate: "2026-09-01",
    });
    expect(r.chargeCents).toBe(0);
    expect(r.blockers).toHaveLength(0);
  });

  it("blocks when the guest classification is unknown", () => {
    const r = assessTourismTax({
      settings: base,
      guestTaxClass: "unknown",
      occupiedRoomNights: 2,
      alreadyCollectedCents: 0,
      propertyDate: "2026-09-01",
    });
    expect(r.chargeCents).toBe(0);
    expect(r.blockers.some((b) => b.code === "tourism_tax_guest_class_unknown" && b.severity === "blocking")).toBe(true);
  });

  it("credits an amount already collected by a platform, without going negative", () => {
    const r = assessTourismTax({
      settings: base,
      guestTaxClass: "foreign_tourist",
      occupiedRoomNights: 2,
      alreadyCollectedCents: 5000,
      propertyDate: "2026-09-01",
    });
    expect(r.grossCents).toBe(2000);
    expect(r.creditedCents).toBe(2000);
    expect(r.chargeCents).toBe(0);
    expect(r.blockers.some((b) => b.code === "tourism_tax_collected_by_platform")).toBe(true);
  });

  it("respects the effective window", () => {
    const r = assessTourismTax({
      settings: base,
      guestTaxClass: "foreign_tourist",
      occupiedRoomNights: 2,
      alreadyCollectedCents: 0,
      propertyDate: "2025-06-01",
    });
    expect(r.chargeCents).toBe(0);
  });
});

describe("authoritative folio computation", () => {
  const roomNights = [
    line({ id: "n1", lineType: "room_night", subtotalCents: 20000, stayDate: "2026-09-01" }),
    line({ id: "n2", lineType: "room_night", subtotalCents: 20000, stayDate: "2026-09-02" }),
  ];

  it("totals room-only stays with no tax when the property is not registered", () => {
    const r = computeFolio({
      currency: "MYR",
      settings: defaultFinancialSettings("t1"),
      lines: roomNights,
      guestTaxClass: "malaysian_citizen",
      occupiedRoomNights: 2,
      tourismTaxCollectedCents: 0,
      propertyDate: "2026-09-03",
    });
    expect(r.totals.chargesCents).toBe(40000);
    expect(r.totals.serviceTaxCents).toBe(0);
    expect(r.totals.grandTotalCents).toBe(40000);
    expect(r.calculationComplete).toBe(true);
  });

  it("applies service charge then service tax, and tourism tax, deterministically", () => {
    const s = settings((x) => {
      x.serviceTaxRegistered = true;
      x.serviceTax.accommodation = { rateBp: 800, n3TaxCodeId: "tc-a", n3TaxCodeSnapshot: "SST8" };
      x.serviceCharge = { enabled: true, percentBp: 1000, serviceTaxApplies: true };
      x.tourismTax = {
        enabled: true,
        centsPerRoomNight: 1000,
        effectiveFrom: null,
        effectiveTo: null,
      };
    });
    const r = computeFolio({
      currency: "MYR",
      settings: s,
      lines: roomNights,
      guestTaxClass: "foreign_tourist",
      occupiedRoomNights: 2,
      tourismTaxCollectedCents: 0,
      propertyDate: "2026-09-03",
    });
    expect(r.totals.serviceChargeCents).toBe(4000); // 10% of 40000
    expect(r.totals.serviceTaxCents).toBe(3520); // 8% of 40000 + 8% of 4000
    expect(r.totals.tourismTaxCents).toBe(2000);
    expect(r.totals.grandTotalCents).toBe(49520);
    expect(r.calculationComplete).toBe(true);
    // Same input, same output.
    expect(computeFolio({
      currency: "MYR",
      settings: s,
      lines: roomNights,
      guestTaxClass: "foreign_tourist",
      occupiedRoomNights: 2,
      tourismTaxCollectedCents: 0,
      propertyDate: "2026-09-03",
    }).totals).toEqual(r.totals);
  });

  it("blocks when a registered property has an unmapped rate", () => {
    const s = settings((x) => {
      x.serviceTaxRegistered = true;
    });
    const r = computeFolio({
      currency: "MYR",
      settings: s,
      lines: roomNights,
      guestTaxClass: "malaysian_citizen",
      occupiedRoomNights: 2,
      tourismTaxCollectedCents: 0,
      propertyDate: "2026-09-03",
    });
    expect(r.calculationComplete).toBe(false);
    expect(r.blockers.some((b) => b.code.startsWith("service_tax_rate_unmapped"))).toBe(true);
    expect(r.totals.serviceTaxCents).toBe(0);
  });

  it("blocks rounding without a mapped rounding account, and unmapped stock/add-ons", () => {
    const s = settings((x) => {
      x.rounding.mode = "nearest_5_cents";
    });
    const r = computeFolio({
      currency: "MYR",
      settings: s,
      lines: [line({ id: "a", subtotalCents: 10003 })],
      guestTaxClass: "malaysian_citizen",
      occupiedRoomNights: 1,
      tourismTaxCollectedCents: 0,
      propertyDate: "2026-09-03",
      unmappedRoomLabels: ["101"],
      unmappedAddonNames: ["Laundry"],
    });
    expect(r.totals.roundingCents).toBe(2);
    expect(r.totals.grandTotalCents).toBe(10005);
    for (const code of ["rounding_account_unmapped", "room_stock_unmapped", "addon_mapping_incomplete"]) {
      expect(r.blockers.some((b) => b.code === code && b.severity === "blocking")).toBe(true);
    }
    expect(r.calculationComplete).toBe(false);
  });

  it("charges a local levy per occupied room-night only inside its window", () => {
    const s = settings((x) => {
      x.localLevy = {
        enabled: true,
        label: "Heritage Tax",
        centsPerRoomNight: 200,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
      };
    });
    const inside = computeFolio({
      currency: "MYR",
      settings: s,
      lines: roomNights,
      guestTaxClass: "malaysian_citizen",
      occupiedRoomNights: 2,
      tourismTaxCollectedCents: 0,
      propertyDate: "2026-09-03",
    });
    expect(inside.totals.localLevyCents).toBe(400);
    const outside = computeFolio({
      currency: "MYR",
      settings: s,
      lines: roomNights,
      guestTaxClass: "malaysian_citizen",
      occupiedRoomNights: 2,
      tourismTaxCollectedCents: 0,
      propertyDate: "2027-01-05",
    });
    expect(outside.totals.localLevyCents).toBe(0);
  });
});

describe("staged migration contract", () => {
  const sql = (() => {
    const p = resolve(
      __dirname,
      "../../../db/migrations-pending/20260827162500_hh_golive_01a_folio_foundation.sql",
    );
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  })();

  it("is staged, additive and never executed against live data", () => {
    expect(sql).not.toBe("");
    expect(sql).toMatch(/NOT EXECUTED/);
    expect(sql).not.toMatch(/\b(drop\s+table|alter\s+table\s+\w+\s+drop|delete\s+from|truncate)\b/i);
    expect(sql).not.toMatch(/\binsert\s+into\b/i);
  });

  it("creates every new table with RLS enabled and service-role grants", () => {
    for (const t of [
      "hotel_addon_catalogue",
      "hotel_financial_settings",
      "hotel_folios",
      "hotel_folio_lines",
      "hotel_reservation_tax_profile",
      "hotel_tourism_tax_evidence",
    ]) {
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${t}`));
      expect(sql).toMatch(new RegExp(`grant all on public\\.${t} to service_role`));
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      // Data API stays locked: no anon/authenticated grants on financial data.
      expect(sql).not.toMatch(new RegExp(`on public\\.${t} to (anon|authenticated)`));
    }
  });

  it("enforces one folio per reservation and one night per room per date", () => {
    expect(sql).toMatch(/hotel_folios_tenant_reservation_uidx[\s\S]*?\(tenant_id, reservation_id\)/);
    expect(sql).toMatch(/hotel_folio_lines_room_night_uidx/);
    expect(sql).toMatch(/hotel_folio_lines_request_uidx/);
    expect(sql).toMatch(/hotel_folio_lines_reversal_link_chk/);
  });
});
