// Owner-only POST endpoint that runs the N3 Financial Verification console.
// Read-only: only authenticated GETs are ever issued to N3. Never creates,
// updates, voids, matches, refunds, or deletes anything in N3.
import { createFileRoute } from "@tanstack/react-router";
import { destroySession, requirePermission } from "@/lib/session-context.server";
import {
  parseDateRange,
  runFinancialVerification,
  compareReceiptKnockoffs,
  compareRefundKnockoffs,
  evaluateGlAccount,
  classifyOrOrigin,
  buildFieldMap,
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

  // Load the tenant's configured HotelHub N3 walk-in customer, if any.
  // Used to validate a browser-supplied customerCode filter — we never
  // trust an arbitrary customer id from the client.
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
    const run = await runFinancialVerification({
      token: ctx.session.n3Token,
      dateFrom: range.from,
      dateTo: range.to,
      tenant: {
        id: ctx.session.tenantId,
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

    const ar = run.resources.find((r) => r.resource === "ar_receipts");
    const cs = run.resources.find((r) => r.resource === "cash_sales");
    const rf = run.resources.find((r) => r.resource === "customer_refunds");
    const gl = run.resources.find((r) => r.resource === "gl_accounts");

    const orToCashMemo =
      ar && cs && ar.status === "success" && cs.status === "success"
        ? compareReceiptKnockoffs(ar.matchedRawRows, cs.matchedRawRows)
        : [];
    const refundToOr =
      rf && ar && rf.status === "success" && ar.status === "success"
        ? compareRefundKnockoffs(rf.matchedRawRows, ar.matchedRawRows)
        : [];
    const glEligibility =
      gl && gl.status === "success"
        ? gl.rows.map((row) => {
            const detail = evaluateGlAccount(row);
            return { row, ...detail };
          })
        : [];
    const orClassified =
      ar && ar.status === "success"
        ? ar.rows.map((row) => ({ row, origin: classifyOrOrigin(row) }))
        : [];

    // Bundle-ready derived section that stays browser-safe (raw rows are
    // never returned; only sanitized `rows` from ResourceReport).
    const fieldMaps = {
      arReceipt: ar ? buildFieldMap(ar.rows) : { observed: [] },
      cashSales: cs ? buildFieldMap(cs.rows) : { observed: [] },
      customerRefund: rf ? buildFieldMap(rf.rows) : { observed: [] },
      glAccount: gl ? buildFieldMap(gl.rows) : { observed: [] },
    };

    const conclusions = run.resources.map((r) => ({
      resource: r.resource,
      label: r.mafLabel,
      note: r.note ?? null,
    }));

    // Never return the raw matched rows.
    const publicRun = {
      ...run,
      resources: run.resources.map((r) => {
        const { matchedRawRows: _drop, ...safe } = r;
        void _drop;
        return safe;
      }),
    };

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

    return Response.json(
      {
        run: publicRun,
        derived: {
          knockoffs: orToCashMemo, // legacy alias for the existing UI table
          orToCashMemo,
          refundToOr,
          glClassified: glEligibility.map((g) => ({ row: g.row, eligibility: g.eligibility })),
          glEligibility,
          orClassified,
          fieldMaps,
          conclusions,
        },
      },
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
