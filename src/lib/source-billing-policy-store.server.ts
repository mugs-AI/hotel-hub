// Fixed service-owned RPC adapter; no browser payload can select a writer/reader.
import type { SettlementActor } from "./settlement-context.server";
import type { EvidenceResult, SettlementScope } from "./settlement";
import type {
  CollectionMode,
  ReservationPayerSnapshot,
  SourceBillingPolicy,
} from "./source-billing";
import {
  parseSourceBillingPolicy,
  prepareReservationPayer,
  readSourceBillingPolicy,
  type SourcePolicyDeps,
} from "./source-billing-policy.server";

export type SourcePolicyRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: null | { code?: string; message?: string } }>;
export type SavedReservationPayer = SettlementScope & {
  sourceId: string;
  revision: string;
  updatedAt: string;
  payer: ReservationPayerSnapshot;
};
type ReservationFacts = NonNullable<Awaited<ReturnType<SourcePolicyDeps["readReservation"]>>> & {
  updatedAt: string;
};
export type PayerReview = { sourceId: string; policyVersion: string; reservationUpdatedAt: string };
export type SourcePolicyStore = {
  readSettings(
    actor: SettlementActor,
    sourceId: string,
  ): Promise<EvidenceResult<{ policy: SourceBillingPolicy; blockers: string[] }>>;
  readPolicy(
    actor: SettlementActor,
    sourceId: string,
  ): Promise<EvidenceResult<SourceBillingPolicy>>;
  readReservation(actor: SettlementActor): Promise<EvidenceResult<ReservationFacts>>;
  update(
    actor: SettlementActor,
    input: { sourceId: string; expectedVersion: string; policy: SourceBillingPolicy },
  ): Promise<EvidenceResult<SourceBillingPolicy>>;
  confirm(
    actor: SettlementActor,
    mode: CollectionMode,
    expectedRevision: string,
    review?: PayerReview,
  ): Promise<EvidenceResult<SavedReservationPayer>>;
};
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const rev = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const dateTime = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const unavailable = (code: string) => ({ kind: "unavailable" as const, code });
const contradiction = (code: string) => ({ kind: "contradiction" as const, code });
const codes = new Set([
  "source_billing_forbidden",
  "source_policy_version_conflict",
  "source_policy_scope_mismatch",
  "source_billing_policy_missing",
  "source_payer_revision_conflict",
  "source_collection_mode_not_allowed",
  "source_payer_owner_required",
  "source_payer_frozen",
  "settlement_locked",
  "settlement_busy",
  "reservation_not_found",
  "invalid_source_billing_policy",
]);
class StoreFailure extends Error {
  constructor(
    readonly code: string,
    readonly unavailable: boolean,
  ) {
    super(code);
  }
}
function failure(e: unknown): EvidenceResult<never> {
  return e instanceof StoreFailure
    ? e.unavailable
      ? unavailable(e.code)
      : contradiction(e.code)
    : unavailable("source_billing_store_unavailable");
}
function scope(actor: SettlementActor) {
  if (
    !uuid(actor.tenantId) ||
    !["owner", "front_desk"].includes(actor.role) ||
    !actor.n3UserKey?.trim() ||
    !actor.n3Token?.trim()
  )
    throw new StoreFailure("source_billing_forbidden", false);
  return { p_tenant: actor.tenantId, p_actor: actor.n3UserKey, p_role: actor.role };
}
function payer(value: unknown): ReservationPayerSnapshot | null {
  if (
    !obj(value) ||
    !obj(value.policy) ||
    !uuid(value.policy.sourceId) ||
    !["guest", "source"].includes(String(value.collectionMode)) ||
    typeof value.confirmedBy !== "string" ||
    !value.confirmedBy.trim() ||
    !dateTime(value.confirmedAt)
  )
    return null;
  const policy = parseSourceBillingPolicy(value.policy, value.policy.sourceId);
  if (
    policy.kind !== "confirmed" ||
    !policy.value.allowedCollectionModes.includes(value.collectionMode as CollectionMode)
  )
    return null;
  return Object.freeze({
    policy: policy.value,
    collectionMode: value.collectionMode as CollectionMode,
    confirmedBy: value.confirmedBy,
    confirmedAt: value.confirmedAt,
  });
}
/** Default registry is closed; tests inject trusted current-master observations.
 * A runtime flag or local legacy customer code can never open this registry. */
const closedMaster: SourcePolicyDeps["readCustomer"] = async () =>
  unavailable("n3_source_customer_master_contract_unverified");
function createSourcePolicyStoreCore(
  rpc: SourcePolicyRpc,
  readCustomer: SourcePolicyDeps["readCustomer"] = closedMaster,
): SourcePolicyStore {
  async function call(name: string, args: Record<string, unknown>) {
    const result = await rpc(name, args);
    if (result.error) {
      if (["42P01", "42883", "PGRST202", "PGRST205"].includes(result.error.code ?? ""))
        throw new StoreFailure("source_billing_setup_required", true);
      if (codes.has(result.error.message ?? ""))
        throw new StoreFailure(result.error.message!, false);
      throw new StoreFailure("source_billing_store_unavailable", true);
    }
    return result.data;
  }
  async function readRawPolicy(actor: SettlementActor, sourceId: string) {
    if (!uuid(sourceId)) throw new StoreFailure("invalid_source_billing_policy", false);
    const value = await call("hh_source_billing_policy_get", {
      ...scope(actor),
      p_source: sourceId,
    });
    if (value === null) return null;
    if (!obj(value) || value.tenantId !== actor.tenantId || typeof value.active !== "boolean")
      throw new StoreFailure("source_policy_scope_mismatch", false);
    const p = parseSourceBillingPolicy(value.policy, sourceId);
    if (p.kind !== "confirmed") throw new StoreFailure(p.code, false);
    return { tenantId: actor.tenantId, active: value.active, policy: p.value };
  }
  async function readFacts(actor: SettlementActor): Promise<ReservationFacts | null> {
    if (!uuid(actor.reservationId)) throw new StoreFailure("source_payer_scope_mismatch", false);
    const value = await call("hh_source_billing_reservation_get", {
      ...scope(actor),
      p_reservation: actor.reservationId,
    });
    if (value === null) return null;
    if (
      !obj(value) ||
      value.tenantId !== actor.tenantId ||
      value.reservationId !== actor.reservationId ||
      !uuid(value.sourceId) ||
      !rev(value.revision) ||
      !dateTime(value.updatedAt) ||
      typeof value.frozen !== "boolean"
    )
      throw new StoreFailure("source_payer_revision_conflict", false);
    const saved = value.payer === null ? null : payer(value.payer);
    if (value.payer !== null && !saved)
      throw new StoreFailure("source_payer_revision_conflict", false);
    return {
      tenantId: actor.tenantId,
      reservationId: actor.reservationId,
      sourceId: value.sourceId,
      revision: value.revision,
      updatedAt: value.updatedAt,
      frozen: value.frozen,
      payer: saved,
    };
  }
  const deps: SourcePolicyDeps = {
    readPolicy: readRawPolicy,
    readCustomer,
    readReservation: readFacts,
    now: () => new Date(),
  };
  return {
    async readSettings(actor, sourceId) {
      try {
        scope(actor);
        if (actor.role !== "owner") return contradiction("source_billing_forbidden");
        const raw = await readRawPolicy(actor, sourceId);
        if (!raw) return unavailable("source_billing_policy_missing");
        const verified = await readSourceBillingPolicy(actor, sourceId, {
          ...deps,
          readPolicy: async () => raw,
        });
        if (
          verified.kind !== "confirmed" &&
          ["n3_session_expired", "n3_unauthorized"].includes(verified.code)
        )
          return verified;
        return {
          kind: "confirmed",
          value: {
            policy: raw.policy,
            blockers: verified.kind === "confirmed" ? [] : [verified.code],
          },
        };
      } catch (e) {
        return failure(e);
      }
    },
    async readPolicy(actor, sourceId) {
      return readSourceBillingPolicy(actor, sourceId, deps);
    },
    async readReservation(actor) {
      try {
        const value = await readFacts(actor);
        return value ? { kind: "confirmed", value } : unavailable("reservation_not_found");
      } catch (e) {
        return failure(e);
      }
    },
    async update(actor, input) {
      try {
        scope(actor);
        if (actor.role !== "owner") return contradiction("source_billing_forbidden");
        const parsed = parseSourceBillingPolicy(input.policy, input.sourceId);
        if (
          parsed.kind !== "confirmed" ||
          !rev(input.expectedVersion) ||
          input.expectedVersion !== parsed.value.version
        )
          return contradiction("invalid_source_billing_policy");
        const existing = await readRawPolicy(actor, input.sourceId);
        if (
          (existing && (!existing.active || existing.policy.version !== input.expectedVersion)) ||
          (!existing && input.expectedVersion !== "0")
        )
          return contradiction("source_policy_version_conflict");
        const checked = await readSourceBillingPolicy(actor, input.sourceId, {
          ...deps,
          readPolicy: async () => ({
            tenantId: actor.tenantId,
            active: true,
            policy: parsed.value,
          }),
        });
        if (checked.kind !== "confirmed") return checked;
        const value = await call("hh_source_billing_policy_put", {
          ...scope(actor),
          p_source: input.sourceId,
          p_expected_version: input.expectedVersion,
          p_policy: checked.value,
        });
        const saved = parseSourceBillingPolicy(value, input.sourceId);
        if (
          saved.kind !== "confirmed" ||
          saved.value.version !== (BigInt(input.expectedVersion) + 1n).toString()
        )
          return unavailable("source_billing_save_unverified");
        const { version: _v, ...proposed } = checked.value,
          { version: _s, ...observed } = saved.value;
        if (JSON.stringify(proposed) !== JSON.stringify(observed))
          return unavailable("source_billing_save_unverified");
        return saved;
      } catch (e) {
        return failure(e);
      }
    },
    async confirm(actor, selectedMode, expectedRevision, review) {
      try {
        scope(actor);
        const before = await readFacts(actor);
        if (!before) return unavailable("reservation_not_found");
        if (
          review &&
          (!uuid(review.sourceId) ||
            !rev(review.policyVersion) ||
            !dateTime(review.reservationUpdatedAt) ||
            review.sourceId !== before.sourceId ||
            review.reservationUpdatedAt !== before.updatedAt)
        )
          return contradiction("source_payer_revision_conflict");
        const prepared = await prepareReservationPayer(
          actor,
          before.sourceId,
          selectedMode,
          expectedRevision,
          { ...deps, readReservation: async () => before },
        );
        if (prepared.kind !== "confirmed") return prepared;
        if (review && review.policyVersion !== prepared.value.policy.version)
          return contradiction("source_policy_version_conflict");
        const value = await call("hh_source_billing_payer_confirm", {
          ...scope(actor),
          p_reservation: actor.reservationId,
          p_source: before.sourceId,
          p_mode: selectedMode,
          p_expected_revision: expectedRevision,
          p_policy_version: prepared.value.policy.version,
          p_reservation_updated_at: before.updatedAt,
        });
        if (!obj(value)) return unavailable("source_billing_save_unverified");
        const saved = payer(value.payer);
        if (
          !saved ||
          value.tenantId !== actor.tenantId ||
          value.reservationId !== actor.reservationId ||
          value.sourceId !== before.sourceId ||
          value.revision !== (BigInt(expectedRevision) + 1n).toString() ||
          !dateTime(value.updatedAt) ||
          saved.confirmedBy !== actor.n3UserKey ||
          saved.collectionMode !== selectedMode ||
          JSON.stringify(saved.policy) !== JSON.stringify(prepared.value.policy)
        )
          return unavailable("source_billing_save_unverified");
        return {
          kind: "confirmed",
          value: Object.freeze({
            tenantId: actor.tenantId,
            reservationId: actor.reservationId,
            sourceId: before.sourceId,
            revision: String(value.revision),
            updatedAt: value.updatedAt,
            payer: saved,
          }),
        };
      } catch (e) {
        return failure(e);
      }
    },
  };
}
/** Bind the entire operation before its first await, not each later master read.
 * Reject a caller switch even when an awaited RPC/GET itself succeeded. */
export function createSourcePolicyStore(
  rpc: SourcePolicyRpc,
  readCustomer: SourcePolicyDeps["readCustomer"] = closedMaster,
): SourcePolicyStore {
  async function operate<T>(
    actor: SettlementActor,
    action: (store: SourcePolicyStore, bound: SettlementActor) => Promise<EvidenceResult<T>>,
  ): Promise<EvidenceResult<T>> {
    const bound = Object.freeze({ ...actor });
    function current() {
      for (const key of ["tenantId", "reservationId", "role", "n3UserKey", "n3Token"] as const)
        if (actor[key] !== bound[key])
          throw new StoreFailure("source_policy_scope_mismatch", false);
    }
    const store = createSourcePolicyStoreCore(
      async (name, args) => {
        current();
        const result = await rpc(name, args);
        current();
        return result;
      },
      async (_a, id) => {
        current();
        const result = await readCustomer(bound, id);
        current();
        return result;
      },
    );
    try {
      current();
      const result = await action(store, bound);
      current();
      return result;
    } catch (e) {
      return failure(e);
    }
  }
  return {
    readSettings: (a, id) => operate(a, (s, b) => s.readSettings(b, id)),
    readPolicy: (a, id) => operate(a, (s, b) => s.readPolicy(b, id)),
    readReservation: (a) => operate(a, (s, b) => s.readReservation(b)),
    update: (a, input) => {
      const captured = { ...input };
      return operate(a, (s, b) => s.update(b, captured));
    },
    confirm: (a, mode, revision, review) => {
      const savedReview = review ? Object.freeze({ ...review }) : undefined;
      return operate(a, (s, b) => s.confirm(b, mode, revision, savedReview));
    },
  };
}
export function liveSourcePolicyStore(): SourcePolicyStore {
  return createSourcePolicyStore(
    async (name, args) => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return (supabaseAdmin as unknown as { rpc: SourcePolicyRpc }).rpc(name, args);
    },
    async (actor, id) => {
      const { createCurrentSettlementMasters } =
        await import("./settlement-current-masters.server");
      return createCurrentSettlementMasters(actor, {
        invalidateSession: async () => {
          const { destroySession } = await import("./session-context.server");
          await destroySession("n3_unauthorized");
        },
      }).readCustomer(actor, id);
    },
  );
}
