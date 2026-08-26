// Server-only reservation-operation decision engine.
//
// This is the ONE place that approves/rejects an operation request. It is
// used by:
//   - the Owner decision route (Owner approval mode), and
//   - the direct-action path (SME mode), where the property has chosen to let
//     the front desk carry out exceptions without a second pair of eyes.
//
// Both callers run IDENTICAL validation: readiness gates fail closed, the
// vacated-room handoff is recorded durably before the move, and nothing is
// trusted from the browser. Authorization is the CALLER's responsibility and
// is always performed before this function is reached.
import { logAudit } from "@/lib/audit.server";
import { isUuid } from "@/lib/reservations-store.server";
import {
  decideOperation,
  destinationBlockerCode,
  housekeepingCheckInBlocker,
  OperationError,
  OPERATION_ERROR_CODES,
  readOperationRequestForHandoffOutcome,
  resolveReservationRoomHotelRoomId,
  applyDirectOperation,
  type OperationPayload,
  type OperationType,
} from "@/lib/reservation-operations.server";
import {
  applyRoomHandoff,
  cancelRoomHandoff,
  enqueueRoomHandoff,
  reconcilePendingHandoffs,
  roomReadinessBlocker,
} from "@/lib/housekeeping-store.server";

export type DecisionOutcome =
  | {
      ok: true;
      result: { requestId: string; state: string };
      housekeepingHandoff: { applied: boolean; pending: boolean } | null;
    }
  | { ok: false; status: number; code: string };

/**
 * Approve or reject one operation request, with every WP1 guest-safety rule
 * applied in the same order regardless of which caller invoked it.
 */
export async function executeOperationDecision(input: {
  tenantId: string;
  actorN3UserKey: string;
  reservationId: string;
  requestId: string;
  decision: "approve" | "reject";
  note: string | null;
  clientRequestId: string;
  /** Injected so this module stays free of HTTP concerns. */
  statusForOperationError: (code: string) => number;
}): Promise<DecisionOutcome> {
  const {
    tenantId,
    reservationId: id,
    requestId,
    decision: verdict,
    note,
    statusForOperationError,
  } = input;
  const actor = input.actorN3UserKey;

  let handoffReservationRoomId: string | null = null;
  let roomBeingVacated: string | null = null;
  let handoffId: string | null = null;

  if (verdict === "approve") {
    const detail = await readOperationRequestForHandoffOutcome(tenantId, requestId);
    if (detail.status === "error") {
      await logAudit({
        tenantId,
        n3UserKey: actor,
        eventType: "hotel.reservation.operation_read_failed",
        detail: { reservationId: id, requestId },
      });
      return { ok: false, status: 503, code: "operation_read_failed" };
    }
    if (detail.status === "missing") {
      return { ok: false, status: 404, code: "operation_not_found" };
    }
    const req = detail.value;

    // ---- Readiness gate (fails CLOSED) --------------------------------
    if (req.state === "pending") {
      let blocker: string | null = null;
      try {
        if (req.operationType === "early_check_in") {
          blocker = await housekeepingCheckInBlocker(tenantId, id);
        } else if (req.operationType === "room_change") {
          const dest = req.payload["to_hotel_room_id"] ?? req.payload["toHotelRoomId"];
          if (typeof dest !== "string" || !isUuid(dest)) {
            return { ok: false, status: 400, code: "validation_failed" };
          }
          blocker = await roomReadinessBlocker(tenantId, [dest]);
          if (blocker) blocker = destinationBlockerCode(blocker);
        }
      } catch {
        await logAudit({
          tenantId,
          n3UserKey: actor,
          eventType: "hotel.housekeeping.readiness_read_failed",
          detail: { reservationId: id, requestId, operationType: req.operationType },
        });
        return { ok: false, status: 503, code: "readiness_read_failed" };
      }
      if (blocker) {
        await logAudit({
          tenantId,
          n3UserKey: actor,
          eventType: "hotel.housekeeping.destination_not_ready",
          detail: { reservationId: id, requestId, operationType: req.operationType, code: blocker },
        });
        return { ok: false, status: statusForOperationError(blocker), code: blocker };
      }
    }

    // ---- Durable handoff intent (FAILS CLOSED) -------------------------
    if (req.operationType === "room_change" && req.state === "pending") {
      const rrid = req.payload["reservation_room_id"] ?? req.payload["reservationRoomId"];
      if (typeof rrid !== "string" || !isUuid(rrid)) {
        return { ok: false, status: 400, code: "validation_failed" };
      }
      handoffReservationRoomId = rrid;
      const oldRoom = await resolveReservationRoomHotelRoomId(tenantId, rrid);
      if (oldRoom.status === "error") {
        await logAudit({
          tenantId,
          n3UserKey: actor,
          eventType: "hotel.housekeeping.handoff_precheck_failed",
          detail: { reservationId: id, requestId, code: "reservation_room_unreadable" },
        });
        return { ok: false, status: 503, code: "handoff_precheck_failed" };
      }
      if (oldRoom.status === "missing" || oldRoom.value === null) {
        await logAudit({
          tenantId,
          n3UserKey: actor,
          eventType: "hotel.housekeeping.handoff_precheck_failed",
          detail: { reservationId: id, requestId, code: "reservation_room_unresolved" },
        });
        return { ok: false, status: 409, code: "reservation_room_unresolved" };
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
        return { ok: false, status: 503, code: "handoff_not_recorded" };
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
      idempotencyKey: input.clientRequestId,
    });
  } catch (err) {
    const code =
      err instanceof OperationError && OPERATION_ERROR_CODES.has(err.code)
        ? err.code
        : "operation_decision_failed";
    await logAudit({
      tenantId,
      n3UserKey: actor,
      eventType: "hotel.reservation.operation_decision_failed",
      detail: { reservationId: id, requestId, code, handoffPending: handoffId !== null },
    });
    return { ok: false, status: statusForOperationError(code), code };
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
    const positivelyApplied = result.state === "applied";
    const positivelyNotApplied = result.state === "rejected" || result.state === "cancelled";
    const post = positivelyNotApplied
      ? null
      : await resolveReservationRoomHotelRoomId(tenantId, handoffReservationRoomId);
    const movedAway =
      post !== null &&
      post.status === "ok" &&
      post.value !== null &&
      post.value !== roomBeingVacated;

    if (positivelyApplied && movedAway) {
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
      await cancelRoomHandoff(tenantId, handoffId);
    } else if (handoffId) {
      handoff = { applied: false, pending: true };
      await logAudit({
        tenantId,
        n3UserKey: actor,
        eventType: "hotel.housekeeping.vacate_pending",
        detail: { roomId: roomBeingVacated, reservationId: id, source: "room_change" },
      });
    }
  }

  if (handoff?.pending) await reconcilePendingHandoffs(tenantId);

  return { ok: true, result, housekeepingHandoff: handoff };
}

/**
 * Effective authority for an exception.
 *
 * An Owner never queues an action for themself, so an Owner is always direct.
 * Front Desk is direct only when the property has chosen `direct` mode. This
 * is computed from the SERVER session role and the SERVER setting — never
 * from anything the browser sends.
 */
export function effectiveDirectExecution(
  role: string | null,
  mode: "direct" | "owner_approval",
): boolean {
  return role === "owner" || mode === "direct";
}

export type DirectOutcome =
  | {
      ok: true;
      result: { requestId: string; state: string };
      housekeepingHandoff: { applied: boolean; pending: boolean } | null;
    }
  | { ok: false; status: number; code: string };

/**
 * Carry out one exception immediately, atomically.
 *
 * EVERYTHING guest-safety relevant happens inside ONE PostgreSQL transaction
 * (`hotelhub_direct_operation_v2`): idempotent request lookup/create, locked
 * housekeeping readiness / Do Not Disturb / pending-handover checks,
 * resolution of the room actually being vacated, the durable handover
 * correlated to the NEW request id, and the existing approve/apply engine.
 *
 * No handover row is ever created from here BEFORE that transaction: a replay
 * would otherwise resolve the already-moved destination as the "old" room and
 * queue a second, uncorrelated handover that blocks housekeeping forever.
 * After a committed transaction this function only APPLIES the handover the
 * database itself returned, and a transport-uncertain response is safe because
 * a committed handover is correlated to the operation request and the
 * reconciler can prove or abandon it, while a rolled-back transaction left
 * nothing behind at all.
 */
export async function executeDirectOperation(input: {
  tenantId: string;
  actorN3UserKey: string;
  reservationId: string;
  operationType: OperationType;
  payload: OperationPayload;
  idempotencyKey: string;
  statusForOperationError: (code: string) => number;
}): Promise<DirectOutcome> {
  const { tenantId, reservationId: id, operationType, payload, statusForOperationError } = input;
  const actor = input.actorN3UserKey;

  // Shape-only validation. Every readiness/authority decision belongs to the
  // database routine below, never to this process.
  if (operationType === "room_change") {
    const dest = payload["to_hotel_room_id"] ?? payload["toHotelRoomId"];
    const rrid = payload["reservation_room_id"] ?? payload["reservationRoomId"];
    if (typeof dest !== "string" || !isUuid(dest)) {
      return { ok: false, status: 400, code: "validation_failed" };
    }
    if (typeof rrid !== "string" || !isUuid(rrid)) {
      return { ok: false, status: 400, code: "validation_failed" };
    }
  }

  // ---- ONE transaction: request + readiness + handoff + apply -----------
  let result: {
    requestId: string;
    state: string;
    handoffId: string | null;
    oldRoomId: string | null;
  };
  try {
    result = await applyDirectOperation({
      tenantId,
      reservationId: id,
      actorN3UserKey: actor,
      operationType,
      payload,
      idempotencyKey: input.idempotencyKey,
    });
  } catch (err) {
    const known = err instanceof OperationError && OPERATION_ERROR_CODES.has(err.code);
    const code = known ? (err as OperationError).code : "operation_request_failed";
    await logAudit({
      tenantId,
      n3UserKey: actor,
      eventType: "hotel.reservation.operation_request_failed",
      detail: { reservationId: id, operationType, code, direct: true },
    });
    return { ok: false, status: statusForOperationError(code), code };
  }

  await logAudit({
    tenantId,
    n3UserKey: actor,
    eventType: "hotel.reservation.operation_direct",
    detail: { reservationId: id, operationType, state: result.state },
  });

  // ---- Reconcile the handover the DATABASE recorded ---------------------
  let handoff: { applied: boolean; pending: boolean } | null = null;
  const roomBeingVacated = result.oldRoomId;
  if (roomBeingVacated && result.state === "applied") {
    const applied = await applyRoomHandoff({
      tenantId,
      roomId: roomBeingVacated,
      actorN3UserKey: actor,
      source: "room_change",
      handoffId: result.handoffId,
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
  }

  if (handoff?.pending) await reconcilePendingHandoffs(tenantId);

  return {
    ok: true,
    result: { requestId: result.requestId, state: result.state },
    housekeepingHandoff: handoff,
  };
}
