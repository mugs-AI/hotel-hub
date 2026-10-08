import type { SettlementActor } from "./settlement-context.server";
import type {
  ChargeLine,
  EvidenceResult,
  LinkedReceipt,
  SettlementScope,
  SettlementSnapshot,
} from "./settlement";
import { createHash } from "node:crypto";
import { MAX_MONEY_CENTS, sumCents } from "./checkout-money";
import { propertyTodayIso } from "./checkout-preview";

export type SnapshotLine = ChargeLine & { status: string; reversesLineId: string | null };
export type SnapshotFacts = Omit<SettlementSnapshot, "digest" | "lines"> & {
  lines: SnapshotLine[];
  prepared: boolean;
  reservationStatus: string;
  historyGap: boolean;
  blockers: string[];
};
export type SnapshotDeps = {
  readFacts(scope: SettlementScope): Promise<SnapshotFacts | null>;
  verifyLine(actor: SettlementActor, line: ChargeLine): Promise<EvidenceResult<ChargeLine>>;
  verifyReceipt(
    actor: SettlementActor,
    receipt: LinkedReceipt,
  ): Promise<EvidenceResult<LinkedReceipt>>;
  now(): Date;
};
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const r = value as Record<string, unknown>;
    return `{${Object.keys(r)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(r[k])}`)
      .join(",")}}`;
  }
  throw new Error("non_json_snapshot_fact");
}
export function snapshotDigest(snapshot: Omit<SettlementSnapshot, "digest">): string {
  return createHash("sha256").update(canonical(snapshot)).digest("hex");
}
const money = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_MONEY_CENTS;
const masterId = (n: number) => Number.isInteger(n) && n > 0 && n <= 2147483647;
const uuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const isoDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const sourceTables = new Set([
  "hotel_reservations",
  "hotel_reservation_rooms",
  "hotel_reservation_guests",
  "hotel_guests",
  "hotel_folios",
  "hotel_folio_lines",
  "hotel_reservation_tax_profile",
  "hotel_tourism_tax_evidence",
  "hotel_reservation_deposits",
  "hotel_receipt_versions",
  "hotel_folio_bill_to",
  "hotel_financial_settings",
  "hotel_settings",
]);
function activeLines(lines: SnapshotLine[]): ChargeLine[] | null {
  if (new Set(lines.map((l) => l.localLineId)).size !== lines.length) return null;
  const ignored = new Set<string>();
  for (const reversal of lines.filter((l) => l.kind === "reversal")) {
    const original = lines.find((l) => l.localLineId === reversal.reversesLineId);
    if (
      !original ||
      original.kind === "room_night" ||
      original.kind === "reversal" ||
      original.status !== "reversed" ||
      ignored.has(original.localLineId) ||
      reversal.subtotalCents !== -original.subtotalCents ||
      reversal.totalCents !== -original.totalCents ||
      reversal.taxCents !== -original.taxCents ||
      reversal.stockId !== original.stockId ||
      reversal.uomId !== original.uomId ||
      reversal.taxCodeId !== original.taxCodeId
    )
      return null;
    ignored.add(original.localLineId);
    ignored.add(reversal.localLineId);
  }
  if (lines.some((l) => l.status === "reversed" && !ignored.has(l.localLineId))) return null;
  return lines
    .filter((l) => !ignored.has(l.localLineId))
    .map(({ status: _s, reversesLineId: _r, ...line }) => line);
}
function lineFacts(line: ChargeLine): unknown {
  const { mappingEvidence: _mapping, ...facts } = line;
  return facts;
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
export async function loadSettlementSnapshot(
  actor: SettlementActor,
  deps: SnapshotDeps,
): Promise<EvidenceResult<SettlementSnapshot>> {
  try {
    if (!["owner", "front_desk"].includes(actor.role))
      return { kind: "contradiction", code: "forbidden" };
    const f = await deps.readFacts({
      tenantId: actor.tenantId,
      reservationId: actor.reservationId,
    });
    if (!f) return { kind: "unavailable", code: "reservation_not_found" };
    if (
      f.tenantId !== actor.tenantId ||
      f.reservationId !== actor.reservationId ||
      !uuid(f.folioId)
    )
      return { kind: "contradiction", code: "settlement_scope_mismatch" };
    if (f.reservationStatus !== "checked_in")
      return { kind: "contradiction", code: "reservation_not_checked_in" };
    if (!f.prepared) return { kind: "unavailable", code: "folio_not_prepared" };
    if (f.historyGap) return { kind: "unavailable", code: "historical_charge_evidence_incomplete" };
    if (f.blockers.length) return { kind: "unavailable", code: f.blockers[0] };
    const contactLimits = { name: 160, company: 200, address: 600, phone: 60, email: 254 };
    if (
      !f.billTo ||
      Object.entries(contactLimits).some(([key, limit]) => {
        const v = f.billTo[key as keyof typeof contactLimits];
        return typeof v !== "string" || v.length > limit;
      }) ||
      (!f.billTo.name.trim() && !f.billTo.company.trim()) ||
      (f.billTo.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.billTo.email))
    )
      return { kind: "contradiction", code: "invalid_bill_to_snapshot" };
    const billDate = propertyTodayIso(f.propertyTimezone, deps.now());
    if (
      !billDate ||
      !/^[A-Z]{3}$/.test(f.currency) ||
      !masterId(f.customerId) ||
      !masterId(f.currencyId) ||
      !Number.isFinite(f.currencyRate) ||
      f.currencyRate <= 0 ||
      f.currencyRate > 999999 ||
      !/^(0|[1-9]\d{0,18})$/.test(f.revision) ||
      !money(f.totalCents) ||
      f.totalCents <= 0
    )
      return { kind: "contradiction", code: "invalid_settlement_header" };
    if (
      !f.sourceVersions.length ||
      f.sourceVersions.some((v) => !sourceTables.has(v.table) || !uuid(v.id) || !v.version) ||
      new Set(f.sourceVersions.map((v) => `${v.table}:${v.id}`)).size !== f.sourceVersions.length
    )
      return { kind: "contradiction", code: "source_versions_incomplete" };
    const lines = activeLines(f.lines);
    if (!lines) return { kind: "contradiction", code: "folio_reversal_mismatch" };
    if (
      !lines.length ||
      lines.some(
        (l) =>
          !uuid(l.localLineId) ||
          !masterId(l.stockId) ||
          !masterId(l.uomId) ||
          !masterId(l.taxCodeId) ||
          !Number.isInteger(l.qty) ||
          l.qty <= 0 ||
          l.qty > 9999 ||
          ![l.unitCents, l.subtotalCents, l.taxCents, l.totalCents].every(money) ||
          l.subtotalCents !== l.unitCents * l.qty ||
          l.totalCents !== l.subtotalCents + l.taxCents ||
          typeof l.description !== "string" ||
          !l.description.trim() ||
          l.description.length > 160,
      )
    )
      return { kind: "contradiction", code: "invalid_charge_snapshot" };
    if (sumCents(lines.map((l) => l.totalCents)) !== f.totalCents)
      return { kind: "contradiction", code: "folio_total_mismatch" };
    for (const line of lines) {
      const checked = await deps.verifyLine(actor, line);
      if (checked.kind !== "confirmed") return checked;
      if (canonical(lineFacts(checked.value)) !== canonical(lineFacts(line)))
        return { kind: "contradiction", code: "master_snapshot_mismatch" };
      line.mappingEvidence = checked.value.mappingEvidence;
    }
    const receipts: LinkedReceipt[] = [];
    const seen = new Set<string>();
    for (const candidate of f.receipts) {
      if (candidate.reservationId !== actor.reservationId)
        return { kind: "contradiction", code: "receipt_scope_mismatch" };
      if (
        !uuid(candidate.receiptId) ||
        !uuid(candidate.depositId) ||
        seen.has(candidate.receiptId) ||
        !masterId(candidate.customerId) ||
        candidate.customerId !== f.customerId ||
        candidate.currency !== f.currency ||
        !money(candidate.amountCents) ||
        candidate.amountCents <= 0 ||
        !isoDate(candidate.receiptDate) ||
        !candidate.reference ||
        candidate.reference.length > 50 ||
        candidate.payments.length !== 1 ||
        candidate.payments.some(
          (p) => !uuid(p.accountId) || !money(p.amountCents) || p.amountCents <= 0,
        ) ||
        sumCents(candidate.payments.map((p) => p.amountCents)) !== candidate.amountCents
      )
        return { kind: "contradiction", code: "invalid_linked_receipt" };
      const checked = await deps.verifyReceipt(actor, candidate);
      if (checked.kind !== "confirmed") return checked;
      if (canonical(checked.value) !== canonical(candidate))
        return { kind: "contradiction", code: "receipt_snapshot_mismatch" };
      seen.add(candidate.receiptId);
      receipts.push(checked.value);
    }
    const snapshot: Omit<SettlementSnapshot, "digest"> = {
      tenantId: actor.tenantId,
      reservationId: actor.reservationId,
      folioId: f.folioId,
      revision: f.revision,
      currency: f.currency,
      currencyId: f.currencyId,
      currencyRate: f.currencyRate,
      propertyTimezone: f.propertyTimezone,
      billDate,
      customerId: f.customerId,
      billTo: f.billTo,
      lines: lines.sort((a, b) => a.localLineId.localeCompare(b.localLineId)),
      totalCents: f.totalCents,
      receipts: receipts.sort(
        (a, b) =>
          a.receiptDate.localeCompare(b.receiptDate) || a.receiptId.localeCompare(b.receiptId),
      ),
      sourceVersions: [...f.sourceVersions].sort(
        (a, b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id),
      ),
    };
    // Clone removes reference aliases; recursive freeze protects immutable facts.
    const copy = JSON.parse(canonical(snapshot)) as Omit<SettlementSnapshot, "digest">;
    return { kind: "confirmed", value: freezeDeep({ ...copy, digest: snapshotDigest(copy) }) };
  } catch {
    return { kind: "unavailable", code: "settlement_snapshot_read_failed" };
  }
}
