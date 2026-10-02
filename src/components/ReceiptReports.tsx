// Owner receipt / voided-receipt reports: server-filtered, sorted and paged rows
// from the same verified snapshot as the Dashboard cards.
import { N3ReceiptPrintLink } from "@/components/N3ReceiptPrintLink";
import { MalaysianDateInput } from "@/components/malaysia-date-input";
import { formatCents } from "@/lib/folio-money";
import { isoToMyDate } from "@/lib/malaysia-date";
import {
  RECEIPT_STATUS_LABEL,
  type ReceiptReportDTO,
  type ReceiptReportFilter,
  type ReceiptRowStatus,
} from "@/lib/financial-reporting";
import {
  FinancialClientError,
  financialMessage,
  receiptReportExportUrl,
  useReceiptReport,
} from "@/lib/financial-reporting-client";

const money = (n: number, c: string) => formatCents(Math.round(n * 100), c);

function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, "0")}`;
}

export function ReceiptReports({
  filter,
  onFilterChange,
  enabled = true,
}: {
  filter: ReceiptReportFilter;
  onFilterChange: (f: ReceiptReportFilter) => void;
  enabled?: boolean;
}) {
  const q = useReceiptReport(filter, enabled);
  const set = (patch: Partial<ReceiptReportFilter>) =>
    onFilterChange({ ...filter, offset: 0, ...patch });
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-2">
        {(["receipts", "voided"] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={filter.tab === tab}
            type="button"
            onClick={() => set({ tab, status: undefined })}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${filter.tab === tab ? "border-teal-700 bg-teal-50 text-teal-900" : "border-input bg-white"}`}
          >
            {tab === "receipts" ? "Receipts" : "Voided receipts"}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Month">
          <input
            type="month"
            value={filter.month}
            onChange={(e) =>
              /^\d{4}-\d{2}$/.test(e.target.value) &&
              set({ month: e.target.value, fromDate: undefined, toDate: undefined })
            }
            className={inp}
          />
        </Field>
        <Field label="From">
          <MalaysianDateInput
            value={filter.fromDate ?? ""}
            minIso={`${filter.month}-01`}
            maxIso={lastDay(filter.month)}
            pickerLabel="Choose the start date"
            aria-label="From date"
            onChange={(iso) => set({ fromDate: iso || undefined })}
          />
        </Field>
        <Field label="To">
          <MalaysianDateInput
            value={filter.toDate ?? ""}
            minIso={filter.fromDate ?? `${filter.month}-01`}
            maxIso={lastDay(filter.month)}
            pickerLabel="Choose the end date"
            aria-label="To date"
            onChange={(iso) => set({ toDate: iso || undefined })}
          />
        </Field>
        <Field label="Booking ref">
          <input
            maxLength={100}
            value={filter.bookingReference ?? ""}
            onChange={(e) => set({ bookingReference: e.target.value || undefined })}
            className={inp}
          />
        </Field>
        <Field label="Receipt no.">
          <input
            maxLength={100}
            value={filter.receiptNumber ?? ""}
            onChange={(e) => set({ receiptNumber: e.target.value || undefined })}
            className={inp}
          />
        </Field>
        {filter.tab === "receipts" ? (
          <Field label="Status">
            <select
              value={filter.status ?? ""}
              onChange={(e) =>
                set({ status: (e.target.value || undefined) as ReceiptRowStatus | undefined })
              }
              className={inp}
            >
              <option value="">All</option>
              {(Object.keys(RECEIPT_STATUS_LABEL) as ReceiptRowStatus[]).map((s) => (
                <option key={s} value={s}>
                  {RECEIPT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      <ReportStatus data={q.data} />
      {q.isError ? (
        <p role="alert" className="text-sm text-red-800">
          {financialMessage(q.error instanceof FinancialClientError ? q.error.code : "")}
        </p>
      ) : null}
      <ReceiptReportTable
        data={q.data}
        filter={filter}
        onSort={(sort) =>
          set({
            sort,
            direction: filter.sort === sort && filter.direction === "desc" ? "asc" : "desc",
          })
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{q.data ? `${q.data.total} row${q.data.total === 1 ? "" : "s"}` : ""}</span>
        <div className="flex items-center gap-2">
          <select
            aria-label="Rows per page"
            value={filter.limit}
            onChange={(e) => set({ limit: Number(e.target.value) as 25 | 50 | 100 })}
            className={inp}
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </select>
          <button
            type="button"
            className={btn}
            disabled={filter.offset === 0}
            onClick={() =>
              onFilterChange({ ...filter, offset: Math.max(0, filter.offset - filter.limit) })
            }
          >
            Previous
          </button>
          <button
            type="button"
            className={btn}
            disabled={!q.data || filter.offset + filter.limit >= q.data.total}
            onClick={() => onFilterChange({ ...filter, offset: filter.offset + filter.limit })}
          >
            Next
          </button>
          {q.data?.sourceStatus === "complete" ? (
            <a className={btn} href={receiptReportExportUrl(filter)} download>
              Export CSV
            </a>
          ) : (
            <span className="text-xs text-slate-500">Export needs every receipt checked</span>
          )}
        </div>
      </div>
    </div>
  );
}

const inp = "w-full rounded-md border border-input bg-white px-2 py-1 text-sm";
const btn =
  "rounded-md border border-input bg-white px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function ReportStatus({ data }: { data: ReceiptReportDTO | undefined }) {
  if (!data) return null;
  const text =
    data.sourceStatus === "unavailable"
      ? "Unavailable — not every receipt could be checked in N3. Try again."
      : data.sourceStatus === "needs_review"
        ? "Some receipts need review in N3."
        : "Current verified state from N3, not a closing balance.";
  return (
    <p
      className={`text-sm ${data.sourceStatus === "complete" ? "text-slate-600" : "text-amber-800"}`}
    >
      {text}
      {data.verifiedAt ? ` Checked ${new Date(data.verifiedAt).toLocaleString("en-MY")}.` : ""}
    </p>
  );
}

export function ReceiptReportTable({
  data,
  filter,
  onSort,
}: {
  data: ReceiptReportDTO | undefined;
  filter: ReceiptReportFilter;
  onSort?: (s: ReceiptReportFilter["sort"]) => void;
}) {
  const voided = filter.tab === "voided";
  const arrow = (k: ReceiptReportFilter["sort"]) =>
    filter.sort === k ? (filter.direction === "asc" ? " ↑" : " ↓") : "";
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600">
          <tr>
            <th className="p-2">
              <button type="button" onClick={() => onSort?.("documentCode")}>
                Receipt{arrow("documentCode")}
              </button>
            </th>
            <th className="p-2">
              <button type="button" onClick={() => onSort?.("documentDate")}>
                {voided ? "Voided on" : "Date"}
                {arrow("documentDate")}
              </button>
            </th>
            <th className="p-2">Booking</th>
            <th className="p-2">Customer</th>
            <th className="p-2">Payment account</th>
            <th className="p-2 text-right">{voided ? "Amount before void" : "Amount"}</th>
            <th className="p-2">Status</th>
            <th className="p-2">Audit</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {data?.items.length === 0 ? (
            <tr>
              <td colSpan={9} className="p-4 text-center text-slate-500">
                {data.sourceStatus === "unavailable"
                  ? "Unavailable"
                  : "No receipts for these filters."}
              </td>
            </tr>
          ) : null}
          {data?.items.map((r) => (
            <tr key={r.id} className="border-t border-slate-100 align-top">
              <td className="p-2 font-medium">{r.receiptNumber}</td>
              <td className="p-2">{isoToMyDate(r.documentDate)}</td>
              <td className="p-2">{r.bookingReference}</td>
              <td className="p-2">{r.customerLabel}</td>
              <td className="p-2">
                {r.savedPaymentName ?? "—"}
                {r.accountCode ? (
                  <span className="block text-xs text-slate-500">{r.accountCode}</span>
                ) : null}
              </td>
              <td className="p-2 text-right">
                {money(r.amount, r.currency)}
                {r.creationAmount !== r.amount ? (
                  <span className="block text-xs text-slate-500">
                    Original {money(r.creationAmount, r.currency)}
                  </span>
                ) : null}
              </td>
              <td className="p-2">
                {RECEIPT_STATUS_LABEL[r.status]}
                {r.replacementOf ? (
                  <span className="block text-xs">Replaces {r.replacementOf.slice(0, 8)}…</span>
                ) : null}
                {r.replacementReceiptId ? (
                  <span className="block text-xs">
                    Replaced by {r.replacementReceiptId.slice(0, 8)}…
                  </span>
                ) : null}
              </td>
              <td className="p-2 text-xs">
                {r.requesterLabel ? (
                  <span className="block">Requested: {r.requesterLabel}</span>
                ) : null}
                {r.approverLabel ? (
                  <span className="block">Approved: {r.approverLabel}</span>
                ) : null}
                {r.reason ? <span className="block">Reason: {r.reason}</span> : null}
              </td>
              <td className="p-2">
                {r.amount > 0 || voided ? (
                  <N3ReceiptPrintLink status="posted" receiptId={r.receiptId} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
