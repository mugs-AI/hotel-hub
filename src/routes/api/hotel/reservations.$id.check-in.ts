// POST /api/hotel/reservations/:id/check-in — Owner + Front Desk.
// Standard check-in only. Early check-in must go through an approved
// operation request. Never touches N3 or deposits.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import { isUuid } from "@/lib/reservations-store.server";
import {
  checkInReservation,
  OperationError,
  OPERATION_ERROR_CODES,
} from "@/lib/reservation-operations.server";
import {
  deny,
  isSameOriginWrite,
  readJsonBody,
  rejectUnknown,
  statusForOperationError,
} from "@/lib/operations-api.server";

const ALLOWED = new Set(["expectedUpdatedAt", "clientRequestId"]);

export async function handleCheckIn({
  request,
  params,
}: {
  request: Request;
  params: { id?: string };
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "forbidden");
  const { ctx, decision } = await requirePermission("hotel:reservations:check_in");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!isUuid(id)) return deny(400, "invalid_id");

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return deny(statusForOperationError(parsed.code), parsed.code);
  const unknown = rejectUnknown(parsed.body, ALLOWED);
  if (unknown !== null) return deny(400, "unknown_field");
  const expected = parsed.body.expectedUpdatedAt;
  if (expected !== undefined && expected !== null && typeof expected !== "string") {
    return deny(400, "validation_failed");
  }
  // Idempotency: a retried submit must never check the guest in twice.
  const clientRequestId = parsed.body.clientRequestId;
  if (clientRequestId !== undefined && clientRequestId !== null) {
    if (typeof clientRequestId !== "string" || !isUuid(clientRequestId)) {
      return deny(400, "validation_failed");
    }
  }

  try {
    const result = await checkInReservation({
      tenantId: ctx.session.tenantId!,
      reservationId: id,
      actorN3UserKey: ctx.session.n3UserKey,
      expectedUpdatedAt: typeof expected === "string" ? expected : null,
      clientRequestId: typeof clientRequestId === "string" ? clientRequestId : null,
    });

    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.reservation.check_in",
      detail: { reservationId: id },
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const code =
      err instanceof OperationError && OPERATION_ERROR_CODES.has(err.code)
        ? err.code
        : "check_in_failed";
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.reservation.check_in_failed",
      detail: { reservationId: id, code },
    });
    return deny(statusForOperationError(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/check-in")({
  server: { handlers: { POST: handleCheckIn } },
});
