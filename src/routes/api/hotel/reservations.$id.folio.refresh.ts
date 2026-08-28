// POST /api/hotel/reservations/:id/folio/refresh — Owner + Front Desk.
//
// The ONLY caller-visible way to create the folio and snapshot room nights.
// GET /folio is strictly read-only, so preparing a folio is always an
// explicit, audited action. Re-running this is safe: only missing
// (reservation room, stay date) nights are added, and an existing snapshot is
// never rewritten by a later rate change.
import { createFileRoute } from "@tanstack/react-router";
import { logAudit } from "@/lib/audit.server";
import { isUuid } from "@/lib/reservations-store.server";
import { refreshFolioRoomNights } from "@/lib/folio-store.server";
import { folioDeny, folioFailure, folioJson, requireFolioActor, folioSameOriginGuard } from "@/lib/folio-api.server";

export async function handleRefreshFolio({
  request,
  params,
}: {
  request: Request;
  params: { id?: string };
}): Promise<Response> {
  // Cross-origin write protection: a cookie session must not be usable
  // from another origin.
  const origin = folioSameOriginGuard(request);
  if (origin) return origin;
  const gate = await requireFolioActor("hotel:folio:add_item");
  if ("response" in gate) return gate.response;
  const { actor } = gate;
  const id = params.id ?? "";
  if (!isUuid(id)) return folioDeny(400, "invalid_id");
  try {
    const result = await refreshFolioRoomNights({
      tenantId: actor.tenantId,
      reservationId: id,
      actorKey: actor.actorKey,
    });
    await logAudit({
      tenantId: actor.tenantId,
      n3UserKey: actor.actorKey,
      eventType: "hotel.folio.refreshed",
      detail: { reservationId: id, inserted: result.inserted },
    });
    return folioJson({
      folioId: result.folioId,
      inserted: result.inserted,
      unmappedRoomLabels: result.unmappedRoomLabels,
    });
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/folio/refresh")({
  server: { handlers: { POST: handleRefreshFolio } },
});
