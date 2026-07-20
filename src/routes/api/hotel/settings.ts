// GET  /api/hotel/settings  — any authenticated role may read (front desk
//                              needs currency/times for later flows).
// PATCH /api/hotel/settings — Owner only. Updates currency, timezone,
//                              check-in/check-out times. Never accepts
//                              walk-in customer here — that has a
//                              dedicated verified endpoint.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { getOrCreateHotelSettings, updateHotelSettings } from "@/lib/hotel-store.server";
import { logAudit } from "@/lib/audit.server";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function handleGetSettings(): Promise<Response> {
  const { ctx, decision } = await requirePermission("app:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const settings = await getOrCreateHotelSettings(ctx.session.tenantId!);
  return Response.json({ settings }, { headers: { "cache-control": "no-store" } });
}

export async function handlePatchSettings({ request }: { request: Request }): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return deny(400, "invalid_json");
  }
  const patch: {
    currency?: string;
    timezone?: string;
    standardCheckInTime?: string;
    standardCheckOutTime?: string;
  } = {};
  if (typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency)) {
    patch.currency = body.currency;
  }
  if (typeof body.timezone === "string" && body.timezone.length <= 64) {
    patch.timezone = body.timezone.trim();
  }
  if (typeof body.standardCheckInTime === "string" && TIME_RE.test(body.standardCheckInTime)) {
    patch.standardCheckInTime = body.standardCheckInTime;
  }
  if (typeof body.standardCheckOutTime === "string" && TIME_RE.test(body.standardCheckOutTime)) {
    patch.standardCheckOutTime = body.standardCheckOutTime;
  }
  if (Object.keys(patch).length === 0) return deny(400, "no_valid_fields");
  const settings = await updateHotelSettings(ctx.session.tenantId!, patch);
  await logAudit({
    tenantId: ctx.session.tenantId,
    n3UserKey: ctx.session.n3UserKey,
    eventType: "hotel.settings.updated",
    detail: { fields: Object.keys(patch) },
  });
  return Response.json({ settings }, { headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/hotel/settings")({
  server: {
    handlers: {
      GET: handleGetSettings,
      PATCH: handlePatchSettings,
    },
  },
});
