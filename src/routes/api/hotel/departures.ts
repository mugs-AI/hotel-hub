// GET /api/hotel/departures — Owner + Front Desk, read-only.
//
// Lists checked-in reservations bucketed by the property-local calendar date.
// Performs no writes of any kind.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { deny } from "@/lib/operations-api.server";
import { parseDeparturesQuery } from "@/lib/checkout-preview";
import {
  CheckoutPreviewError,
  listDepartures,
  resolvePropertyToday,
} from "@/lib/checkout-preview.server";

export async function handleDepartures({ request }: { request: Request }): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:checkout:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const parsed = parseDeparturesQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return deny(400, parsed.code);
  try {
    const propertyToday = await resolvePropertyToday(ctx.session.tenantId!);
    const data = await listDepartures({
      tenantId: ctx.session.tenantId!,
      query: parsed.query,
      propertyToday,
    });
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof CheckoutPreviewError) return deny(err.status, err.code);
    return deny(500, "checkout_preview_failed");
  }
}

export const Route = createFileRoute("/api/hotel/departures")({
  server: { handlers: { GET: handleDepartures } },
});
