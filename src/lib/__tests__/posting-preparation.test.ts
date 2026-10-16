import { describe, expect, it, vi } from "vitest";
import { preparePostingLines, derivedPostingLineId } from "../posting-preparation.server";
import { preparedSettlementFolio } from "./fixtures/settlement-folio";
import { settlementFixture } from "./fixtures/settlement";
import { fixtureActor as actor } from "./fixtures/settlement-evidence";
import { defaultFinancialSettings } from "../financial-settings";
function setup() {
  const s = settlementFixture(),
    view = preparedSettlementFolio();
  const settings = defaultFinancialSettings(actor.tenantId);
  settings.serviceTaxRegistered = true;
  for (const m of Object.values(settings.serviceTax)) {
    m.rateBp = 800;
    m.n3TaxCodeId = "8";
  }
  settings.exempt.n3TaxCodeId = "2";
  view.readiness.serviceTaxRegistered = true;
  view.lines[0].taxRateBp = 800;
  view.derived = [
    {
      key: "service_tax:accommodation",
      lineType: "service_tax",
      description: "SST 8%",
      taxRateBp: 800,
      quantity: 1,
      unitPrice: 40,
      amount: 40,
    },
  ];
  view.totals.serviceTax = 40;
  view.totals.grandTotal = 540;
  const raw = {
    id: s.lines[0].localLineId,
    tenant_id: actor.tenantId,
    folio_id: s.folioId,
    line_type: "room_night",
    status: "draft",
    quantity: 1,
    unit_price_cents: 50000,
    subtotal_cents: 50000,
    tax_cents: 0,
    total_cents: 50000,
    description_snapshot: "Room charge",
    n3_stock_id_snapshot: "101",
    n3_uom_id_snapshot: "1",
    n3_tax_code_id_snapshot: "8",
    tax_snapshot: {},
  };
  const resolveRoomUom = vi.fn(async () => ({ kind: "confirmed" as const, value: 1 }));
  return { folioId: s.folioId, view, settings, raw, rawLines: [raw], resolveRoomUom };
}
describe("canonical folio posting preparation", () => {
  it("prepares RM500 + RM40 SST from the real folio while preserving zero-tax raw rows", async () => {
    const f = setup(),
      before = structuredClone(f.raw);
    expect(await preparePostingLines(actor, f)).toMatchObject({
      kind: "confirmed",
      value: [
        { unitCents: 50000, subtotalCents: 50000, taxCents: 4000, totalCents: 54000, taxCodeId: 8 },
      ],
    });
    expect(f.raw).toEqual(before);
  });
  it("embeds SST exactly once rather than creating a second service-tax charge", async () => {
    const f = setup(),
      r = await preparePostingLines(actor, f);
    expect(r.kind).toBe("confirmed");
    if (r.kind === "confirmed") expect(r.value).toHaveLength(1);
  });
  it("uses the explicitly configured exempt code when the property is not registered", async () => {
    const f = setup();
    f.settings.serviceTaxRegistered = false;
    f.view.readiness.serviceTaxRegistered = false;
    f.view.derived = [];
    f.view.lines[0].taxRateBp = null;
    f.view.totals.serviceTax = 0;
    f.view.totals.grandTotal = 500;
    expect(await preparePostingLines(actor, f)).toMatchObject({
      kind: "confirmed",
      value: [{ taxCodeId: 2, taxCents: 0, totalCents: 50000 }],
    });
  });
  it("uses the current configured tax code while retaining the captured charge stock", async () => {
    const f = setup();
    f.settings.serviceTax.accommodation.n3TaxCodeId = "9";
    expect(await preparePostingLines(actor, f)).toMatchObject({
      kind: "confirmed",
      value: [{ stockId: 101, taxCodeId: 9, taxCents: 4000 }],
    });
  });
  it("adds a separately mapped service charge and its own SST", async () => {
    const f = setup(),
      m = f.settings.postingMappings.service_charge;
    f.settings.serviceCharge.serviceTaxApplies = true;
    m.enabled = true;
    m.stock.id = "102";
    m.uom.id = "3";
    m.taxCode.id = "8";
    f.view.readiness.serviceChargeEnabled = true;
    f.view.totals.serviceCharge = 50;
    f.view.totals.serviceTax = 44;
    f.view.totals.grandTotal = 594;
    f.view.derived.push({
      key: "service_charge",
      lineType: "service_charge",
      description: "Service charge 10%",
      taxRateBp: 800,
      quantity: 1,
      unitPrice: 50,
      amount: 50,
    });
    f.view.derived[0].amount = 44;
    f.view.derived[0].unitPrice = 44;
    expect(await preparePostingLines(actor, f)).toMatchObject({
      kind: "confirmed",
      value: [
        expect.objectContaining({ taxCents: 4000 }),
        expect.objectContaining({
          kind: "service_charge",
          stockId: 102,
          uomId: 3,
          subtotalCents: 5000,
          taxCents: 400,
          totalCents: 5400,
        }),
      ],
    });
  });
  it.each(["tourism_tax", "local_levy"] as const)(
    "uses a dedicated mapping for %s",
    async (kind) => {
      const f = setup(),
        m = f.settings.postingMappings[kind];
      m.enabled = true;
      m.stock.id = "103";
      m.uom.id = "4";
      m.taxCode.id = "2";
      f.view.derived.push({
        key: kind,
        lineType: kind,
        description: "Levy",
        taxRateBp: null,
        quantity: 1,
        unitPrice: 10,
        amount: 10,
      });
      f.view.totals[kind === "tourism_tax" ? "tourismTax" : "localLevy"] = 10;
      f.view.totals.grandTotal = 550;
      expect(await preparePostingLines(actor, f)).toMatchObject({
        kind: "confirmed",
        value: [expect.anything(), expect.objectContaining({ kind, stockId: 103, taxCents: 0 })],
      });
    },
  );
  it("requires a dedicated mapping for an enabled calculated charge", async () => {
    const f = setup();
    f.view.derived.push({
      key: "local_levy",
      lineType: "local_levy",
      description: "Levy",
      taxRateBp: null,
      quantity: 1,
      unitPrice: 10,
      amount: 10,
    });
    f.view.totals.localLevy = 10;
    f.view.totals.grandTotal = 550;
    expect(await preparePostingLines(actor, f)).toMatchObject({
      kind: "unavailable",
      code: "settlement_local_mapping_required",
    });
  });
  it("uses stable derived IDs for this booking and folio; another booking gets another ID", () => {
    const f = setup();
    const id = derivedPostingLineId(actor, f.folioId, "service_charge");
    expect(id).toMatch(/^[a-f\d]{8}-[a-f\d]{4}-5[a-f\d]{3}-8[a-f\d]{3}-[a-f\d]{12}$/);
    expect(derivedPostingLineId(actor, f.folioId, "service_charge")).toBe(id);
    expect(
      derivedPostingLineId(
        { ...actor, reservationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
        f.folioId,
        "service_charge",
      ),
    ).not.toBe(id);
  });
  it("does not invent a rounding stock or silently change the payable amount", async () => {
    const f = setup();
    f.view.totals.rounding = 0.01;
    f.view.totals.grandTotal = 540.01;
    expect(await preparePostingLines(actor, f)).toMatchObject({
      kind: "unavailable",
      code: "n3_rounding_contract_unverified",
    });
  });
  it("requires exact tax rounding agreement with the prepared total", async () => {
    const f = setup();
    f.view.totals.serviceTax = 39.99;
    f.view.totals.grandTotal = 539.99;
    f.view.derived[0].amount = 39.99;
    expect(await preparePostingLines(actor, f)).toMatchObject({
      kind: "unavailable",
      code: "n3_tax_rounding_contract_unverified",
    });
  });
  it("rejects changed raw rate facts before resolving any missing unit", async () => {
    const f = setup();
    f.raw.unit_price_cents = 55000;
    f.raw.n3_uom_id_snapshot = null as unknown as string;
    expect((await preparePostingLines(actor, f)).kind).not.toBe("confirmed");
    expect(f.resolveRoomUom).not.toHaveBeenCalled();
  });
  it("preserves the captured add-on stock/unit instead of using a current catalogue replacement", async () => {
    const f = setup();
    f.raw.line_type = "add_on";
    f.view.lines[0].lineType = "add_on";
    f.raw.n3_stock_id_snapshot = null as unknown as string;
    f.raw.n3_uom_id_snapshot = null as unknown as string;
    f.raw.tax_snapshot = { n3StockId: "202", n3UomId: "303", n3TaxCodeId: "8" };
    expect(await preparePostingLines(actor, f)).toMatchObject({
      kind: "confirmed",
      value: [{ stockId: 202, uomId: 303 }],
    });
  });
  it("rejects foreign tenant data and unauthorized actors", async () => {
    const f = setup();
    f.raw.tenant_id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    expect((await preparePostingLines(actor, f)).kind).not.toBe("confirmed");
    expect((await preparePostingLines({ ...actor, role: "housekeeper" }, setup())).kind).not.toBe(
      "confirmed",
    );
  });
});
