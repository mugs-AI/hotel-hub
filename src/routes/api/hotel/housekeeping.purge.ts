// GET  /api/hotel/housekeeping/purge — Owner only. Authoritative preview.
// POST /api/hotel/housekeeping/purge — Owner only. Fixed 30-day purge.
//
// There is exactly ONE retention policy: remove this property's housekeeping
// history older than 30 days. The browser cannot choose a window, a tenant or
// an actor — tenant and actor come from the trusted session and the cut-off is
// recomputed by the database on every call. The delete and its audit record
// are applied in ONE transaction by a service-role routine, so a purge is
// never silent. No scheduler is involved.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import {
  HOUSEKEEPING_RETENTION_DAYS,
  previewHousekeepingHistoryPurge,
  purgeHousekeepingHistory,
} from "@/lib/housekeeping-store.server";
import { deny, isSameOriginWrite, readJsonBody, rejectUnknown } from "@/lib/operations-api.server";

/** The purge takes NO product parameters. Any field at all is refused. */
const ALLOWED = new Set<string>();

/** The one and only retention window. Kept exported for tests and the UI. */
export const RETENTION_DAYS = HOUSEKEEPING_RETENTION_DAYS;

export async function handleHousekeepingPurgePreview(): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  try {
    const preview = await previewHousekeepingHistoryPurge({
      tenantId: ctx.session.tenantId!,
    });
    return Response.json(
      {
        ...preview,
        tenantLabel: ctx.session.companyName ?? ctx.session.tenantCode ?? null,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return deny(503, "housekeeping_failed");
  }
}

export async function handleHousekeepingPurge({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "forbidden");
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return deny(400, parsed.code);
  // No days, no tenant, no actor — nothing the browser can supply is honoured.
  if (rejectUnknown(parsed.body, ALLOWED) !== null) return deny(400, "unknown_field");

  try {
    const result = await purgeHousekeepingHistory({
      tenantId: ctx.session.tenantId!,
      actorN3UserKey: ctx.session.n3UserKey,
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.housekeeping.history_purge_failed",
      detail: { days: RETENTION_DAYS },
    });
    return deny(503, "housekeeping_failed");
  }
}

export const Route = createFileRoute("/api/hotel/housekeeping/purge")({
  server: {
    handlers: { GET: handleHousekeepingPurgePreview, POST: handleHousekeepingPurge },
  },
});
