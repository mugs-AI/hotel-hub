// GET /api/hotel/reservations/:id — Owner + Front Desk. Tenant-scoped detail.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { getReservationById, isUuid } from "@/lib/reservations-store.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function handleReservationDetail({
  params,
}: {
  params: { id?: string };
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:reservations:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!isUuid(id)) return deny(400, "invalid_id");
  try {
    const res = await getReservationById(ctx.session.tenantId!, id);
    if (!res) return deny(404, "not_found");
    return Response.json({ reservation: res }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[reservation.detail] failed", (err as Error).message?.slice(0, 200));
    return deny(500, "reservation_detail_failed");
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id")({
  server: { handlers: { GET: handleReservationDetail } },
});
