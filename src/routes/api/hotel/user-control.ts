// HH-AUTH-02 — Owner-only User Control API.
//
// GET  /api/hotel/user-control  — list the current tenant's ACTIVE N3 users
//                                 with their HotelHub assignment.
// POST /api/hotel/user-control  — grant / change / revoke front_desk or
//                                 housekeeper for one N3 user.
//
// Tenant and actor are ALWAYS taken from the verified HotelHub session; a
// browser-supplied tenant or actor is refused as an unknown field. Before any
// write the actor is re-confirmed against a fresh `/api/Users` read as the
// current N3 `isOwner` user. `owner` can never be written locally.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { deny, isSameOriginWrite, readJsonBody, rejectUnknown } from "@/lib/operations-api.server";
import { applyUserAccess, listUserControl } from "@/lib/user-control.server";

/** Only these two fields are ever honoured. tenantId/actor are refused. */
const ALLOWED_WRITE_KEYS = new Set(["targetN3UserKey", "access"]);

export async function handleListUserControl(): Promise<Response> {
  const { ctx, decision } = await requirePermission("roles:manage");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const result = await listUserControl({
    token: ctx.session.n3Token,
    tenantId: ctx.session.tenantId!,
    actorN3UserKey: ctx.session.n3UserKey,
  });
  if (result.status === "upstream_unavailable") return deny(503, "n3_users_unavailable");
  if (result.status === "upstream_malformed") return deny(502, "n3_users_malformed");
  if (result.status === "store_unavailable") return deny(503, "user_control_unavailable");

  return Response.json(
    {
      rows: result.rows,
      skippedWithoutIdentifier: result.skippedWithoutIdentifier,
      actorKeyAlignsWithN3Id: result.actorKeyAlignsWithN3Id,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function handleAssignUserControl({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "forbidden");
  const { ctx, decision } = await requirePermission("roles:manage");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return deny(400, parsed.code);
  if (rejectUnknown(parsed.body, ALLOWED_WRITE_KEYS) !== null) return deny(400, "unknown_field");

  const result = await applyUserAccess({
    tenantId: ctx.session.tenantId!,
    actorN3UserKey: ctx.session.n3UserKey,
    actorIdentity: {
      n3UserKey: ctx.session.n3UserKey,
      email: ctx.session.userEmail ?? null,
      userName: ctx.session.userName ?? null,
    },
    token: ctx.session.n3Token,
    targetN3UserKey: parsed.body.targetN3UserKey,
    access: parsed.body.access,
  });
  if (!result.ok) return deny(result.status, result.code);

  return Response.json(
    { n3UserKey: result.n3UserKey, access: result.to, changed: result.changed },
    { headers: { "cache-control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/hotel/user-control")({
  server: {
    handlers: { GET: handleListUserControl, POST: handleAssignUserControl },
  },
});
