// Browser-safe, same-origin Owner queries for monthly finance and receipt reports.
import { useQuery } from "@tanstack/react-query";
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
  report: (tenantKey: string, f: ReceiptReportFilter) =>
    ["financial-reporting", tenantKey, "report", reportFilterParams(f).toString()] as const,
};

export function useMonthlyFinancialDashboard(month?: string, enabled = true, tenantKey = "session") {
  return useQuery({
    queryKey: financialKeys.dashboard(tenantKey, month),
    queryFn: () =>
      get<MonthlyFinancialDTO>(
        `/api/hotel/financial-dashboard${month ? `?month=${encodeURIComponent(month)}` : ""}`,
      ),
    enabled,
    retry: false,
    staleTime: 15_000,
  });
}

export function useReceiptReport(filter: ReceiptReportFilter, enabled = true, tenantKey = "session") {
  return useQuery({
    queryKey: financialKeys.report(tenantKey, filter),
    queryFn: () => get<ReceiptReportDTO>(`/api/hotel/receipt-reports?${reportFilterParams(filter)}`),
    enabled,
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
