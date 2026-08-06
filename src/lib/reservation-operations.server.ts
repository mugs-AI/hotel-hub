/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only reservation operations store (HotelHub Run 5D2).
//
// Scope boundary: reservation operations ONLY. Nothing in this module posts
// to N3, touches money, or performs checkout accounting. Deposit behaviour
// from Run 5D1.1.1 is untouched.
//
// Every call runs under the service-role client and requires an explicit
// tenantId supplied by the trusted server context (never from the browser).

import { isIsoDate, isUuid } from "./reservations-store.server";
import { resolveActorLabels } from "./tenant-store.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export const OPERATION_TYPES = [
  "early_check_in",
  "late_checkout",
  "room_change",
  "stay_extension",
  "rate_change",
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export function isOperationType(v: unknown): v is OperationType {
  return typeof v === "string" && (OPERATION_TYPES as readonly string[]).includes(v);
}

export const OPERATION_STATES = [
  "pending",
  "approved",
  "rejected",
  "applied",
  "cancelled",
] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

/** Stable, non-leaking error codes surfaced to the browser. */
export const OPERATION_ERROR_CODES = new Set([
  "unauthorized",
  "reservation_not_found",
  "operation_not_found",
  "invalid_transition",
  "reservation_changed",
  "early_check_in_required",
  "operation_pending",
  "operation_stale",
  "room_unavailable",
  "room_capacity_exceeded",
  "room_not_found",
  "guest_not_found",
  "validation_failed",
  "operation_immutable_field",
  "unknown_field",
  "late_checkout_out_of_range",
  "late_checkout_not_later",
]);

export class OperationError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "OperationError";
  }
}

function mapRpcError(message: string | null | undefined, fallback: string): OperationError {
  const msg = (message ?? "").toString();
  const hit = msg.match(/[a-z_]+/g)?.find((w) => OPERATION_ERROR_CODES.has(w));
  return new OperationError(hit ?? fallback);
}

// ---------------------------------------------------------------------------
// Payload validation (pure — unit tested)
// ---------------------------------------------------------------------------

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** Property-local wall-clock datetime — deliberately offset-free. */
const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
void ISO_DATETIME_RE;

export type OperationPayload = Record<string, unknown>;
export type PayloadResult =
  | { ok: true; payload: OperationPayload }
  | { ok: false; code: string };

const PAYLOAD_FIELDS: Record<OperationType, ReadonlySet<string>> = {
  early_check_in: new Set(["reason"]),
  late_checkout: new Set(["expectedCheckOutLocal", "reason"]),

  room_change: new Set(["reservationRoomId", "toHotelRoomId", "preserveRate", "reason"]),
  stay_extension: new Set(["newDepartureDate", "reason"]),
  rate_change: new Set(["reservationRoomId", "newAgreedRate", "reason"]),
};

/**
 * Validate and normalise an operation request payload. Unknown keys are
 * REJECTED (never silently dropped), so the browser can neither smuggle
 * fields into the ledger nor believe a mistyped field was honoured.
 */
export function validateOperationPayload(
  type: OperationType,
  raw: unknown,
): PayloadResult {
  if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) {
    return { ok: false, code: "validation_failed" };
  }
  const body: Record<string, unknown> = (raw as Record<string, unknown>) ?? {};
  const allowed = PAYLOAD_FIELDS[type];
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) return { ok: false, code: "unknown_field" };
  }

  if (type === "early_check_in") {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > 300) return { ok: false, code: "validation_failed" };
    return { ok: true, payload: reason ? { reason } : {} };
  }

  if (type === "late_checkout") {
    // Property-local contract: the browser must never guess a numeric UTC
    // offset. The route resolves this in the configured IANA timezone.
    const at = body.expectedCheckOutLocal;
    if (typeof at !== "string" || !LOCAL_DATETIME_RE.test(at)) {
      return { ok: false, code: "validation_failed" };
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > 300) return { ok: false, code: "validation_failed" };
    return {
      ok: true,
      payload: { expected_check_out_local: at, ...(reason ? { reason } : {}) },
    };
  }


  if (type === "room_change") {
    if (!isUuid(body.reservationRoomId) || !isUuid(body.toHotelRoomId)) {
      return { ok: false, code: "validation_failed" };
    }
    if (body.preserveRate !== undefined && typeof body.preserveRate !== "boolean") {
      return { ok: false, code: "validation_failed" };
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > 300) return { ok: false, code: "validation_failed" };
    return {
      ok: true,
      payload: {
        reservation_room_id: body.reservationRoomId,
        to_hotel_room_id: body.toHotelRoomId,
        preserve_rate: body.preserveRate === undefined ? true : body.preserveRate,
        ...(reason ? { reason } : {}),
      },
    };
  }

  if (type === "stay_extension") {
    if (!isIsoDate(body.newDepartureDate)) return { ok: false, code: "validation_failed" };
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > 300) return { ok: false, code: "validation_failed" };
    return {
      ok: true,
      payload: { new_departure_date: body.newDepartureDate, ...(reason ? { reason } : {}) },
    };
  }

  // rate_change
  if (!isUuid(body.reservationRoomId)) return { ok: false, code: "validation_failed" };
  const rate = body.newAgreedRate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
    return { ok: false, code: "validation_failed" };
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return { ok: false, code: "validation_failed" };
  if (reason.length > 300) return { ok: false, code: "validation_failed" };
  return {
    ok: true,
    payload: {
      reservation_room_id: body.reservationRoomId,
      new_agreed_rate: Math.round(rate * 100) / 100,
      reason,
    },
  };
}

/**
 * A requested late checkout must land on the reservation's departure date in
 * the property's timezone, and must be later than the standard checkout time.
 * Pure and deterministic so it can be unit tested without a request context.
 */
export function validateLateCheckoutWindow(input: {
  expectedCheckOutAtIso: string;
  departureDate: string;
  standardCheckOutTime: string;
  timezone: string;
}): { ok: true } | { ok: false; code: string } {
  const ms = Date.parse(input.expectedCheckOutAtIso);
  if (!Number.isFinite(ms)) return { ok: false, code: "validation_failed" };
  let local: string;
  try {
    local = new Intl.DateTimeFormat("en-CA", {
      timeZone: input.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return { ok: false, code: "validation_failed" };
  }
  // en-CA renders as "YYYY-MM-DD, HH:MM"
  const [datePart, timePart] = local.split(", ");
  if (!datePart || !timePart) return { ok: false, code: "validation_failed" };
  if (datePart !== input.departureDate) return { ok: false, code: "late_checkout_out_of_range" };
  const normalized = timePart === "24:00" ? "00:00" : timePart;
  if (normalized <= input.standardCheckOutTime) {
    return { ok: false, code: "late_checkout_not_later" };
  }
  return { ok: true };
}

/** Minimal, tenant-scoped lookup used to bind a request to its reservation. */
export async function getOperationRequestReservationId(
  tenantId: string,
  requestId: string,
): Promise<string | null> {
  const sb = await admin();
  const res = await sb
    .from("hotel_reservation_operation_requests")
    .select("reservation_id")
    .eq("tenant_id", tenantId)
    .eq("id", requestId)
    .maybeSingle();
  if (res.error) throw new OperationError("operation_read_failed");
  return (res.data as { reservation_id: string } | null)?.reservation_id ?? null;
}

/** Operations a front-desk user may perform directly, without approval. */
export const DIRECT_OPERATIONS: ReadonlySet<OperationType> = new Set();

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type OperationRequestDTO = {
  id: string;
  reservationId: string;
  operationType: OperationType;
  state: OperationState;
  /** Sanitised, display-safe summary of the requested change. */
  summary: string;
  requestedByLabel: string | null;
  requestedAt: string;
  decidedByLabel: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedAt: string | null;
};

export type ReservationEventDTO = {
  eventType: string;
  summary: string;
  actorLabel: string | null;
  occurredAt: string;
};

const TYPE_LABELS: Record<OperationType, string> = {
  early_check_in: "Early check-in",
  late_checkout: "Late checkout",
  room_change: "Room change",
  stay_extension: "Stay extension",
  rate_change: "Rate change",
};

export function operationTypeLabel(t: string): string {
  return (TYPE_LABELS as Record<string, string>)[t] ?? t.replace(/_/g, " ");
}

/** Build a short, non-sensitive description of a pending request. */
export function summarizeOperation(type: string, payload: Record<string, unknown>): string {
  const p = payload ?? {};
  switch (type) {
    case "late_checkout":
      return typeof p.expected_check_out_at === "string"
        ? `Requested checkout until ${p.expected_check_out_at}`
        : "Requested a later checkout";
    case "stay_extension":
      return typeof p.new_departure_date === "string"
        ? `Extend departure to ${p.new_departure_date}`
        : "Extend the stay";
    case "room_change":
      return p.preserve_rate === false ? "Move rooms and re-price" : "Move rooms, keep rate";
    case "rate_change":
      return typeof p.new_agreed_rate === "number"
        ? `Change agreed rate to ${p.new_agreed_rate.toFixed(2)}`
        : "Change the agreed rate";
    case "early_check_in":
    default:
      return "Check in before the standard time";
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listOperationRequests(
  tenantId: string,
  reservationId: string,
): Promise<OperationRequestDTO[]> {
  const sb = await admin();
  const res = await sb
    .from("hotel_reservation_operation_requests")
    .select(
      "id, reservation_id, operation_type, state, payload, requested_by_n3_user_key, requested_at, decided_by_n3_user_key, decided_at, decision_note, applied_at",
    )
    .eq("tenant_id", tenantId)
    .eq("reservation_id", reservationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (res.error) throw new OperationError("operation_read_failed");
  const rows = (res.data ?? []) as any[];
  const labels = await resolveActorLabels(
    tenantId,
    rows.flatMap((r) => [r.requested_by_n3_user_key, r.decided_by_n3_user_key]),
  );
  return rows.map((r) => ({
    id: r.id,
    reservationId: r.reservation_id,
    operationType: r.operation_type,
    state: r.state,
    summary: summarizeOperation(r.operation_type, r.payload ?? {}),
    requestedByLabel: labels.get(r.requested_by_n3_user_key) ?? null,
    requestedAt: r.requested_at,
    decidedByLabel: r.decided_by_n3_user_key
      ? (labels.get(r.decided_by_n3_user_key) ?? null)
      : null,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note ?? null,
    appliedAt: r.applied_at ?? null,
  }));
}

export async function listReservationTimeline(
  tenantId: string,
  reservationId: string,
): Promise<ReservationEventDTO[]> {
  const sb = await admin();
  const res = await sb
    .from("hotel_reservation_events")
    .select("id, event_type, summary, actor_n3_user_key, occurred_at")
    .eq("tenant_id", tenantId)
    .eq("reservation_id", reservationId)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (res.error) throw new OperationError("operation_read_failed");
  const rows = (res.data ?? []) as any[];
  const labels = await resolveActorLabels(
    tenantId,
    rows.map((r) => r.actor_n3_user_key),
  );
  return rows.map((r) => ({
    eventType: r.event_type,
    summary: r.summary,
    actorLabel: r.actor_n3_user_key ? (labels.get(r.actor_n3_user_key) ?? null) : null,
    occurredAt: r.occurred_at,
  }));
}

// ---------------------------------------------------------------------------
// Writes (all atomic via SECURITY DEFINER RPCs)
// ---------------------------------------------------------------------------

export async function checkInReservation(input: {
  tenantId: string;
  reservationId: string;
  actorN3UserKey: string;
  expectedUpdatedAt: string | null;
}): Promise<{ status: string; checkedInAt: string | null; updatedAt: string }> {
  const sb = await admin();
  const res = await sb.rpc("hotelhub_check_in_reservation", {
    p_tenant_id: input.tenantId,
    p_reservation_id: input.reservationId,
    p_actor_n3_user_key: input.actorN3UserKey,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_allow_early: false,
    p_operation_request_id: null,
  });
  if (res.error) throw mapRpcError(res.error.message, "check_in_failed");
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) throw new OperationError("check_in_failed");
  return {
    status: row.out_status,
    checkedInAt: row.out_checked_in_at ?? null,
    updatedAt: row.out_updated_at,
  };
}

export async function requestOperation(input: {
  tenantId: string;
  reservationId: string;
  actorN3UserKey: string;
  operationType: OperationType;
  payload: OperationPayload;
  idempotencyKey: string;
}): Promise<{ requestId: string; state: OperationState }> {
  const sb = await admin();
  const res = await sb.rpc("hotelhub_request_operation", {
    p_tenant_id: input.tenantId,
    p_reservation_id: input.reservationId,
    p_actor_n3_user_key: input.actorN3UserKey,
    p_operation_type: input.operationType,
    p_payload: input.payload,
    p_idempotency_key: input.idempotencyKey,
  });
  if (res.error) throw mapRpcError(res.error.message, "operation_request_failed");
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) throw new OperationError("operation_request_failed");
  return { requestId: row.out_request_id, state: row.out_state };
}

export async function decideOperation(input: {
  tenantId: string;
  requestId: string;
  actorN3UserKey: string;
  decision: "approve" | "reject";
  note: string | null;
  idempotencyKey: string;
}): Promise<{ requestId: string; state: OperationState }> {
  const sb = await admin();
  const res = await sb.rpc("hotelhub_decide_operation", {
    p_tenant_id: input.tenantId,
    p_request_id: input.requestId,
    p_actor_n3_user_key: input.actorN3UserKey,
    p_decision: input.decision,
    p_note: input.note,
    p_idempotency_key: input.idempotencyKey,
  });
  if (res.error) throw mapRpcError(res.error.message, "operation_decision_failed");
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) throw new OperationError("operation_decision_failed");
  return { requestId: row.out_request_id, state: row.out_state };
}

export async function assignGuestRooms(input: {
  tenantId: string;
  reservationId: string;
  actorN3UserKey: string;
  assignments: Array<{ reservationGuestId: string; reservationRoomId: string | null }>;
}): Promise<{ updated: number }> {
  const sb = await admin();
  const res = await sb.rpc("hotelhub_assign_guest_rooms", {
    p_tenant_id: input.tenantId,
    p_reservation_id: input.reservationId,
    p_actor_n3_user_key: input.actorN3UserKey,
    p_assignments: input.assignments.map((a) => ({
      reservation_guest_id: a.reservationGuestId,
      reservation_room_id: a.reservationRoomId,
    })),
  });
  if (res.error) throw mapRpcError(res.error.message, "guest_assignment_failed");
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  return { updated: row?.out_updated ?? 0 };
}
