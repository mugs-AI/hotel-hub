import type { SourceBillingReadScope } from "./source-billing-read-scope.server";
import { hasPermission } from "./rbac";
import type { SettlementActor } from "./settlement-context.server";
import type { SettlementStepInput, SettlementView } from "./settlement";
import type {
  SourceBillStore,
  LegStoredIntent,
  StoredSourceStay,
} from "./source-billing-store.server";
import type { SourceStayView } from "./source-billing-view";
import {
  runSettlementStep,
  reconcileSettlement,
  readSettlementStatus,
  type SettlementDeps,
} from "./settlement-coordinator.server";
import { sourceBillingDocumentGate } from "./source-billing-n3.server";
export type SourceBillingDeps = {
  store: SourceBillStore;
  // Fixed service adapter supplies fresh scope/master/version evidence. Browser
  // inputs never supply this factory, client, contracts or prepared snapshots.
  legDeps(
    actor: SettlementActor,
    leg: LegStoredIntent,
    readScope?: SourceBillingReadScope,
  ): Promise<Omit<SettlementDeps, "store">>;
};
function fail(code: string): never {
  throw Error(code);
}
function authorize(a: SettlementActor, write = false) {
  if (
    !a.n3Token?.trim() ||
    !a.n3UserKey?.trim() ||
    !hasPermission(a.role, write ? "hotel:checkout:write" : "hotel:checkout:view")
  )
    fail("settlement_forbidden");
}
function empty(a: SettlementActor, l: LegStoredIntent): SettlementView {
  return {
    tenantId: a.tenantId,
    reservationId: a.reservationId,
    intentId: l.id,
    snapshotDigest: l.snapshot.digest,
    revision: l.revision,
    state: l.state,
    currency: l.snapshot.currency,
    bill: null,
    receipts: [],
    blockers: [],
    allowedActions: [],
    verifiedAt: null,
  };
}
function project(
  stay: StoredSourceStay,
  views: Map<string, SettlementView>,
  extra: string[] = [],
): SourceStayView {
  const legs = stay.legs.map((l) => {
    const v = views.get(l.id)!;
    let allowed = v.allowedActions.filter((x) => x !== "close");
    if (l.legKind === "source_room") {
      allowed = allowed.filter((x) => x === "post_bill");
      if (sourceBillingDocumentGate().kind !== "confirmed") allowed = [];
    }
    return {
      legId: l.legId,
      kind: l.legKind,
      hhNumber: l.hhNumber,
      view: { ...v, allowedActions: allowed },
    };
  });
  return {
    reservationId: stay.reservationId,
    revision: stay.revision,
    planDigest: stay.plan.digest,
    legs,
    blockers: [...new Set([...extra, ...legs.flatMap((l) => l.view.blockers)])],
    canClose: false,
  };
}
async function bound(a: SettlementActor, l: LegStoredIntent, d: SourceBillingDeps) {
  return { ...(await d.legDeps(a, l)), store: await d.store.forLeg(a, l.legId, l.planDigest) };
}
async function inspect(
  a: SettlementActor,
  d: SourceBillingDeps,
  digest?: string,
  persist = false,
): Promise<SourceStayView> {
  authorize(a);
  const stay = await d.store.read(a);
  if (!stay) fail("settlement_not_found");
  if (digest !== undefined && digest !== stay.plan.digest) fail("settlement_scope_mismatch");
  const views = new Map<string, SettlementView>();
  // Sequential so an expired session cannot launch additional sibling N3 reads.
  for (const l of stay.legs) {
    const deps = await bound(a, l, d);
    const v = persist
      ? await reconcileSettlement(a, l.id, deps)
      : await readSettlementStatus(a, deps);
    views.set(l.id, v);
    if (v.blockers.includes("n3_session_expired")) {
      for (const sibling of stay.legs)
        if (!views.has(sibling.id)) views.set(sibling.id, empty(a, sibling));
      break;
    }
  }
  const current = await d.store.read(a);
  if (!current || current.plan.digest !== stay.plan.digest) fail("settlement_scope_mismatch");
  for (const leg of current.legs) {
    const v = views.get(leg.id);
    if (!v || v.revision !== leg.revision) {
      const held = empty(a, leg);
      held.blockers.push("settlement_stale_revision");
      views.set(leg.id, held);
    }
  }
  return project(current, views);
}
export async function readSourceBillingStatus(
  a: SettlementActor,
  d: SourceBillingDeps,
): Promise<SourceStayView> {
  return inspect(a, d);
}
export async function reconcileSourceBills(
  a: SettlementActor,
  planDigest: string,
  d: SourceBillingDeps,
): Promise<SourceStayView> {
  authorize(a, true);
  return inspect(a, d, planDigest, true);
}
export async function runSourceBillStep(
  a: SettlementActor,
  input: {
    legId: string;
    planDigest: string;
    expectedRevision: string;
    action: SettlementStepInput;
  },
  d: SourceBillingDeps,
): Promise<SourceStayView> {
  authorize(a, true);
  const stay = await d.store.read(a),
    l = stay?.legs.find((x) => x.legId === input.legId);
  if (
    !stay ||
    !l ||
    stay.plan.digest !== input.planDigest ||
    (input.action.intentId !== undefined && input.action.intentId !== l.id)
  )
    fail("settlement_scope_mismatch");
  if (input.action.action === "close") fail("source_billing_whole_stay_required");
  if (l.legKind === "source_room" && input.action.action !== "post_bill")
    fail("source_billing_guest_action_required");
  if (input.expectedRevision !== l.revision || input.action.expectedRevision !== l.revision)
    fail("settlement_stale_revision");
  if (
    l.legKind === "source_room" &&
    input.action.action === "post_bill" &&
    l.dispatches.length === 0
  ) {
    const gate = sourceBillingDocumentGate();
    if (gate.kind !== "confirmed") {
      const views = new Map(stay.legs.map((x) => [x.id, empty(a, x)]));
      views.get(l.id)!.blockers.push(gate.code);
      return project(stay, views);
    }
  }
  const v = await runSettlementStep(a, { ...input.action, intentId: l.id }, await bound(a, l, d));
  if (v.blockers.includes("n3_session_expired")) {
    const current = await d.store.read(a);
    if (!current || current.plan.digest !== stay.plan.digest) fail("settlement_scope_mismatch");
    const views = new Map(current.legs.map((x) => [x.id, empty(a, x)]));
    views.set(l.id, v);
    return project(current, views, ["n3_session_expired"]);
  }
  const result = await inspect(a, d, stay.plan.digest);
  const selected = result.legs.find((x) => x.legId === l.id)!;
  selected.view.blockers = [...new Set([...selected.view.blockers, ...v.blockers])];
  if (selected.view.blockers.length) selected.view.allowedActions = [];
  result.blockers = [...new Set([...result.blockers, ...v.blockers])];
  return result;
}
