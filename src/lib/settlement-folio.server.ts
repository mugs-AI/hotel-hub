import type { FolioViewDTO } from "./folio-view";
import type {
  EvidenceResult,
  FrozenFolioProjection,
  SettlementScope,
  SettlementSnapshot,
} from "./settlement";
import type { SettlementRpc } from "./settlement-store.server";
import { z } from "zod";
import { parseCents, sumCents } from "./folio-money";
import { guestFacingFolioRows } from "./folio-view";
import { billingPayloadDigest } from "./n3-billing.server";

const text = z.string().max(4096);
const nullableText = text.nullable();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const amount = z
  .number()
  .finite()
  .refine((v) => parseCents(Math.abs(v)) !== null);
const quantity = z.number().int().min(1).max(9999);
const rate = z.number().int().min(0).max(10000).nullable();
const kind = z.enum([
  "room_night",
  "add_on",
  "service_charge",
  "service_tax",
  "tourism_tax",
  "local_levy",
  "discount",
  "manual_adjustment",
  "reversal",
]);
const taxClass = z.enum([
  "accommodation",
  "food_and_beverage",
  "parking",
  "other_taxable_service",
  "non_taxable",
  "service_charge",
  "damage_compensation",
]);
const totals = z.object({
  charges: amount,
  serviceCharge: amount,
  serviceTax: amount,
  tourismTax: amount,
  localLevy: amount,
  rounding: amount,
  grandTotal: amount,
});
// Only the existing browser-safe prepared DTO is retained. Schema parsing
// strips unknown fields recursively; accounting/master/token evidence is not
// part of a printable statement. No charge or tax is recalculated here.
const folioSchema = z.object({
  reservation: z.object({
    id: text,
    bookingReference: text,
    arrivalDate: date,
    departureDate: date,
    currency: z.string().regex(/^[A-Z]{3}$/),
    primaryGuestName: nullableText,
    roomLabels: z.array(text).max(100),
  }),
  propertyDate: date,
  guestTaxClass: z.enum([
    "malaysian_citizen",
    "malaysian_pr",
    "foreign_tourist",
    "other_exemption",
    "unknown",
  ]),
  evidenceNote: nullableText,
  tourismTaxEvidence: z
    .array(
      z.object({
        id: text,
        sourceLabel: text,
        reference: nullableText,
        collectedOn: date.nullable(),
        amount,
        note: nullableText,
        createdAt: text,
      }),
    )
    .max(1000),
  occupiedRoomNights: z.number().int().min(0).max(10000),
  lines: z
    .array(
      z.object({
        id: text,
        catalogueId: nullableText,
        lineType: kind,
        status: z.enum(["draft", "committed", "reversed"]),
        taxClass: taxClass.nullable(),
        description: text,
        taxRateBp: rate,
        quantity,
        unitPrice: amount,
        amount,
        stayDate: date.nullable(),
        roomLabel: nullableText,
        reason: nullableText,
        reversesLineId: nullableText,
        actorLabel: nullableText,
        createdAt: text,
        canEditQuantity: z.boolean(),
        canReverse: z.boolean(),
      }),
    )
    .max(10000),
  derived: z
    .array(
      z.object({
        key: text,
        lineType: kind,
        description: text,
        taxRateBp: rate,
        quantity,
        unitPrice: amount,
        amount,
      }),
    )
    .max(1000),
  totals,
  blockers: z
    .array(z.object({ code: text, severity: z.enum(["blocking", "advisory"]), message: text }))
    .max(100),
  readiness: z.object({
    serviceTaxRegistered: z.boolean(),
    serviceChargeEnabled: z.boolean(),
    tourismTaxEnabled: z.boolean(),
    localLevyEnabled: z.boolean(),
    localLevyLabel: nullableText,
    roundingMode: z.enum(["none", "nearest_5_cents", "nearest_10_cents"]),
    missing: z.array(text).max(100),
    configurationComplete: z.boolean(),
    calculationComplete: z.boolean(),
    roomNightsPrepared: z.boolean(),
    projectedRoomNights: z.number().int().min(0),
  }),
  catalogue: z
    .array(
      z.object({ id: text, displayName: text, category: text, taxClass, defaultUnitPrice: amount }),
    )
    .max(10000),
  capability: z.object({
    canView: z.boolean(),
    canAddItem: z.boolean(),
    canAdjust: z.boolean(),
    canSetTaxClass: z.boolean(),
    canManageCharges: z.boolean(),
  }),
  preparationOnly: z.literal(true),
});
const signedCents = (value: number) => {
  const cents = parseCents(Math.abs(value));
  if (cents === null) throw new Error("unsafe_frozen_folio");
  return value < 0 ? -cents : cents;
};

export function captureSettlementFolio(
  snapshot: Pick<
    SettlementSnapshot,
    "reservationId" | "currency" | "billDate" | "totalCents" | "lines"
  >,
  dto: FolioViewDTO,
): EvidenceResult<FrozenFolioProjection> {
  const parsed = folioSchema.safeParse(dto);
  if (!parsed.success) return { kind: "contradiction", code: "settlement_folio_invalid" };
  const folio = parsed.data;
  try {
    const rows = guestFacingFolioRows(folio);
    const totalCents = signedCents(folio.totals.grandTotal);
    const roundingCents = signedCents(folio.totals.rounding);
    if (
      folio.reservation.id !== snapshot.reservationId ||
      folio.reservation.currency !== snapshot.currency ||
      folio.propertyDate !== snapshot.billDate ||
      totalCents !== snapshot.totalCents ||
      !folio.readiness.configurationComplete ||
      !folio.readiness.calculationComplete ||
      !folio.readiness.roomNightsPrepared ||
      folio.readiness.projectedRoomNights !== 0 ||
      folio.readiness.missing.length ||
      folio.blockers.some((b) => b.severity === "blocking") ||
      sumCents([...rows.map((r) => signedCents(r.line.amount)), roundingCents]) !== totalCents ||
      sumCents(
        Object.entries(folio.totals)
          .filter(([key]) => key !== "grandTotal")
          .map(([, value]) => signedCents(value)),
      ) !== totalCents
    )
      return { kind: "contradiction", code: "settlement_folio_mismatch" };
    const liveLines = rows.filter((r) => r.kind === "line");
    if (
      new Set(liveLines.map((r) => r.line.id)).size !== liveLines.length ||
      new Set(folio.derived.map((r) => r.key)).size !== folio.derived.length ||
      liveLines.some((r) => {
        const l = snapshot.lines.find((s) => s.localLineId === r.line.id);
        return (
          !l ||
          l.kind !== r.line.lineType ||
          l.qty !== r.line.quantity ||
          l.unitCents !== signedCents(r.line.unitPrice) ||
          l.subtotalCents !== signedCents(r.line.amount)
        );
      })
    )
      return { kind: "contradiction", code: "settlement_folio_mismatch" };
    const derivedKinds = ["service_charge", "service_tax", "tourism_tax", "local_levy"];
    const mappedRounding = sumCents(
      snapshot.lines.filter((l) => l.kind === "rounding").map((l) => l.subtotalCents),
    );
    if (
      signedCents(folio.totals.charges) !==
        sumCents(liveLines.map((r) => signedCents(r.line.amount))) ||
      folio.derived.some((l) => !derivedKinds.includes(l.lineType)) ||
      mappedRounding !== roundingCents ||
      (folio.readiness.roundingMode === "none" && roundingCents !== 0) ||
      snapshot.lines.some(
        (l) => l.kind === "rounding" && (l.taxCents !== 0 || l.totalCents !== l.subtotalCents),
      )
    )
      return { kind: "contradiction", code: "settlement_folio_mismatch" };
    if (
      snapshot.lines.some(
        (l) =>
          !derivedKinds.includes(l.kind) &&
          l.kind !== "rounding" &&
          !liveLines.some((r) => r.line.id === l.localLineId),
      )
    )
      return { kind: "contradiction", code: "settlement_folio_mismatch" };
    const groups = [
      ["service_charge", "serviceCharge", folio.readiness.serviceChargeEnabled],
      ["service_tax", "serviceTax", folio.readiness.serviceTaxRegistered],
      ["tourism_tax", "tourismTax", folio.readiness.tourismTaxEnabled],
      ["local_levy", "localLevy", folio.readiness.localLevyEnabled],
    ] as const;
    for (const [kind, total, enabled] of groups) {
      const prepared = signedCents(folio.totals[total]);
      const posted = sumCents(
        snapshot.lines.filter((l) => l.kind === kind).map((l) => l.subtotalCents),
      );
      const embeddedTax =
        kind === "service_tax" ? sumCents(snapshot.lines.map((l) => l.taxCents)) : 0;
      const printed = sumCents(
        folio.derived.filter((l) => l.lineType === kind).map((l) => signedCents(l.amount)),
      );
      if (
        posted === null ||
        embeddedTax === null ||
        prepared !== posted + embeddedTax ||
        printed !== prepared ||
        (!enabled && prepared !== 0)
      )
        return { kind: "contradiction", code: "settlement_folio_mismatch" };
    }
    folio.lines = folio.lines.map((l) => ({ ...l, canEditQuantity: false, canReverse: false }));
    folio.capability = {
      canView: true,
      canAddItem: false,
      canAdjust: false,
      canSetTaxClass: false,
      canManageCharges: false,
    };
    return { kind: "confirmed", value: { version: 1, folio } };
  } catch {
    return { kind: "contradiction", code: "settlement_folio_invalid" };
  }
}
export function projectSettlementFolio(
  scope: SettlementScope,
  intent: unknown,
): EvidenceResult<FolioViewDTO | null> {
  if (intent === null) return { kind: "confirmed", value: null };
  const parsed = z
    .object({
      tenantId: z.string(),
      reservationId: z.string(),
      state: z.enum([
        "frozen",
        "bill_dispatched",
        "bill_verified",
        "allocating",
        "awaiting_payment",
        "balance_dispatched",
        "settled",
        "closing",
        "closed",
        "needs_review",
      ]),
      snapshot: z
        .object({
          tenantId: z.string(),
          reservationId: z.string(),
          digest: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .passthrough(),
    })
    .safeParse(intent);
  if (!parsed.success) return { kind: "unavailable", code: "settlement_folio_unavailable" };
  const v = parsed.data;
  if (
    v.tenantId !== scope.tenantId ||
    v.reservationId !== scope.reservationId ||
    v.snapshot.tenantId !== scope.tenantId ||
    v.snapshot.reservationId !== scope.reservationId
  )
    return { kind: "contradiction", code: "settlement_folio_scope_mismatch" };
  const { digest, ...facts } = v.snapshot;
  try {
    if (billingPayloadDigest(facts) !== digest)
      return { kind: "contradiction", code: "settlement_folio_digest_mismatch" };
    if (!facts.folioProjection) return { kind: "unavailable", code: "settlement_folio_missing" };
    const packet = z
      .object({ version: z.literal(1), folio: folioSchema })
      .safeParse(facts.folioProjection);
    if (!packet.success) return { kind: "unavailable", code: "settlement_folio_unavailable" };
    const result = captureSettlementFolio(facts as SettlementSnapshot, packet.data.folio);
    return result.kind === "confirmed" ? { kind: "confirmed", value: result.value.folio } : result;
  } catch {
    return { kind: "unavailable", code: "settlement_folio_unavailable" };
  }
}
export async function readFrozenSettlementFolio(
  scope: SettlementScope,
  rpc?: SettlementRpc,
): Promise<FolioViewDTO | null> {
  if (
    !z.object({ tenantId: z.string().uuid(), reservationId: z.string().uuid() }).safeParse(scope)
      .success
  )
    throw new Error("settlement_folio_scope_mismatch");
  const read =
    rpc ??
    (async (name, args) => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return (supabaseAdmin as unknown as { rpc: SettlementRpc }).rpc(name, args);
    });
  let result: Awaited<ReturnType<SettlementRpc>>;
  try {
    result = await read("hotelhub_settlement_read", {
      p_tenant_id: scope.tenantId,
      p_reservation_id: scope.reservationId,
    });
  } catch {
    throw new Error("settlement_folio_unavailable");
  }
  if (result.error) throw new Error("settlement_folio_unavailable");
  const projected = projectSettlementFolio(scope, result.data);
  if (projected.kind !== "confirmed") throw new Error(projected.code);
  return projected.value;
}
