// GET /api/hotel/reservations/:id/checkout-preview — Owner + Front Desk.
//
// READ-ONLY. Returns the server-authoritative room-only folio, GET-verified
// N3 deposit evidence, an estimated balance and every remaining blocker.
// Creates/updates NOTHING in N3 or in HotelHub.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission, destroySession } from "@/lib/session-context.server";
import { deny } from "@/lib/operations-api.server";
import { isUuid } from "@/lib/reservations-store.server";
import {
  buildCheckoutPreview,
  CheckoutPreviewError,
  liveCheckoutDeps,
} from "@/lib/checkout-preview.server";

export async function handleCheckoutPreview({
  params,
}: {
  params: { id?: string };
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:checkout:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!isUuid(id)) return deny(400, "invalid_id");
  try {
    const dto = await buildCheckoutPreview({
      tenantId: ctx.session.tenantId!,
      reservationId: id,
      n3Token: ctx.session.n3Token,
      deps: liveCheckoutDeps,
    });
    return Response.json(dto, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof CheckoutPreviewError) {
      if (err.status === 401) {
        // N3 rejected the session token during verification — destroy it.
        await destroySession("n3_unauthorized");
        return deny(401, "unauthenticated");
      }
      return deny(err.status, err.code);
    }
    return deny(500, "checkout_preview_failed");
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/checkout-preview")({
  server: { handlers: { GET: handleCheckoutPreview } },
});
