// GET /api/n3/selectors/:kind — Owner only, read-only.
//
// Returns human-readable N3 rows ({ id, code, name }) for a selector kind, or
// an explicit `contract_unverified` status when HotelHub has no proven
// read-only contract for that resource. Never writes to N3, never accepts an
// arbitrary path, and never returns a raw upstream body.
import { createFileRoute } from "@tanstack/react-router";
import { destroySession, requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import { isN3SelectorKind } from "@/lib/n3-selectors";
import { loadN3Selector, N3SelectorUnauthorized } from "@/lib/n3-selectors.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function handleN3Selector({
  params,
}: {
  params: { kind: string };
}): Promise<Response> {
  if (!isN3SelectorKind(params.kind)) return deny(404, "unknown_selector");
  const { ctx, decision } = await requirePermission("hotel:charges:manage");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  try {
    const load = await loadN3Selector(ctx.session.n3Token, params.kind);
    return Response.json(load, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof N3SelectorUnauthorized) {
      await destroySession("n3_401");
      await logAudit({
        tenantId: ctx.session.tenantId,
        n3UserKey: ctx.session.n3UserKey,
        eventType: "session.n3_401",
        detail: { endpoint: `selectors/${params.kind}` },
      });
      return deny(401, "n3_unauthorized");
    }
    return deny(502, "n3_unavailable");
  }
}

export const Route = createFileRoute("/api/n3/selectors/$kind")({
  server: { handlers: { GET: handleN3Selector } },
});
