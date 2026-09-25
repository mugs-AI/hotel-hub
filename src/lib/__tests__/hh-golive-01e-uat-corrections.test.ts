import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeFolio, effectiveTaxClassForLine, type StoredFolioLine } from "../folio";
import { defaultFinancialSettings, discountTaxClassFromSettings } from "../financial-settings";
import { folioExtraAccentMap } from "../folio-view";
import { getN3StockDetailById, listN3Stocks } from "../n3-gateway.server";
import { evaluateRoundingGlAccount } from "../n3-selectors.server";
import { roomImportSeed } from "@/routes/api/hotel/rooms";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function line(input: Partial<StoredFolioLine>): StoredFolioLine {
  return {
    id: input.id ?? crypto.randomUUID(),
    lineType: input.lineType ?? "add_on",
    status: input.status ?? "draft",
    taxClass: Object.prototype.hasOwnProperty.call(input, "taxClass")
      ? (input.taxClass ?? null)
      : "accommodation",
    description: input.description ?? "Charge",
    quantity: input.quantity ?? 1,
    unitPriceCents: input.unitPriceCents ?? 0,
    subtotalCents: input.subtotalCents ?? 0,
    reversesLineId: input.reversesLineId ?? null,
    reason: input.reason ?? null,
    stayDate: input.stayDate ?? null,
    reservationRoomId: input.reservationRoomId ?? null,
    roomLabel: input.roomLabel ?? null,
    actorLabel: input.actorLabel ?? null,
    createdAt: input.createdAt ?? "2026-09-20T00:00:00.000Z",
  };
}

describe("HH-GOLIVE-01E UAT corrections", () => {
  it("reads the full N3 StockMaster detail contract by immutable stock ID", async () => {
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            code: "0000",
            data: {
              id: 2092687,
              code: "777-ROOM-502",
              name: "HOTEL ROOM 502 - Presidential / Penthouse",
              active: true,
              category: { id: 1, name: "Presidential" },
              stockGroupCode: "5",
              group: { id: 5, name: "LEVEL 5" },
              stockClassCode: "8",
              class: { id: 8, name: "Double" },
              listPrice: 990,
              purchasePrice: 990,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchSpy as typeof fetch;

    await expect(getN3StockDetailById("token", "2092687")).resolves.toEqual({
      status: "found",
      item: {
        id: "2092687",
        code: "777-ROOM-502",
        name: "HOTEL ROOM 502 - Presidential / Penthouse",
        isActive: true,
        category: "Presidential",
        groupCode: "5",
        stockClassCode: "8",
        listPrice: 990,
      },
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toMatch(/\/api\/stocks\/2092687$/);
  });

  it("sanitizes the N3 Stock Master fields and seeds the exact requested HH room values", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "0000",
            data: {
              count: 1,
              value: [
                {
                  Id: "stock-101",
                  Code: "777-ROOM-101",
                  Description: "HOTEL ROOM 101 - Essential",
                  StockCategory: { Name: "Essential" },
                  StockGroupCode: "1",
                  StockGroup: { Name: "1" },
                  StockClassCode: "2",
                  StockClass: { Name: "2" },
                  ListPrice: "188.00",
                  IsActive: true,
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    const page = await listN3Stocks("token", { top: 25, skip: 0 });
    expect(page.items).toHaveLength(1);
    expect(roomImportSeed(page.items[0]!)).toEqual({
      ok: true,
      value: {
        displayName: "HOTEL ROOM 101 - Essential",
        roomType: "Essential",
        floor: "1",
        maxOccupancy: 2,
        baseRate: 188,
      },
    });
  });

  it("preserves a string Group Code as Floor and validates only Class Code for MaxGuest", () => {
    const base = {
      id: "stock-101",
      code: "777-ROOM-101",
      name: "HOTEL ROOM 101 - Essential",
      isActive: true,
      category: "Essential",
      groupCode: "LEVEL-1",
      stockClassCode: "2",
      listPrice: 188,
    };
    expect(roomImportSeed(base)).toEqual({
      ok: true,
      value: {
        displayName: "HOTEL ROOM 101 - Essential",
        roomType: "Essential",
        floor: "LEVEL-1",
        maxOccupancy: 2,
        baseRate: 188,
      },
    });
    expect(roomImportSeed({ ...base, stockClassCode: "Double" })).toEqual({
      ok: false,
      code: "n3_stock_class_must_be_positive_integer",
    });
  });

  it("accepts identifier/code-only rows from the proven N3 Leaf account query", () => {
    const row = { Id: "gl-rounding", AccountCode: "999-ROUND", AccountName: "Rounding" };
    expect(evaluateRoundingGlAccount(row).eligibility).toBe("ineligible");
    expect(evaluateRoundingGlAccount(row, { fromLeafQuery: true }).eligibility).toBe("eligible");
    expect(
      evaluateRoundingGlAccount({ ...row, IsActive: false }, { fromLeafQuery: true }).eligibility,
    ).toBe("ineligible");
  });

  it("reverses the discount's 8% tax and keeps rounding in the footer only", () => {
    const settings = defaultFinancialSettings("tenant");
    settings.serviceTaxRegistered = true;
    settings.serviceTax.accommodation = {
      rateBp: 800,
      n3TaxCodeId: "svt-8",
      n3TaxCodeSnapshot: "SVT-8%",
    };
    settings.postingMappings.discount.taxCode = {
      id: "SVT-8",
      code: "SVT-8%",
      name: "Service Tax 8%",
    };
    settings.rounding = {
      mode: "nearest_5_cents",
      n3RoundingAccountId: "gl-rounding",
      n3RoundingAccountSnapshot: "999-ROUND — Rounding",
    };

    const discountClass = discountTaxClassFromSettings(settings);
    expect(discountClass).toBe("accommodation");
    expect(
      effectiveTaxClassForLine(
        line({ lineType: "discount", taxClass: null, subtotalCents: -300 }),
        discountClass,
      ),
    ).toBe("accommodation");
    const result = computeFolio({
      currency: "MYR",
      settings,
      lines: [
        line({ lineType: "room_night", subtotalCents: 18_800 }),
        line({ subtotalCents: 1_500 }),
        line({ subtotalCents: 2_500 }),
        line({ subtotalCents: 5_500 }),
        line({
          lineType: "discount",
          description: "Discount",
          // Simulates BK260920001's already-saved pre-correction discount.
          taxClass: null,
          unitPriceCents: -300,
          subtotalCents: -300,
        }),
      ],
      guestTaxClass: "malaysian_citizen",
      occupiedRoomNights: 1,
      tourismTaxCollectedCents: 0,
      propertyDate: "2026-09-20",
    });

    expect(result.totals.chargesCents).toBe(28_000);
    expect(result.totals.serviceTaxCents).toBe(2_240);
    expect(result.totals.grandTotalCents).toBe(30_240);
    expect(result.derived.some((item) => item.description === "Rounding adjustment")).toBe(false);
  });

  it("assigns distinct, shared pastel identities to every visible extra", () => {
    const map = folioExtraAccentMap(["extra-pillow", "phone-charger", "extra-service"]);
    const surfaces = [...map.values()].map((accent) => accent.surface);
    expect(new Set(surfaces).size).toBe(3);
    expect(
      folioExtraAccentMap(["extra-service", "extra-pillow", "phone-charger"]).get("extra-pillow"),
    ).toEqual(map.get("extra-pillow"));
  });

  it("routes direct early check-in through the existing idempotent early-capable check-in RPC", () => {
    const route = readFileSync(
      new URL("../../routes/api/hotel/reservations.$id.operations.ts", import.meta.url),
      "utf8",
    );
    expect(route).toContain(
      'if (type === "early_check_in" && outcome.code === "direct_operation_unavailable")',
    );
    expect(route).toContain("allowEarly: true");
    expect(route).toContain("clientRequestId: clientRequestId as string");
  });
});
