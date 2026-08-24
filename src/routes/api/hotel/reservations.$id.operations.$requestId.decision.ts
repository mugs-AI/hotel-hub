// POST /api/hotel/reservations/:id/operations/:requestId/decision — Owner only.
// Approves or rejects a pending reservation-operation request. Never touches
// N3 or deposit records.
//
// The guest-safety rules (fail-closed readiness gate + durable vacated-room
// handoff) live in `executeOperationDecision`, shared verbatim with the SME
// direct-action path so both routes behave identically.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { isUuid } from "@/lib/reservations-store.server";
import { getOperationRequestReservationId } from "@/lib/reservation-operations.server";
import { executeOperationDecision } from "@/lib/operation-decision.server";
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

  const outcome = await executeOperationDecision({
    tenantId,
    actorN3UserKey: actor,
    reservationId: id,
    requestId,
    decision: verdict,
    note,
    clientRequestId: clientRequestId as string,
    statusForOperationError,
  });
  if (!outcome.ok) return deny(outcome.status, outcome.code);

  return Response.json(
    {
      ...outcome.result,
      ...(outcome.housekeepingHandoff
        ? { housekeepingHandoff: outcome.housekeepingHandoff }
        : {}),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/hotel/reservations/$id/operations/$requestId/decision")({
  server: { handlers: { POST: handleOperationDecision } },
});
