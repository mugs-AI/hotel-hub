// POST /api/hotel/reservations/:id/folio/lines — Owner + Front Desk.
// Adds one catalogue add-on to the prepared folio. Idempotent on
// `clientRequestId`: a retried request replays the same line, never a second
// charge. A unit-price override is Owner-only and always needs a reason.
import { createFileRoute } from "@tanstack/react-router";
import { logAudit } from "@/lib/audit.server";
import { isUuid } from "@/lib/reservations-store.server";
import { addAddonLine } from "@/lib/folio-store.server";
import {
  folioDeny,
  folioFailure,
  folioJson,
  readJsonBody,
  requireFolioActor,
} from "@/lib/folio-api.server";

export async function handleAddFolioLine({
  request,
  params,
}: {
  request: Request;
  params: { id?: string };
}): Promise<Response> {
  const gate = await requireFolioActor("hotel:folio:add_item");
  if ("response" in gate) return gate.response;
  const { actor } = gate;
  const id = params.id ?? "";
  if (!isUuid(id)) return folioDeny(400, "invalid_id");
  try {
    const body = await readJsonBody(request);
    const line = await addAddonLine({
      tenantId: actor.tenantId,
      reservationId: id,
      catalogueId: body.catalogueId,
      quantity: body.quantity,
      unitPriceCents: body.unitPriceCents,
      reason: body.reason,
      clientRequestId: body.clientRequestId,
      actorKey: actor.actorKey,
      canOverridePrice: actor.can("hotel:folio:adjust"),
    });
    await logAudit({
      tenantId: actor.tenantId,
      n3UserKey: actor.actorKey,
      eventType: "hotel.folio.item_added",
      detail: { reservationId: id, lineId: line.id, quantity: line.quantity },
    });
    return folioJson({ line }, 201);
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/folio/lines")({
  server: { handlers: { POST: handleAddFolioLine } },
});
