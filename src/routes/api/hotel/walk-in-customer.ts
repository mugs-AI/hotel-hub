// POST /api/hotel/walk-in-customer — Owner only.
// Body: { code: string }. Server verifies the code against the tenant's
// live N3 customer list; only after verification are the N3 ID + name
// persisted. Browser-supplied name/id are ignored entirely — manual entry
// of an unverified customer code is impossible.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission, destroySession } from "@/lib/session-context.server";
import { verifyN3CustomerByCode } from "@/lib/n3-gateway.server";
import { setWalkInCustomer } from "@/lib/hotel-store.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function handleSetWalkInCustomer({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  let body: { code?: unknown } = {};
  try {
    body = (await request.json()) as { code?: unknown };
  } catch {
    return deny(400, "invalid_json");
  }
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) return deny(400, "code_required");
  let verified;
  try {
    verified = await verifyN3CustomerByCode(ctx.session.n3Token, code);
  } catch {
    return deny(502, "n3_unavailable");
  }
  if (verified === null) {
    // A page fetch may still return 401 — surface it explicitly.
    // (verifyN3CustomerByCode returns null on any non-2xx page too, which
    // is safe: without confirmed identity we refuse to persist.)
    return deny(404, "customer_not_found_in_n3");
  }
  // If the underlying gateway returned 401, subsequent fetches will still
  // fail; we treat unknown-customer safely by refusing to save.
  try {
    const settings = await setWalkInCustomer(ctx.session.tenantId!, {
      n3Id: verified.id,
      n3Code: verified.code,
      n3Name: verified.name,
    });
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.walk_in_customer.mapped",
      detail: { customerCode: verified.code },
    });
    return Response.json({ settings }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[walk-in] save failed", (err as Error).message?.slice(0, 200));
    return deny(500, "save_failed");
  }
}

// N3 401 during any inline call is possible; we do not aggressively probe
// here. If the caller's session is stale, the next probe/list request will
// surface 401 and destroy it. Keep unused import guard silent:
void destroySession;

export const Route = createFileRoute("/api/hotel/walk-in-customer")({
  server: {
    handlers: { POST: handleSetWalkInCustomer },
  },
});
