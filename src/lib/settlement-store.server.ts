import type { SettlementActor, SettlementProof } from "./settlement-context.server";
import type {
  DispatchClaim,
  DispatchOutcome,
  Intent,
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
  read(scope: SettlementScope): Promise<Intent | null>;
  freeze(
    actor: SettlementActor,
    snapshot: SettlementSnapshot,
    clientRequestId: string,
  ): Promise<Intent>;
  claim(
    actor: SettlementActor,
    intentId: string,
    revision: Revision,
    step: { kind: StepKind; receiptId?: string },
    payloadDigest: string,
  ): Promise<DispatchClaim | null>;
  recordOutcome(
    actor: SettlementActor,
    claim: DispatchClaim,
    outcome: DispatchOutcome,
  ): Promise<Intent>;
  recordProof(
    actor: SettlementActor,
    intentId: string,
    revision: Revision,
    proof: SettlementProof,
  ): Promise<Intent>;
  abandonUnused(actor: SettlementActor, intentId: string, revision: Revision): Promise<Intent>;
  close(
    actor: SettlementActor,
    intentId: string,
    revision: Revision,
    proofDigest: string,
  ): Promise<Intent>;
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
function parseIntent(value: unknown, scope: SettlementScope): Intent {
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
  return value as Intent;
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
    async recordProof(_actor, _id, _rev, _proof) {
      return fail("settlement_untrusted_proof");
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
