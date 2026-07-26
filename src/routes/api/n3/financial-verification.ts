// Owner-only POST endpoint that runs the N3 Financial Verification console.
// Read-only: never creates/updates/voids anything in N3.
import { createFileRoute } from "@tanstack/react-router";
import { destroySession, requirePermission } from "@/lib/session-context.server";
import {
  parseDateRange,
  runFinancialVerification,
  compareReceiptKnockoffs,
  classifyGlAccount,
  classifyOrOrigin,
} from "@/lib/n3-financial.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function methodNotAllowed() {
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
}

export async function handleFinancialVerification({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") return methodNotAllowed();
  const { ctx, decision } = await requirePermission("n3:financial_verify");
  if (!decision.ok) return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return deny(400, "invalid_json");
  }
  const range = parseDateRange(body.dateFrom, body.dateTo);
  if (!range.ok) return deny(400, range.error);

  const filters: { docNumber?: string; hotelReference?: string; customerCode?: string } = {};
  if (typeof body.docNumber === "string" && body.docNumber.trim()) filters.docNumber = body.docNumber.trim();
  if (typeof body.hotelReference === "string" && body.hotelReference.trim())
    filters.hotelReference = body.hotelReference.trim();
  if (typeof body.customerCode === "string" && body.customerCode.trim())
    filters.customerCode = body.customerCode.trim();

  const tenantRow = await getTenant(ctx.session.tenantId).catch(() => null);

  try {
    const run = await runFinancialVerification({
      token: ctx.session.n3Token,
      dateFrom: range.from,
      dateTo: range.to,
      tenant: {
        id: ctx.session.tenantId,
        code: tenantRow?.n3TenantCode ?? null,
        name: tenantRow?.n3CompanyName ?? null,
      },
      filters,
    });

    // If any resource returned 401, destroy session and surface unauthorized.
    if (run.resources.some((r) => r.status === "unauthorized")) {
      await destroySession("n3_401");
      await logAudit({
        tenantId: ctx.session.tenantId,
        n3UserKey: ctx.session.n3UserKey,
        eventType: "session.n3_401",
        detail: { endpoint: "financial-verification" },
      });
      return deny(401, "n3_unauthorized");
    }

    const ar = run.resources.find((r) => r.resource === "ar_receipts");
    const cs = run.resources.find((r) => r.resource === "cash_sales");
    const gl = run.resources.find((r) => r.resource === "gl_accounts");
    const knockoffs =
      ar && cs && ar.status === "success" && cs.status === "success"
        ? compareReceiptKnockoffs(ar.rows, cs.rows)
        : [];
    const glClassified =
      gl && gl.status === "success"
        ? gl.rows.map((row) => ({ row, eligibility: classifyGlAccount(row) }))
        : [];
    const orClassified =
      ar && ar.status === "success"
        ? ar.rows.map((row) => ({ row, origin: classifyOrOrigin(row) }))
        : [];

    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "n3.financial_verification",
      detail: {
        dateFrom: range.from,
        dateTo: range.to,
        results: run.resources.map((r) => ({
          resource: r.resource,
          status: r.status,
          matched: r.matched,
          pagesFetched: r.pagesFetched,
        })),
      },
    });

    return Response.json(
      { run, derived: { knockoffs, glClassified, orClassified } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[fin-verify] failed", (err as Error).message?.slice(0, 200));
    return deny(502, "verification_failed");
  }
}

export const Route = createFileRoute("/api/n3/financial-verification")({
  server: {
    handlers: {
      POST: handleFinancialVerification,
      GET: methodNotAllowed,
    },
  },
});
