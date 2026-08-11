// GET /api/hotel/reservations/:id/timeline — Owner + Front Desk.
// Append-only, newest-first reservation history. Contains no guest PII, no
// raw actor keys and no internal database identifiers.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { isUuid } from "@/lib/reservations-store.server";
import { listReservationTimeline } from "@/lib/reservation-operations.server";
import { deny } from "@/lib/operations-api.server";

export async function handleTimeline({ params }: { params: { id?: string } }): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:operations:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!isUuid(id)) return deny(400, "invalid_id");
  try {
    const events = await listReservationTimeline(ctx.session.tenantId!, id);
    return Response.json({ events }, { headers: { "cache-control": "no-store" } });
  } catch {
    return deny(500, "operation_read_failed");
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/timeline")({
  server: { handlers: { GET: handleTimeline } },
});
