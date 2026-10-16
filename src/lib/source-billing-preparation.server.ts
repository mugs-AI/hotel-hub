// Authoritative, read-only source-plan preparation. Browser inputs supply no
// customer, line money, account mapping, allocation or leg identity.
import type { ChargeLine, EvidenceResult } from "./settlement";
import type { SourceBillPlan } from "./source-billing";
import type { SettlementActor } from "./settlement-context.server";
import type { createChargeAttributionService } from "./charge-attribution.server";
import type { SourceBillCustomerFacts } from "./source-billing-plan.server";
import { partitionSourceBill } from "./source-billing-plan.server";
import { snapshotDigest } from "./settlement-snapshot.server";
import { billingPayloadDigest } from "./n3-billing.server";
import { hasPermission } from "./rbac";

type Header = { customerId: number; currencyId: number; currency: string; currencyRate: number };
export type SourcePlanPreparationDeps = {
  attribution: Pick<ReturnType<typeof createChargeAttributionService>, "prepare" | "assertCurrent">;
  masters: {
    readBillingCustomer(
      a: SettlementActor,
      customerId: number,
      currency: string,
    ): Promise<EvidenceResult<SourceBillCustomerFacts>>;
    verifyLine(
      a: SettlementActor,
      header: Header,
      line: ChargeLine,
    ): Promise<EvidenceResult<ChargeLine>>;
    checkCurrent(a: SettlementActor): EvidenceResult<true>;
  };
};
const contradiction = (code: string) => ({ kind: "contradiction" as const, code });
function same(original: SettlementActor, bound: SettlementActor) {
  for (const key of ["tenantId", "reservationId", "n3UserKey", "n3Token", "role"] as const)
    if (original[key] !== bound[key]) throw Error("source_plan_actor_changed");
}
function legId(seed: unknown, kind: string) {
  const h = billingPayloadDigest({ domain: "hh-source-billing-leg-v1", seed, kind });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function prepareSourceBill(
  actor: SettlementActor,
  d: SourcePlanPreparationDeps,
): Promise<EvidenceResult<SourceBillPlan>> {
  const a = Object.freeze({ ...actor });
  try {
    if (
      !hasPermission(a.role, "hotel:checkout:write") ||
      !a.n3Token?.trim() ||
      !a.n3UserKey?.trim() ||
      !/^[a-f0-9-]{36}$/i.test(a.tenantId) ||
      !/^[a-f0-9-]{36}$/i.test(a.reservationId)
    )
      return contradiction("settlement_forbidden");
    const prepared = await d.attribution.prepare(actor);
    same(actor, a);
    const state = structuredClone(prepared),
      s = state.snapshot;
    const customers = new Map<number, SourceBillCustomerFacts>();
    if ([...state.assignments.values()].includes("source_room")) {
      const id = state.payer.policy.sourceCustomerId;
      if (!id) return contradiction("source_customer_snapshot_mismatch");
      const c = await d.masters.readBillingCustomer(a, id, s.currency);
      same(actor, a);
      if (c.kind !== "confirmed") return c;
      customers.set(id, structuredClone(c.value));
    }
    const lines: ChargeLine[] = [];
    for (const line of s.lines) {
      const kind = state.assignments.get(line.localLineId);
      if (!kind) return contradiction("source_charge_attribution_invalid");
      const customerId =
        kind === "guest"
          ? state.payer.policy.guestCustomerId
          : state.payer.policy.sourceCustomerId!;
      const r = await d.masters.verifyLine(
        a,
        {
          customerId,
          currencyId: s.currencyId,
          currency: s.currency,
          currencyRate: s.currencyRate,
        },
        structuredClone(line),
      );
      same(actor, a);
      if (r.kind !== "confirmed") return r;
      const { mappingEvidence: _old, ...before } = line,
        { mappingEvidence: _new, ...after } = r.value;
      if (billingPayloadDigest(before) !== billingPayloadDigest(after))
        return contradiction("source_plan_line_changed");
      lines.push(structuredClone(r.value));
    }
    await d.attribution.assertCurrent(actor, state);
    same(actor, a);
    const current = d.masters.checkCurrent(a);
    if (current.kind !== "confirmed") return current;
    const { digest: _digest, ...facts } = s;
    facts.lines = lines;
    const verified = { ...facts, digest: snapshotDigest(facts) };
    const seed = {
      tenantId: a.tenantId,
      reservationId: a.reservationId,
      folioId: s.folioId,
      payerRevision: state.payerRevision,
      basisDigest: state.basisDigest,
    };
    return partitionSourceBill(
      verified,
      state.payer,
      state.assignments,
      { source: legId(seed, "source_room"), guest: legId(seed, "guest") },
      customers,
    );
  } catch (e) {
    const code =
      e instanceof Error && /^(?:source_|settlement_|master_|n3_)[a-z_]{1,90}$/.test(e.message)
        ? e.message
        : "source_plan_preparation_unavailable";
    return code === "source_plan_actor_changed"
      ? contradiction(code)
      : { kind: "unavailable", code };
  }
}
/** One current-master cache per operation, bound to this caller's own N3 token.
 * This supplies the existing confirmation service's prepare port; no writer or
 * frozen-leg recovery adapter is fabricated here. */
export async function prepareLiveSourceBill(
  actor: SettlementActor,
): Promise<EvidenceResult<SourceBillPlan>> {
  const [{ liveChargeAttributionService }, { createCurrentSettlementMasters }, { destroySession }] =
    await Promise.all([
      import("./charge-attribution.server"),
      import("./settlement-current-masters.server"),
      import("./session-context.server"),
    ]);
  return prepareSourceBill(actor, {
    attribution: liveChargeAttributionService(),
    masters: createCurrentSettlementMasters(actor, {
      invalidateSession: () => destroySession("n3_unauthorized"),
    }),
  });
}
