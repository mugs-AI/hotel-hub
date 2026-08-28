// GET /api/hotel/reservations/:id/folio — Owner + Front Desk.
//
// Returns the server-authoritative prepared folio: stored lines, derived
// service charge / Service Tax / Tourism Tax / local levy, totals, blockers
// and capabilities. PREPARATION ONLY — nothing is posted to N3, no CashMemo,
// no invoice, no deposit matching and no refund.
import { createFileRoute } from "@tanstack/react-router";
import { isUuid } from "@/lib/reservations-store.server";
import { buildFolioView } from "@/lib/folio-store.server";
import { folioDeny, folioFailure, folioJson, requireFolioActor } from "@/lib/folio-api.server";

export async function handleReadFolio({
  params,
}: {
  params: { id?: string };
}): Promise<Response> {
  const gate = await requireFolioActor("hotel:folio:view");
  if ("response" in gate) return gate.response;
  const { actor } = gate;
  const id = params.id ?? "";
  if (!isUuid(id)) return folioDeny(400, "invalid_id");
  try {
    const dto = await buildFolioView({
      tenantId: actor.tenantId,
      reservationId: id,
      actorKey: actor.actorKey,
      timezone: actor.timezone,
      capability: {
        canAddItem: actor.can("hotel:folio:add_item"),
        canAdjust: actor.can("hotel:folio:adjust"),
        canSetTaxClass: actor.can("hotel:folio:tax_class"),
        canManageCharges: actor.can("hotel:charges:manage"),
      },
    });
    return folioJson(dto);
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/folio")({
  server: { handlers: { GET: handleReadFolio } },
});
