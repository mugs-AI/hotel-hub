// PATCH /api/hotel/charges/catalogue/:itemId — Owner only.
// Partial edit of a catalogue item, including finishing the N3 mapping.
import { createFileRoute } from "@tanstack/react-router";
import { logAudit } from "@/lib/audit.server";
import { mappingStatus } from "@/lib/charges-catalogue";
import { updateAddonItem } from "@/lib/folio-store.server";
import {
  folioDeny,
  folioFailure,
  folioJson,
  readJsonBody,
  requireFolioActor,
} from "@/lib/folio-api.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleUpdateCatalogueItem({
  request,
  params,
}: {
  request: Request;
  params: { itemId?: string };
}): Promise<Response> {
  const gate = await requireFolioActor("hotel:charges:manage");
  if ("response" in gate) return gate.response;
  const { actor } = gate;
  const itemId = params.itemId ?? "";
  if (!UUID_RE.test(itemId)) return folioDeny(400, "invalid_id");
  try {
    const body = await readJsonBody(request);
    const item = await updateAddonItem(actor.tenantId, itemId, body);
    await logAudit({
      tenantId: actor.tenantId,
      n3UserKey: actor.actorKey,
      eventType: "hotel.charges.catalogue_updated",
      detail: { id: item.id, isActive: item.isActive, mapping: mappingStatus(item) },
    });
    return folioJson({ item });
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export const Route = createFileRoute("/api/hotel/charges/catalogue/$itemId")({
  server: { handlers: { PATCH: handleUpdateCatalogueItem } },
});
