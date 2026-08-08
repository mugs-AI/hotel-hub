// PATCH /api/hotel/reservations/:id/guest-assignments
//
// Run 5D2.5 §8 — assign reservation guests to reservation rooms.
// Owner + Front Desk. Tenant, actor identity and actor role are derived from
// the authenticated N3 session and are never accepted from the browser.
// Delegates atomically to `hotelhub_assign_guest_rooms_v2` (v2 ONLY).
// No N3 financial call is made from this route.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { isUuid } from "@/lib/reservations-store.server";
import { assignGuestRoomsV2, OperationError } from "@/lib/reservation-operations.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const ALLOWED_TOP = new Set([
  "clientRequestId",
  "expectedUpdatedAt",
  "correctionReason",
  "assignments",
]);
const ALLOWED_ASSIGNMENT = new Set(["reservationGuestId", "reservationRoomId"]);

function rejectUnknown(obj: Record<string, unknown>, allowed: ReadonlySet<string>): string | null {
  for (const k of Object.keys(obj)) if (!allowed.has(k)) return k;
  return null;
}

/** Stable HTTP status for each allow-listed error code. */
export function assignmentErrorStatus(code: string): number {
  switch (code) {
    case "stale_reservation":
    case "idempotency_conflict":
    case "reservation_not_editable":
      return 409;
    case "guest_edit_locked":
    case "primary_guest_change_not_allowed":
    case "unauthorized":
      return 403;
    case "reservation_not_found":
      return 404;
    case "guest_assignment_failed":
      return 500;
    default:
      return 400;
  }
}

export async function handleGuestAssignmentsPatch({
  request,
  params,
}: {
  request: Request;
  params: { id?: string };
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:reservations:assign_guests");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!isUuid(id)) return deny(400, "invalid_id");

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return deny(400, "invalid_json");
  }
  if (!isPlainObject(parsed)) return deny(400, "invalid_body");
  if (rejectUnknown(parsed, ALLOWED_TOP) !== null) return deny(400, "unknown_field");

  const clientRequestId = parsed.clientRequestId;
  if (!isUuid(clientRequestId)) return deny(400, "invalid_request");

  const expectedUpdatedAt = parsed.expectedUpdatedAt;
  if (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt)
    return deny(400, "stale_reservation");

  const reasonRaw = parsed.correctionReason;
  let correctionReason: string | null = null;
  if (reasonRaw !== undefined && reasonRaw !== null && reasonRaw !== "") {
    if (typeof reasonRaw !== "string") return deny(400, "invalid_request");
    const t = reasonRaw.trim();
    if (t.length > 500) return deny(400, "correction_reason_too_long");
    correctionReason = t || null;
  }

  if (!Array.isArray(parsed.assignments)) return deny(400, "invalid_request");
  const assignments: Array<{ reservationGuestId: string; reservationRoomId: string | null }> = [];
  const seenGuests = new Set<string>();
  for (const raw of parsed.assignments as unknown[]) {
    if (!isPlainObject(raw)) return deny(400, "invalid_request");
    if (rejectUnknown(raw, ALLOWED_ASSIGNMENT) !== null) return deny(400, "unknown_field");
    const guestId = raw.reservationGuestId;
    if (!isUuid(guestId)) return deny(400, "guest_not_found");
    if (seenGuests.has(guestId)) return deny(400, "duplicate_guest");
    seenGuests.add(guestId);
    const roomId = raw.reservationRoomId ?? null;
    if (roomId !== null && !isUuid(roomId)) return deny(400, "room_not_found");
    assignments.push({
      reservationGuestId: guestId,
      reservationRoomId: (roomId as string | null) ?? null,
    });
  }
  if (assignments.length === 0) return deny(400, "guest_required");

  try {
    const result = await assignGuestRoomsV2({
      tenantId: ctx.session.tenantId!,
      reservationId: id,
      actorN3UserKey: ctx.session.n3UserKey,
      actorRole: ctx.role ?? "",
      clientRequestId,
      expectedUpdatedAt,
      correctionReason,
      assignments,
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const code = err instanceof OperationError ? err.code : "guest_assignment_failed";
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.reservation.guest_assignment_failed",
      // Safe counts only — never guest names, contact details or identities.
      detail: { reservationId: id, code, assignmentCount: assignments.length },
    });
    return deny(assignmentErrorStatus(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/guest-assignments")({
  server: { handlers: { PATCH: handleGuestAssignmentsPatch } },
});
