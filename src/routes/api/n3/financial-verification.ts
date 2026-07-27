// Owner-only POST endpoint that runs the N3 Financial Verification console.
// Read-only: only authenticated GETs are ever issued to N3. Never creates,
// updates, voids, matches, refunds, or deletes anything in N3.
import { createFileRoute } from "@tanstack/react-router";
import { destroySession, requirePermission } from "@/lib/session-context.server";
import {
  parseDateRange,
  runFinancialVerification,
  assertNoInternalOrSecretFields,
  FINANCIAL_BUNDLE_SCHEMA_VERSION,
  type NormalizedFilters,
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

  const filters: NormalizedFilters = {};
  if (typeof body.docNumber === "string" && body.docNumber.trim()) filters.docNumber = body.docNumber.trim();
  if (typeof body.hotelReference === "string" && body.hotelReference.trim())
    filters.hotelReference = body.hotelReference.trim();
  if (typeof body.customerCode === "string" && body.customerCode.trim())
    filters.customerCode = body.customerCode.trim();

  let tenantCustomer: { code: string | null } | null = null;
  if (ctx.session.tenantId) {
    try {
      const { getOrCreateHotelSettings } = await import("@/lib/hotel-store.server");
      const settings = await getOrCreateHotelSettings(ctx.session.tenantId);
      tenantCustomer = { code: settings.walkInCustomer?.n3Code ?? null };
    } catch {
      tenantCustomer = null;
    }
  }

  try {
    const { run, bundle } = await runFinancialVerification({
      token: ctx.session.n3Token,
      dateFrom: range.from,
      dateTo: range.to,
      tenant: {
        // Never place tenant.id into any exportable shape.
        code: ctx.session.tenantCode ?? null,
        name: ctx.session.companyName ?? null,
      },
      filters,
      tenantCustomer,
    });

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

    // Belt-and-braces: refuse to send any payload containing internal-only
    // properties or a tenant UUID.
    assertNoInternalOrSecretFields(bundle);

    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "n3.financial_verification",
      detail: {
        schemaVersion: FINANCIAL_BUNDLE_SCHEMA_VERSION,
        runId: run.runId,
        dateFrom: range.from,
        dateTo: range.to,
        results: run.resources.map((r) => ({
          resource: r.resource,
          status: r.status,
          matched: r.matched,
          fetched: r.fetched,
          pagesFetched: r.pagesFetched,
          chosenEndpoint: r.chosenEndpoint,
          contractPassed: r.contractValidation?.passed ?? null,
          detailFanOut: r.detailFanOut
            ? {
                requested: r.detailFanOut.requested,
                performed: r.detailFanOut.performed,
                skipped: r.detailFanOut.skipped,
              }
            : null,
        })),
      },
    });

    // 5d0.3: return the bundle at TOP LEVEL. No internal `run` or `derived`.
    return Response.json(bundle, { headers: { "cache-control": "no-store" } });
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
