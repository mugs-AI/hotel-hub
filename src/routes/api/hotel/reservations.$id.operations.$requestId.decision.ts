// POST /api/hotel/reservations/:id/operations/:requestId/decision — Owner only.
// Approves or rejects a pending reservation-operation request. Never touches
// N3 or deposit records.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import { isUuid } from "@/lib/reservations-store.server";
import {
  decideOperation,
  getOperationRequestReservationId,
  getReservationRoomHotelRoomId,
  OperationError,
  OPERATION_ERROR_CODES,
  readOperationRequestForHandoff,
} from "@/lib/reservation-operations.server";
import { vacateRoomSafely } from "@/lib/housekeeping-store.server";
import {
  deny,
  isSameOriginWrite,
  readJsonBody,
  rejectUnknown,
  statusForOperationError,
} from "@/lib/operations-api.server";

const ALLOWED = new Set(["decision", "note", "clientRequestId"]);

export async function handleOperationDecision({
  request,
  params,
}: {
  request: Request;
  params: { id?: string; requestId?: string };
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "forbidden");
  const { ctx, decision: authz } = await requirePermission("hotel:operations:approve");
  if (!authz.ok) {
    return deny(authz.reason === "unauthenticated" ? 401 : 403, authz.reason);
  }
  const id = params.id ?? "";
  const requestId = params.requestId ?? "";
  if (!isUuid(id) || !isUuid(requestId)) return deny(400, "invalid_id");

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return deny(statusForOperationError(parsed.code), parsed.code);
  const unknown = rejectUnknown(parsed.body, ALLOWED);
  if (unknown !== null) return deny(400, "unknown_field");

  const verdict = parsed.body.decision;
  if (verdict !== "approve" && verdict !== "reject") return deny(400, "validation_failed");
  const clientRequestId = parsed.body.clientRequestId;
  if (!isUuid(clientRequestId)) return deny(400, "validation_failed");
  const rawNote = parsed.body.note;
  if (rawNote !== undefined && rawNote !== null && typeof rawNote !== "string") {
    return deny(400, "validation_failed");
  }
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 300) || null : null;

  // Bind the request to the reservation in the URL. Without this the audit
  // trail could name a reservation the request does not belong to.
  let boundReservationId: string | null;
  try {
    boundReservationId = await getOperationRequestReservationId(ctx.session.tenantId!, requestId);
  } catch {
    return deny(500, "operation_decision_failed");
  }
  if (boundReservationId === null) return deny(404, "operation_not_found");
  if (boundReservationId !== id) return deny(404, "operation_not_found");

  // WP1 vacated-room handoff. Capture the room the guest is LEAVING before
  // the approval moves them, otherwise the old room is unrecoverable and
  // silently stays "Ready" while it is actually dirty.
  let handoffReservationRoomId: string | null = null;
  let roomBeingVacated: string | null = null;
  if (verdict === "approve") {
    const req = await readOperationRequestForHandoff(ctx.session.tenantId!, requestId);
    if (req && req.operationType === "room_change" && req.state === "pending") {
      const rrid = req.payload["reservation_room_id"] ?? req.payload["reservationRoomId"];
      if (typeof rrid === "string") {
        handoffReservationRoomId = rrid;
        roomBeingVacated = await getReservationRoomHotelRoomId(ctx.session.tenantId!, rrid);
      }
    }
  }

  try {
    const result = await decideOperation({
      tenantId: ctx.session.tenantId!,
      requestId,
      actorN3UserKey: ctx.session.n3UserKey,
      decision: verdict,
      note,
      idempotencyKey: clientRequestId as string,
    });
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType:
        verdict === "approve"
          ? "hotel.reservation.operation_applied"
          : "hotel.reservation.operation_rejected",
      detail: { reservationId: id, requestId, state: result.state },
    });

    if (roomBeingVacated && handoffReservationRoomId) {
      const newRoomId = await getReservationRoomHotelRoomId(
        ctx.session.tenantId!,
        handoffReservationRoomId,
      );
      // Only hand off when the guest genuinely moved to a different room.
      if (newRoomId && newRoomId !== roomBeingVacated) {
        const handoff = await vacateRoomSafely({
          tenantId: ctx.session.tenantId!,
          roomId: roomBeingVacated,
          actorN3UserKey: ctx.session.n3UserKey,
          source: "room_change",
        });
        if (handoff.applied) {
          await logAudit({
            tenantId: ctx.session.tenantId,
            n3UserKey: ctx.session.n3UserKey,
            eventType: "hotel.housekeeping.vacated",
            detail: { roomId: roomBeingVacated, reservationId: id, source: "room_change" },
          });
        }
      }
    }

    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const code =
      err instanceof OperationError && OPERATION_ERROR_CODES.has(err.code)
        ? err.code
        : "operation_decision_failed";
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.reservation.operation_decision_failed",
      detail: { reservationId: id, requestId, code },
    });
    return deny(statusForOperationError(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/operations/$requestId/decision")({
  server: { handlers: { POST: handleOperationDecision } },
});
