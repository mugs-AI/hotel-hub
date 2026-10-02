// Owner-only HTTP handlers for monthly financial cards, receipt reports and
// CSV export. Tenant/actor/currency come only from the server session.
import { FinancialReportError, validateReceiptReportFilter } from "./financial-reporting";
import type { FinancialReportingDeps } from "./financial-reporting-store.server";
import {
  readMonthlyFinancialDashboard,
  readReceiptReportSnapshot,
} from "./financial-reporting-store.server";
import { receiptReportCsvDocument } from "./receipt-report-export.server";
import { ReceiptControlError } from "./receipt-controls";
import type { ReceiptControlActor } from "./receipt-controls-evidence.server";

export type ActorResult =
  | { ok: true; actor: ReceiptControlActor }
  | { ok: false; reason: "unauthenticated" | "unprovisioned" | "role_unassigned" | "forbidden" };

export type FinancialHttpDeps = {
  actor(): Promise<ActorResult>;
  data(): FinancialReportingDeps;
  onDenied?(reason: string): Promise<void>;
};

const noStore = { "cache-control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

const BAD_INPUT = new Set([
  "invalid_month",
  "invalid_timezone",
  "invalid_filter",
  "unknown_filter",
  "invalid_paging",
  "invalid_date_range",
]);

export type FinancialEndpoint = "dashboard" | "report" | "export";

export async function handleFinancialRequest(
  request: Request,
  endpoint: FinancialEndpoint,
  deps: FinancialHttpDeps,
): Promise<Response> {
  const a = await deps.actor();
  if (!a.ok) {
    await deps.onDenied?.(a.reason);
    return json({ error: a.reason }, a.reason === "unauthenticated" ? 401 : 403);
  }
  if (a.actor.role !== "owner") return json({ error: "forbidden" }, 403);
  const params = new URL(request.url).searchParams;
  try {
    if (endpoint === "dashboard") {
      for (const k of params.keys()) if (k !== "month") return json({ error: "unknown_filter" }, 400);
      if (params.getAll("month").length > 1) return json({ error: "invalid_month" }, 400);
      const dto = await readMonthlyFinancialDashboard(a.actor, params.get("month") ?? undefined, deps.data());
      return json(dto);
    }
    const { filter, sources, rows } = await readReceiptReportSnapshot(
      a.actor,
      params,
      deps.data(),
      validateReceiptReportFilter,
    );
    const status = sources.receipts.status;
    if (endpoint === "report") {
      return json({
        period: sources.period,
        items: rows.slice(filter.offset, filter.offset + filter.limit),
        total: rows.length,
        sourceStatus: status,
        verifiedAt: sources.receipts.verifiedAt,
      });
    }
    // Export the complete matching set — never a page, never an incomplete source.
    if (status !== "complete") return json({ error: "report_source_incomplete" }, 409);
    const csv = receiptReportCsvDocument(rows, {
      period: sources.period,
      tab: filter.tab,
      currency: sources.currency,
      verifiedAt: sources.receipts.verifiedAt,
    });
    return new Response(csv, {
      status: 200,
      headers: {
        ...noStore,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="hotelhub-${filter.tab}-${sources.period.month}.csv"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof FinancialReportError) {
      if (err.code === "forbidden") return json({ error: "forbidden" }, 403);
      if (BAD_INPUT.has(err.code)) return json({ error: err.code }, 400);
      return json({ error: "financial_report_failed" }, 500);
    }
    if (err instanceof ReceiptControlError && err.code === "unauthorized")
      return json({ error: "unauthorized" }, 401);
    console.error("[financial-reporting] request failed", (err as Error).message?.slice(0, 200));
    return json({ error: "financial_report_failed" }, 500);
  }
}

/** Production session wiring. */
export function defaultFinancialHttpDeps(): FinancialHttpDeps {
  return {
    async actor() {
      const { requirePermission } = await import("./session-context.server");
      const { ctx, decision } = await requirePermission("hotel:financial_reports:view");
      if (!decision.ok) return { ok: false, reason: decision.reason };
      return {
        ok: true,
        actor: {
          tenantId: ctx.session.tenantId!,
          n3UserKey: ctx.session.n3UserKey,
          n3Token: ctx.session.n3Token,
          role: ctx.role!,
        },
      };
    },
    data() {
      // Lazily resolved so the module stays light.
      return lazyDeps();
    },
    async onDenied(reason) {
      const { logAudit } = await import("./audit.server");
      await logAudit({ eventType: "hotel.financial_reports.denied", detail: { reason } });
    },
  };
}

let cached: FinancialReportingDeps | null = null;
function lazyDeps(): FinancialReportingDeps {
  if (!cached) {
    // Imported synchronously by callers through the dynamic route import.
    throw new Error("financial deps not initialised");
  }
  return cached;
}
export function setFinancialDeps(d: FinancialReportingDeps) {
  cached = d;
}
