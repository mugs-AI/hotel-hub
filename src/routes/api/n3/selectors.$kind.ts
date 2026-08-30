// GET /api/n3/selectors/:kind — Owner only, read-only.
//
// Returns human-readable N3 rows ({ id, code, name }) for a selector kind, or
// an explicit `contract_unverified` status when HotelHub has no proven
// read-only contract for that resource. Never writes to N3, never accepts an
// arbitrary path, and never returns a raw upstream body.
import { createFileRoute } from "@tanstack/react-router";
import { destroySession, requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import { boundedN3Id, isN3SelectorKind, selectorRequiresStock } from "@/lib/n3-selectors";
import {
  loadN3Selector,
  N3SelectorForbidden,
  N3SelectorUnauthorized,
} from "@/lib/n3-selectors.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function handleN3Selector({
  request,
  params,
}: {
  request: Request;
  params: { kind: string };
}): Promise<Response> {
  if (!isN3SelectorKind(params.kind)) return deny(404, "unknown_selector");
  const { ctx, decision } = await requirePermission("hotel:charges:manage");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }

  // Stock-linked lists carry a bounded, validated stock identifier. Nothing
  // else from the query string is ever forwarded to N3.
  let stockId: string | null = null;
  if (selectorRequiresStock(params.kind)) {
    const raw = new URL(request.url).searchParams.get("stockId");
    const parsed = boundedN3Id(raw);
    if (parsed === undefined) return deny(400, "invalid_stock_context");
    stockId = parsed;
  }

  try {
    const load = await loadN3Selector(ctx.session.n3Token, params.kind, { stockId });
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
    // N3 403 is a permission decision, NOT token expiry: fail closed but keep
    // the valid HotelHub session (matches the accepted deposit contract).
    if (e instanceof N3SelectorForbidden) return deny(403, "n3_forbidden");
    return deny(502, "n3_unavailable");
  }
}


export const Route = createFileRoute("/api/n3/selectors/$kind")({
  server: { handlers: { GET: handleN3Selector } },
});
