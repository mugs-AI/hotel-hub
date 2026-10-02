/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows for staged (ungenerated) tables */
// Server-only durable store for receipt correction/void requests.
// All writes go through service-role transaction functions (staged migration
// 20261002110000). Until that migration is applied every call fails closed
// with `receipt_controls_unavailable` and deposit behaviour is unchanged.
import { createHash } from "node:crypto";
import type { HotelRole } from "./rbac";
import {
  assertReceiptControllable,
  compareReceiptControl,
  requiresAccountEligibility,
  MANUAL_APPROVAL_MESSAGE,
  ReceiptControlError,
  validateReason,
  validateReceiptControlProposal,
  type ReceiptComparison,
  type ReceiptControlExecutionMode,
  type ReceiptControlProposal,
  type ReceiptControlRequestDTO,
  type ReceiptControlState,
  type ReceiptSnapshot,
} from "./receipt-controls";
import type { ReceiptControlActor } from "./receipt-controls-evidence.server";

export type RequestRow = {
  id: string;
  tenantId: string;
  reservationId: string;
  depositId: string;
  clientRequestId: string;
  fingerprint: string;
  kind: "correction" | "void";
  reason: string;
  original: ReceiptSnapshot;
  proposal: ReceiptControlProposal;
  comparison: ReceiptComparison;
  executionMode: ReceiptControlExecutionMode;
  state: ReceiptControlState;
  version: number;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Set only by an Owner approval (never by Hold). Verify requires it. */
  approvedBy: string | null;
  approvedAt: string | null;
  outcomeCode: string | null;
};

export type DecisionRow = {
  requestId: string;
  decision: "approve" | "reject" | "hold" | "verify" | "recover";
  actor: string;
  selfApproved: boolean;
  createdAt: string;
};

export type AlertRow = {
  requestId: string;
  event: string;
  requestVersion: number;
  status: "pending" | "sending" | "sent" | "failed" | "disabled";
  lastErrorCode: string | null;
  createdAt: string;
};

export type VersionPayload = {
  state: "active" | "voided";
  receiptId: string;
  docCode: string;
  documentDate: string;
  currency: string;
  amountCents: number;
  paymentLines: ReceiptSnapshot["paymentLines"];
  replacementOf: string | null;
  fingerprint: string;
};

export interface ReceiptControlDb {
  create(a: {
    tenantId: string;
    reservationId: string;
    depositId: string;
    clientRequestId: string;
    fingerprint: string;
    kind: "correction" | "void";
    reason: string;
    original: ReceiptSnapshot;
    proposal: ReceiptControlProposal;
    comparison: ReceiptComparison;
    originalCents: number;
    proposedCents: number | null;
    actor: string;
  }): Promise<RequestRow>;
  decide(a: {
    tenantId: string;
    requestId: string;
    expectedVersion: number;
    decision: "approve" | "reject" | "hold";
    toState: ReceiptControlState;
    actor: string;
    outcomeCode: string | null;
    note: string | null;
  }): Promise<RequestRow>;
  claim(a: {
    tenantId: string;
    requestId: string;
    expectedVersion: number;
    step: "verify";
    actor: string;
  }): Promise<string | null>;
  complete(a: {
    tenantId: string;
    requestId: string;
    executionId: string;
    toState: "applied" | "needs_review" | "failed";
    outcomeCode: string;
    actor: string;
    version: VersionPayload | null;
  }): Promise<RequestRow>;
  /** Claim + complete in one transaction (manual Verify). No partial state survives a crash. */
  verifyAtomic(a: {
    tenantId: string;
    requestId: string;
    expectedVersion: number;
    actor: string;
    toState: "applied" | "needs_review";
    outcomeCode: string;
    version: VersionPayload | null;
  }): Promise<RequestRow>;
  /** Release a stale in-flight claim (older than staleSeconds); bumps the version. */
  recover(a: {
    tenantId: string;
    requestId: string;
    expectedVersion: number;
    actor: string;
    staleSeconds: number;
  }): Promise<RequestRow>;
  get(tenantId: string, requestId: string): Promise<RequestRow | null>;
  list(
    tenantId: string,
    f: {
      reservationId?: string;
      requestedBy?: string;
      states?: ReceiptControlState[];
      offset: number;
      limit: number;
    },
  ): Promise<{ rows: RequestRow[]; total: number }>;
  decisions(tenantId: string, requestIds: string[]): Promise<DecisionRow[]>;
  alerts(tenantId: string, requestIds: string[]): Promise<AlertRow[]>;
}

const DB_CODES = new Set([
  "receipt_control_key_conflict",
  "receipt_control_active_exists",
  "deposit_not_found",
  "request_not_found",
  "version_conflict",
  "invalid_transition",
  "claim_not_found",
  "receipt_control_immutable",
  "not_approved",
  "claim_stale",
  "claim_conflict",
  "invalid_reason",
  "automation_unavailable",
]);

/** Map a database error to a safe code; missing objects = staged migration not applied. */
export function mapDbError(err: { code?: string; message?: string } | null): ReceiptControlError {
  const msg = err?.message ?? "";
  for (const c of DB_CODES) if (msg.includes(c)) return new ReceiptControlError(c);
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(err?.code ?? ""))
    return new ReceiptControlError("receipt_controls_unavailable");
  return new ReceiptControlError("receipt_control_store_failed");
}

function toRow(r: any): RequestRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    reservationId: r.reservation_id,
    depositId: r.deposit_id,
    clientRequestId: r.client_request_id,
    fingerprint: r.request_fingerprint,
    kind: r.kind,
    reason: r.reason,
    original: r.original,
    proposal: r.proposal,
    comparison: r.comparison,
    executionMode: r.execution_mode,
    state: r.state,
    version: r.version,
    requestedBy: r.requested_by_n3_user_key,
    requestedAt: r.requested_at,
    decidedBy: r.decided_by_n3_user_key ?? null,
    decidedAt: r.decided_at ?? null,
    approvedBy: r.approved_by_n3_user_key ?? null,
    approvedAt: r.approved_at ?? null,
    outcomeCode: r.outcome_code ?? null,
  };
}

const REQ_COLS =
  "id, tenant_id, reservation_id, deposit_id, client_request_id, request_fingerprint, kind, reason, original, proposal, comparison, execution_mode, state, version, requested_by_n3_user_key, requested_at, decided_by_n3_user_key, decided_at, approved_by_n3_user_key, approved_at, outcome_code";

/** Production implementation: service-role client, loaded lazily inside calls. */
export function supabaseReceiptControlDb(): ReceiptControlDb {
  const sb = async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
      from: (t: string) => any;
    };
  };
  const one = (res: { data: any; error: any }) => {
    if (res.error) throw mapDbError(res.error);
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!row) throw new ReceiptControlError("receipt_control_store_failed");
    return toRow(row);
  };
  return {
    async create(a) {
      return one(
        await (
          await sb()
        ).rpc("hotelhub_receipt_control_create", {
          p_tenant_id: a.tenantId,
          p_reservation_id: a.reservationId,
          p_deposit_id: a.depositId,
          p_client_request_id: a.clientRequestId,
          p_fingerprint: a.fingerprint,
          p_kind: a.kind,
          p_reason: a.reason,
          p_original: a.original,
          p_proposal: a.proposal,
          p_comparison: a.comparison,
          p_original_cents: a.originalCents,
          p_proposed_cents: a.proposedCents,
          p_actor: a.actor,
        }),
      );
    },
    async decide(a) {
      return one(
        await (
          await sb()
        ).rpc("hotelhub_receipt_control_decide", {
          p_tenant_id: a.tenantId,
          p_request_id: a.requestId,
          p_expected_version: a.expectedVersion,
          p_decision: a.decision,
          p_to_state: a.toState,
          p_actor: a.actor,
          p_outcome_code: a.outcomeCode,
          p_note: a.note,
        }),
      );
    },
    async claim(a) {
      const res = await (
        await sb()
      ).rpc("hotelhub_receipt_control_claim", {
        p_tenant_id: a.tenantId,
        p_request_id: a.requestId,
        p_expected_version: a.expectedVersion,
        p_step: a.step,
        p_actor: a.actor,
      });
      if (res.error) throw mapDbError(res.error);
      return typeof res.data === "string" ? res.data : null;
    },
    async complete(a) {
      return one(
        await (
          await sb()
        ).rpc("hotelhub_receipt_control_complete", {
          p_tenant_id: a.tenantId,
          p_request_id: a.requestId,
          p_execution_id: a.executionId,
          p_to_state: a.toState,
          p_outcome_code: a.outcomeCode,
          p_actor: a.actor,
          p_version: a.version,
        }),
      );
    },
    async verifyAtomic(a) {
      return one(
        await (
          await sb()
        ).rpc("hotelhub_receipt_control_verify_atomic", {
          p_tenant_id: a.tenantId,
          p_request_id: a.requestId,
          p_expected_version: a.expectedVersion,
          p_actor: a.actor,
          p_to_state: a.toState,
          p_outcome_code: a.outcomeCode,
          p_version: a.version,
        }),
      );
    },
    async recover(a) {
      return one(
        await (
          await sb()
        ).rpc("hotelhub_receipt_control_recover", {
          p_tenant_id: a.tenantId,
          p_request_id: a.requestId,
          p_expected_version: a.expectedVersion,
          p_actor: a.actor,
          p_stale_seconds: a.staleSeconds,
        }),
      );
    },
    async get(tenantId, requestId) {
      const res = await (await sb())
        .from("hotel_receipt_control_requests")
        .select(REQ_COLS)
        .eq("tenant_id", tenantId)
        .eq("id", requestId)
        .maybeSingle();
      if (res.error) throw mapDbError(res.error);
      return res.data ? toRow(res.data) : null;
    },
    async list(tenantId, f) {
      let q = (await sb())
        .from("hotel_receipt_control_requests")
        .select(REQ_COLS, { count: "exact" })
        .eq("tenant_id", tenantId);
      if (f.reservationId) q = q.eq("reservation_id", f.reservationId);
      if (f.requestedBy) q = q.eq("requested_by_n3_user_key", f.requestedBy);
      if (f.states?.length) q = q.in("state", f.states);
      const res = await q
        .order("requested_at", { ascending: false })
        .order("id", { ascending: false })
        .range(f.offset, f.offset + f.limit - 1);
      if (res.error) throw mapDbError(res.error);
      return { rows: (res.data ?? []).map(toRow), total: res.count ?? 0 };
    },
    async decisions(tenantId, ids) {
      if (!ids.length) return [];
      const res = await (await sb())
        .from("hotel_receipt_control_decisions")
        .select("request_id, decision, actor_n3_user_key, self_approved, created_at")
        .eq("tenant_id", tenantId)
        .in("request_id", ids);
      if (res.error) throw mapDbError(res.error);
      return (res.data ?? []).map((d: any) => ({
        requestId: d.request_id,
        decision: d.decision,
        actor: d.actor_n3_user_key,
        selfApproved: d.self_approved,
        createdAt: d.created_at,
      }));
    },
    async alerts(tenantId, ids) {
      if (!ids.length) return [];
      const res = await (await sb())
        .from("hotel_receipt_alert_outbox")
        .select("request_id, event, request_version, status, last_error_code, created_at")
        .eq("tenant_id", tenantId)
        .in("request_id", ids);
      if (res.error) throw mapDbError(res.error);
      return (res.data ?? []).map((a: any) => ({
        requestId: a.request_id,
        event: a.event,
        requestVersion: a.request_version,
        status: a.status,
        lastErrorCode: a.last_error_code ?? null,
        createdAt: a.created_at,
      }));
    },
  };
}

export type StoreDeps = {
  db: ReceiptControlDb;
  readEvidence(actor: ReceiptControlActor, depositId: string): Promise<ReceiptSnapshot>;
  /** Verified, visible N3 deposit account label, or null when not allowed. */
  resolveAccount(
    actor: ReceiptControlActor,
    accountId: string,
    originalAccountId: string,
  ): Promise<string | null>;
  walkInCustomerId(tenantId: string): Promise<string | null>;
  labels(tenantId: string, keys: string[]): Promise<Map<string, string>>;
  bookingRefs(tenantId: string, reservationIds: string[]): Promise<Map<string, string>>;
  audit(e: {
    tenantId: string;
    n3UserKey: string;
    eventType:
      | "hotel.receipt_control.requested"
      | "hotel.receipt_control.decided"
      | "hotel.receipt_control.verified"
      | "hotel.receipt_control.recovered";
    detail: Record<string, unknown>;
  }): Promise<void>;
};

const isUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const CAN_REQUEST: ReadonlySet<HotelRole> = new Set(["owner", "front_desk"]);
const assertOwner = (actor: ReceiptControlActor) => {
  if (actor.role !== "owner") throw new ReceiptControlError("forbidden");
};

export function requestFingerprint(depositId: string, reason: string, p: ReceiptControlProposal) {
  return createHash("sha256")
    .update(JSON.stringify({ depositId, reason, proposal: p }))
    .digest("hex");
}

export async function createReceiptControlRequest(
  actor: ReceiptControlActor,
  input: {
    reservationId: unknown;
    depositId: unknown;
    clientRequestId: unknown;
    reason: unknown;
    proposal: unknown;
  },
  deps: StoreDeps,
): Promise<ReceiptControlRequestDTO> {
  if (!CAN_REQUEST.has(actor.role)) throw new ReceiptControlError("forbidden");
  if (!isUuid(input.reservationId) || !isUuid(input.depositId))
    throw new ReceiptControlError("invalid_id");
  if (!isUuid(input.clientRequestId)) throw new ReceiptControlError("invalid_client_request_id");
  const reason = validateReason(input.reason);
  const original = await deps.readEvidence(actor, input.depositId);
  assertReceiptControllable(original);
  const proposal = validateReceiptControlProposal(input.proposal, original);
  const comparison = compareReceiptControl(original, proposal);
  if (proposal.kind === "correction" && requiresAccountEligibility(original, proposal)) {
    const line = original.paymentLines[0]!;
    const label = await deps.resolveAccount(actor, proposal.accountId, line.accountId);
    if (!label) throw new ReceiptControlError("account_not_allowed");
    for (const f of comparison.fields) if (f.label === "Deposit to") f.requested = label;
  }
  const row = await deps.db.create({
    tenantId: actor.tenantId,
    reservationId: input.reservationId,
    depositId: input.depositId,
    clientRequestId: input.clientRequestId,
    fingerprint: requestFingerprint(input.depositId, reason, proposal),
    kind: proposal.kind,
    reason,
    original,
    proposal,
    comparison,
    originalCents: original.amountCents,
    proposedCents: proposal.kind === "correction" ? proposal.amountCents : null,
    actor: actor.n3UserKey,
  });
  await deps.audit({
    tenantId: actor.tenantId,
    n3UserKey: actor.n3UserKey,
    eventType: "hotel.receipt_control.requested",
    detail: { requestId: row.id, kind: row.kind, outcome: row.state },
  });
  return (await toDTOs(actor, [row], deps))[0]!;
}

/** Owner decision. Approval re-reads N3 and holds instead of approving changed evidence. */
export async function decideReceiptControlRequest(
  actor: ReceiptControlActor,
  input: { requestId: unknown; expectedVersion: unknown; decision: unknown; note?: unknown },
  deps: StoreDeps,
): Promise<ReceiptControlRequestDTO> {
  assertOwner(actor);
  if (!isUuid(input.requestId)) throw new ReceiptControlError("invalid_id");
  if (!Number.isInteger(input.expectedVersion)) throw new ReceiptControlError("version_conflict");
  if (input.decision !== "approve" && input.decision !== "reject")
    throw new ReceiptControlError("invalid_decision");
  const note =
    typeof input.note === "string" && input.note.trim() ? validateReason(input.note) : null;
  const row = await deps.db.get(actor.tenantId, input.requestId);
  if (!row) throw new ReceiptControlError("request_not_found");
  const expectedVersion = input.expectedVersion as number;
  let decided: RequestRow;
  if (input.decision === "reject") {
    decided = await deps.db.decide({
      tenantId: actor.tenantId,
      requestId: row.id,
      expectedVersion,
      decision: "reject",
      toState: "rejected",
      actor: actor.n3UserKey,
      outcomeCode: "rejected",
      note,
    });
  } else {
    const hold = await approvalHoldReason(actor, row, deps);
    decided = await deps.db.decide({
      tenantId: actor.tenantId,
      requestId: row.id,
      expectedVersion,
      decision: hold ? "hold" : "approve",
      toState: hold ? "needs_review" : "approved_awaiting_n3",
      actor: actor.n3UserKey,
      outcomeCode: hold ?? "approved_manual",
      note,
    });
  }
  await deps.audit({
    tenantId: actor.tenantId,
    n3UserKey: actor.n3UserKey,
    eventType: "hotel.receipt_control.decided",
    detail: {
      requestId: decided.id,
      outcome: decided.outcomeCode,
      selfApproved: actor.n3UserKey === row.requestedBy,
    },
  });
  return (await toDTOs(actor, [decided], deps))[0]!;
}

async function approvalHoldReason(
  actor: ReceiptControlActor,
  row: RequestRow,
  deps: StoreDeps,
): Promise<string | null> {
  let current: ReceiptSnapshot;
  try {
    current = await deps.readEvidence(actor, row.depositId);
  } catch (e) {
    if (e instanceof ReceiptControlError && e.code === "unauthorized") throw e;
    return "n3_evidence_unavailable";
  }
  if (current.documentState !== "active" || current.matchingState !== "unmatched")
    return "receipt_restricted";
  // Balanced GL is not enough: the posting must exactly equal this receipt.
  if (current.journalExact !== true) return "journal_unproven";
  if (current.sourceFingerprint !== row.original.sourceFingerprint)
    return "n3_changed_since_request";
  const walkIn = await deps.walkInCustomerId(actor.tenantId);
  if (!walkIn || walkIn.toLowerCase() !== row.original.customerId.toLowerCase())
    return "walk_in_mapping_changed";
  if (
    row.proposal.kind === "correction" &&
    requiresAccountEligibility(row.original, row.proposal)
  ) {
    const line = row.original.paymentLines[0];
    if (!line || !(await deps.resolveAccount(actor, row.proposal.accountId, line.accountId)))
      return "account_not_allowed";
  }
  return null;
}

/** Safe original projection for the request dialog (contact/account/amount). */
export async function readReceiptOriginalForDialog(
  actor: ReceiptControlActor,
  input: { reservationId: unknown; depositId: unknown },
  deps: Pick<StoreDeps, "readEvidence">,
) {
  if (!CAN_REQUEST.has(actor.role)) throw new ReceiptControlError("forbidden");
  if (!isUuid(input.reservationId) || !isUuid(input.depositId))
    throw new ReceiptControlError("invalid_id");
  const o = await deps.readEvidence(actor, input.depositId);
  const line = o.paymentLines.length === 1 ? o.paymentLines[0]! : null;
  return {
    amountCents: o.amountCents,
    currency: o.currency,
    accountId: line?.accountId ?? null,
    accountLabel: line ? line.savedName || line.code : null,
    contact: { ...o.contact },
  };
}

export async function listReceiptControlRequests(
  actor: ReceiptControlActor,
  f: { reservationId?: string; queue?: boolean; offset?: unknown; limit?: unknown },
  deps: StoreDeps,
): Promise<ReceiptControlPage> {
  if (!CAN_REQUEST.has(actor.role)) throw new ReceiptControlError("forbidden");
  if (f.reservationId !== undefined && !isUuid(f.reservationId))
    throw new ReceiptControlError("invalid_id");
  const offset = parsePageInt(f.offset, 0, 0, 1_000_000);
  const limit = parsePageInt(f.limit, RECEIPT_CONTROL_PAGE_DEFAULT, 1, RECEIPT_CONTROL_PAGE_MAX);
  const { rows, total } = await deps.db.list(actor.tenantId, {
    offset,
    limit,
    reservationId: f.reservationId,
    // Front Desk sees only its own requests; the Owner sees all.
    requestedBy: actor.role === "owner" ? undefined : actor.n3UserKey,
    states: f.queue
      ? ["pending", "approved_awaiting_n3", "applying", "failed", "needs_review"]
      : undefined,
  });
  const requests = await toDTOs(actor, rows, deps);
  const next = offset + rows.length;
  return { requests, total, offset, limit, nextOffset: next < total && rows.length ? next : null };
}

export const RECEIPT_CONTROL_PAGE_DEFAULT = 50;
export const RECEIPT_CONTROL_PAGE_MAX = 100;
export type ReceiptControlPage = {
  requests: ReceiptControlRequestDTO[];
  total: number;
  offset: number;
  limit: number;
  /** Null when every matching request has been returned; never a silent cap. */
  nextOffset: number | null;
};
function parsePageInt(v: unknown, dflt: number, min: number, max: number): number {
  if (v === undefined || v === null || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ReceiptControlError("invalid_page");
  return n;
}

const OUTCOME_MESSAGE: Record<string, string> = {
  approved_manual: MANUAL_APPROVAL_MESSAGE,
  rejected: "Rejected. The receipt stays as it is.",
  verified: "Verified in N3. Totals now use the corrected receipt.",
  n3_changed_since_request:
    "The receipt changed in N3 after this request. Review it before deciding.",
  n3_evidence_unavailable: "N3 could not confirm the receipt. Needs review.",
  receipt_restricted: "The receipt is matched, refunded or cancelled in N3. Needs review.",
  walk_in_mapping_changed: "The walk-in customer mapping changed. Needs review.",
  account_not_allowed: "The requested deposit account is not available. Needs review.",
  n3_result_mismatch: "N3 does not show the approved change. Needs review.",
  n3_evidence_insufficient: "N3 could not prove the change (missing or unknown). Needs review.",
  journal_unproven: "N3 could not prove the receipt journal exactly. Held for review.",
  verification_interrupted: "A verification was interrupted and released. Verify again to read N3.",
};

export async function toDTOs(
  actor: ReceiptControlActor,
  rows: RequestRow[],
  deps: Pick<StoreDeps, "db" | "labels" | "bookingRefs">,
): Promise<ReceiptControlRequestDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [decisions, alerts, labels, refs] = await Promise.all([
    deps.db.decisions(actor.tenantId, ids),
    deps.db.alerts(actor.tenantId, ids),
    deps.labels(
      actor.tenantId,
      rows.flatMap((r) => [r.requestedBy, r.decidedBy ?? ""]).filter(Boolean),
    ),
    deps.bookingRefs(actor.tenantId, Array.from(new Set(rows.map((r) => r.reservationId)))),
  ]);
  const owner = actor.role === "owner";
  return rows.map((r) => {
    const latestAlert = alerts
      .filter((a) => a.requestId === r.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return {
      id: r.id,
      reservationId: r.reservationId,
      bookingReference: refs.get(r.reservationId) ?? "",
      depositId: r.depositId,
      reason: r.reason,
      requestedByLabel: labels.get(r.requestedBy) ?? null,
      requestedAt: r.requestedAt,
      state: r.state,
      version: r.version,
      original: r.original,
      proposal: r.proposal,
      comparison: r.comparison,
      executionMode: r.executionMode,
      decidedByLabel: r.decidedBy ? (labels.get(r.decidedBy) ?? null) : null,
      decidedAt: r.decidedAt,
      selfApproved: decisions.some(
        (d) => d.requestId === r.id && d.decision === "approve" && d.selfApproved,
      ),
      canApprove: owner && r.state === "pending",
      canReject: owner && (r.state === "pending" || r.state === "needs_review"),
      canVerify:
        owner &&
        (r.state === "approved_awaiting_n3" ||
          (r.state === "needs_review" && r.approvedAt !== null)),
      // Applying only persists when a verification was interrupted (Verify is atomic).
      canRecover: owner && r.state === "applying" && r.approvedAt !== null,
      outcomeMessage: r.outcomeCode ? (OUTCOME_MESSAGE[r.outcomeCode] ?? null) : null,
      alert: latestAlert
        ? {
            status: latestAlert.status === "sending" ? "pending" : latestAlert.status,
            lastError: latestAlert.lastErrorCode,
          }
        : null,
    };
  });
}
