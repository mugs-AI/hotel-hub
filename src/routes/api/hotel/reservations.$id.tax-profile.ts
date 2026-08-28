// PATCH /api/hotel/reservations/:id/tax-profile — Owner + Front Desk.
//         Guest classification for Tourism Tax (classification only — raw
//         identity-document numbers are never stored here).
// POST  /api/hotel/reservations/:id/tax-profile — Owner only.
//         Records manual evidence that an OTA / DPSP already collected
//         Tourism Tax. No card, bank or other payment secrets are stored.
import { createFileRoute } from "@tanstack/react-router";
import { logAudit } from "@/lib/audit.server";
import { isUuid } from "@/lib/reservations-store.server";
import { addTourismTaxEvidence, setGuestTaxClass } from "@/lib/folio-store.server";
import { validateEvidenceBody, validateTaxProfileBody } from "@/lib/folio-input";
import {
  folioDeny,
  folioSameOriginGuard,
  folioFailure,
  folioJson,
  readJsonBody,
  requireFolioActor,
} from "@/lib/folio-api.server";

export async function handleSetTaxProfile({
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
  const gate = await requireFolioActor("hotel:folio:tax_class");
  if ("response" in gate) return gate.response;
  const { actor } = gate;
  const id = params.id ?? "";
  if (!isUuid(id)) return folioDeny(400, "invalid_id");
  try {
    const body = await readJsonBody(request);
    const checked = validateTaxProfileBody(body);
    if (!checked.ok) return folioDeny(400, checked.code);
    const profile = await setGuestTaxClass({
      tenantId: actor.tenantId,
      reservationId: id,
      guestTaxClass: checked.value.guestTaxClass,
      evidenceNote: checked.value.evidenceNote,
      actorKey: actor.actorKey,
    });
    await logAudit({
      tenantId: actor.tenantId,
      n3UserKey: actor.actorKey,
      eventType: "hotel.folio.tax_class_updated",
      detail: { reservationId: id, guestTaxClass: profile.guestTaxClass },
    });
    return folioJson({ profile });
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export async function handleAddTourismTaxEvidence({
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
  const gate = await requireFolioActor("hotel:charges:manage");
  if ("response" in gate) return gate.response;
  const { actor } = gate;
  const id = params.id ?? "";
  if (!isUuid(id)) return folioDeny(400, "invalid_id");
  try {
    const body = await readJsonBody(request);
    const checked = validateEvidenceBody(body);
    if (!checked.ok) return folioDeny(400, checked.code);
    const row = await addTourismTaxEvidence({
      tenantId: actor.tenantId,
      reservationId: id,
      sourceLabel: checked.value.sourceLabel,
      reference: checked.value.reference,
      collectedOn: checked.value.collectedOn,
      amountCents: checked.value.amountCents,
      note: checked.value.note,
      clientRequestId: checked.value.clientRequestId,
      actorKey: actor.actorKey,
    });
    await logAudit({
      tenantId: actor.tenantId,
      n3UserKey: actor.actorKey,
      eventType: "hotel.folio.tourism_tax_evidence_added",
      detail: { reservationId: id, evidenceId: row.id },
    });
    return folioJson({ evidenceId: row.id }, 201);
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/tax-profile")({
  server: { handlers: { PATCH: handleSetTaxProfile, POST: handleAddTourismTaxEvidence } },
});
