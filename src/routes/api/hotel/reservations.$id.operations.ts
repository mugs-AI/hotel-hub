// GET  /api/hotel/reservations/:id/operations — Owner + Front Desk ledger.
// POST /api/hotel/reservations/:id/operations — Owner + Front Desk raise a
//   request needing Owner approval. Never touches N3 or deposits.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import { getReservationById, isUuid } from "@/lib/reservations-store.server";
import { getOrCreateHotelSettings } from "@/lib/hotel-store.server";
import { effectiveDirectExecution, executeDirectOperation } from "@/lib/operation-decision.server";
import {
  isOperationType,
  listOperationRequests,
  OperationError,
  OPERATION_ERROR_CODES,
  requestOperation,
  validateLateCheckoutWindow,
  validateOperationPayload,
} from "@/lib/reservation-operations.server";
import {
  deny,
  isSameOriginWrite,
  readJsonBody,
  rejectUnknown,
  statusForOperationError,
} from "@/lib/operations-api.server";

const ALLOWED = new Set(["operationType", "payload", "clientRequestId"]);

export async function handleOperationsList({
  params,
}: {
  params: { id?: string };
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:operations:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!isUuid(id)) return deny(400, "invalid_id");
  try {
    const requests = await listOperationRequests(ctx.session.tenantId!, id);
    return Response.json({ requests }, { headers: { "cache-control": "no-store" } });
  } catch {
    return deny(500, "operation_read_failed");
  }
}

export async function handleOperationCreate({
  request,
  params,
}: {
  request: Request;
  params: { id?: string };
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "forbidden");
  const { ctx, decision } = await requirePermission("hotel:operations:request");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!isUuid(id)) return deny(400, "invalid_id");

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return deny(statusForOperationError(parsed.code), parsed.code);
  const unknown = rejectUnknown(parsed.body, ALLOWED);
  if (unknown !== null) return deny(400, "unknown_field");

  const type = parsed.body.operationType;
  if (!isOperationType(type)) return deny(400, "validation_failed");
  const clientRequestId = parsed.body.clientRequestId;
  if (!isUuid(clientRequestId)) return deny(400, "validation_failed");
  const payload = validateOperationPayload(type, parsed.body.payload);
  if (!payload.ok) return deny(statusForOperationError(payload.code), payload.code);

  // Late checkout is bounded by the property's own departure date and
  // standard checkout time, evaluated in the property's timezone. The browser
  // sends a property-local wall clock; the server resolves the instant.
  if (type === "late_checkout") {
    let reservation, settings;
    try {
      [reservation, settings] = await Promise.all([
        getReservationById(ctx.session.tenantId!, id),
        getOrCreateHotelSettings(ctx.session.tenantId!),
      ]);
    } catch {
      return deny(500, "operation_request_failed");
    }
    if (!reservation) return deny(404, "reservation_not_found");
    const window = validateLateCheckoutWindow({
      expectedCheckOutLocal: String(payload.payload.expected_check_out_local ?? ""),
      departureDate: reservation.departureDate,
      standardCheckOutTime: settings.standardCheckOutTime,
      timezone: settings.timezone,
    });
    if (!window.ok) return deny(statusForOperationError(window.code), window.code);
    delete payload.payload.expected_check_out_local;
    payload.payload.expected_check_out_at = window.utcIso;
  }

  // Effective authority is decided by the SERVER: an Owner never queues an
  // exception for themself, and Front Desk goes direct only when the property
  // has chosen direct mode. Nothing here trusts a browser-supplied role,
  // tenant, actor or mode.
  let approvalMode: "owner_approval" | "direct" = "owner_approval";
  try {
    approvalMode = (await getOrCreateHotelSettings(ctx.session.tenantId!)).exceptionApprovalMode;
  } catch {
    approvalMode = "owner_approval";
  }
  const direct = effectiveDirectExecution(ctx.role, approvalMode);

  if (direct) {
    // Atomic: request + apply in ONE transaction, identical fail-closed
    // readiness gates and durable vacated-room handoff.
    const outcome = await executeDirectOperation({
      tenantId: ctx.session.tenantId!,
      actorN3UserKey: ctx.session.n3UserKey,
      reservationId: id,
      operationType: type,
      payload: payload.payload,
      idempotencyKey: clientRequestId as string,
      statusForOperationError,
    });
    if (!outcome.ok) return deny(outcome.status, outcome.code);
    return Response.json(
      { ...outcome.result, direct: true, outcome: "applied" },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await requestOperation({
      tenantId: ctx.session.tenantId!,
      reservationId: id,
      actorN3UserKey: ctx.session.n3UserKey,
      operationType: type,
      payload: payload.payload,
      idempotencyKey: clientRequestId as string,
    });
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.reservation.operation_requested",
      detail: { reservationId: id, operationType: type, state: result.state },
    });
    return Response.json(
      { ...result, direct: false, outcome: "submitted" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const code =
      err instanceof OperationError && OPERATION_ERROR_CODES.has(err.code)
        ? err.code
        : "operation_request_failed";
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.reservation.operation_request_failed",
      detail: { reservationId: id, operationType: type, code },
    });
    return deny(statusForOperationError(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/operations")({
  server: { handlers: { GET: handleOperationsList, POST: handleOperationCreate } },
});
