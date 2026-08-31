import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultFinancialSettings } from "../financial-settings";
import { computeFolio, planMissingRoomNights, type StoredFolioLine } from "../folio";
import { visibleFolioTotalRows, type FolioViewDTO } from "../folio-view";

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
