// POST /api/hotel/reservations/:id/folio/adjustments — Owner only.
//
// A discount (negative) or a signed manual adjustment. Always requires a
// reason, is idempotent on `clientRequestId`, and can itself only be undone by
// a reversal.
import { createFileRoute } from "@tanstack/react-router";
import { logAudit } from "@/lib/audit.server";
import { isUuid } from "@/lib/reservations-store.server";
import { addOwnerAdjustment } from "@/lib/folio-store.server";
import {
  folioDeny,
  folioFailure,
  folioJson,
  readJsonBody,
  requireFolioActor,
} from "@/lib/folio-api.server";

export async function handleAddFolioAdjustment({
  request,
  params,
}: {
  request: Request;
  params: { id?: string };
}): Promise<Response> {
  const gate = await requireFolioActor("hotel:folio:adjust");
  if ("response" in gate) return gate.response;
  const { actor } = gate;
  const id = params.id ?? "";
  if (!isUuid(id)) return folioDeny(400, "invalid_id");
  try {
    const body = await readJsonBody(request);
    const line = await addOwnerAdjustment({
      tenantId: actor.tenantId,
      reservationId: id,
      lineType: body.lineType,
      description: body.description,
      amountCents: body.amountCents,
      taxClass: body.taxClass,
      reason: body.reason,
      clientRequestId: body.clientRequestId,
      actorKey: actor.actorKey,
    });
    await logAudit({
      tenantId: actor.tenantId,
      n3UserKey: actor.actorKey,
      eventType: "hotel.folio.adjusted",
      detail: { reservationId: id, lineId: line.id, lineType: line.lineType },
    });
    return folioJson({ line }, 201);
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/folio/adjustments")({
  server: { handlers: { POST: handleAddFolioAdjustment } },
});
