// PATCH  /api/hotel/reservations/:id/folio/lines/:lineId — Owner + Front Desk.
//         Quantity change on a still-draft add-on line only.
// DELETE  is deliberately NOT supported: corrections are reversal-only.
import { createFileRoute } from "@tanstack/react-router";
import { logAudit } from "@/lib/audit.server";
import { isUuid } from "@/lib/reservations-store.server";
import { updateAddonQuantity } from "@/lib/folio-store.server";
import { validateQuantityBody } from "@/lib/folio-input";
import {
  folioDeny,
  folioSameOriginGuard,
  folioFailure,
  folioJson,
  readJsonBody,
  requireFolioActor,
} from "@/lib/folio-api.server";

export async function handleUpdateFolioLine({
  request,
  params,
}: {
  request: Request;
  params: { id?: string; lineId?: string };
}): Promise<Response> {
  // Cross-origin write protection: a cookie session must not be usable
  // from another origin.
  const origin = folioSameOriginGuard(request);
  if (origin) return origin;
  const gate = await requireFolioActor("hotel:folio:add_item");
  if ("response" in gate) return gate.response;
  const { actor } = gate;
  const id = params.id ?? "";
  const lineId = params.lineId ?? "";
  if (!isUuid(id) || !isUuid(lineId)) return folioDeny(400, "invalid_id");
  try {
    const body = await readJsonBody(request);
    const checked = validateQuantityBody(body);
    if (!checked.ok) return folioDeny(400, checked.code);
    const line = await updateAddonQuantity({
      tenantId: actor.tenantId,
      reservationId: id,
      lineId,
      quantity: checked.value.quantity,
      clientRequestId: checked.value.clientRequestId,
      actorKey: actor.actorKey,
    });
    await logAudit({
      tenantId: actor.tenantId,
      n3UserKey: actor.actorKey,
      eventType: "hotel.folio.quantity_updated",
      detail: { reservationId: id, lineId, quantity: line.quantity },
    });
    return folioJson({ line });
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/folio/lines/$lineId")({
  server: { handlers: { PATCH: handleUpdateFolioLine } },
});
