import {
  settlementProgressBoundTo,
  settlementFinalEvidenceForStore,
} from "./settlement-evidence.server";
import type { DispatchFacts, StoredIntent, StoredDispatch } from "./settlement-dispatch.server";
import { billingPayloadDigest } from "./n3-billing.server";
import type {
  SettlementActor,
  SettlementProof,
  SettlementProgressProof,
} from "./settlement-context.server";
import type {
  DispatchClaim,
  DispatchOutcome,
  Revision,
  SettlementScope,
  SettlementSnapshot,
  StepKind,
} from "./settlement";
export type SettlementRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: null | { code?: string; message?: string } }>;
export interface SettlementStore {
  recordProgress(
    actor: SettlementActor,
    intentId: string,
    revision: Revision,
    proof: SettlementProgressProof,
  ): Promise<StoredIntent>;
  read(scope: SettlementScope): Promise<StoredIntent | null>;
  freeze(
    actor: SettlementActor,
    snapshot: SettlementSnapshot,
    clientRequestId: string,
  ): Promise<StoredIntent>;
  claim(
    actor: SettlementActor,
    intentId: string,
    revision: Revision,
    step: { kind: StepKind; receiptId?: string; facts: DispatchFacts },
    payloadDigest: string,
  ): Promise<DispatchClaim | null>;
  recordOutcome(
    actor: SettlementActor,
    claim: DispatchClaim,
    outcome: DispatchOutcome,
  ): Promise<StoredIntent>;
  recordProof(
    actor: SettlementActor,
    intentId: string,
    revision: Revision,
    proof: SettlementProof,
  ): Promise<StoredIntent>;
  abandonUnused(
    actor: SettlementActor,
    intentId: string,
    revision: Revision,
  ): Promise<StoredIntent>;
  close(
    actor: SettlementActor,
    intentId: string,
    revision: Revision,
    proofDigest: string,
  ): Promise<StoredIntent>;
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const revision = (v: unknown): v is Revision =>
  typeof v === "string" && /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{64}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
function fail(code: string): never {
  throw new Error(code);
}
function scopeArgs(scope: SettlementScope): Record<string, unknown> {
  if (!uuid(scope.tenantId) || !uuid(scope.reservationId)) fail("settlement_invalid_scope");
  return { p_tenant_id: scope.tenantId, p_reservation_id: scope.reservationId };
}
function writeArgs(actor: SettlementActor): Record<string, unknown> {
  if (actor.role !== "owner" || !actor.n3UserKey?.trim() || !actor.n3Token?.trim())
    fail("settlement_forbidden");
  return { ...scopeArgs(actor), p_actor: actor.n3UserKey };
}
const states = new Set([
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
  "abandoned",
]);
function parseIntent(value: unknown, scope: SettlementScope): StoredIntent {
  if (
    !record(value) ||
    !uuid(value.id) ||
    !revision(value.revision) ||
    !states.has(String(value.state)) ||
    !record(value.snapshot) ||
    !Array.isArray(value.dispatches)
  )
    fail("settlement_invalid_result");
  if (
    value.tenantId !== scope.tenantId ||
    value.reservationId !== scope.reservationId ||
    value.snapshot.tenantId !== scope.tenantId ||
    value.snapshot.reservationId !== scope.reservationId
  )
    fail("settlement_scope_mismatch");
  for (const dispatch of value.dispatches) {
    if (
      !record(dispatch) ||
      !record(dispatch.claim) ||
      !uuid(dispatch.claim.attemptId) ||
      dispatch.claim.intentId !== value.id ||
      !hash(dispatch.claim.payloadDigest)
    )
      fail("settlement_invalid_result");
    if (dispatch.facts === undefined) fail("settlement_invalid_result");
    if (dispatch.facts !== undefined) {
      validateDispatchFacts(
        dispatch.facts,
        dispatch.claim.kind as StepKind,
        dispatch.claim.payloadDigest,
        dispatch.claim.receiptId as string | undefined,
      );
      if ((dispatch.facts as DispatchFacts).snapshotDigest !== value.snapshot.digest)
        fail("settlement_invalid_result");
      freezeDeep(dispatch.facts);
      persistedDispatches.set(dispatch as StoredDispatch, {
        scope: { ...scope },
        intentId: value.id,
        snapshotDigest: String(value.snapshot.digest),
      });
    }
  }
  return value as StoredIntent;
}
const persistedDispatches = new WeakMap<
  StoredDispatch,
  { scope: SettlementScope; intentId: string; snapshotDigest: string }
>();
export function persistedDispatchBoundTo(
  d: StoredDispatch,
  scope: SettlementScope,
  intentId: string,
  snapshotDigest: string,
): boolean {
  const m = persistedDispatches.get(d);
  return Boolean(
    m &&
    m.intentId === intentId &&
    m.snapshotDigest === snapshotDigest &&
    m.scope.tenantId === scope.tenantId &&
    m.scope.reservationId === scope.reservationId,
  );
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const x of Object.values(value)) freezeDeep(x);
    Object.freeze(value);
  }
  return value;
}
function privateField(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  return Object.entries(v).some(
    ([k, x]) =>
      /^(n3token|authorization|password|secret|rawjournal|access_token|refresh_token|cookie|session)$/i.test(
        k,
      ) || privateField(x),
  );
}
function validateDispatchFacts(
  v: unknown,
  kind: StepKind,
  payloadDigest: string,
  receiptId?: string,
): asserts v is DispatchFacts {
  if (
    !record(v) ||
    v.kind !== kind ||
    !hash(v.snapshotDigest) ||
    privateField(v) ||
    !("payload" in v)
  )
    fail("settlement_invalid_dispatch_facts");
  let digest: string;
  try {
    digest = billingPayloadDigest(v.payload);
  } catch {
    fail("settlement_invalid_dispatch_facts");
  }
  if (digest !== payloadDigest) fail("settlement_invalid_dispatch_facts");
  const allowed =
    kind === "bill"
      ? ["kind", "snapshotDigest", "payload"]
      : kind === "balance_receipt"
        ? ["kind", "snapshotDigest", "payload", "input", "account"]
        : [
            "kind",
            "snapshotDigest",
            "payload",
            "billId",
            "receipt",
            "before",
            "expectedTotalToBillCents",
            "expectedAfterFingerprint",
          ];
  if (Object.keys(v).some((k) => !allowed.includes(k)) || allowed.some((k) => !(k in v)))
    fail("settlement_invalid_dispatch_facts");
  if (kind === "bill" && !record(v.payload)) fail("settlement_invalid_dispatch_facts");
  if (
    kind === "balance_receipt" &&
    (!record(v.payload) ||
      !record(v.input) ||
      !record(v.account) ||
      !uuid(v.account.id) ||
      v.account.id !== v.input.accountId)
  )
    fail("settlement_invalid_dispatch_facts");
  if (
    kind.includes("allocation") &&
    (!Array.isArray(v.payload) ||
      !v.payload.length ||
      !record(v.receipt) ||
      v.receipt.receiptId !== receiptId ||
      !record(v.before) ||
      !uuid(v.billId) ||
      !hash(v.expectedAfterFingerprint) ||
      !Number.isSafeInteger(v.expectedTotalToBillCents) ||
      Number(v.expectedTotalToBillCents) <= 0)
  )
    fail("settlement_invalid_dispatch_facts");
}
const safeErrors = new Set([
  "settlement_locked",
  "settlement_busy",
  "settlement_stale_revision",
  "settlement_pending_financial_operation",
  "settlement_scope_mismatch",
  "settlement_snapshot_changed",
  "settlement_conflicting_request",
  "settlement_forbidden",
  "settlement_dispatched",
  "settlement_not_found",
  "settlement_invalid_state",
  "settlement_untrusted_proof",
]);
export function createSettlementStore(rpc: SettlementRpc): SettlementStore {
  async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await rpc(name, args);
    if (result.error) {
      if (["PGRST202", "PGRST205", "42883", "42P01"].includes(result.error.code || ""))
        fail("settlement_setup_required");
      fail(
        safeErrors.has(result.error.message || "")
          ? result.error.message!
          : "settlement_store_unavailable",
      );
    }
    return result.data;
  }
  function targeted(actor: SettlementActor, id: string, rev: Revision) {
    const args = writeArgs(actor);
    if (!uuid(id) || !revision(rev)) fail("settlement_invalid_input");
    return { ...args, p_intent_id: id, p_revision: rev };
  }
  return {
    async recordProgress(actor, id, rev, proof) {
      if (!settlementProgressBoundTo(proof, actor, id)) fail("settlement_untrusted_proof");
      return parseIntent(
        await call("hotelhub_settlement_prove", { ...targeted(actor, id, rev), p_proof: proof }),
        actor,
      );
    },
    async read(scope) {
      const v = await call("hotelhub_settlement_read", scopeArgs(scope));
      return v === null ? null : parseIntent(v, scope);
    },
    async freeze(actor, snapshot, clientRequestId) {
      const args = writeArgs(actor);
      if (snapshot.tenantId !== actor.tenantId || snapshot.reservationId !== actor.reservationId)
        fail("settlement_scope_mismatch");
      if (!uuid(clientRequestId) || !hash(snapshot.digest)) fail("settlement_invalid_input");
      return parseIntent(
        await call("hotelhub_settlement_freeze", {
          ...args,
          p_snapshot: snapshot,
          p_client_request_id: clientRequestId,
        }),
        actor,
      );
    },
    async claim(actor, id, rev, step, payloadDigest) {
      const args = targeted(actor, id, rev);
      validateDispatchFacts(step.facts, step.kind, payloadDigest, step.receiptId);
      if (
        !hash(payloadDigest) ||
        !new Set(["bill", "deposit_allocation", "balance_receipt", "balance_allocation"]).has(
          step.kind,
        ) ||
        ((step.kind === "deposit_allocation" || step.kind === "balance_allocation") &&
          !uuid(step.receiptId))
      )
        fail("settlement_invalid_input");
      const v = await call("hotelhub_settlement_claim", {
        ...args,
        p_step: step.kind,
        p_receipt_id: step.receiptId || null,
        p_payload_digest: payloadDigest,
        p_dispatch_facts: step.facts,
      });
      if (v === null) return null;
      if (
        !record(v) ||
        !uuid(v.attemptId) ||
        v.intentId !== id ||
        v.kind !== step.kind ||
        v.receiptId !== step.receiptId ||
        !revision(v.expectedRevision) ||
        BigInt(v.expectedRevision) !== BigInt(rev) + 1n ||
        v.payloadDigest !== payloadDigest
      )
        fail("settlement_invalid_result");
      return v as DispatchClaim;
    },
    async recordOutcome(actor, claim, outcome) {
      const args = targeted(actor, claim.intentId, claim.expectedRevision);
      if (
        !uuid(claim.attemptId) ||
        !hash(claim.payloadDigest) ||
        !["confirmed", "rejected", "unknown"].includes(outcome.kind) ||
        !/^[a-z\d_]{1,100}$/.test(outcome.code)
      )
        fail("settlement_invalid_input");
      return parseIntent(
        await call("hotelhub_settlement_outcome", {
          ...args,
          p_attempt_id: claim.attemptId,
          p_payload_digest: claim.payloadDigest,
          p_outcome: outcome,
        }),
        actor,
      );
    },
    // Task5 supplies runtime proof authority; structural casts never authorize SQL.
    async recordProof(actor, id, rev, proof) {
      const evidence = settlementFinalEvidenceForStore(proof, actor, id);
      if (!evidence) fail("settlement_untrusted_proof");
      return parseIntent(
        await call("hotelhub_settlement_prove", { ...targeted(actor, id, rev), p_proof: evidence }),
        actor,
      );
    },
    async abandonUnused(actor, id, rev) {
      return parseIntent(
        await call("hotelhub_settlement_abandon", targeted(actor, id, rev)),
        actor,
      );
    },
    async close(actor, id, rev, proofDigest) {
      if (!hash(proofDigest)) fail("settlement_invalid_input");
      return parseIntent(
        await call("hotelhub_settlement_close", {
          ...targeted(actor, id, rev),
          p_proof_digest: proofDigest,
        }),
        actor,
      );
    },
  };
}
