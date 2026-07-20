// GET /api/n3/stocks/all — Owner only. See customers.all.ts for contract.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission, destroySession } from "@/lib/session-context.server";
import { listAllN3Stocks, N3ListError } from "@/lib/n3-gateway.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function handleListAllStocks(): Promise<Response> {
  const { ctx, decision } = await requirePermission("n3:list_stocks");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  try {
    const { items, total } = await listAllN3Stocks(ctx.session.n3Token);
    return Response.json(
      { items, total, complete: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof N3ListError) {
      if (e.code === "unauthorized") {
        await destroySession("n3_401");
        await logAudit({
          tenantId: ctx.session.tenantId,
          n3UserKey: ctx.session.n3UserKey,
          eventType: "session.n3_401",
          detail: { endpoint: "stocks/list/all" },
        });
        return deny(401, "n3_unauthorized");
      }
      if (e.code === "incomplete") return deny(502, "n3_incomplete");
    }
    return deny(502, "n3_unavailable");
  }
}

export const Route = createFileRoute("/api/n3/stocks/all")({
  server: { handlers: { GET: handleListAllStocks } },
});
