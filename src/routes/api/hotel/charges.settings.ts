// GET   /api/hotel/charges/settings — Owner: full configuration.
//                                     Front Desk: safe readiness projection only.
// PATCH /api/hotel/charges/settings — Owner only.
//
// Nothing here is defaulted or guessed: an unconfigured Service Tax rate stays
// null and blocks the folio instead of silently applying a rate.
import { createFileRoute } from "@tanstack/react-router";
import { logAudit } from "@/lib/audit.server";
import { patchFinancialSettings, readFinancialSettings } from "@/lib/folio-store.server";
import { folioReadinessProjection } from "@/lib/folio-readiness";
import { folioFailure, folioJson, readJsonBody, requireFolioActor } from "@/lib/folio-api.server";

export async function handleReadChargeSettings(): Promise<Response> {
  const gate = await requireFolioActor("hotel:folio:view");
  if ("response" in gate) return gate.response;
  const { actor } = gate;
  try {
    const settings = await readFinancialSettings(actor.tenantId);
    const readiness = folioReadinessProjection(settings);
    if (!actor.can("hotel:charges:manage")) {
      // Front desk never receives rates, tax-code ids or account ids.
      return folioJson({ readiness, capability: { canManage: false } });
    }
    return folioJson({ settings, readiness, capability: { canManage: true } });
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export async function handlePatchChargeSettings({
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
    const settings = await patchFinancialSettings(actor.tenantId, body, actor.actorKey);
    const readiness = folioReadinessProjection(settings);
    await logAudit({
      tenantId: actor.tenantId,
      n3UserKey: actor.actorKey,
      eventType: "hotel.charges.settings_updated",
      detail: { fields: Object.keys(body), configurationComplete: readiness.configurationComplete },
    });
    return folioJson({ settings, readiness, capability: { canManage: true } });
  } catch (err) {
    return folioFailure(err, { tenantId: actor.tenantId, actorKey: actor.actorKey });
  }
}

export const Route = createFileRoute("/api/hotel/charges/settings")({
  server: { handlers: { GET: handleReadChargeSettings, PATCH: handlePatchChargeSettings } },
});
