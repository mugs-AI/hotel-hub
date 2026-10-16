// Server-only canonical charge projection. Original folio rows are never rewritten.
import { createHash } from "node:crypto";
import type { SettlementActor } from "./settlement-context.server";
import type { EvidenceResult } from "./settlement";
import type { SnapshotLine } from "./settlement-snapshot.server";
import { guestFacingFolioRows, type FolioViewDTO } from "./folio-view";
import {
  resolveServiceTaxRate,
  serviceTaxKeyFor,
  type FinancialSettings,
} from "./financial-settings";
import { parseCents, sumCents } from "./folio-money";
import type { TaxClass } from "./charges-catalogue";
export type PostingPreparationInput = {
  folioId: string;
  view: FolioViewDTO;
  rawLines: Record<string, unknown>[];
  settings: FinancialSettings;
  resolveRoomUom(actor: SettlementActor, stockId: number): Promise<EvidenceResult<number>>;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function fail(code: string): never {
  throw Error(code);
}
function id(v: unknown): number {
  if (
    (typeof v !== "number" && typeof v !== "string") ||
    !/^[1-9]\d*$/.test(String(v)) ||
    Number(v) > 2147483647
  )
    fail("settlement_local_mapping_required");
  return Number(v);
}
function amount(v: number): number {
  if (v < 0) fail("n3_signed_charge_contract_unverified");
  const n = parseCents(v);
  if (n === null) fail("settlement_local_amount_invalid");
  return n;
}
export function derivedPostingLineId(
  scope: Pick<SettlementActor, "tenantId" | "reservationId">,
  folioId: string,
  kind: string,
) {
  if (
    ![scope.tenantId, scope.reservationId, folioId].every(uuid) ||
    !["service_charge", "tourism_tax", "local_levy"].includes(kind)
  )
    fail("settlement_local_mapping_required");
  const h = createHash("sha256")
    .update(
      [
        scope.tenantId.toLowerCase(),
        scope.reservationId.toLowerCase(),
        folioId.toLowerCase(),
        kind,
      ].join("|"),
    )
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Tax is embedded on its charge once. The existing folio calculator's total
 * must agree exactly with N3's currently supported per-line rounding. Unknown
 * signed-line or rounding contracts remain closed, never approximated. */
export async function preparePostingLines(
  actor: SettlementActor,
  input: PostingPreparationInput,
): Promise<EvidenceResult<SnapshotLine[]>> {
  const a = Object.freeze({ ...actor });
  try {
    if (
      ![a.tenantId, a.reservationId, input.folioId].every(uuid) ||
      !["owner", "front_desk"].includes(a.role) ||
      !a.n3Token?.trim() ||
      !a.n3UserKey?.trim()
    )
      fail("settlement_forbidden");
    const { view, settings, rawLines, folioId } = structuredClone({
      view: input.view,
      settings: input.settings,
      rawLines: input.rawLines,
      folioId: input.folioId,
    });
    if (
      settings.tenantId !== a.tenantId ||
      view.reservation.id !== a.reservationId ||
      view.readiness.serviceTaxRegistered !== settings.serviceTaxRegistered
    )
      fail("settlement_scope_mismatch");
    if (
      !view.readiness.calculationComplete ||
      !view.readiness.configurationComplete ||
      !view.readiness.roomNightsPrepared ||
      view.readiness.projectedRoomNights !== 0 ||
      view.blockers.some((b) => b.severity === "blocking")
    )
      fail("settlement_folio_not_prepared");
    if (view.totals.rounding !== 0) fail("n3_rounding_contract_unverified");
    const visible = guestFacingFolioRows(view).filter((r) => r.kind === "line");
    if (
      !visible.length ||
      visible.length !== rawLines.length ||
      new Set(rawLines.map((l) => l.id)).size !== rawLines.length ||
      rawLines.some((l) => l.tenant_id !== a.tenantId || l.folio_id !== folioId || !uuid(l.id)) ||
      visible.some(
        ({ line: l }) =>
          !rawLines.some(
            (r) =>
              r.id === l.id &&
              r.line_type === l.lineType &&
              r.quantity === l.quantity &&
              r.unit_price_cents === amount(l.unitPrice) &&
              r.subtotal_cents === amount(l.amount) &&
              r.description_snapshot === l.description,
          ),
      )
    )
      fail("settlement_local_folio_mismatch");
    const rows: SnapshotLine[] = [];
    function append(
      v: {
        localLineId: string;
        kind: string;
        stockId: number;
        uomId: number;
        taxCodeId: number;
        qty: number;
        unitCents: number;
        subtotalCents: number;
        description: string;
      },
      bp: number,
    ) {
      if (
        !Number.isInteger(v.qty) ||
        v.qty < 1 ||
        v.qty > 9999 ||
        v.unitCents * v.qty !== v.subtotalCents ||
        !Number.isInteger(bp) ||
        bp < 0 ||
        bp > 10000 ||
        !v.description.trim() ||
        v.description.length > 160
      )
        fail("settlement_local_amount_invalid");
      const taxCents = Number((BigInt(v.subtotalCents) * BigInt(bp) + 5000n) / 10000n),
        totalCents = v.subtotalCents + taxCents;
      if (sumCents([v.subtotalCents, taxCents]) !== totalCents)
        fail("settlement_local_amount_invalid");
      rows.push({
        ...v,
        taxCents,
        totalCents,
        mappingEvidence: {},
        status: "draft",
        reversesLineId: null,
      });
    }
    for (const { line: l } of visible) {
      const raw = rawLines.find((r) => r.id === l.id)!,
        captured = object(raw.tax_snapshot) ? raw.tax_snapshot : {};
      const stockId = id(raw.n3_stock_id_snapshot ?? captured.n3StockId),
        unit = raw.n3_uom_id_snapshot ?? captured.n3UomId;
      if (
        raw.n3_stock_id_snapshot != null &&
        captured.n3StockId != null &&
        id(captured.n3StockId) !== stockId
      )
        fail("settlement_local_mapping_conflict");
      let uomId: number;
      if (unit == null) {
        if (l.lineType !== "room_night") fail("settlement_local_mapping_required");
        const current = await input.resolveRoomUom(a, stockId);
        if (
          ["tenantId", "reservationId", "n3UserKey", "n3Token", "role"].some(
            (k) => actor[k as keyof SettlementActor] !== a[k as keyof SettlementActor],
          )
        )
          fail("settlement_scope_mismatch");
        if (current.kind !== "confirmed") return current;
        uomId = id(current.value);
      } else uomId = id(unit);
      if (
        raw.n3_uom_id_snapshot != null &&
        captured.n3UomId != null &&
        id(captured.n3UomId) !== uomId
      )
        fail("settlement_local_mapping_conflict");
      if (!l.taxClass) fail("settlement_local_mapping_required");
      const rate = resolveServiceTaxRate(settings, l.taxClass);
      if (!rate.ok) fail("settlement_local_mapping_required");
      if (rate.source === "configured" && l.taxRateBp !== rate.rateBp)
        fail("settlement_local_folio_mismatch");
      const key = serviceTaxKeyFor(l.taxClass);
      const taxCodeId =
        rate.source === "configured"
          ? id(key ? settings.serviceTax[key].n3TaxCodeId : null)
          : id(settings.exempt.n3TaxCodeId);
      append(
        {
          localLineId: l.id,
          kind: l.lineType,
          stockId,
          uomId,
          taxCodeId,
          qty: l.quantity,
          unitCents: amount(l.unitPrice),
          subtotalCents: amount(l.amount),
          description: l.description,
        },
        rate.rateBp,
      );
    }
    const derived = view.derived.filter((l) => l.lineType !== "service_tax" && l.amount !== 0);
    if (
      new Set(view.derived.map((l) => l.key)).size !== view.derived.length ||
      new Set(derived.map((l) => l.lineType)).size !== derived.length
    )
      fail("settlement_local_folio_mismatch");
    for (const l of derived) {
      if (
        l.lineType !== "service_charge" &&
        l.lineType !== "tourism_tax" &&
        l.lineType !== "local_levy"
      )
        fail("settlement_local_mapping_required");
      const mapping = settings.postingMappings[l.lineType];
      if (!mapping.enabled) fail("settlement_local_mapping_required");
      let bp = 0;
      if (l.lineType === "service_charge" && settings.serviceCharge.serviceTaxApplies) {
        const rate = resolveServiceTaxRate(settings, "service_charge" as TaxClass);
        if (!rate.ok) fail("settlement_local_mapping_required");
        bp = rate.rateBp;
      }
      if (bp !== (l.taxRateBp ?? 0)) fail("settlement_local_folio_mismatch");
      append(
        {
          localLineId: derivedPostingLineId(a, folioId, l.lineType),
          kind: l.lineType,
          stockId: id(mapping.stock.id),
          uomId: id(mapping.uom.id),
          taxCodeId: id(mapping.taxCode.id),
          qty: l.quantity,
          unitCents: amount(l.unitPrice),
          subtotalCents: amount(l.amount),
          description: l.description,
        },
        bp,
      );
    }
    if (sumCents(rows.map((l) => l.taxCents)) !== amount(view.totals.serviceTax))
      fail("n3_tax_rounding_contract_unverified");
    if (
      sumCents(rows.map((l) => l.totalCents)) !== amount(view.totals.grandTotal) ||
      new Set(rows.map((l) => l.localLineId)).size !== rows.length
    )
      fail("settlement_local_folio_mismatch");
    return { kind: "confirmed", value: rows };
  } catch (error) {
    return {
      kind: "unavailable",
      code:
        error instanceof Error && /^(settlement_|n3_)[a-z_]+$/.test(error.message)
          ? error.message
          : "settlement_local_folio_mismatch",
    };
  }
}
