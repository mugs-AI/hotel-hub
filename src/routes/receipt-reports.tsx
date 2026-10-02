import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { ReceiptReports } from "@/components/ReceiptReports";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import type { ReceiptReportFilter } from "@/lib/financial-reporting";
import { useMonthlyFinancialDashboard } from "@/lib/financial-reporting-client";

type Search = { month?: string; tab?: "receipts" | "voided" };

export const Route = createFileRoute("/receipt-reports")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    month: typeof s.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s.month) ? s.month : undefined,
    tab: s.tab === "voided" ? "voided" : s.tab === "receipts" ? "receipts" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Receipt reports — HotelHub" },
      { name: "description", content: "Owner receipt and voided-receipt reports with audit details." },
      { property: "og:title", content: "Receipt reports — HotelHub" },
      { property: "og:description", content: "Owner receipt and voided-receipt reports with audit details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReceiptReportsPage,
});

import { useState } from "react";

function ReceiptReportsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/receipt-reports" });
  const session = useSessionMe();
  const role = session.data?.authenticated === true ? session.data.role : null;
  const allowed = hasPermission(role, "hotel:financial_reports:view");
  // Server decides the current property month when none is given.
  const current = useMonthlyFinancialDashboard(undefined, allowed && !search.month);
  const month = search.month ?? current.data?.period.month;
  const [extra, setExtra] = useState<Omit<ReceiptReportFilter, "month" | "tab">>({
    sort: "documentDate",
    direction: "desc",
    limit: 25,
    offset: 0,
  });
  const filter: ReceiptReportFilter | null = month
    ? { ...extra, month, tab: search.tab ?? "receipts" }
    : null;
  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-[#102A43]">Receipt reports</h1>
        {!allowed ? (
          <p className="text-sm text-slate-600">Only the Owner can see receipt reports.</p>
        ) : filter ? (
          <ReceiptReports
            filter={filter}
            onFilterChange={(f) => {
              const { month: m, tab, ...rest } = f;
              setExtra(rest);
              void navigate({ search: { month: m, tab } });
            }}
          />
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </div>
    </AppShell>
  );
}
