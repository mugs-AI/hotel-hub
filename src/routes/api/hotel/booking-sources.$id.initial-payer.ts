import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { readLiveInitialBookingPolicy } from "@/lib/initial-booking-payer.server";
import { isSourceCodeFormat } from "@/lib/booking-sources-store.server";
export async function handleInitialPayer({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  const respond = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { "cache-control": "no-store" } });
  if (request.method !== "GET") return respond({ error: "method_not_allowed" }, 405);
  const { ctx, decision } = await requirePermission("hotel:reservations:create");
  if (!decision.ok)
    return respond({ error: decision.reason }, decision.reason === "unauthenticated" ? 401 : 403);
  if (!isSourceCodeFormat(params.id)) return respond({ error: "invalid_booking_source" }, 400);
  try {
    return respond(
      await readLiveInitialBookingPolicy(
        {
          tenantId: ctx.session.tenantId!,
          reservationId: "",
          n3UserKey: ctx.session.n3UserKey,
          n3Token: ctx.session.n3Token,
          role: ctx.role!,
        },
        params.id,
      ),
    );
  } catch {
    return respond({ error: "source_billing_setup_required" }, 503);
  }
}
export const Route = createFileRoute("/api/hotel/booking-sources/$id/initial-payer")({
  server: { handlers: { GET: handleInitialPayer } },
});
