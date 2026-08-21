// POST /api/hotel/reservations/:id/operations/:requestId/decision — Owner only.
// Approves or rejects a pending reservation-operation request. Never touches
// N3 or deposit records.
//
// P1 correction. Two guest-safety rules are enforced here, before anything is
// applied:
//   1. Readiness — an early check-in or a room change may only be approved
//      into a room that is set up, Ready, and not under Do Not Disturb.
//   2. Handoff — the room the guest LEAVES is recorded as a durable pending
//      handoff before approval, applied atomically after it, and retried until
//      it lands. It is never silently swallowed.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import { isUuid } from "@/lib/reservations-store.server";
import {
  decideOperation,
  destinationBlockerCode,
  getOperationRequestReservationId,
  housekeepingCheckInBlocker,
  OperationError,
  OPERATION_ERROR_CODES,
  readOperationRequestForHandoffOutcome,
  resolveReservationRoomHotelRoomId,
} from "@/lib/reservation-operations.server";
import {
  applyRoomHandoff,
  cancelRoomHandoff,
  enqueueRoomHandoff,
  reconcilePendingHandoffs,
  roomReadinessBlocker,
} from "@/lib/housekeeping-store.server";
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

  const tenantId = ctx.session.tenantId!;
  const actor = ctx.session.n3UserKey;

  // Bind the request to the reservation in the URL. Without this the audit
  // trail could name a reservation the request does not belong to.
  let boundReservationId: string | null;
  try {
    boundReservationId = await getOperationRequestReservationId(tenantId, requestId);
  } catch {
    return deny(500, "operation_decision_failed");
  }
  if (boundReservationId === null) return deny(404, "operation_not_found");
  if (boundReservationId !== id) return deny(404, "operation_not_found");

  // WP1 vacated-room handoff + readiness. Capture the room the guest is
  // LEAVING before the approval moves them, otherwise the old room is
  // unrecoverable and silently stays "Ready" while it is actually dirty.
  let handoffReservationRoomId: string | null = null;
  let roomBeingVacated: string | null = null;
  let handoffId: string | null = null;

  if (verdict === "approve") {
    // Correction 5 — this read is guest-safety critical: it decides whether
    // the readiness gate and the durable handoff run at all. If it cannot be
    // read, or the operation has vanished after binding, we fail CLOSED and
    // never reach decideOperation. Nothing from the browser is trusted here.
    const detail = await readOperationRequestForHandoffOutcome(tenantId, requestId);
    if (detail.status === "error") {
      await logAudit({
        tenantId,
        n3UserKey: actor,
        eventType: "hotel.reservation.operation_read_failed",
        detail: { reservationId: id, requestId },
      });
      return deny(503, "operation_read_failed");
    }
    if (detail.status === "missing") return deny(404, "operation_not_found");
    const req = detail.value;

    // ---- Readiness gate (fails CLOSED) --------------------------------
    if (req.state === "pending") {
      let blocker: string | null = null;
      if (req.operationType === "early_check_in") {
        // The guest is coming in NOW: every allocated room must be verified.
        blocker = await housekeepingCheckInBlocker(tenantId, id);
      } else if (req.operationType === "room_change") {
        const dest = req.payload["to_hotel_room_id"] ?? req.payload["toHotelRoomId"];
        if (typeof dest !== "string" || !isUuid(dest)) return deny(400, "validation_failed");
        blocker = await roomReadinessBlocker(tenantId, [dest]);
        if (blocker) blocker = destinationBlockerCode(blocker);
      }
      if (blocker) {
        await logAudit({
          tenantId,
          n3UserKey: actor,
          eventType: "hotel.housekeeping.destination_not_ready",
          detail: { reservationId: id, requestId, operationType: req.operationType, code: blocker },
        });
        return deny(statusForOperationError(blocker), blocker);
      }
    }

    // ---- Durable handoff intent (FAILS CLOSED) -------------------------
    // The room the guest leaves must have a recoverable "make this dirty"
    // record BEFORE the move is applied. If the old room cannot be positively
    // resolved, or the record cannot be written, the move does not happen at
    // all — a bed that looks clean and is not is exactly what WP1 prevents.
    if (req.operationType === "room_change" && req.state === "pending") {
      const rrid = req.payload["reservation_room_id"] ?? req.payload["reservationRoomId"];
      if (typeof rrid !== "string" || !isUuid(rrid)) return deny(400, "validation_failed");
      handoffReservationRoomId = rrid;
      const oldRoom = await resolveReservationRoomHotelRoomId(tenantId, rrid);
      if (oldRoom.status === "error") {
        await logAudit({
          tenantId,
          n3UserKey: actor,
          eventType: "hotel.housekeeping.handoff_precheck_failed",
          detail: { reservationId: id, requestId, code: "reservation_room_unreadable" },
        });
        return deny(503, "handoff_precheck_failed");
      }
      if (oldRoom.status === "missing" || oldRoom.value === null) {
        await logAudit({
          tenantId,
          n3UserKey: actor,
          eventType: "hotel.housekeeping.handoff_precheck_failed",
          detail: { reservationId: id, requestId, code: "reservation_room_unresolved" },
        });
        return deny(409, "reservation_room_unresolved");
      }
      roomBeingVacated = oldRoom.value;
      try {
        handoffId = await enqueueRoomHandoff({
          tenantId,
          roomId: roomBeingVacated,
          actorN3UserKey: actor,
          reservationId: id,
          operationRequestId: requestId,
          source: "room_change",
        });
      } catch {
        handoffId = null;
      }
      if (!handoffId) {
        await logAudit({
          tenantId,
          n3UserKey: actor,
          eventType: "hotel.housekeeping.handoff_not_recorded",
          detail: { reservationId: id, requestId, roomId: roomBeingVacated },
        });
        return deny(503, "handoff_not_recorded");
      }
    }
  }

  let result: { requestId: string; state: string };
  try {
    result = await decideOperation({
      tenantId,
      requestId,
      actorN3UserKey: actor,
      decision: verdict,
      note,
      idempotencyKey: clientRequestId as string,
    });
  } catch (err) {
    // The room change did not happen: withdraw the recorded handoff intent so
    // no room is later marked dirty for a move that never occurred.
    if (handoffId) await cancelRoomHandoff(tenantId, handoffId);
    const code =
      err instanceof OperationError && OPERATION_ERROR_CODES.has(err.code)
        ? err.code
        : "operation_decision_failed";
    await logAudit({
      tenantId,
      n3UserKey: actor,
      eventType: "hotel.reservation.operation_decision_failed",
      detail: { reservationId: id, requestId, code },
    });
    return deny(statusForOperationError(code), code);
  }

  await logAudit({
    tenantId,
    n3UserKey: actor,
    eventType:
      verdict === "approve"
        ? "hotel.reservation.operation_applied"
        : "hotel.reservation.operation_rejected",
    detail: { reservationId: id, requestId, state: result.state },
  });

  let handoff: { applied: boolean; pending: boolean } | null = null;
  if (roomBeingVacated && handoffReservationRoomId) {
    // Correction 5 — uncertainty must never destroy the only retry record.
    // The handoff is cancelled ONLY when the decision positively did not
    // apply. An unreadable or missing post-decision read leaves the durable
    // intent pending for reconciliation, which re-proves it from scratch.
    const post = await resolveReservationRoomHotelRoomId(tenantId, handoffReservationRoomId);
    const movedAway = post.status === "ok" && post.value !== null && post.value !== roomBeingVacated;
    const positivelyNotApplied = result.state === "rejected" || result.state === "cancelled";

    if (movedAway) {
      const applied = await applyRoomHandoff({
        tenantId,
        roomId: roomBeingVacated,
        actorN3UserKey: actor,
        source: "room_change",
        handoffId,
      });
      handoff = { applied: applied.applied, pending: applied.pending };
      await logAudit({
        tenantId,
        n3UserKey: actor,
        eventType: applied.applied
          ? "hotel.housekeeping.vacated"
          : "hotel.housekeeping.vacate_pending",
        detail: { roomId: roomBeingVacated, reservationId: id, source: "room_change" },
      });
    } else if (positivelyNotApplied && handoffId) {
      // The guest demonstrably did not change room — safe, idempotent withdrawal.
      await cancelRoomHandoff(tenantId, handoffId);
    } else if (handoffId) {
      // Applied, or simply not knowable right now: keep the pending intent.
      handoff = { applied: false, pending: true };
      await logAudit({
        tenantId,
        n3UserKey: actor,
        eventType: "hotel.housekeeping.vacate_pending",
        detail: { roomId: roomBeingVacated, reservationId: id, source: "room_change" },
      });
    }
  }

  // Retry anything still outstanding (including this one on failure) so the
  // board self-heals rather than reporting a stale "Ready".
  if (handoff?.pending) await reconcilePendingHandoffs(tenantId);

  return Response.json(
    { ...result, ...(handoff ? { housekeepingHandoff: handoff } : {}) },
    { headers: { "cache-control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/hotel/reservations/$id/operations/$requestId/decision")({
  server: { handlers: { POST: handleOperationDecision } },
});
