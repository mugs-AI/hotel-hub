import { hasPermission } from "./rbac";
import { validateSourceBillPlan } from "./source-billing-store.server";
import { billingContractGate } from "./settlement-contracts.server";
import { sourceBillingDocumentGate } from "./source-billing-n3.server";
import {
  readSourceBillingStatus,
  runSourceBillStep,
  reconcileSourceBills,
} from "./source-billing-coordinator.server";
import type { EvidenceResult } from "./settlement";
import type { SettlementActor } from "./settlement-context.server";
import type { SourceBillPlan } from "./source-billing";
import type { SourceBillingDeps } from "./source-billing-coordinator.server";
import type { SourceStayView } from "./source-billing-view";
import { parseSourceCheckoutView, type SourceCheckoutView } from "./source-billing-checkout";
export type { SourceCheckoutView } from "./source-billing-checkout";
export type SourceConfirmationDeps = {
  billing: SourceBillingDeps;
  readLegacy(actor: SettlementActor): Promise<boolean>;
  prepare(actor: SettlementActor): Promise<EvidenceResult<SourceBillPlan>>;
};
export type SourceConfirmInput = {
  expectedFolioRevision: string;
  planDigest: string;
  clientRequestId: string;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function authorize(a: SettlementActor) {
  if (
    !hasPermission(a.role, "hotel:checkout:write") ||
    !uuid(a.tenantId) ||
    !uuid(a.reservationId) ||
    !a.n3UserKey?.trim() ||
    !a.n3Token?.trim()
  )
    throw Error("settlement_forbidden");
}
function blank(a: SettlementActor): SourceCheckoutView {
  return {
    tenantId: a.tenantId,
    reservationId: a.reservationId,
    legacy: false,
    review: null,
    stay: null,
    blockers: [],
  };
}
function withStay(a: SettlementActor, stay: SourceStayView): SourceCheckoutView {
  if (
    stay.reservationId !== a.reservationId ||
    stay.legs.some(
      (l) => l.view.tenantId !== a.tenantId || l.view.reservationId !== a.reservationId,
    )
  )
    throw Error("settlement_scope_mismatch");
  const safe = parseSourceCheckoutView(
    { ...blank(a), stay, blockers: [...stay.blockers] },
    a.tenantId,
    a.reservationId,
  );
  if (!safe) throw Error("source_billing_invalid_result");
  return safe;
}
function planGate(p: SourceBillPlan): string[] {
  const bill = billingContractGate("bill"),
    source = sourceBillingDocumentGate();
  return [
    ...new Set([
      ...(bill.kind === "confirmed" ? [] : [bill.code]),
      ...(p.legs.some((l) => l.kind === "source_room") && source.kind !== "confirmed"
        ? [source.code]
        : []),
    ]),
  ];
}
function review(a: SettlementActor, p: SourceBillPlan): SourceCheckoutView {
  const blockers = planGate(p);
  return {
    ...blank(a),
    blockers,
    review: {
      folioRevision: p.legs[0].snapshot.revision,
      planDigest: p.digest,
      currency: p.legs[0].snapshot.currency,
      totalCents: p.totalCents,
      canConfirm: blockers.length === 0,
      legs: p.legs.map((l) => ({
        legId: l.legId,
        kind: l.kind,
        customerId: l.customerId,
        totalCents: l.snapshot.totalCents,
      })),
    },
  };
}
async function prepared(a: SettlementActor, d: SourceConfirmationDeps) {
  const r = await d.prepare(a);
  return r.kind === "confirmed"
    ? { kind: "confirmed" as const, value: validateSourceBillPlan(r.value, a) }
    : r;
}
/** Reads can prepare a review, but never freeze a plan or create an N3 document. */
export async function readSourceCheckout(
  a: SettlementActor,
  d: SourceConfirmationDeps,
): Promise<SourceCheckoutView> {
  authorize(a);
  if (await d.billing.store.read(a))
    return withStay(a, await readSourceBillingStatus(a, d.billing));
  if (await d.readLegacy(a)) return { ...blank(a), legacy: true };
  const p = await prepared(a, d);
  return p.kind === "confirmed" ? review(a, p.value) : { ...blank(a), blockers: [p.code] };
}
/** Explicit full-folio confirmation. Saved attempts are recovered only through
 * explicit per-leg operations; replaying this action never posts an old leg. */
export async function confirmSourceCheckout(
  a: SettlementActor,
  input: SourceConfirmInput,
  d: SourceConfirmationDeps,
): Promise<SourceCheckoutView> {
  authorize(a);
  if (
    !uuid(input.clientRequestId) ||
    !hash(input.planDigest) ||
    typeof input.expectedFolioRevision !== "string" ||
    !/^(0|[1-9]\d{0,18})$/.test(input.expectedFolioRevision)
  )
    throw Error("settlement_invalid_input");
  const existing = await d.billing.store.read(a);
  if (existing) {
    if (
      existing.plan.digest !== input.planDigest ||
      existing.plan.legs[0].snapshot.revision !== input.expectedFolioRevision
    )
      throw Error("settlement_snapshot_changed");
    return withStay(a, await readSourceBillingStatus(a, d.billing));
  }
  if (await d.readLegacy(a)) throw Error("settlement_locked");
  const p = await prepared(a, d);
  if (p.kind !== "confirmed") return { ...blank(a), blockers: [p.code] };
  if (
    p.value.digest !== input.planDigest ||
    p.value.legs[0].snapshot.revision !== input.expectedFolioRevision
  )
    throw Error("settlement_snapshot_changed");
  const preview = review(a, p.value);
  if (!preview.review!.canConfirm) return preview;
  const stored = await d.billing.store.freeze(a, p.value, input.clientRequestId);
  if (stored.plan.digest !== p.value.digest) throw Error("settlement_scope_mismatch");
  let current = await readSourceBillingStatus(a, d.billing);
  for (const leg of stored.legs) {
    if (current.blockers.includes("n3_session_expired")) break;
    const fresh = current.legs.find((l) => l.legId === leg.legId);
    // Durable coordinator claims remain authoritative under two callers. Never
    // redispatch an attempt already present when this confirmation was frozen.
    if (!fresh || leg.dispatches.length || !fresh.view.allowedActions.includes("post_bill"))
      continue;
    current = await runSourceBillStep(
      a,
      {
        legId: leg.legId,
        planDigest: stored.plan.digest,
        expectedRevision: fresh.view.revision,
        action: {
          action: "post_bill",
          clientRequestId: input.clientRequestId,
          snapshotDigest: leg.snapshot.digest,
          expectedRevision: fresh.view.revision,
          intentId: leg.id,
        },
      },
      d.billing,
    );
  }
  return withStay(a, current);
}

/** Server-only bindings. The HTTP request cannot supply a coordinator, transport,
 * master registry, plan or actor. Mount only with the reviewed live plan adapter. */
export function createSourceBillingServices(
  deps: SourceConfirmationDeps,
): import("./source-billing-http.server").SourceBillingHttpDeps["services"] {
  return {
    read: (actor) => readSourceCheckout(actor, deps),
    confirm: (actor, input) => confirmSourceCheckout(actor, input, deps),
    step: async (actor, input) => {
      authorize(actor);
      return withStay(actor, await runSourceBillStep(actor, input, deps.billing));
    },
    reconcile: async (actor, planDigest) => {
      authorize(actor);
      return withStay(actor, await reconcileSourceBills(actor, planDigest, deps.billing));
    },
  };
}
