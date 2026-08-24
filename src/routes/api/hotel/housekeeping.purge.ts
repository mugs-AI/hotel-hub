// POST /api/hotel/housekeeping/purge — Owner only.
//
// Deletes this property's housekeeping history older than the requested
// number of days (default 30). The delete and its audit record are applied in
// ONE transaction by a service-role routine, so a purge is never silent. No
// scheduler is involved: retention is an explicit, deliberate Owner action.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import { purgeHousekeepingHistory } from "@/lib/housekeeping-store.server";
import { deny, isSameOriginWrite, readJsonBody, rejectUnknown } from "@/lib/operations-api.server";

const ALLOWED = new Set(["days"]);

/** Owner-selectable retention windows. Anything else is refused. */
export const RETENTION_DAY_OPTIONS = [30, 60, 90, 180, 365] as const;

export function isRetentionDays(v: unknown): v is number {
  return typeof v === "number" && (RETENTION_DAY_OPTIONS as readonly number[]).includes(v);
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
  if (rejectUnknown(parsed.body, ALLOWED) !== null) return deny(400, "unknown_field");
  const days = parsed.body.days === undefined ? 30 : parsed.body.days;
  if (!isRetentionDays(days)) return deny(400, "validation_failed");

  try {
    const result = await purgeHousekeepingHistory({
      tenantId: ctx.session.tenantId!,
      actorN3UserKey: ctx.session.n3UserKey,
      days,
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.housekeeping.history_purge_failed",
      detail: { days },
    });
    return deny(503, "housekeeping_failed");
  }
}

export const Route = createFileRoute("/api/hotel/housekeeping/purge")({
  server: { handlers: { POST: handleHousekeepingPurge } },
});
