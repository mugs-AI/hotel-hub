// Server-only prepared-folio/deposit bridge. Reads never create a folio, OR or bill.
import { preparePostingLines } from "./posting-preparation.server";
import type { FinancialSettings } from "./financial-settings";
import type { SettlementActor } from "./settlement-context.server";
import { billingPayloadDigest } from "./n3-billing.server";
import { parseCents, sumCents } from "./folio-money";
import { propertyTodayIso } from "./checkout-preview";
import { guestFacingFolioRows } from "./folio-view";
import { isN3Guid } from "./n3-guid";
import { computeReceiptOverlay, type ReceiptVersionRow } from "./effective-receipts";
import type { LinkedReceipt, SourceVersion } from "./settlement";
import type { EvidenceResult } from "./settlement";
import type { SnapshotFacts } from "./settlement-snapshot.server";
import type { FolioViewDTO } from "./folio-view";
export type LocalFactsQuery = {
  select(columns: string, options: { count: "exact" }): LocalFactsQuery;
  eq(column: string, value: unknown): LocalFactsQuery;
  in(column: string, values: readonly unknown[]): LocalFactsQuery;
  order(column: string): LocalFactsQuery;
  limit(
    n: number,
  ): PromiseLike<{ data: Record<string, unknown>[] | null; count: number | null; error: unknown }>;
};
export type LocalFactsDb = {
  from(table: string): LocalFactsQuery;
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};
export type LocalFactsHeader = {
  customerId: number;
  currencyId: number;
  currency: string;
  currencyRate: number;
};
export type LocalFactsPorts = {
  db: LocalFactsDb;
  /** Trusted saved payer/intent only; never a browser-supplied override. */
  customerId?: number;
  /** Only the digest-validated saved intent may supply its original date. */
  frozenPropertyDate?: string;
  readFinancialSettings?(actor: SettlementActor): Promise<FinancialSettings>;
  readView(actor: SettlementActor, timezone: string): Promise<FolioViewDTO>;
  readHeader(
    actor: SettlementActor,
    customerId: number,
    currency: string,
  ): Promise<EvidenceResult<LocalFactsHeader>>;
  resolveRoomUom(actor: SettlementActor, stockId: number): Promise<EvidenceResult<number>>;
  readReceiptDate(actor: SettlementActor, receiptId: string): Promise<EvidenceResult<string>>;
  now(): Date;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const localId = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const cents = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || Math.abs(v) > 1_000_000_000)
    throw Error("settlement_local_amount_invalid");
  return v;
};
const masterId = (v: unknown): number => {
  if (
    (typeof v !== "string" && typeof v !== "number") ||
    !/^[1-9]\d*$/.test(String(v)) ||
    Number(v) > 2147483647
  )
    throw Error("settlement_local_mapping_required");
  return Number(v);
};
const day = (v: unknown): string => {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw Error("settlement_receipt_date_unavailable");
  return v;
};
/** Source fingerprints bracket all local reads. The freeze RPC must compare
 * them again under lock. This is a read adapter, never N3 posting acceptance.
 * Canonical posting rows must equal the prepared folio including tax/charges;
 * historical zero-tax rows must not be promoted to a tax-free N3 invoice. */
export async function readLocalSettlementFacts(
  actor: SettlementActor,
  ports: LocalFactsPorts,
): Promise<EvidenceResult<SnapshotFacts>> {
  const a = Object.freeze({ ...actor });
  function current() {
    if (
      ["tenantId", "reservationId", "n3UserKey", "n3Token", "role"].some(
        (k) => actor[k as keyof SettlementActor] !== a[k as keyof SettlementActor],
      )
    )
      throw Error("settlement_scope_mismatch");
  }
  try {
    if (
      !localId(a.tenantId) ||
      !localId(a.reservationId) ||
      !["owner", "front_desk"].includes(a.role) ||
      !a.n3UserKey?.trim() ||
      !a.n3Token?.trim()
    )
      throw Error("settlement_forbidden");
    async function rpc(name: string, args: Record<string, unknown>) {
      current();
      const r = await ports.db.rpc(name, args);
      current();
      if (r.error)
        throw Error(
          ["42883", "PGRST202", "42P01", "PGRST205"].includes(r.error.code ?? "")
            ? "settlement_setup_required"
            : "settlement_local_read_unavailable",
        );
      return r.data;
    }
    async function rows(
      table: string,
      columns: string,
      filters: Record<string, unknown>,
      limit: number,
    ) {
      current();
      let q = ports.db
        .from(table)
        .select("tenant_id," + columns, { count: "exact" })
        .eq("tenant_id", a.tenantId);
      for (const [k, v] of Object.entries(filters)) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
      const r = await q.limit(limit + 1);
      current();
      if (
        r.error ||
        !Array.isArray(r.data) ||
        !Number.isSafeInteger(r.count) ||
        r.count === null ||
        r.count < 0 ||
        r.count !== r.data.length ||
        r.count > limit
      )
        throw Error("settlement_local_read_unavailable");
      if (
        r.data.some(
          (row) =>
            !object(row) ||
            row.tenant_id !== a.tenantId ||
            Object.entries(filters).some(([k, v]) =>
              Array.isArray(v) ? !v.includes(row[k]) : row[k] !== v,
            ),
        )
      )
        throw Error("settlement_scope_mismatch");
      return r.data;
    }
    const scope = { p_tenant_id: a.tenantId, p_reservation_id: a.reservationId };
    const before = await rpc("hotelhub_settlement_sources", scope);
    if (
      !Array.isArray(before) ||
      before.length === 0 ||
      before.length > 15000 ||
      before.some(
        (v) =>
          !object(v) ||
          typeof v.table !== "string" ||
          !localId(v.id) ||
          typeof v.version !== "string" ||
          !v.version,
      )
    )
      throw Error("settlement_source_versions_unavailable");
    const reservation = (
      await rows("hotel_reservations", "id,status,currency", { id: a.reservationId }, 1)
    )[0];
    if (!reservation) throw Error("settlement_reservation_not_found");
    if (reservation.status !== "checked_in") throw Error("settlement_reservation_not_checked_in");
    const folio = (
      await rows(
        "hotel_folios",
        "id,reservation_id,status,currency,updated_at",
        { reservation_id: a.reservationId },
        1,
      )
    )[0];
    if (!folio || folio.status !== "prepared" || !localId(folio.id))
      throw Error("settlement_folio_not_prepared");
    if (folio.currency !== reservation.currency) throw Error("settlement_local_currency_mismatch");
    const settings = (await rows("hotel_settings", "timezone,n3_walk_in_customer_id", {}, 1))[0];
    if (
      !settings ||
      typeof settings.timezone !== "string" ||
      !propertyTodayIso(settings.timezone, ports.now())
    )
      throw Error("settlement_property_settings_required");
    const expectedDate =
      ports.frozenPropertyDate === undefined
        ? propertyTodayIso(settings.timezone, ports.now())
        : day(ports.frozenPropertyDate);
    if (!expectedDate || expectedDate > propertyTodayIso(settings.timezone, ports.now())!)
      throw Error("settlement_snapshot_changed");
    const [raw, deposits, requests, billTo, view] = await Promise.all([
      rows(
        "hotel_folio_lines",
        "id,folio_id,line_type,status,quantity,unit_price_cents,subtotal_cents,tax_cents,total_cents,description_snapshot,n3_stock_id_snapshot,n3_uom_id_snapshot,n3_tax_code_id_snapshot,tax_snapshot,reverses_line_id",
        { folio_id: folio.id },
        10000,
      ),
      rows(
        "hotel_reservation_deposits",
        "id,reservation_id,status,amount,currency_code,n3_receipt_id,n3_reference_no,n3_customer_id,payment_lines",
        { reservation_id: a.reservationId },
        100,
      ),
      rows(
        "hotel_receipt_control_requests",
        "reservation_id,deposit_id,state",
        { reservation_id: a.reservationId },
        1000,
      ),
      rpc("hotelhub_bill_to_current", { p_tenant: a.tenantId, p_res: a.reservationId }),
      ports.readView(a, settings.timezone),
    ]);
    current();
    if (
      view.reservation.id !== a.reservationId ||
      view.reservation.currency !== reservation.currency
    )
      throw Error("settlement_scope_mismatch");
    if (
      !view.readiness.roomNightsPrepared ||
      view.readiness.projectedRoomNights !== 0 ||
      !view.readiness.configurationComplete ||
      !view.readiness.calculationComplete ||
      view.blockers.some((b) => b.severity === "blocking")
    )
      throw Error("settlement_folio_not_prepared");
    if (
      requests.some((r) => !["applied", "rejected"].includes(String(r.state))) ||
      deposits.some((d) => d.status === "submitting" || d.status === "unknown")
    )
      throw Error("settlement_pending_financial_operation");
    const ignored = new Set<string>();
    for (const r of raw.filter((l) => l.line_type === "reversal")) {
      const original = raw.find((l) => l.id === r.reverses_line_id);
      if (
        !original ||
        original.status !== "reversed" ||
        original.line_type === "room_night" ||
        original.line_type === "reversal" ||
        ignored.has(String(original.id)) ||
        ["subtotal_cents", "tax_cents", "total_cents"].some(
          (k) => cents(r[k]) !== -cents(original[k]),
        )
      )
        throw Error("settlement_folio_reversal_mismatch");
      ignored.add(String(original.id));
      ignored.add(String(r.id));
    }
    if (raw.some((l) => l.status === "reversed" && !ignored.has(String(l.id))))
      throw Error("settlement_folio_reversal_mismatch");
    const active = raw.filter((l) => !ignored.has(String(l.id))),
      printed = guestFacingFolioRows(view).filter((r) => r.kind === "line");
    if (
      !active.length ||
      active.length !== printed.length ||
      new Set(active.map((l) => l.id)).size !== active.length ||
      printed.some(
        (r) =>
          !active.some(
            (l) =>
              l.id === r.line.id &&
              l.line_type === r.line.lineType &&
              l.quantity === r.line.quantity &&
              l.unit_price_cents === parseCents(r.line.unitPrice) &&
              l.subtotal_cents === parseCents(r.line.amount) &&
              l.description_snapshot === r.line.description,
          ),
      )
    )
      throw Error("settlement_local_folio_mismatch");
    const totalCents = parseCents(view.totals.grandTotal);
    if (
      !ports.readFinancialSettings &&
      (totalCents === null ||
        totalCents <= 0 ||
        sumCents(active.map((l) => cents(l.total_cents))) !== totalCents ||
        view.totals.rounding !== 0 ||
        view.derived.some((l) => l.lineType !== "service_tax" && l.amount !== 0) ||
        sumCents(active.map((l) => cents(l.tax_cents))) !== parseCents(view.totals.serviceTax))
    )
      throw Error("settlement_prepared_posting_rows_required");
    if (totalCents === null || totalCents <= 0) throw Error("settlement_local_amount_invalid");
    const customerId = masterId(ports.customerId ?? settings.n3_walk_in_customer_id);
    const header = await ports.readHeader(a, customerId, String(reservation.currency));
    current();
    if (header.kind !== "confirmed") return header;
    if (
      header.value.customerId !== customerId ||
      header.value.currency !== reservation.currency ||
      header.value.currencyRate !== 1 ||
      masterId(header.value.currencyId) !== header.value.currencyId
    )
      throw Error("settlement_local_currency_mismatch");
    let lines: SnapshotFacts["lines"] = [];
    if (ports.readFinancialSettings) {
      const financial = await ports.readFinancialSettings(a);
      current();
      const prepared = await preparePostingLines(a, {
        folioId: folio.id,
        view,
        rawLines: active,
        settings: financial,
        resolveRoomUom: ports.resolveRoomUom,
      });
      current();
      if (prepared.kind !== "confirmed") return prepared;
      lines = prepared.value;
    }
    for (const l of ports.readFinancialSettings ? [] : active) {
      const captured = object(l.tax_snapshot) ? l.tax_snapshot : {};
      const stockId = masterId(l.n3_stock_id_snapshot ?? captured.n3StockId);
      const savedUnit = l.n3_uom_id_snapshot ?? captured.n3UomId;
      let uomId: number;
      if (savedUnit === null || savedUnit === undefined) {
        if (l.line_type !== "room_night") throw Error("settlement_local_mapping_required");
        const unit = await ports.resolveRoomUom(a, stockId);
        current();
        if (unit.kind !== "confirmed") return unit;
        uomId = masterId(unit.value);
      } else uomId = masterId(savedUnit);
      if (
        (l.n3_stock_id_snapshot != null &&
          captured.n3StockId != null &&
          masterId(captured.n3StockId) !== stockId) ||
        (savedUnit != null && captured.n3UomId != null && masterId(captured.n3UomId) !== uomId)
      )
        throw Error("settlement_local_mapping_conflict");
      const taxCodeId = masterId(l.n3_tax_code_id_snapshot ?? captured.n3TaxCodeId);
      if (
        l.n3_tax_code_id_snapshot != null &&
        captured.n3TaxCodeId != null &&
        masterId(captured.n3TaxCodeId) !== taxCodeId
      )
        throw Error("settlement_local_mapping_conflict");
      lines.push({
        localLineId: String(l.id),
        kind: String(l.line_type),
        stockId,
        uomId,
        taxCodeId,
        qty: Number(l.quantity),
        unitCents: cents(l.unit_price_cents),
        subtotalCents: cents(l.subtotal_cents),
        taxCents: cents(l.tax_cents),
        totalCents: cents(l.total_cents),
        description: String(l.description_snapshot),
        mappingEvidence: {},
        status: String(l.status),
        reversesLineId: null,
      });
    }
    const ids = new Set(deposits.map((d) => d.id));
    const versionRows = ids.size
      ? await rows(
          "hotel_receipt_versions",
          "id,deposit_id,request_id,version_no,state,receipt_id,doc_code,document_date,currency,amount_cents,payment_lines,replacement_of,verified_at",
          { deposit_id: [...ids] },
          10000,
        )
      : [];
    const versions: ReceiptVersionRow[] = versionRows
      .filter((v) => ids.has(v.deposit_id))
      .map((v) => {
        if (
          !Number.isSafeInteger(v.version_no) ||
          Number(v.version_no) < 1 ||
          !["active", "voided"].includes(String(v.state)) ||
          !isN3Guid(v.receipt_id) ||
          typeof v.verified_at !== "string" ||
          !Number.isFinite(Date.parse(v.verified_at)) ||
          !Array.isArray(v.payment_lines)
        )
          throw Error("settlement_receipt_history_unavailable");
        return {
          depositId: String(v.deposit_id),
          requestId: String(v.request_id),
          versionNo: Number(v.version_no),
          state: v.state as "active" | "voided",
          receiptId: String(v.receipt_id),
          docCode: String(v.doc_code),
          documentDate: day(v.document_date),
          currency: String(v.currency),
          amountCents: cents(v.amount_cents),
          paymentLines: v.payment_lines as ReceiptVersionRow["paymentLines"],
          replacementOf: v.replacement_of as string | null,
          verifiedAt: v.verified_at,
        };
      });
    if (new Set(versions.map((v) => v.depositId + ":" + v.versionNo)).size !== versions.length)
      throw Error("settlement_receipt_history_unavailable");
    const overlay = computeReceiptOverlay(versions, new Set());
    const receipts: LinkedReceipt[] = [];
    for (const d of deposits) {
      if (d.status !== "posted") {
        if (!["draft", "failed"].includes(String(d.status)) || d.n3_receipt_id)
          throw Error("settlement_pending_financial_operation");
        continue;
      }
      const effective = overlay.get(String(d.id));
      if (effective?.needsReview) throw Error("settlement_receipt_history_unavailable");
      if (effective?.confirmed.state === "voided") continue;
      const confirmed = effective?.confirmed;
      const v =
        confirmed?.state === "active"
          ? versions.find(
              (x) =>
                x.depositId === d.id &&
                x.receiptId === confirmed.receiptId &&
                x.versionNo ===
                  Math.max(...versions.filter((x) => x.depositId === d.id).map((x) => x.versionNo)),
            )
          : null;
      if (effective?.confirmed.state === "active" && !v)
        throw Error("settlement_receipt_history_unavailable");
      const receiptId = v?.receiptId ?? d.n3_receipt_id;
      if (!localId(d.id) || !isN3Guid(receiptId)) throw Error("settlement_receipt_link_invalid");
      const date = v
        ? { kind: "confirmed" as const, value: v.documentDate }
        : await ports.readReceiptDate(a, receiptId);
      current();
      if (date.kind !== "confirmed") return date;
      const amountCents = v ? v.amountCents : parseCents(d.amount);
      const paymentRows = v ? v.paymentLines : d.payment_lines;
      if (
        !Array.isArray(paymentRows) ||
        amountCents === null ||
        amountCents <= 0 ||
        masterId(d.n3_customer_id) !== header.value.customerId ||
        (v?.currency ?? d.currency_code) !== header.value.currency
      )
        throw Error("settlement_receipt_link_invalid");
      const payments = paymentRows.map((p) => {
        if (
          !object(p) ||
          !isN3Guid(v ? p.accountId : p.id) ||
          typeof p.code !== "string" ||
          !p.code.trim() ||
          typeof (v ? p.savedName : p.name) !== "string"
        )
          throw Error("settlement_receipt_link_invalid");
        return {
          accountId: String(v ? p.accountId : p.id),
          accountCode: p.code,
          accountName: String(v ? p.savedName : p.name),
          amountCents: v ? cents(p.amountCents) : (parseCents(p.amount) ?? -1),
        };
      });
      if (
        payments.length !== 1 ||
        payments.some((p) => p.amountCents <= 0) ||
        sumCents(payments.map((p) => p.amountCents)) !== amountCents ||
        typeof d.n3_reference_no !== "string" ||
        !d.n3_reference_no.trim()
      )
        throw Error("settlement_receipt_link_invalid");
      receipts.push({
        depositId: d.id,
        reservationId: a.reservationId,
        receiptId,
        reference: d.n3_reference_no,
        customerId: header.value.customerId,
        currency: header.value.currency,
        amountCents,
        receiptDate: day(date.value),
        payments,
      });
    }
    const after = await rpc("hotelhub_settlement_sources", scope);
    if (billingPayloadDigest(before) !== billingPayloadDigest(after))
      throw Error("settlement_snapshot_changed");
    const stamp = typeof folio.updated_at === "string" ? Date.parse(folio.updated_at) : NaN;
    if (!Number.isSafeInteger(stamp) || stamp < 0 || !object(billTo))
      throw Error("settlement_local_read_unavailable");
    if (
      view.propertyDate !== expectedDate ||
      (ports.frozenPropertyDate === undefined &&
        expectedDate !== propertyTodayIso(settings.timezone, ports.now()))
    )
      throw Error("settlement_snapshot_changed");
    return {
      kind: "confirmed",
      value: {
        tenantId: a.tenantId,
        reservationId: a.reservationId,
        folioId: folio.id,
        revision: String(stamp),
        ...header.value,
        billDate: view.propertyDate,
        propertyTimezone: settings.timezone,
        billTo: billTo as SnapshotFacts["billTo"],
        totalCents,
        lines,
        receipts,
        sourceVersions: before as SourceVersion[],
        folioProjection: { version: 1, folio: view },
        prepared: true,
        reservationStatus: "checked_in",
        historyGap: false,
        blockers: [],
      },
    };
  } catch (error) {
    const code =
      error instanceof Error && /^settlement_[a-z_]+$/.test(error.message)
        ? error.message
        : "settlement_local_read_unavailable";
    return {
      kind: ["settlement_scope_mismatch", "settlement_snapshot_changed"].includes(code)
        ? "contradiction"
        : "unavailable",
      code,
    };
  }
}
