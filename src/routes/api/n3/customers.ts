// GET /api/n3/customers?top=&skip=&filter= — Owner only.
// Returns a bounded, minimal projection of the tenant's live N3 customer list.
// Filtering is applied only to the currently loaded page; N3 server-side
// filter syntax is not assumed here.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission, destroySession } from "@/lib/session-context.server";
import { listN3Customers } from "@/lib/n3-gateway.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function handleListCustomers({ request }: { request: Request }): Promise<Response> {
  const { ctx, decision } = await requirePermission("n3:list_customers");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const url = new URL(request.url);
  try {
    const page = await listN3Customers(ctx.session.n3Token, {
      top: url.searchParams.get("top"),
      skip: url.searchParams.get("skip"),
      filter: url.searchParams.get("filter"),
    });
    if (page.status === 401) {
      await destroySession("n3_401");
      await logAudit({
        tenantId: ctx.session.tenantId,
        n3UserKey: ctx.session.n3UserKey,
        eventType: "session.n3_401",
        detail: { endpoint: "customers/list" },
      });
      return deny(401, "n3_unauthorized");
    }
    if (page.status < 200 || page.status >= 300) return deny(502, "n3_unavailable");
    return Response.json(page, { headers: { "cache-control": "no-store" } });
  } catch {
    return deny(502, "n3_unavailable");
  }
}

export const Route = createFileRoute("/api/n3/customers")({
  server: { handlers: { GET: handleListCustomers } },
});
