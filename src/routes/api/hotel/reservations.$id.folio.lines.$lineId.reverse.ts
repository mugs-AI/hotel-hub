// POST /api/hotel/reservations/:id/folio/lines/:lineId/reverse — Owner only.
//
// The ONLY correction mechanism for a folio line. The original line is never
// deleted or rewritten: it is marked reversed and a mirrored negative line is
// written with the mandatory reason. Room-night lines are not reversible.
import { createFileRoute } from "@tanstack/react-router";
import { logAudit } from "@/lib/audit.server";
import { isUuid } from "@/lib/reservations-store.server";
import { reverseFolioLine } from "@/lib/folio-store.server";
import { validateReverseBody } from "@/lib/folio-input";
import {
  folioDeny,
  folioSameOriginGuard,
  folioFailure,
  folioJson,
  readJsonBody,
  requireFolioActor,
} from "@/lib/folio-api.server";

export async function handleReverseFolioLine({
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
  const gate = await requireFolioActor("hotel:folio:adjust");
  if ("response" in gate) return gate.response;
  const { actor } = gate;
  const id = params.id ?? "";
  const lineId = params.lineId ?? "";
  if (!isUuid(id) || !isUuid(lineId)) return folioDeny(400, "invalid_id");
  try {
    const body = await readJsonBody(request);
    const checked = validateReverseBody(body);
    if (!checked.ok) return folioDeny(400, checked.code);
    const { reversal } = await reverseFolioLine({
      tenantId: actor.tenantId,
      reservationId: id,
      lineId,
      reason: checked.value.reason,
      clientRequestId: checked.value.clientRequestId,
      actorKey: actor.actorKey,
    });
    await logAudit({
      tenantId: actor.tenantId,
      n3UserKey: actor.actorKey,
      eventType: "hotel.folio.reversed",
      detail: { reservationId: id, reversedLineId: lineId, reversalLineId: reversal.id },
    });
    return folioJson({ reversal }, 201);
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/folio/lines/$lineId/reverse")({
  server: { handlers: { POST: handleReverseFolioLine } },
});
