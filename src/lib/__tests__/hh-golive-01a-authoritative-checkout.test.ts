/**
 * HH-GOLIVE-01A — one authoritative balance at Prepare Checkout.
 *
 * These are behaviour tests over the real orchestration with mocked loaders.
 * They prove the preview settles against the prepared folio (not room nights),
 * that an unprepared folio is reported honestly instead of being priced, and
 * that the obsolete "additional charges not configured" warning is gone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCheckoutPreview,
  type CheckoutPreviewDeps,
  type CheckoutReservationEvidence,
  type PreparedFolioEvidence,
} from "../checkout-preview.server";
import { standingBlockers } from "../checkout-preview";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RES = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function reservation(): CheckoutReservationEvidence {
  return {
    id: RES,
    bookingReference: "HH-000001",
    status: "checked_in",
    arrivalDate: "2026-08-01",
    departureDate: "2026-08-04",
    currency: "MYR",
    expectedCheckOutAt: null,
    primaryGuestName: "Guest One",
    rooms: [
      {
        reservationRoomId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        hotelRoomId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        roomNumber: "101",
        displayName: null,
        n3StockId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        n3StockCode: "RM101",
        n3StockName: "Deluxe",
        agreedRate: 150,
        baseRateSnapshot: 150,
        allocationStatus: "occupied",
        maxOccupancy: 2,
        adults: 2,
        children: 0,
      },
    ],
    guests: [
      {
        guestId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        isPrimary: true,
        reservationRoomId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
    ],
  } as CheckoutReservationEvidence;
}

function prepared(over: Partial<PreparedFolioEvidence> = {}): PreparedFolioEvidence {
  return {
    prepared: true,
    grandTotalCents: 52000,
    totals: {
      charges: 450,
      serviceCharge: 45,
      serviceTax: 25,
      tourismTax: 0,
      localLevy: 0,
      rounding: 0,
      grandTotal: 520,
    },
    blockers: [],
    ...over,
  };
}

function deps(over: Partial<CheckoutPreviewDeps> = {}): CheckoutPreviewDeps {
  return {
    loadSettings: async () => ({
      timezone: "Asia/Kuala_Lumpur",
      currency: "MYR",
      walkInCustomerId: null,
    }),
    loadReservation: async () => reservation(),
    hasHistoryGap: async () => false,
    loadDeposits: async () => [],
    loadPreparedFolio: async () => prepared(),
    getReceiptById: async () => ({ kind: "transport_error", reason: "network" }),
    now: new Date("2026-08-04T02:00:00.000Z"),
    ...over,
  };
}

const run = (d: CheckoutPreviewDeps) =>
  buildCheckoutPreview({ tenantId: TENANT, reservationId: RES, n3Token: "tok", deps: d });

describe("authoritative checkout balance", () => {
  it("settles against the prepared folio total, not the room-night projection", async () => {
    const dto = await run(deps());
    expect(dto.folio.scope).toBe("authoritative");
    expect(dto.folio.calculationStatus).toBe("calculated");
    // Room nights alone would be 450; the authoritative folio is 520.
    expect(dto.folio.preparedTotal).toBe(520);
    expect(dto.summary.estimatedBalance).toBe(520);
    expect(dto.folio.totals?.serviceTax).toBe(25);
  });

  it("keeps room nights only as posting evidence, with no competing total", async () => {
    const dto = await run(deps());
    expect(dto.folio.roomNightEvidence.length).toBe(1);
    expect(dto.folio).not.toHaveProperty("roomChargeTotal");
    expect(dto.folio).not.toHaveProperty("lines");
  });

  it("reports an unprepared folio honestly instead of pricing it", async () => {
    const dto = await run(
      deps({
        loadPreparedFolio: async () =>
          prepared({
            prepared: false,
            grandTotalCents: null,
            totals: null,
            blockers: [
              {
                code: "folio_not_prepared",
                severity: "blocking",
                message: "The guest folio has not been prepared yet.",
              },
            ],
          }),
      }),
    );
    expect(dto.folio.prepared).toBe(false);
    expect(dto.folio.preparedTotal).toBeNull();
    expect(dto.summary.estimatedBalance).toBeNull();
    expect(dto.readiness.calculationComplete).toBe(false);
    expect(dto.readiness.blockers.map((b) => b.code)).toContain("folio_not_prepared");
  });

  it("propagates folio blockers into checkout readiness", async () => {
    const dto = await run(
      deps({
        loadPreparedFolio: async () =>
          prepared({
            grandTotalCents: null,
            totals: null,
            blockers: [
              {
                code: "service_tax_rate_not_configured",
                severity: "blocking",
                message: "Service Tax rate is not configured.",
              },
            ],
          }),
      }),
    );
    expect(dto.readiness.blockers.map((b) => b.code)).toContain("service_tax_rate_not_configured");
    expect(dto.folio.preparedTotal).toBeNull();
  });

  it("no longer emits the obsolete additional-charges warning", async () => {
    expect(standingBlockers().map((b) => b.code)).not.toContain(
      "additional_charges_and_tax_not_configured",
    );
    const dto = await run(deps());
    expect(dto.readiness.blockers.map((b) => b.code)).not.toContain(
      "additional_charges_and_tax_not_configured",
    );
  });
});

describe("printable folio and check-in outcome", () => {
  const root = resolve(__dirname, "../..");
  const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

  it("prints server-derived deposits, prepared total and current balance", () => {
    const page = read("routes/reservations.$id_.folio-print.tsx");
    expect(page).toMatch(/useCheckoutPreview/);
    expect(page).toMatch(/Verified deposits \/ credits/);
    expect(page).toMatch(/Current balance/);
    expect(page).toMatch(/Prepared total/);
    // The print view never computes money.
    expect(page).not.toMatch(/[a-zA-Z)]\s[-+]\s[a-zA-Z]+Total/);
  });

  it("keeps a successful check-in successful but exposes a folio warning", () => {
    const route = read("routes/api/hotel/reservations.$id.check-in.ts");
    expect(route).toMatch(/folioWarning = "folio_needs_preparation"/);
    expect(route).toMatch(/\.\.\.result, folioWarning/);
    expect(route).toMatch(/folioNightsSnapshotted, folioWarning/);
    const ui = read("components/ReservationOperations.tsx");
    expect(ui).toMatch(/folio_needs_preparation/);
  });

  it("guards every folio mutation route with the same-origin check", () => {
    const routes = [
      "routes/api/hotel/reservations.$id.folio.lines.ts",
      "routes/api/hotel/reservations.$id.folio.lines.$lineId.ts",
      "routes/api/hotel/reservations.$id.folio.lines.$lineId.reverse.ts",
      "routes/api/hotel/reservations.$id.folio.adjustments.ts",
      "routes/api/hotel/reservations.$id.folio.refresh.ts",
      "routes/api/hotel/reservations.$id.tax-profile.ts",
      "routes/api/hotel/charges.catalogue.ts",
      "routes/api/hotel/charges.catalogue.$itemId.ts",
      "routes/api/hotel/charges.settings.ts",
    ];
    for (const rel of routes) {
      expect(read(rel), rel).toMatch(/const origin = folioSameOriginGuard\(request\);/);
    }
  });
});
