// Browser-safe, same-origin Owner queries for monthly finance and receipt reports.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSessionMe } from "./session-client";
import { identityFromSession } from "./receipt-controls-client";
import {
  reportFilterParams,
  type MonthlyFinancialDTO,
  type ReceiptReportDTO,
  type ReceiptReportFilter,
} from "./financial-reporting";

export class FinancialClientError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export const FINANCIAL_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Your N3 session expired. Relaunch HotelHub from N3.",
  unauthenticated: "Your session ended. Relaunch HotelHub from N3.",
  forbidden: "Only the Owner can see financial reports.",
  invalid_month: "Choose a valid month.",
  invalid_date_range: "Choose dates inside the selected month, start before end.",
  report_source_incomplete: "Export is unavailable until every receipt can be checked.",
};
export const financialMessage = (code: string) =>
  FINANCIAL_ERROR_MESSAGES[code] ?? "Financial figures could not be loaded. Try again.";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new FinancialClientError(String(body.error ?? "request_failed"));
  return body as T;
}

/** Session-scoped keys; invalidated by receipt-control completion and sign-out. */
export const financialKeys = {
  all: ["financial-reporting"] as const,
  dashboard: (tenantKey: string, month: string | undefined) =>
    ["financial-reporting", tenantKey, "dashboard", month ?? "current"] as const,
  period: (tenantKey: string) => ["financial-reporting", tenantKey, "period"] as const,
  report: (tenantKey: string, f: ReceiptReportFilter) =>
    ["financial-reporting", tenantKey, "report", reportFilterParams(f).toString()] as const,
};

/**
 * Cache namespace = authenticated tenant/user/role. Finance snapshots cached for
 * any other identity are removed as soon as the signed-in account changes.
 */
export function useFinancialIdentity(): string | null {
  const qc = useQueryClient();
  const me = useSessionMe();
  const identity = identityFromSession(me);
  useEffect(() => {
    purgeForeignFinancialCache(qc, identity);
  }, [qc, identity]);
  return identity;
}

export function purgeForeignFinancialCache(
  qc: {
    removeQueries: (f: {
      queryKey: readonly unknown[];
      predicate: (q: { queryKey: readonly unknown[] }) => boolean;
    }) => unknown;
  },
  identity: string | null,
) {
  qc.removeQueries({
    queryKey: financialKeys.all,
    predicate: (q) => identity === null || q.queryKey[1] !== identity,
  });
}

export function useMonthlyFinancialDashboard(month?: string, enabled = true) {
  const identity = useFinancialIdentity();
  const tenantKey = identity ?? "none";
  return useQuery({
    queryKey: financialKeys.dashboard(tenantKey, month),
    queryFn: () =>
      get<MonthlyFinancialDTO>(
        `/api/hotel/financial-dashboard${month ? `?month=${encodeURIComponent(month)}` : ""}`,
      ),
    enabled: enabled && identity !== null,
    retry: false,
    staleTime: 15_000,
  });
}

/**
 * Current property-local month for this authenticated identity (settings-only
 * server read, never the browser clock). Polled so a mounted page gains the
 * next month after the property rolls over.
 */
export function useCurrentFinancialPeriod(enabled = true) {
  const identity = useFinancialIdentity();
  return useQuery({
    queryKey: financialKeys.period(identity ?? "none"),
    queryFn: () => get<{ month: string }>("/api/hotel/financial-period"),
    enabled: enabled && identity !== null,
    retry: false,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

export function useReceiptReport(filter: ReceiptReportFilter, enabled = true) {
  const identity = useFinancialIdentity();
  const tenantKey = identity ?? "none";
  return useQuery({
    queryKey: financialKeys.report(tenantKey, filter),
    queryFn: () =>
      get<ReceiptReportDTO>(`/api/hotel/receipt-reports?${reportFilterParams(filter)}`),
    enabled: enabled && identity !== null,
    retry: false,
    staleTime: 15_000,
  });
}

export function receiptReportExportUrl(filter: ReceiptReportFilter): string {
  const p = reportFilterParams(filter);
  p.delete("limit");
  p.delete("offset");
  return `/api/hotel/receipt-reports/export?${p}`;
}
