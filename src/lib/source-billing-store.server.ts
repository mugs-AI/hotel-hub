// Fixed service-only durable source-plan access. No browser RPC names or N3 calls.
import type { SourceBillPlan, BillingLegKind } from "./source-billing";
import type { SettlementActor } from "./settlement-context.server";
import type { StoredIntent } from "./settlement-dispatch.server";
import type { SettlementScope } from "./settlement";
import {
  createSettlementStore,
  type SettlementRpc,
  type SettlementStore,
} from "./settlement-store.server";
import { partitionSourceBill } from "./source-billing-plan.server";
import { snapshotDigest } from "./settlement-snapshot.server";
import { billingPayloadDigest } from "./n3-billing.server";

export type LegStoredIntent = StoredIntent & {
  legId: string;
  legKind: BillingLegKind;
  planDigest: string;
  hhNumber: string;
};
export type StoredSourceStay = SettlementScope & {
  revision: string;
  plan: SourceBillPlan;
  legs: LegStoredIntent[];
};
export interface SourceBillStore {
  freeze(
    actor: SettlementActor,
    plan: SourceBillPlan,
    requestId: string,
  ): Promise<StoredSourceStay>;
  read(actor: SettlementActor): Promise<StoredSourceStay | null>;
  readLeg(actor: SettlementActor, legId: string, planDigest: string): Promise<LegStoredIntent>;
  forLeg(actor: SettlementActor, legId: string, planDigest: string): Promise<SettlementStore>;
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{64}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const rev = (v: unknown): v is string =>
  typeof v === "string" && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
function fail(code: string): never {
  throw Error(code);
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
function args(a: SettlementActor, write = false) {
  if (
    !uuid(a.tenantId) ||
    !uuid(a.reservationId) ||
    !a.n3Token?.trim() ||
    !a.n3UserKey?.trim() ||
    (write ? a.role !== "owner" : !["owner", "front_desk"].includes(a.role))
  )
    fail("settlement_forbidden");
  return { p_tenant_id: a.tenantId, p_reservation_id: a.reservationId, p_actor: a.n3UserKey };
}
/** Reconstruct using the same lossless partition validator. This checks line,
 * payer, contact, privacy and hash facts without treating a type cast as proof. */
export function validateSourceBillPlan(value: unknown, scope: SettlementScope): SourceBillPlan {
  try {
    if (
      !record(value) ||
      value.version !== 1 ||
      !record(value.scope) ||
      value.scope.tenantId !== scope.tenantId ||
      value.scope.reservationId !== scope.reservationId ||
      !hash(value.digest) ||
      !Array.isArray(value.legs) ||
      value.legs.length < 1 ||
      value.legs.length > 2
    )
      fail("source_billing_invalid_plan");
    const p = value as SourceBillPlan;
    const source = p.legs.find((l) => l.kind === "source_room"),
      guest = p.legs.find((l) => l.kind === "guest");
    if (
      new Set(p.legs.map((l) => l.kind)).size !== p.legs.length ||
      new Set(p.legs.map((l) => l.legId)).size !== p.legs.length ||
      new Set(p.legs.flatMap((l) => l.snapshot.lines.map((x) => x.localLineId))).size !==
        p.legs.reduce((n, l) => n + l.snapshot.lines.length, 0)
    )
      fail("source_billing_invalid_plan");
    const base = guest?.snapshot ?? source!.snapshot;
    for (const leg of p.legs) {
      const { digest, ...facts } = leg.snapshot;
      if (
        snapshotDigest(facts) !== digest ||
        leg.snapshot.tenantId !== scope.tenantId ||
        leg.snapshot.reservationId !== scope.reservationId
      )
        fail("source_billing_invalid_plan");
      for (const key of [
        "folioId",
        "revision",
        "currency",
        "currencyId",
        "currencyRate",
        "propertyTimezone",
        "billDate",
        "sourceVersions",
      ] as const)
        if (billingPayloadDigest(leg.snapshot[key]) !== billingPayloadDigest(base[key]))
          fail("source_billing_invalid_plan");
    }
    const facts = {
      ...base,
      customerId: p.payer.policy.guestCustomerId,
      lines: p.legs.flatMap((l) => l.snapshot.lines),
      receipts: guest?.snapshot.receipts ?? [],
      totalCents: p.totalCents,
    };
    const { digest: _d, ...original } = facts;
    const absentId = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ].find((id) => !p.legs.some((l) => l.legId === id))!;
    const rebuilt = partitionSourceBill(
      { ...original, digest: snapshotDigest(original) },
      p.payer,
      new Map(p.legs.flatMap((l) => l.snapshot.lines.map((x) => [x.localLineId, l.kind] as const))),
      { source: source?.legId ?? absentId, guest: guest?.legId ?? absentId },
      source
        ? new Map([
            [
              source.customerId,
              {
                tenantId: scope.tenantId,
                customerId: source.customerId,
                currencyId: source.snapshot.currencyId,
                currencyRate: source.snapshot.currencyRate,
                billTo: source.snapshot.billTo,
              },
            ],
          ])
        : undefined,
    );
    if (
      rebuilt.kind !== "confirmed" ||
      rebuilt.value.digest !== p.digest ||
      billingPayloadDigest(p) !== billingPayloadDigest(rebuilt.value)
    )
      fail("source_billing_invalid_plan");
    return rebuilt.value;
  } catch {
    return fail("source_billing_invalid_plan");
  }
}
const safe = new Set([
  "settlement_forbidden",
  "settlement_scope_mismatch",
  "settlement_locked",
  "settlement_stale_revision",
  "settlement_conflicting_request",
  "settlement_snapshot_changed",
  "settlement_pending_financial_operation",
  "settlement_invalid_state",
  "source_billing_invalid_plan",
  "source_billing_payer_changed",
  "source_billing_charge_mismatch",
  "source_billing_guest_action_required",
  "source_billing_whole_stay_required",
  "source_document_date_invalid",
  "source_document_number_overflow",
]);
export function createSourceBillStore(rpc: SettlementRpc): SourceBillStore {
  async function call(name: string, parameters: Record<string, unknown>): Promise<unknown> {
    const r = await rpc(name, parameters);
    if (r.error) {
      if (["PGRST202", "PGRST205", "42883", "42P01"].includes(r.error.code ?? ""))
        fail("settlement_setup_required");
      fail(safe.has(r.error.message ?? "") ? r.error.message! : "source_billing_store_unavailable");
    }
    return r.data;
  }
  async function parseLeg(
    v: unknown,
    a: SettlementActor,
    id: string,
    digest: string,
  ): Promise<LegStoredIntent> {
    if (
      !record(v) ||
      v.id !== id ||
      v.legId !== id ||
      v.planDigest !== digest ||
      !["source_room", "guest"].includes(String(v.legKind))
    )
      fail("settlement_scope_mismatch");
    if (typeof v.hhNumber !== "string" || !/^SI\d{9}$/.test(v.hhNumber))
      fail("source_billing_invalid_result");
    const parsed = await createSettlementStore(async () => ({ data: v, error: null })).read(a);
    if (!parsed) fail("source_billing_invalid_result");
    const { digest: snapshotHash, ...snapshot } = parsed.snapshot;
    if (snapshotDigest(snapshot) !== snapshotHash) fail("source_billing_invalid_result");
    return freeze(parsed as LegStoredIntent);
  }
  async function parseStay(v: unknown, a: SettlementActor): Promise<StoredSourceStay> {
    if (
      !record(v) ||
      v.tenantId !== a.tenantId ||
      v.reservationId !== a.reservationId ||
      !rev(v.revision) ||
      !Array.isArray(v.legs)
    )
      fail("source_billing_invalid_result");
    const plan = validateSourceBillPlan(v.plan, a);
    if (
      v.legs.length !== plan.legs.length ||
      new Set(v.legs.map((l) => (record(l) ? l.legId : null))).size !== v.legs.length
    )
      fail("source_billing_invalid_result");
    const legs = await Promise.all(
      plan.legs.map(async (l) => {
        const raw = (v.legs as unknown[]).find((x) => record(x) && x.legId === l.legId);
        const leg = await parseLeg(raw, a, l.legId, plan.digest);
        if (
          leg.legKind !== l.kind ||
          billingPayloadDigest(leg.snapshot) !== billingPayloadDigest(l.snapshot)
        )
          fail("source_billing_invalid_result");
        return leg;
      }),
    );
    return freeze({
      tenantId: a.tenantId,
      reservationId: a.reservationId,
      revision: v.revision,
      plan,
      legs,
    });
  }
  const store: SourceBillStore = {
    async freeze(a, p, requestId) {
      const parameters = args(a, true),
        plan = validateSourceBillPlan(p, a);
      if (!uuid(requestId)) fail("settlement_invalid_input");
      const stay = await parseStay(
        await call("hh_source_billing_freeze", {
          ...parameters,
          p_plan: plan,
          p_request_id: requestId,
        }),
        a,
      );
      if (stay.plan.digest !== plan.digest) fail("settlement_scope_mismatch");
      return stay;
    },
    async read(a) {
      const v = await call("hh_source_billing_read", { ...args(a), p_role: a.role });
      return v === null ? null : parseStay(v, a);
    },
    async readLeg(a, id, digest) {
      if (!uuid(id) || !hash(digest)) fail("settlement_invalid_input");
      return parseLeg(
        await call("hh_source_billing_leg_read", {
          ...args(a),
          p_role: a.role,
          p_leg_id: id,
          p_plan_digest: digest,
        }),
        a,
        id,
        digest,
      );
    },
    async forLeg(a, id, digest) {
      const stay = await store.read(a);
      const binding = stay?.legs.find((l) => l.legId === id);
      if (!binding || stay!.plan.digest !== digest) fail("settlement_scope_mismatch");
      const names: Record<string, string> = {
        hotelhub_settlement_read: "hh_source_billing_leg_read",
        hotelhub_settlement_claim: "hh_source_billing_leg_claim",
        hotelhub_settlement_outcome: "hh_source_billing_leg_outcome",
        hotelhub_settlement_prove: "hh_source_billing_leg_prove",
      };
      const core = createSettlementStore(async (name, parameters) => {
        if (
          parameters.p_tenant_id !== a.tenantId ||
          parameters.p_reservation_id !== a.reservationId ||
          (parameters.p_intent_id !== undefined && parameters.p_intent_id !== binding.id)
        )
          fail("settlement_scope_mismatch");
        if (
          name === "hotelhub_settlement_close" ||
          name === "hotelhub_settlement_abandon" ||
          name === "hotelhub_settlement_freeze"
        )
          fail("source_billing_whole_stay_required");
        if (
          name === "hotelhub_settlement_claim" &&
          binding.legKind === "source_room" &&
          parameters.p_step !== "bill"
        )
          fail("source_billing_guest_action_required");
        if (!names[name]) fail("source_billing_invalid_input");
        const result = await rpc(names[name], {
          ...parameters,
          p_actor: parameters.p_actor ?? a.n3UserKey,
          ...(name === "hotelhub_settlement_read" ? { p_role: a.role } : {}),
          p_leg_id: id,
          p_plan_digest: digest,
        });
        if (!result.error && result.data !== null && name !== "hotelhub_settlement_claim") {
          const leg = await parseLeg(result.data, a, id, digest);
          if (billingPayloadDigest(leg.snapshot) !== billingPayloadDigest(binding.snapshot))
            fail("settlement_scope_mismatch");
        }
        return result;
      });
      // Deny sibling IDs/actions before the core validates payloads or opaque proofs.
      const scope = (s: SettlementScope) => {
        if (s.tenantId !== a.tenantId || s.reservationId !== a.reservationId)
          fail("settlement_scope_mismatch");
      };
      const target = (s: SettlementActor, intent: string) => {
        scope(s);
        if (intent !== binding.id) fail("settlement_scope_mismatch");
      };
      return {
        async read(s) {
          scope(s);
          return core.read(s);
        },
        freeze() {
          return Promise.reject(Error("source_billing_whole_stay_required"));
        },
        async claim(s, intent, revision, step, payload) {
          target(s, intent);
          if (binding.legKind === "source_room" && step.kind !== "bill")
            fail("source_billing_guest_action_required");
          return core.claim(s, intent, revision, step, payload);
        },
        async recordOutcome(s, claim, outcome) {
          target(s, claim.intentId);
          return core.recordOutcome(s, claim, outcome);
        },
        async recordProgress(s, intent, revision, proof) {
          target(s, intent);
          return core.recordProgress(s, intent, revision, proof);
        },
        async recordProof(s, intent, revision, proof) {
          target(s, intent);
          return core.recordProof(s, intent, revision, proof);
        },
        abandonUnused() {
          return Promise.reject(Error("source_billing_whole_stay_required"));
        },
        close() {
          return Promise.reject(Error("source_billing_whole_stay_required"));
        },
      };
    },
  };
  return store;
}
