import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultFinancialSettings } from "../financial-settings";
import { computeFolio, planMissingRoomNights, type StoredFolioLine } from "../folio";
import {
  folioExtraAccent,
  formatFolioTaxRate,
  guestFacingFolioRows,
  visibleFolioTotalRows,
  type FolioLineDTO,
  type FolioViewDTO,
} from "../folio-view";

function storedLine(input: Partial<StoredFolioLine>): StoredFolioLine {
  return {
    id: input.id ?? "line",
    lineType: input.lineType ?? "room_night",
    status: input.status ?? "draft",
    taxClass: input.taxClass ?? "accommodation",
    description: input.description ?? "Room charge",
    quantity: input.quantity ?? 1,
    unitPriceCents: input.unitPriceCents ?? 0,
    subtotalCents: input.subtotalCents ?? 0,
    reversesLineId: input.reversesLineId ?? null,
    reason: input.reason ?? null,
    stayDate: input.stayDate ?? null,
    reservationRoomId: input.reservationRoomId ?? null,
    roomLabel: input.roomLabel ?? null,
    actorLabel: input.actorLabel ?? null,
    createdAt: input.createdAt ?? "2026-08-26T00:00:00.000Z",
  };
}

function folioDto(overrides: Partial<FolioViewDTO["readiness"]> = {}): FolioViewDTO {
  return {
    reservation: {
      id: "reservation",
      bookingReference: "BK260826001",
      arrivalDate: "2026-08-26",
      departureDate: "2026-08-27",
      currency: "MYR",
      primaryGuestName: "Jason Wong",
      roomLabels: ["301", "302"],
    },
    propertyDate: "2026-08-26",
    guestTaxClass: "malaysian_citizen",
    evidenceNote: null,
    tourismTaxEvidence: [],
    occupiedRoomNights: 2,
    lines: [],
    derived: [],
    totals: {
      charges: 1780,
      serviceCharge: 0,
      serviceTax: 0,
      tourismTax: 0,
      localLevy: 0,
      rounding: 0,
      grandTotal: 1780,
    },
    blockers: [],
    readiness: {
      serviceTaxRegistered: false,
      serviceChargeEnabled: false,
      tourismTaxEnabled: false,
      localLevyEnabled: false,
      localLevyLabel: null,
      roundingMode: "none",
      missing: [],
      configurationComplete: true,
      calculationComplete: true,
      roomNightsPrepared: false,
      projectedRoomNights: 2,
      ...overrides,
    },
    catalogue: [],
    capability: {
      canView: true,
      canAddItem: false,
      canAdjust: false,
      canSetTaxClass: false,
      canManageCharges: false,
    },
    preparationOnly: true,
  };
}

function dtoLine(input: Partial<FolioLineDTO>): FolioLineDTO {
  return {
    id: input.id ?? "line",
    catalogueId: input.catalogueId ?? null,
    lineType: input.lineType ?? "add_on",
    status: input.status ?? "draft",
    taxClass: input.taxClass ?? "non_taxable",
    description: input.description ?? "Charge",
    taxRateBp: input.taxRateBp ?? null,
    quantity: input.quantity ?? 1,
    unitPrice: input.unitPrice ?? 0,
    amount: input.amount ?? 0,
    stayDate: input.stayDate ?? null,
    roomLabel: input.roomLabel ?? null,
    reason: input.reason ?? null,
    reversesLineId: input.reversesLineId ?? null,
    actorLabel: input.actorLabel ?? null,
    createdAt: input.createdAt ?? "2026-09-02T00:00:00.000Z",
    canEditQuantity: input.canEditQuantity ?? false,
    canReverse: input.canReverse ?? false,
  };
}

describe("HH-GOLIVE-01A Malaysia tax, folio and reservation UI correction", () => {
  it("restores the two RM900 room charges before applying the RM20 discount", () => {
    const planned = planMissingRoomNights(
      [
        {
          reservationRoomId: "room-301",
          hotelRoomId: "hotel-room-301",
          roomLabel: "301",
          arrivalDate: "2026-08-26",
          departureDate: "2026-08-27",
          nightlyRateCents: 90_000,
        },
        {
          reservationRoomId: "room-302",
          hotelRoomId: "hotel-room-302",
          roomLabel: "302",
          arrivalDate: "2026-08-26",
          departureDate: "2026-08-27",
          nightlyRateCents: 90_000,
        },
      ],
      [],
    );
    const lines = planned.map((night) =>
      storedLine({
        id: `${night.reservationRoomId}:${night.stayDate}`,
        reservationRoomId: night.reservationRoomId,
        roomLabel: night.roomLabel,
        stayDate: night.stayDate,
        unitPriceCents: night.unitPriceCents,
        subtotalCents: night.unitPriceCents,
      }),
    );
    lines.push(
      storedLine({
        id: "discount",
        lineType: "discount",
        taxClass: "non_taxable",
        description: "Discount",
        unitPriceCents: -2_000,
        subtotalCents: -2_000,
      }),
    );

    const result = computeFolio({
      currency: "MYR",
      settings: defaultFinancialSettings("tenant"),
      lines,
      guestTaxClass: "malaysian_citizen",
      occupiedRoomNights: planned.length,
      tourismTaxCollectedCents: 0,
      propertyDate: "2026-08-26",
      unmappedRoomLabels: [],
      unmappedAddonNames: [],
    });

    expect(planned).toHaveLength(2);
    expect(result.totals.chargesCents).toBe(178_000);
    expect(result.totals.grandTotalCents).toBe(178_000);
  });

  it("calculates an N3 0.10 rate as 10%, not 0.1%", () => {
    const settings = defaultFinancialSettings("tenant");
    settings.serviceTaxRegistered = true;
    settings.serviceTax.accommodation = {
      rateBp: 1_000,
      n3TaxCodeId: "st-10",
      n3TaxCodeSnapshot: "ST-10%",
    };
    const result = computeFolio({
      currency: "MYR",
      settings,
      lines: [
        storedLine({
          id: "room-charge",
          unitPriceCents: 100_000,
          subtotalCents: 100_000,
        }),
      ],
      guestTaxClass: "malaysian_citizen",
      occupiedRoomNights: 1,
      tourismTaxCollectedCents: 0,
      propertyDate: "2026-09-01",
      unmappedRoomLabels: [],
      unmappedAddonNames: [],
    });

    expect(result.totals.chargesCents).toBe(100_000);
    expect(result.totals.serviceTaxCents).toBe(10_000);
    expect(result.totals.grandTotalCents).toBe(110_000);
  });

  it("shows only enabled optional totals while always retaining core charges", () => {
    expect(visibleFolioTotalRows(folioDto()).map((row) => row.label)).toEqual(["Charges"]);
    expect(
      visibleFolioTotalRows(
        folioDto({
          serviceTaxRegistered: true,
          tourismTaxEnabled: true,
          localLevyEnabled: true,
          localLevyLabel: "Perak Local Levy",
        }),
      ).map((row) => row.label),
    ).toEqual(["Charges", "Service Tax", "Tourism Tax", "Perak Local Levy"]);
  });

  it("hides both sides of a reversal and puts discounts after tax rows", () => {
    const dto = folioDto();
    dto.lines = [
      dtoLine({ id: "discount", lineType: "discount", description: "Discount", amount: -20 }),
      dtoLine({
        id: "old-extra",
        status: "reversed",
        description: "Old service charge",
        amount: 30,
      }),
      dtoLine({
        id: "reverse-old-extra",
        lineType: "reversal",
        status: "committed",
        description: "Reversal — Old service charge",
        amount: -30,
        reversesLineId: "old-extra",
      }),
      dtoLine({ id: "room", lineType: "room_night", description: "Room charge", amount: 900 }),
      dtoLine({ id: "active-extra", description: "Service charge", amount: 30 }),
    ];
    dto.derived = [
      {
        key: "service-tax",
        lineType: "service_tax",
        description: "Service Tax 8.00%",
        taxRateBp: 800,
        quantity: 1,
        unitPrice: 72,
        amount: 72,
      },
    ];

    expect(guestFacingFolioRows(dto).map((row) => row.line.description)).toEqual([
      "Room charge",
      "Service charge",
      "Service Tax 8.00%",
      "Discount",
    ]);
  });

  it("uses one stable extra colour and displays basis-point tax rates at the correct scale", () => {
    expect(folioExtraAccent("catalogue-room-service")).toEqual(
      folioExtraAccent("catalogue-room-service"),
    );
    expect(formatFolioTaxRate(1_000)).toBe("10%");
    expect(formatFolioTaxRate(825)).toBe("8.25%");
    expect(formatFolioTaxRate(null)).toBe("—");

    const card = readFileSync("src/components/FolioCard.tsx", "utf8");
    const print = readFileSync("src/routes/reservations.$id_.folio-print.tsx", "utf8");
    expect(card).toContain("folioExtraAccent(c.id)");
    expect(card).toContain("formatFolioTaxRate(l.taxRateBp)");
    expect(print).toContain("folioExtraAccent(l.catalogueId)");
    expect(print).toContain(">Tax %</th>");
  });

  it("opens Print Folio in a new tab and never waits for N3 checkout verification", () => {
    const card = readFileSync("src/components/FolioCard.tsx", "utf8");
    const print = readFileSync("src/routes/reservations.$id_.folio-print.tsx", "utf8");
    expect(card).toContain('target="_blank"');
    expect(card).toContain('rel="noopener noreferrer"');
    expect(print).not.toContain("if (preview.isPending) return");
    expect(print).toContain("guestFacingFolioRows(dto)");
  });

  it("keeps a new active charge after a reversed pair in the authoritative total", () => {
    const result = computeFolio({
      currency: "MYR",
      settings: defaultFinancialSettings("tenant"),
      lines: [
        storedLine({ id: "old", status: "reversed", subtotalCents: 3_000 }),
        storedLine({
          id: "reversal",
          lineType: "reversal",
          status: "committed",
          subtotalCents: -3_000,
          reversesLineId: "old",
        }),
        storedLine({ id: "active", subtotalCents: 3_000 }),
      ],
      guestTaxClass: "malaysian_citizen",
      occupiedRoomNights: 0,
      tourismTaxCollectedCents: 0,
      propertyDate: "2026-09-02",
      unmappedRoomLabels: [],
      unmappedAddonNames: [],
    });

    expect(result.totals.chargesCents).toBe(3_000);
    expect(result.totals.grandTotalCents).toBe(3_000);
  });

  it("uses one read-only missing-night projection for screen, print and checkout safety", () => {
    const store = readFileSync("src/lib/folio-store.server.ts", "utf8");
    const print = readFileSync("src/routes/reservations.$id_.folio-print.tsx", "utf8");
    const checkout = readFileSync("src/lib/checkout-preview.server.ts", "utf8");
    expect(store).toContain("missingRoomNights");
    expect(store).toContain("projectedLines");
    expect(store).toContain("roomNightsPrepared");
    expect(print).toContain("visibleFolioTotalRows(dto)");
    expect(print).toContain("isoToMyDate(l.stayDate)");
    expect(checkout).toContain("dto.readiness.roomNightsPrepared");
  });

  it("keeps every tax type visible and moves reservation explanations into info balloons", () => {
    const taxes = readFileSync("src/components/ChargesTaxesPanel.tsx", "utf8");
    expect(taxes).toContain("TAX_SETTINGS_SECTIONS.map");
    expect(taxes).toContain("Tax / charge type");
    expect(taxes).toContain("setActiveSection");
    expect(taxes).toContain('discount: "Discount"');
    expect(taxes).toContain('adjustment_positive: "Adjustment (increase)"');
    expect(taxes).toContain('adjustment_negative: "Adjustment (reduction)"');
    expect(taxes).not.toContain("PostingMappingsSection");
    expect(taxes).not.toContain("POSTING_COMPONENTS.map");
    for (const file of [
      "src/components/FolioCard.tsx",
      "src/components/DepositsCard.tsx",
      "src/components/ReservationOperations.tsx",
      "src/components/GuestRoomAssignmentCard.tsx",
    ]) {
      expect(readFileSync(file, "utf8")).toContain("CardInfoPopover");
    }
  });
});
