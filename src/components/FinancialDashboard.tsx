// Owner-only monthly financial section. Its month selector affects only these
// cards and their reports — never the operational cards above.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CardInfoPopover } from "@/components/CardInfoPopover";
import { formatCents } from "@/lib/folio-money";
import type { FinancialMetric } from "@/lib/financial-reporting";
import {
  FinancialClientError,
  financialMessage,
  useMonthlyFinancialDashboard,
} from "@/lib/financial-reporting-client";

export function FinancialDashboard({ enabled }: { enabled: boolean }) {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const q = useMonthlyFinancialDashboard(month, enabled);
  if (!enabled) return null;
  const shown = month ?? q.data?.period.month;
  return (
    <section
      aria-label="Monthly finance"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-[#102A43]">Monthly finance</h2>
          <CardInfoPopover label="About Monthly finance">
            Current verified state from N3, not a closing balance. Deposits are part of collections
            — do not add the two cards together. Prepared folios are never counted as sales.
          </CardInfoPopover>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Month
          <input
            type="month"
            aria-label="Financial month"
            value={shown ?? ""}
            onChange={(e) =>
              setMonth(/^\d{4}-\d{2}$/.test(e.target.value) ? e.target.value : undefined)
            }
            className="rounded-md border border-input px-2 py-1"
          />
        </label>
      </div>
      {q.isError ? (
        <p role="alert" className="text-sm text-red-800">
          {financialMessage(q.error instanceof FinancialClientError ? q.error.code : "")}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FinanceCard label="Sales" metric={q.data?.sales} loading={q.isPending} />
        <FinanceCard
          label="Deposits"
          metric={q.data?.deposits}
          loading={q.isPending}
          month={shown}
          tab="receipts"
        />
        <FinanceCard label="Collections" metric={q.data?.collections} loading={q.isPending} />
        <FinanceCard
          label="Voided receipts"
          metric={q.data?.voids}
          loading={q.isPending}
          month={shown}
          tab="voided"
        />
      </div>
      <p className="text-xs text-slate-500">Deposits are included in Collections.</p>
    </section>
  );
}

export function FinanceCard({
  label,
  metric,
  loading,
  month,
  tab,
}: {
  label: string;
  metric: FinancialMetric | undefined;
  loading?: boolean;
  month?: string;
  tab?: "receipts" | "voided";
}) {
  const value =
    loading || !metric
      ? "—"
      : metric.amount === null
        ? "Unavailable"
        : formatCents(Math.round(metric.amount * 100), metric.currency);
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {metric?.count !== null && metric?.count !== undefined && metric.amount !== null ? (
        <p className="text-xs">
          {metric.count} receipt{metric.count === 1 ? "" : "s"}
        </p>
      ) : null}
      {metric?.explanation ? <p className="mt-1 text-xs">{metric.explanation}</p> : null}
      {metric?.verifiedAt ? (
        <p className="mt-1 text-xs text-slate-500">
          Checked {new Date(metric.verifiedAt).toLocaleString("en-MY")}
        </p>
      ) : null}
    </>
  );
  const tone =
    metric?.status === "unavailable"
      ? "border-slate-200 bg-slate-50 text-slate-700"
      : metric?.status === "needs_review"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-teal-200 bg-teal-50 text-teal-900";
  const cls = `block rounded-xl border p-4 ${tone}`;
  if (tab && month)
    return (
      <Link to="/receipt-reports" search={{ month, tab }} className={`${cls} hover:shadow-md`}>
        {body}
      </Link>
    );
  return <div className={cls}>{body}</div>;
}
