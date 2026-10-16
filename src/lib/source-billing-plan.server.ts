// Pure preparation from trusted, already verified server facts. No I/O or writer.
import type { BillToSnapshot, ChargeLine, EvidenceResult, SettlementSnapshot } from "./settlement";
import type {
  BillingLegKind,
  BillingLegSnapshot,
  ReservationPayerSnapshot,
  SourceBillPlan,
} from "./source-billing";
import { parseSourceBillingPolicy } from "./source-billing-policy.server";
import { snapshotDigest } from "./settlement-snapshot.server";
import { billingPayloadDigest } from "./n3-billing.server";
import { MAX_MONEY_CENTS } from "./checkout-money";

export type SourceBillCustomerFacts = {
  tenantId: string;
  customerId: number;
  currencyId: number;
  currencyRate: number;
  billTo: BillToSnapshot;
};
const contradiction = (code: string) => ({ kind: "contradiction" as const, code });
const unavailable = (code: string) => ({ kind: "unavailable" as const, code });
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const integer = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && Math.abs(n) <= MAX_MONEY_CENTS;
const id = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 2147483647;
const supportedKinds = new Set([
  "room_night",
  "add_on",
  "service_charge",
  "service_tax",
  "tourism_tax",
  "local_levy",
  "discount",
  "manual_adjustment",
  "rounding",
]);
const privateFact = (v: unknown): boolean =>
  !!v &&
  typeof v === "object" &&
  Object.entries(v).some(
    ([k, x]) =>
      /token|authorization|password|secret|cookie|rawjournal|session/i.test(k) || privateFact(x),
  );
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function contact(v: BillToSnapshot): BillToSnapshot | null {
  if (!v || typeof v !== "object") return null;
  const limits = { name: 160, company: 200, address: 600, phone: 60, email: 254 };
  if (
    Object.entries(limits).some(
      ([k, n]) =>
        typeof v[k as keyof BillToSnapshot] !== "string" || v[k as keyof BillToSnapshot].length > n,
    ) ||
    (!v.name.trim() && !v.company.trim()) ||
    (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))
  )
    return null;
  return { name: v.name, company: v.company, address: v.address, phone: v.phone, email: v.email };
}
function lineValid(l: ChargeLine) {
  return (
    uuid(l.localLineId) &&
    supportedKinds.has(l.kind) &&
    [l.stockId, l.uomId, l.taxCodeId].every(id) &&
    Number.isInteger(l.qty) &&
    l.qty > 0 &&
    l.qty <= 9999 &&
    [l.unitCents, l.subtotalCents, l.taxCents, l.totalCents].every(integer) &&
    l.unitCents * l.qty === l.subtotalCents &&
    l.subtotalCents + l.taxCents === l.totalCents &&
    typeof l.description === "string" &&
    !!l.description.trim() &&
    l.description.length <= 160 &&
    l.mappingEvidence &&
    typeof l.mappingEvidence === "object" &&
    !Array.isArray(l.mappingEvidence) &&
    !privateFact(l.mappingEvidence)
  );
}
function sum(lines: ChargeLine[], field: "subtotalCents" | "taxCents" | "totalCents") {
  const n = lines.reduce((total, l) => total + BigInt(l[field]), 0n);
  return n >= -BigInt(MAX_MONEY_CENTS) && n <= BigInt(MAX_MONEY_CENTS) ? Number(n) : null;
}
/** Extra customer facts are required for a new debtor. Replacing only customerId
 * would retain the guest's address/currency evidence on an OTA bill. Caller is a
 * trusted service adapter; browser payloads must never supply these facts. */
export function partitionSourceBill(
  snapshot: SettlementSnapshot,
  payer: ReservationPayerSnapshot,
  attribution: ReadonlyMap<string, BillingLegKind>,
  legIds: { source: string; guest: string },
  customers?: ReadonlyMap<number, SourceBillCustomerFacts>,
): EvidenceResult<SourceBillPlan> {
  try {
    const parsed = parseSourceBillingPolicy(payer.policy, payer.policy.sourceId);
    if (parsed.kind !== "confirmed") return parsed;
    const policy = parsed.value;
    if (
      !policy.allowedCollectionModes.includes(payer.collectionMode) ||
      typeof payer.confirmedBy !== "string" ||
      !payer.confirmedBy.trim() ||
      typeof payer.confirmedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(payer.confirmedAt) ||
      !Number.isFinite(Date.parse(payer.confirmedAt))
    )
      return contradiction("source_payer_invalid");
    if (
      !uuid(snapshot.tenantId) ||
      !uuid(snapshot.reservationId) ||
      !uuid(snapshot.folioId) ||
      !uuid(legIds.source) ||
      !uuid(legIds.guest) ||
      legIds.source.toLowerCase() === legIds.guest.toLowerCase() ||
      snapshot.customerId !== policy.guestCustomerId
    )
      return contradiction("source_plan_scope_mismatch");
    const { digest, ...original } = snapshot;
    if (
      snapshotDigest(original) !== digest ||
      privateFact(snapshot) ||
      !Array.isArray(snapshot.lines) ||
      !snapshot.lines.length ||
      !snapshot.lines.every(lineValid) ||
      !integer(snapshot.totalCents) ||
      snapshot.totalCents <= 0 ||
      sum(snapshot.lines, "totalCents") !== snapshot.totalCents ||
      new Set(snapshot.lines.map((l) => l.localLineId.toLowerCase())).size !== snapshot.lines.length
    )
      return contradiction("source_plan_snapshot_mismatch");
    if (
      snapshot.receipts.some(
        (r) =>
          r.reservationId !== snapshot.reservationId ||
          r.customerId !== policy.guestCustomerId ||
          r.currency !== snapshot.currency ||
          !integer(r.amountCents) ||
          r.amountCents <= 0,
      ) ||
      new Set(snapshot.receipts.map((r) => r.receiptId.toLowerCase())).size !==
        snapshot.receipts.length
    )
      return contradiction("source_receipt_scope_mismatch");
    const groups: Record<BillingLegKind, ChargeLine[]> = { source_room: [], guest: [] };
    for (const [key, kind] of attribution)
      if (
        !snapshot.lines.some((l) => l.localLineId === key) ||
        !["source_room", "guest"].includes(kind) ||
        (payer.collectionMode === "guest" && kind !== "guest")
      )
        return contradiction("source_charge_attribution_invalid");
    for (const l of snapshot.lines) {
      let kind = attribution.get(l.localLineId);
      if (!kind) {
        if (payer.collectionMode === "guest") kind = "guest";
        else if (l.kind === "room_night") kind = "source_room";
        else if (l.kind === "add_on") kind = "guest";
        else return unavailable("source_charge_attribution_required");
      }
      groups[kind].push(l);
    }
    if (!groups.guest.length && snapshot.receipts.length)
      return unavailable("guest_advance_without_guest_bill");
    const legs: BillingLegSnapshot[] = [];
    for (const kind of ["source_room", "guest"] as const) {
      const lines = groups[kind];
      if (!lines.length) continue;
      const totalCents = sum(lines, "totalCents");
      if (
        totalCents === null ||
        totalCents < 0 ||
        sum(lines, "subtotalCents") === null ||
        sum(lines, "taxCents") === null
      )
        return contradiction("source_leg_money_invalid");
      if (totalCents === 0) return unavailable("zero_value_leg_requires_review");
      const customerId = kind === "guest" ? policy.guestCustomerId : policy.sourceCustomerId!;
      let billTo = contact(snapshot.billTo);
      if (kind === "source_room") {
        const facts = customers?.get(customerId);
        if (!facts) return unavailable("source_customer_snapshot_required");
        if (
          facts.tenantId !== snapshot.tenantId ||
          facts.customerId !== customerId ||
          facts.currencyId !== snapshot.currencyId ||
          facts.currencyRate !== snapshot.currencyRate
        )
          return contradiction("source_customer_snapshot_mismatch");
        billTo = contact(facts.billTo);
      }
      if (!billTo) return contradiction("source_customer_snapshot_mismatch");
      // The full original printable folio would leak the sibling's private price.
      // Task 6 renders these leg lines; no whole-folio projection is copied.
      const legFacts: Omit<SettlementSnapshot, "digest"> = {
        tenantId: snapshot.tenantId,
        reservationId: snapshot.reservationId,
        folioId: snapshot.folioId,
        revision: snapshot.revision,
        currency: snapshot.currency,
        currencyId: snapshot.currencyId,
        currencyRate: snapshot.currencyRate,
        propertyTimezone: snapshot.propertyTimezone,
        billDate: snapshot.billDate,
        sourceVersions: snapshot.sourceVersions,
        customerId,
        billTo,
        lines,
        receipts: kind === "guest" ? snapshot.receipts : [],
        totalCents,
      };
      const frozen = JSON.parse(JSON.stringify(legFacts)) as Omit<SettlementSnapshot, "digest">;
      legs.push({
        legId: kind === "guest" ? legIds.guest : legIds.source,
        kind,
        customerId,
        collectionMode: kind === "guest" ? "guest" : "source",
        documentTitle: kind === "guest" ? "Sales Invoice" : policy.guestDocumentTitle,
        itemDescription: kind === "guest" ? "" : policy.guestItemDescription,
        showPrices: kind === "guest" || policy.showRoomPrices,
        snapshot: { ...frozen, digest: snapshotDigest(frozen) },
      });
    }
    if (legs.reduce((n, l) => n + l.snapshot.totalCents, 0) !== snapshot.totalCents)
      return contradiction("source_plan_total_mismatch");
    const frozenPayer: ReservationPayerSnapshot = {
      policy,
      collectionMode: payer.collectionMode,
      confirmedBy: payer.confirmedBy,
      confirmedAt: payer.confirmedAt,
    };
    const facts = {
      version: 1 as const,
      scope: { tenantId: snapshot.tenantId, reservationId: snapshot.reservationId },
      payer: frozenPayer,
      legs,
      totalCents: snapshot.totalCents,
    };
    return {
      kind: "confirmed",
      value: deepFreeze({ ...facts, digest: billingPayloadDigest(facts) }),
    };
  } catch {
    return contradiction("source_plan_invalid");
  }
}
