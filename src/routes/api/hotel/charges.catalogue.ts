// GET  /api/hotel/charges/catalogue — Owner (full) / Front Desk (usable only).
// POST /api/hotel/charges/catalogue — Owner only. Creates an add-on item.
//
// The catalogue is local configuration. Creating an item never creates
// anything in N3; the immutable N3 stock / UOM / tax-code identifiers are
// mappings the Owner picks from N3, and an unmapped item can be saved but
// never used on a folio.
import { createFileRoute } from "@tanstack/react-router";
import { logAudit } from "@/lib/audit.server";
import { mappingStatus } from "@/lib/charges-catalogue";
import { createAddonItem, listAddonItems } from "@/lib/folio-store.server";
import { folioFailure, folioJson, readJsonBody, requireFolioActor } from "@/lib/folio-api.server";

export async function handleListCatalogue(): Promise<Response> {
  const gate = await requireFolioActor("hotel:folio:view");
  if ("response" in gate) return gate.response;
  const { actor } = gate;
  try {
    const manage = actor.can("hotel:charges:manage");
    const items = await listAddonItems(actor.tenantId, manage ? {} : { usableOnly: true });
    return folioJson({
      items: items.map((i) => ({
        id: i.id,
        category: i.category,
        taxClass: i.taxClass,
        displayName: i.displayName,
        description: i.description,
        isActive: i.isActive,
        defaultUnitPriceCents: i.defaultUnitPriceCents,
        sortOrder: i.sortOrder,
        mappingStatus: mappingStatus(i),
        // Immutable N3 identifiers are Owner-only configuration data.
        ...(manage
          ? {
              n3StockId: i.n3StockId,
              n3UomId: i.n3UomId,
              n3TaxCodeId: i.n3TaxCodeId,
              n3StockCodeSnapshot: i.n3StockCodeSnapshot,
              n3StockNameSnapshot: i.n3StockNameSnapshot,
              n3UomSnapshot: i.n3UomSnapshot,
              n3TaxCodeSnapshot: i.n3TaxCodeSnapshot,
            }
          : {}),
      })),
      capability: { canManage: manage },
    });
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export async function handleCreateCatalogueItem({
  request,
}: {
  request: Request;
}): Promise<Response> {
  // Cross-origin write protection: a cookie session must not be usable
  // from another origin.
  const origin = folioSameOriginGuard(request);
  if (origin) return origin;
  const gate = await requireFolioActor("hotel:charges:manage");
  if ("response" in gate) return gate.response;
  const { actor } = gate;
  try {
    const body = await readJsonBody(request);
    const item = await createAddonItem(actor.tenantId, body);
    await logAudit({
      tenantId: actor.tenantId,
      n3UserKey: actor.actorKey,
      eventType: "hotel.charges.catalogue_created",
      detail: { id: item.id, category: item.category, mapping: mappingStatus(item) },
    });
    return folioJson({ item }, 201);
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export const Route = createFileRoute("/api/hotel/charges/catalogue")({
  server: { handlers: { GET: handleListCatalogue, POST: handleCreateCatalogueItem } },
});
