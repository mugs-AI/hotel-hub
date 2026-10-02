// Owner-only monthly financial section. Its month selector affects only these
// cards and their reports — never the operational cards above.
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { CardInfoPopover } from "@/components/CardInfoPopover";
import { formatCents } from "@/lib/folio-money";
import type { FinancialMetric } from "@/lib/financial-reporting";
import {
  FinancialClientError,
  financialMessage,
  useCurrentFinancialPeriod,
  useFinancialIdentity,
  useMonthlyFinancialDashboard,
} from "@/lib/financial-reporting-client";
import {
  MIN_FINANCIAL_MONTH,
  MONTH_NAMES,
  type MonthSelection,
  clampMonth,
  formatMonth,
  parseMonth,
  resolveFinancialMonth,
  shiftMonth,
} from "@/lib/month-nav";

export function FinancialDashboard({ enabled }: { enabled: boolean }) {
  const identity = useFinancialIdentity();
  // A selection belongs to the identity that made it; any account/role switch
  // drops it, so a previous tenant's month never carries over.
  const [selection, setSelection] = useState<MonthSelection>(null);
  const period = useCurrentFinancialPeriod(enabled);
  // Latest month offered = this identity's server-derived property month,
  // refreshed independently of the selection (never the browser clock).
  // A failed (re)fetch invalidates the maximum even if React Query still holds
  // older data, so controls, figures and links are hidden until it succeeds.
  const max = identity !== null && !period.isError ? period.data?.month : undefined;
  const shown = resolveFinancialMonth(identity, selection, max);
  const q = useMonthlyFinancialDashboard(shown, enabled && shown !== undefined);
  if (!enabled || identity === null) return null;
  const errorCode = period.isError
    ? period.error instanceof FinancialClientError
      ? period.error.code
      : ""
    : q.isError
      ? q.error instanceof FinancialClientError
        ? q.error.code
        : ""
      : null;
  const loading = !shown || q.isPending;
  // Never render cached figures (amount/count/explanation/verifiedAt) beside an error.
  const data = shown && !q.isError ? q.data : undefined;
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
        {shown && max ? (
          <MonthPicker
            value={shown}
            max={max}
            onChange={(m) => setSelection({ identity, month: m })}
          />
        ) : null}
      </div>
      {errorCode !== null ? (
        <p role="alert" className="text-sm text-red-800">
          {financialMessage(errorCode)}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FinanceCard label="Sales" metric={data?.sales} loading={loading} />
        <FinanceCard
          label="Deposits"
          metric={data?.deposits}
          loading={loading}
          month={shown}
          tab="receipts"
        />
        <FinanceCard label="Collections" metric={data?.collections} loading={loading} />
        <FinanceCard
          label="Voided receipts"
          metric={data?.voids}
          loading={loading}
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

/**
 * Portable month selector: Previous / Next buttons plus month and year
 * dropdowns (no reliance on native type="month", which some browsers render
 * as a plain text box). Changes only the financial section's month.
 */
export function MonthPicker({
  value,
  max,
  onChange,
}: {
  value: string | undefined;
  max: string | undefined;
  onChange: (month: string) => void;
}) {
  const cur = parseMonth(value);
  const maxP = parseMonth(max);
  const minP = parseMonth(MIN_FINANCIAL_MONTH)!;
  const disabled = !cur || !maxP;
  const go = (next: string | null) => {
    if (!next || !max) return;
    onChange(clampMonth(next, MIN_FINANCIAL_MONTH, max));
  };
  const prev = value ? shiftMonth(value, -1) : null;
  const next = value ? shiftMonth(value, 1) : null;
  const years: number[] = [];
  if (maxP) for (let y = maxP.y; y >= minP.y; y--) years.push(y);
  const btn =
    "inline-flex h-9 items-center gap-1 rounded-md border border-input bg-white px-2 text-sm hover:bg-slate-50 disabled:opacity-40";
  return (
    <div
      role="group"
      aria-label="Financial month"
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <button
        type="button"
        className={btn}
        aria-label="Previous month"
        disabled={disabled || !prev || prev < MIN_FINANCIAL_MONTH}
        onClick={() => go(prev)}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Previous</span>
      </button>
      <select
        aria-label="Month"
        className="h-9 rounded-md border border-input bg-white px-2"
        disabled={disabled}
        value={cur?.m ?? ""}
        onChange={(e) => cur && go(formatMonth(cur.y, Number(e.target.value)))}
      >
        {!cur ? <option value="">—</option> : null}
        {MONTH_NAMES.map((name, i) => {
          const candidate = cur ? formatMonth(cur.y, i + 1) : "";
          return (
            <option key={name} value={i + 1} disabled={!!max && candidate > max}>
              {name}
            </option>
          );
        })}
      </select>
      <select
        aria-label="Year"
        className="h-9 rounded-md border border-input bg-white px-2"
        disabled={disabled}
        value={cur?.y ?? ""}
        onChange={(e) => cur && go(formatMonth(Number(e.target.value), cur.m))}
      >
        {!cur ? <option value="">—</option> : null}
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={btn}
        aria-label="Next month"
        disabled={disabled || !next || !max || next > max}
        onClick={() => go(next)}
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
