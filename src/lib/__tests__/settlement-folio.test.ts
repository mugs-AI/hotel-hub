import { describe, expect, it } from "vitest";
import {
  captureSettlementFolio,
  projectSettlementFolio,
  readFrozenSettlementFolio,
} from "../settlement-folio.server";
import { snapshotDigest } from "../settlement-snapshot.server";
import { guestFacingFolioRows, visibleFolioTotalRows } from "../folio-view";
import { settlementFixture } from "./fixtures/settlement";
import { preparedSettlementFolio } from "./fixtures/settlement-folio";
import type { SettlementSnapshot } from "../settlement";

const scope = {
  tenantId: settlementFixture().tenantId,
  reservationId: settlementFixture().reservationId,
};
function saved(snapshot: SettlementSnapshot, state = "closed") {
  const { digest: _digest, ...facts } = snapshot;
  return {
    ...scope,
    id: "77777777-7777-4777-8777-777777777777",
    revision: "9223372036854775807",
    state,
    snapshot: { ...facts, digest: snapshotDigest(facts) },
    dispatches: [],
  };
}
function captured() {
  const s = settlementFixture();
  const r = captureSettlementFolio(s, preparedSettlementFolio());
  if (r.kind !== "confirmed") throw new Error(r.code);
  return { ...s, folioProjection: r.value };
}
describe("frozen prepared-folio projection", () => {
  it("rejects hidden rounding used to disguise a different charges subtotal", () => {
    const dto = preparedSettlementFolio();
    dto.totals.charges = 400;
    dto.totals.rounding = 100;
    expect(captureSettlementFolio(settlementFixture(), dto).kind).toBe("contradiction");
  });
  it("rejects fabricated cancelling add-on and discount rows in derived detail", () => {
    const dto = preparedSettlementFolio();
    dto.derived = [
      {
        key: "forged-extra",
        lineType: "add_on",
        description: "Not charged",
        taxRateBp: null,
        quantity: 1,
        unitPrice: 20,
        amount: 20,
      },
      {
        key: "forged-discount",
        lineType: "discount",
        description: "Not granted",
        taxRateBp: null,
        quantity: 1,
        unitPrice: -20,
        amount: -20,
      },
    ];
    expect(captureSettlementFolio(settlementFixture(), dto).kind).toBe("contradiction");
  });
  it("preserves an exact positive mapped rounding amount only in frozen totals", () => {
    const snapshot = settlementFixture();
    snapshot.lines[0] = {
      ...snapshot.lines[0],
      unitCents: 50003,
      subtotalCents: 50003,
      totalCents: 50003,
    };
    snapshot.lines.push({
      ...snapshot.lines[0],
      localLineId: "66666666-6666-4666-8666-666666666666",
      kind: "rounding",
      description: "Mapped rounding",
      unitCents: 2,
      subtotalCents: 2,
      totalCents: 2,
    });
    snapshot.totalCents = 50005;
    const dto = preparedSettlementFolio();
    Object.assign(dto.lines[0], { unitPrice: 500.03, amount: 500.03 });
    Object.assign(dto.totals, { charges: 500.03, rounding: 0.02, grandTotal: 500.05 });
    dto.readiness.roundingMode = "nearest_5_cents";
    const r = captureSettlementFolio(snapshot, dto);
    expect(r.kind).toBe("confirmed");
    if (r.kind !== "confirmed") return;
    expect(guestFacingFolioRows(r.value.folio).map((r) => r.line.amount)).toEqual([500.03]);
    expect(visibleFolioTotalRows(r.value.folio).map((r) => [r.label, r.amount])).toEqual([
      ["Charges", 500.03],
      ["Rounding", 0.02],
    ]);
    expect(r.value.folio.totals.grandTotal).toBe(500.05);
  });
  it("rejects a levy relabelled as tax even if the grand total is unchanged", () => {
    const snapshot = settlementFixture();
    snapshot.lines[0] = {
      ...snapshot.lines[0],
      unitCents: 45000,
      subtotalCents: 45000,
      taxCents: 5000,
    };
    const dto = preparedSettlementFolio();
    Object.assign(dto.lines[0], { unitPrice: 450, amount: 450 });
    dto.totals.charges = 450;
    dto.totals.localLevy = 50;
    dto.readiness.localLevyEnabled = true;
    dto.derived = [
      {
        key: "levy",
        lineType: "local_levy",
        description: "Levy",
        taxRateBp: null,
        quantity: 1,
        unitPrice: 50,
        amount: 50,
      },
    ];
    expect(captureSettlementFolio(snapshot, dto).kind).toBe("contradiction");
  });
  it("sanitizes failed ledger transport instead of exposing an underlying error", async () => {
    await expect(
      readFrozenSettlementFolio(scope, async () => {
        throw new Error("private transport diagnostic");
      }),
    ).rejects.toThrow("settlement_folio_unavailable");
  });
  it("captures a copy without edit capabilities or live deposit/accounting claims", () => {
    const dto = preparedSettlementFolio();
    dto.recordedDeposits = {
      total: 50,
      currency: "MYR",
      count: 1,
      hasUnconfirmed: false,
      netFigure: 450,
      items: [],
    };
    const r = captureSettlementFolio(settlementFixture(), dto);
    expect(r.kind).toBe("confirmed");
    if (r.kind !== "confirmed") return;
    dto.lines[0].amount = 900;
    expect(r.value.folio.totals.grandTotal).toBe(500);
    expect(r.value.folio.lines[0].amount).toBe(500);
    expect(r.value.folio.lines[0].canEditQuantity).toBe(false);
    expect(r.value.folio.capability).toEqual({
      canView: true,
      canAddItem: false,
      canAdjust: false,
      canSetTaxClass: false,
      canManageCharges: false,
    });
    expect(r.value.folio).not.toHaveProperty("recordedDeposits");
  });
  it("keeps the exact prepared tax rows, rates, room labels and date after close", () => {
    const s = settlementFixture();
    s.lines[0] = {
      ...s.lines[0],
      unitCents: 45000,
      subtotalCents: 45000,
      taxCents: 5000,
      totalCents: 50000,
    };
    const dto = preparedSettlementFolio();
    Object.assign(dto.lines[0], { unitPrice: 450, amount: 450, taxRateBp: 800 });
    dto.totals.charges = 450;
    dto.totals.serviceTax = 50;
    dto.readiness.serviceTaxRegistered = true;
    dto.derived = [
      {
        key: "service-tax",
        lineType: "service_tax",
        description: "Prepared Service Tax",
        taxRateBp: 800,
        quantity: 1,
        unitPrice: 50,
        amount: 50,
      },
    ];
    const r = captureSettlementFolio(s, dto);
    expect(r.kind).toBe("confirmed");
    if (r.kind !== "confirmed") return;
    const intent = saved({ ...s, folioProjection: r.value });
    dto.readiness.serviceTaxRegistered = false;
    dto.totals.grandTotal = 900;
    const read = projectSettlementFolio(scope, intent);
    expect(read.kind).toBe("confirmed");
    if (read.kind !== "confirmed" || !read.value) return;
    expect(guestFacingFolioRows(read.value).map((x) => x.line.amount)).toEqual([450, 50]);
    expect(visibleFolioTotalRows(read.value).map((x) => [x.label, x.amount])).toEqual([
      ["Charges", 450],
      ["Service Tax", 50],
    ]);
    expect(read.value.lines[0]).toMatchObject({
      roomLabel: "101",
      taxRateBp: 800,
      stayDate: "2026-10-07",
    });
    expect(read.value.propertyDate).toBe("2026-10-08");
  });
  it.each(["frozen", "bill_dispatched", "needs_review", "settled", "closed"])(
    "uses frozen facts in state %s",
    (state) => {
      const r = projectSettlementFolio(scope, saved(captured(), state));
      expect(r.kind).toBe("confirmed");
      if (r.kind === "confirmed") expect(r.value?.totals.grandTotal).toBe(500);
    },
  );
  it.each(["scope", "currency", "total", "incomplete", "rows"])(
    "rejects inconsistent prepared %s",
    (change) => {
      const dto = preparedSettlementFolio();
      if (change === "scope") dto.reservation.id = "alien";
      if (change === "currency") dto.reservation.currency = "USD";
      if (change === "total") dto.totals.grandTotal = 501;
      if (change === "incomplete") dto.readiness.projectedRoomNights = 1;
      if (change === "rows") dto.lines[0].amount = 499;
      expect(captureSettlementFolio(settlementFixture(), dto).kind).toBe("contradiction");
    },
  );
  it("rejects another charge with the same grand total", () => {
    const dto = preparedSettlementFolio();
    dto.lines[0].id = "alien-line";
    expect(captureSettlementFolio(settlementFixture(), dto).kind).toBe("contradiction");
  });
  it("never rebuilds an old frozen intent missing its projection", () => {
    expect(projectSettlementFolio(scope, saved(settlementFixture()))).toEqual({
      kind: "unavailable",
      code: "settlement_folio_missing",
    });
  });
  it("rejects a changed persisted projection digest and alien intent scope", () => {
    const intent = saved(captured());
    intent.snapshot.folioProjection!.folio.lines[0].description = "Changed after freeze";
    expect(projectSettlementFolio(scope, intent).kind).toBe("contradiction");
    expect(projectSettlementFolio({ ...scope, tenantId: "alien" }, saved(captured())).kind).toBe(
      "contradiction",
    );
  });
  it("returns the unfrozen path only for explicit absence", () => {
    expect(projectSettlementFolio(scope, null)).toEqual({ kind: "confirmed", value: null });
    expect(projectSettlementFolio(scope, {} as unknown).kind).toBe("unavailable");
  });
  it("makes only the exact scoped read RPC, with no N3 transport", async () => {
    const calls: unknown[] = [];
    const dto = await readFrozenSettlementFolio(scope, async (name, args) => {
      calls.push([name, args]);
      return { data: saved(captured()), error: null };
    });
    expect(dto?.totals.grandTotal).toBe(500);
    expect(calls).toEqual([
      [
        "hotelhub_settlement_read",
        { p_tenant_id: scope.tenantId, p_reservation_id: scope.reservationId },
      ],
    ]);
  });
  it("does not mistake an absent/stale RPC cache for proof that no frozen intent exists", async () => {
    await expect(
      readFrozenSettlementFolio(scope, async () => ({
        data: null,
        error: { code: "PGRST202", message: "missing function" },
      })),
    ).rejects.toThrow("settlement_folio_unavailable");
  });
  it.each(["42501", "08006"])("does not reprice on denied/failed ledger read %s", async (code) => {
    await expect(
      readFrozenSettlementFolio(scope, async () => ({ data: null, error: { code } })),
    ).rejects.toThrow("settlement_folio_unavailable");
  });
});
