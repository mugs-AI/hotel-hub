import { describe, expect, it, vi } from "vitest";
import { defaultFinancialSettings } from "../financial-settings";
import { readLocalSettlementFacts, type LocalFactsPorts } from "../settlement-local-facts.server";
import { settlementFixture } from "./fixtures/settlement";
import { fixtureActor as actor } from "./fixtures/settlement-evidence";
import { preparedSettlementFolio } from "./fixtures/settlement-folio";

function setup() {
  const s = settlementFixture(),
    view = preparedSettlementFolio();
  const versions = [
    { table: "hotel_reservations", id: s.reservationId, version: "reservation-v1" },
    { table: "hotel_folios", id: s.folioId, version: "folio-v1" },
    { table: "hotel_folio_lines", id: s.lines[0].localLineId, version: "line-v1" },
    { table: "hotel_settings", id: s.tenantId, version: "settings-v1" },
  ];
  const line = {
    tenant_id: s.tenantId,
    folio_id: s.folioId,
    id: s.lines[0].localLineId,
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
    reverses_line_id: null,
  };
  const deposit = {
    tenant_id: s.tenantId,
    reservation_id: s.reservationId,
    id: s.receipts[0].depositId,
    status: "posted",
    amount: "50.00",
    currency_code: "MYR",
    n3_receipt_id: s.receipts[0].receiptId,
    n3_reference_no: s.receipts[0].reference,
    n3_customer_id: "7",
    payment_lines: [
      { id: s.receipts[0].payments[0].accountId, code: "SYNTHETIC-BANK", name: "Bank", amount: 50 },
    ],
  };
  const rows: Record<string, Record<string, unknown>[]> = {
    hotel_settings: [
      { tenant_id: s.tenantId, timezone: "Asia/Kuala_Lumpur", n3_walk_in_customer_id: "7" },
    ],
    hotel_reservations: [
      { tenant_id: s.tenantId, id: s.reservationId, status: "checked_in", currency: "MYR" },
    ],
    hotel_folios: [
      {
        tenant_id: s.tenantId,
        reservation_id: s.reservationId,
        id: s.folioId,
        status: "prepared",
        currency: "MYR",
        updated_at: "2026-10-08T01:00:00.000Z",
      },
    ],
    hotel_folio_lines: [line],
    hotel_reservation_deposits: [deposit],
    hotel_receipt_versions: [],
    hotel_receipt_control_requests: [],
  };
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const db = {
    from(table: string) {
      const call = { table, filters: [] as Array<[string, unknown]> };
      calls.push(call);
      const query = {
        select: () => query,
        order: () => query,
        eq: (k: string, v: unknown) => {
          call.filters.push([k, v]);
          return query;
        },
        in: (k: string, v: unknown) => {
          call.filters.push([k, v]);
          return query;
        },
        limit: async () => ({
          data: structuredClone(rows[table] ?? []),
          count: rows[table]?.length ?? 0,
          error: null,
        }),
      };
      return query;
    },
    rpc: vi.fn(async (name: string) => ({
      data: structuredClone(name === "hotelhub_settlement_sources" ? versions : s.billTo),
      error: null,
    })),
  };
  const ports: LocalFactsPorts = {
    db,
    readView: vi.fn(async () => view),
    readHeader: vi.fn(async () => ({
      kind: "confirmed" as const,
      value: { customerId: 7, currencyId: 1, currency: "MYR", currencyRate: 1 },
    })),
    resolveRoomUom: vi.fn(async () => ({ kind: "confirmed" as const, value: 1 })),
    readReceiptDate: vi.fn(async () => ({ kind: "confirmed" as const, value: "2026-09-30" })),
    now: () => new Date("2026-10-08T02:00:00.000Z"),
  };
  return { ports, rows, view, line, deposit, versions, calls, db };
}
describe("production prepared-folio/deposit facts", () => {
  it("connects persisted lines and this booking's existing OR without repricing or recreating it", async () => {
    const f = setup();
    const r = await readLocalSettlementFacts(actor, f.ports);
    expect(r).toMatchObject({
      kind: "confirmed" as const,
      value: {
        totalCents: 50000,
        lines: [{ stockId: 101, uomId: 1, taxCodeId: 8, unitCents: 50000 }],
        receipts: [
          { receiptId: f.deposit.n3_receipt_id, amountCents: 5000, receiptDate: "2026-09-30" },
        ],
        folioProjection: { version: 1 },
      },
    });
    expect(
      f.calls.every((c) => c.filters.some(([k, v]) => k === "tenant_id" && v === actor.tenantId)),
    ).toBe(true);
    expect(f.db.rpc.mock.calls.filter(([n]) => n === "hotelhub_settlement_sources")).toHaveLength(
      2,
    );
  });
  it("preserves a verified amount correction and document date instead of the original creation amount", async () => {
    const f = setup();
    f.rows.hotel_receipt_versions.push({
      id: "v1",
      tenant_id: actor.tenantId,
      deposit_id: f.deposit.id,
      version_no: 1,
      state: "active",
      receipt_id: f.deposit.n3_receipt_id,
      amount_cents: 6500,
      currency: "MYR",
      document_date: "2026-09-30",
      replacement_of: null,
      payment_lines: [
        {
          accountId: f.deposit.payment_lines[0].id,
          code: "SYNTHETIC-BANK",
          savedName: "Bank",
          amountCents: 6500,
        },
      ],
      verified_at: "2026-10-01T00:00:00Z",
      request_id: "request",
      doc_code: "OR-1",
    });
    expect(await readLocalSettlementFacts(actor, f.ports)).toMatchObject({
      kind: "confirmed" as const,
      value: { receipts: [{ amountCents: 6500 }] },
    });
  });
  it("cannot silently omit calculated Service Tax when persisted posting rows still contain zero tax", async () => {
    const f = setup();
    f.view.totals.serviceTax = 40;
    f.view.totals.grandTotal = 540;
    f.view.derived = [
      {
        key: "sst",
        lineType: "service_tax",
        description: "SST",
        taxRateBp: 800,
        quantity: 1,
        unitPrice: 40,
        amount: 40,
      },
    ];
    expect(await readLocalSettlementFacts(actor, f.ports)).toMatchObject({
      kind: "unavailable",
      code: "settlement_prepared_posting_rows_required",
    });
  });
  it("prepares current SST separately from zero-tax operational rows", async () => {
    const f = setup(),
      cfg = defaultFinancialSettings(actor.tenantId);
    cfg.serviceTaxRegistered = true;
    cfg.serviceTax.accommodation.rateBp = 800;
    cfg.serviceTax.accommodation.n3TaxCodeId = "8";
    f.ports.readFinancialSettings = async () => cfg;
    f.view.readiness.serviceTaxRegistered = true;
    f.view.lines[0].taxRateBp = 800;
    f.view.totals.serviceTax = 40;
    f.view.totals.grandTotal = 540;
    f.view.derived = [
      {
        key: "sst",
        lineType: "service_tax",
        description: "SST",
        taxRateBp: 800,
        quantity: 1,
        unitPrice: 40,
        amount: 40,
      },
    ];
    expect(await readLocalSettlementFacts(actor, f.ports)).toMatchObject({
      kind: "confirmed",
      value: { totalCents: 54000, lines: [{ taxCents: 4000, totalCents: 54000 }] },
    });
    expect(f.line).toMatchObject({ tax_cents: 0, total_cents: 50000 });
  });
  it("retains the source-version fence across canonical settings preparation", async () => {
    const f = setup(),
      cfg = defaultFinancialSettings(actor.tenantId);
    cfg.exempt.n3TaxCodeId = "8";
    f.ports.readFinancialSettings = async () => {
      f.versions[0].version = "changed";
      return cfg;
    };
    expect(await readLocalSettlementFacts(actor, f.ports)).toMatchObject({
      kind: "contradiction",
      code: "settlement_snapshot_changed",
    });
  });
  it.each([
    "hotel_reservations",
    "hotel_folios",
    "hotel_folio_lines",
    "hotel_reservation_deposits",
    "hotel_receipt_versions",
  ])("denies a foreign tenant row from %s", async (table) => {
    const f = setup();
    f.rows[table].push({ tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-cccccccccccc" });
    expect((await readLocalSettlementFacts(actor, f.ports)).kind).not.toBe("confirmed");
  });
  it.each(["unknown", "submitting"])(
    "blocks an unresolved %s deposit rather than skipping it",
    async (status) => {
      const f = setup();
      f.deposit.status = status;
      expect(await readLocalSettlementFacts(actor, f.ports)).toMatchObject({
        kind: "unavailable",
        code: "settlement_pending_financial_operation",
      });
    },
  );
  it("blocks a pending receipt correction before changing effective money", async () => {
    const f = setup();
    f.rows.hotel_receipt_control_requests.push({
      tenant_id: actor.tenantId,
      reservation_id: actor.reservationId,
      deposit_id: f.deposit.id,
      state: "pending",
    });
    expect(await readLocalSettlementFacts(actor, f.ports)).toMatchObject({
      kind: "unavailable",
      code: "settlement_pending_financial_operation",
    });
  });
  it("refuses a shared-customer OR linked to another reservation", async () => {
    const f = setup();
    f.deposit.reservation_id = "bbbbbbbb-bbbb-4bbb-8bbb-cccccccccccc";
    expect((await readLocalSettlementFacts(actor, f.ports)).kind).not.toBe("confirmed");
  });
  it("resolves a missing room UOM only through the current stock's unambiguous unit", async () => {
    const f = setup();
    f.line.n3_uom_id_snapshot = null as unknown as string;
    expect((await readLocalSettlementFacts(actor, f.ports)).kind).toBe("confirmed");
    expect(f.ports.resolveRoomUom).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: actor.reservationId }),
      101,
    );
  });
  it("refuses ambiguous room units instead of guessing", async () => {
    const f = setup();
    f.line.n3_uom_id_snapshot = null as unknown as string;
    f.ports.resolveRoomUom = async () => ({
      kind: "unavailable",
      code: "settlement_room_uom_required",
    });
    expect(await readLocalSettlementFacts(actor, f.ports)).toMatchObject({
      kind: "unavailable",
      code: "settlement_room_uom_required",
    });
  });
  it("rejects changed source versions during the read", async () => {
    const f = setup();
    f.ports.readView = async () => {
      f.versions[0].version = "changed";
      return f.view;
    };
    expect(await readLocalSettlementFacts(actor, f.ports)).toMatchObject({
      kind: "contradiction",
      code: "settlement_snapshot_changed",
    });
  });
  it("does not use a projected room night as a posted charge", async () => {
    const f = setup();
    f.view.readiness.roomNightsPrepared = false;
    f.view.readiness.projectedRoomNights = 1;
    expect((await readLocalSettlementFacts(actor, f.ports)).kind).not.toBe("confirmed");
  });
  it("does not continue using a changed caller after an awaited read", async () => {
    const f = setup(),
      a = { ...actor };
    f.ports.readView = async () => {
      a.n3Token = "other-session";
      return f.view;
    };
    expect(await readLocalSettlementFacts(a, f.ports)).toMatchObject({
      kind: "contradiction",
      code: "settlement_scope_mismatch",
    });
    expect(f.ports.readReceiptDate).not.toHaveBeenCalled();
  });
  it("rejects a current header for a different debtor even with no deposit", async () => {
    const f = setup();
    f.rows.hotel_reservation_deposits = [];
    f.ports.readHeader = async () => ({
      kind: "confirmed",
      value: { customerId: 99, currencyId: 1, currency: "MYR", currencyRate: 1 },
    });
    expect((await readLocalSettlementFacts(actor, f.ports)).kind).not.toBe("confirmed");
  });
  it("handles no-deposit stays without looking up any OR date", async () => {
    const f = setup();
    f.rows.hotel_reservation_deposits = [];
    expect(await readLocalSettlementFacts(actor, f.ports)).toMatchObject({
      kind: "confirmed",
      value: { receipts: [] },
    });
    expect(f.ports.readReceiptDate).not.toHaveBeenCalled();
  });
  it("accepts persisted tax only when it reconciles to the actual prepared total", async () => {
    const f = setup();
    f.line.tax_cents = 4000;
    f.line.total_cents = 54000;
    f.view.readiness.serviceTaxRegistered = true;
    f.view.totals.serviceTax = 40;
    f.view.totals.grandTotal = 540;
    f.view.derived = [
      {
        key: "sst",
        lineType: "service_tax",
        description: "SST",
        taxRateBp: 800,
        quantity: 1,
        unitPrice: 40,
        amount: 40,
      },
    ];
    expect(await readLocalSettlementFacts(actor, f.ports)).toMatchObject({
      kind: "confirmed",
      value: { totalCents: 54000, lines: [{ taxCents: 4000 }] },
    });
  });
  it("recovers the trusted frozen projection on a later property date", async () => {
    const f = setup();
    f.ports.now = () => new Date("2026-10-10T02:00:00Z");
    f.ports.frozenPropertyDate = "2026-10-08";
    expect(await readLocalSettlementFacts(actor, f.ports)).toMatchObject({
      kind: "confirmed",
      value: { billDate: "2026-10-08" },
    });
  });
  it("requires fresh preparation across the property midnight boundary", async () => {
    const f = setup();
    f.ports.readReceiptDate = async () => {
      f.ports.now = () => new Date("2026-10-09T02:00:00Z");
      return { kind: "confirmed", value: "2026-09-30" };
    };
    expect(await readLocalSettlementFacts(actor, f.ports)).toMatchObject({
      kind: "contradiction",
      code: "settlement_snapshot_changed",
    });
  });
  it("does not accept an incomplete database page as the complete folio", async () => {
    const f = setup();
    const from = f.db.from;
    f.ports.db = {
      ...f.db,
      from(table) {
        const q = from(table),
          limit = q.limit;
        q.limit = async () => ({ ...(await limit()), count: 500 });
        return q;
      },
    };
    expect((await readLocalSettlementFacts(actor, f.ports)).kind).not.toBe("confirmed");
  });
});
