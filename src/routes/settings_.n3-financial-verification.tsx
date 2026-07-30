// Owner-only Financial Verification console.
// Read-only. Does not persist mappings or write to N3.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const SOFT_BG = "#F4F8FC";

export const Route = createFileRoute("/settings_/n3-financial-verification")({
  head: () => ({
    meta: [
      { title: "N3 Financial Verification — HotelHub" },
      {
        name: "description",
        content:
          "Owner-only read-only console that verifies live N3 Cloud AR Receipts, Cash Sales, Customer Refunds and GL Chart of Accounts before enabling payment writes.",
      },
      { property: "og:title", content: "N3 Financial Verification — HotelHub" },
      {
        property: "og:description",
        content:
          "Discover the live N3 Cloud contract for HotelHub payments through a controlled, read-only inquiry.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinancialVerificationPage,
});

// ---- Types mirror the server response shape --------------------------------
type MafLabel =
  | "Documented Contract"
  | "Live N3 Confirmed"
  | "Desktop Supporting Evidence"
  | "Inference"
  | "Not Available"
  | "Mismatch";
type FetchStatus = "success" | "unavailable" | "unauthorized" | "invalid_contract" | "failed";
type SanitizedCall = {
  endpoint: string;
  method: string;
  query: Record<string, string>;
  httpStatus: number | null;
  envelopeCode: string | null;
  envelopeMessage: string | null;
  durationMs: number;
  timestamp: string;
  responseSample: unknown;
  error?: string;
};
type ContractValidation = {
  passed: boolean;
  observedFields: string[];
  requiredHits: Record<string, boolean>;
  suspectedResource: string | null;
  reason: string;
};
type FilterDiagnostic = {
  resource: string;
  requested: Record<string, string>;
  resolvedFields: Record<string, string | null>;
  beforeCount: number;
  afterCount: number;
  mismatches: string[];
  rejected?: { field: string; reason: string };
};
type DetailEvidence = {
  sourceListId: string;
  sourceListDocNo: string | null;
  endpoint: string;
  httpStatus: number | null;
  envelopeCode: string | null;
  sanitizedSample: unknown;
  fieldNamesObserved: string[];
  error?: string;
  rejectionReason?: string;
};
type DetailFanOut = {
  cap: number;
  requested: number;
  performed: number;
  normalized: number;
  skipped: boolean;
  reason: string | null;
  evidence: DetailEvidence[];
};
type ResourceReport = {
  resource: "ar_receipts" | "cash_sales" | "customer_refunds" | "gl_accounts";
  status: FetchStatus;
  chosenEndpoint: string | null;
  endpointAttempts: SanitizedCall[];
  contractValidation: ContractValidation | null;
  rows: unknown[];
  totalReported: number | null;
  fetched: number;
  matched: number;
  pagesFetched: number;
  truncated: boolean;
  elapsedMs: number;
  mafLabel: MafLabel;
  filterDiagnostic: FilterDiagnostic | null;
  detailFanOut: DetailFanOut | null;
  note?: string;
};
type KnockoffMatch = {
  receiptId: string | null;
  receiptDocNo: string | null;
  docType: string | null;
  docId: string | null;
  docNo: string | null;
  docCode: string | null;
  appliedAmount: number | null;
  candidateCashSalesId: string | null;
  candidateCashSalesDocNo: string | null;
  candidateCashSalesDocCode: string | null;
  sameUuid: boolean | null;
  docNoAgrees: boolean | null;
  customerMatch: boolean | null;
  correlation: "immutable_id" | "document_number_only" | "mismatch" | "not_available";
  evidenceLabel: string;
};
type RefundKnockoffMatch = {
  refundId: string | null;
  refundDocNo: string | null;
  docType: string | null;
  docId: string | null;
  docNo: string | null;
  appliedAmount: number | null;
  candidateReceiptId: string | null;
  candidateReceiptDocNo: string | null;
  sameUuid: boolean | null;
  correlation: string;
  evidenceLabel: string;
};
type GlEligibilityRow = {
  row: unknown;
  eligibility: "bank" | "cash" | "unknown" | "ineligible";
  reasons: string[];
  normalizedSpecialType: string | null;
  active: boolean | null;
  posting: boolean | null;
};
type Bundle = {
  schemaVersion: string;
  runId: string;
  runAt: string;
  tenant: { code: string | null; name: string | null };
  dateRange: { from: string; to: string };
  filters: Record<string, string>;
  resources: ResourceReport[];
  comparisons: { orToCashMemo: KnockoffMatch[]; refundToOr: RefundKnockoffMatch[] };
  glEligibility: GlEligibilityRow[];
  fieldMaps: Record<string, { observed: string[] }>;
  conclusions: { resource: string; label: MafLabel; note: string | null }[];
  refundLinkState?: {
    state: "linked" | "unapplied" | "not_available";
    label: string;
    note: string;
    acceptedRefundDetails: number;
    refundsWithKnockoffs: number;
    comparisonRows: number;
  };
  elapsedMs: number;
};

type ApiResponse = Bundle;

function todayKL(): string {
  // Malaysia is UTC+8, no DST.
  const now = new Date();
  const kl = new Date(now.getTime() + 8 * 3600_000);
  return kl.toISOString().slice(0, 10);
}
function daysAgoKL(n: number): string {
  const now = new Date();
  const kl = new Date(now.getTime() + 8 * 3600_000 - n * 86_400_000);
  return kl.toISOString().slice(0, 10);
}
function fmtDMY(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function FinancialVerificationPage() {
  return (
    <AppShell>
      <div className="min-h-full" style={{ backgroundColor: SOFT_BG }}>
        <Inner />
      </div>
    </AppShell>
  );
}

function Inner() {
  const session = useSessionMe();
  if (session.isLoading || !session.data) return null;
  if (session.data.authenticated === false) return null;
  if (!hasPermission(session.data.role, "n3:financial_verify")) {
    return (
      <div className="mx-auto max-w-3xl p-6 sm:p-8">
        <div
          className="rounded-xl border bg-white p-6 text-sm shadow-sm"
          style={{ borderColor: `${NAVY}22`, borderLeft: `4px solid ${GOLD}` }}
        >
          <p className="font-semibold" style={{ color: NAVY }}>
            Owner-only tool
          </p>
          <p className="mt-1 text-muted-foreground">
            The N3 Financial Verification console is available to hotel owners only.
          </p>
        </div>
      </div>
    );
  }
  return <Console />;
}

function Console() {
  const [dateFrom, setDateFrom] = useState<string>(daysAgoKL(6));
  const [dateTo, setDateTo] = useState<string>(todayKL());
  const [docNumber, setDocNumber] = useState("");
  const [hotelReference, setHotelReference] = useState("");
  const [customerCode, setCustomerCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  async function runVerification() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/n3/financial-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateFrom,
          dateTo,
          docNumber: docNumber.trim() || undefined,
          hotelReference: hotelReference.trim() || undefined,
          customerCode: customerCode.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(String(body.error ?? `HTTP ${res.status}`));
        return;
      }
      const body = (await res.json()) as ApiResponse;
      setData(body);
    } catch (e) {
      setError((e as Error).message ?? "network_error");
    } finally {
      setLoading(false);
    }
  }

  const rangeInvalid = useMemo(() => {
    if (!dateFrom || !dateTo) return "Both dates are required.";
    if (dateTo < dateFrom) return "Date To cannot be before Date From.";
    const days = Math.floor((Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000) + 1;
    if (days > 31) return "Range is limited to 31 days.";
    return null;
  }, [dateFrom, dateTo]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: TEAL }}
        >
          Hotel settings › Verification
        </p>
        <h1
          className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl"
          style={{ color: NAVY }}
        >
          N3 Financial Verification
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Read-only console. Discovers the live N3 Cloud contract for AR Receive Payments, Cash
          Sales, Customer Refunds, and the GL Chart of Accounts used for deposits and refunds. It
          does not create, void, match, or refund any N3 transaction.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          <Link to="/settings" className="underline">
            ← Back to Settings
          </Link>
        </p>
      </header>

      <section
        className="rounded-xl border bg-white p-5 shadow-sm"
        style={{ borderColor: `${NAVY}1F` }}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="date-from">Date From ({fmtDMY(dateFrom)})</Label>
            <Input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="date-to">Date To ({fmtDMY(dateTo)})</Label>
            <Input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="doc-no">N3 document number (optional)</Label>
            <Input
              id="doc-no"
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              placeholder="OR-000123"
            />
          </div>
          <div>
            <Label htmlFor="hh-ref">HotelHub Reference No. (optional)</Label>
            <Input
              id="hh-ref"
              value={hotelReference}
              onChange={(e) => setHotelReference(e.target.value)}
              placeholder="HH-2026-000045"
            />
          </div>
          <div>
            <Label htmlFor="cust-code">Customer Code (optional)</Label>
            <Input
              id="cust-code"
              value={customerCode}
              onChange={(e) => setCustomerCode(e.target.value)}
              placeholder="700-C001"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              disabled={loading || !!rangeInvalid}
              onClick={runVerification}
              className="w-full"
              style={{ backgroundColor: TEAL, color: "white" }}
            >
              {loading ? "Fetching…" : "Get Result"}
            </Button>
          </div>
        </div>
        {rangeInvalid ? (
          <p className="mt-3 text-xs" style={{ color: "#C2413B" }}>
            {rangeInvalid}
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 text-xs" style={{ color: "#C2413B" }}>
            {error === "n3_unauthorized"
              ? "Your N3 session has expired. Reopen HotelHub from N3 → Marketplace → My Apps."
              : `Verification error: ${error}`}
          </p>
        ) : null}
      </section>

      {data ? <RunSummary data={data} /> : null}
      {data ? <ResourceSections data={data} /> : null}
    </div>
  );
}

function StatusBadge({ status }: { status: FetchStatus }) {
  const color =
    status === "success"
      ? TEAL
      : status === "unauthorized"
        ? "#C2413B"
        : status === "invalid_contract" || status === "failed"
          ? GOLD
          : "#8B98A9";
  const label =
    status === "success"
      ? "Success"
      : status === "unauthorized"
        ? "Unauthorized"
        : status === "invalid_contract"
          ? "Invalid contract"
          : status === "unavailable"
            ? "Unavailable"
            : "Failed";
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  );
}

function MafBadge({ label }: { label: MafLabel }) {
  const bg =
    label === "Live N3 Confirmed"
      ? TEAL
      : label === "Documented Contract"
        ? NAVY
        : label === "Mismatch"
          ? "#C2413B"
          : label === "Not Available"
            ? "#8B98A9"
            : GOLD;
  return (
    <span
      className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
      style={{ backgroundColor: bg }}
      title={`MAF Evidence: ${label}`}
    >
      {label}
    </span>
  );
}

function RunSummary({ data }: { data: ApiResponse }) {
  const run = data;
  return (
    <section
      className="rounded-xl border bg-white p-5 shadow-sm"
      style={{ borderColor: `${NAVY}1F` }}
    >
      <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
        Run Summary
      </h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Run at</dt>
          <dd className="font-medium">{new Date(run.runAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Tenant</dt>
          <dd className="font-medium">
            {run.tenant.name ?? "—"} {run.tenant.code ? `(${run.tenant.code})` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Range</dt>
          <dd className="font-medium">
            {fmtDMY(run.dateRange.from)} — {fmtDMY(run.dateRange.to)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Elapsed</dt>
          <dd className="font-medium">{run.elapsedMs} ms</dd>
        </div>
      </dl>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {run.resources.map((r: ResourceReport) => (
          <div
            key={r.resource}
            className="rounded-lg border p-3 text-xs"
            style={{ borderColor: `${NAVY}14` }}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold" style={{ color: NAVY }}>
                {labelFor(r.resource)}
              </span>
              <StatusBadge status={r.status} />
            </div>
            <p className="mt-1 text-muted-foreground">
              {r.matched} matched / {r.fetched} fetched · {r.pagesFetched} pages
              {r.truncated ? " · truncated" : ""}
            </p>
            {r.note ? <p className="mt-1">{r.note}</p> : null}
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(data, null, 2));
          }}
        >
          Copy Verification Bundle
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const ts = run.runAt.replace(/[-:.]/g, "").slice(0, 15); // YYYYMMDDTHHMMSS
            const refPart = (
              run.filters.hotelReference ||
              run.filters.docNumber ||
              "noref"
            ).replace(/[^A-Za-z0-9-]/g, "");
            const blob = new Blob([JSON.stringify(data, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `hotelhub-5d0-${ts}-${refPart}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download JSON
        </Button>
      </div>
    </section>
  );
}

function labelFor(r: ResourceReport["resource"]): string {
  switch (r) {
    case "ar_receipts":
      return "Receive Payments (OR)";
    case "cash_sales":
      return "Cash Memos (Cash Sales)";
    case "customer_refunds":
      return "Customer Refunds (RF)";
    case "gl_accounts":
      return "Payment Accounts (GL)";
  }
}

function ResourceSections({ data }: { data: ApiResponse }) {
  const map = new Map<string, ResourceReport>(
    data.resources.map((r: ResourceReport) => [r.resource, r] as const),
  );
  return (
    <>
      <ResourceCard report={map.get("ar_receipts")!} />
      <ResourceCard report={map.get("cash_sales")!} />
      <KnockoffCard data={data} />
      <ResourceCard report={map.get("customer_refunds")!} />
      <RefundKnockoffCard data={data} />
      <ResourceCard report={map.get("gl_accounts")!} extra={<GlAccountsTable data={data} />} />
    </>
  );
}

function RefundKnockoffCard({ data }: { data: ApiResponse }) {
  const rows = data.comparisons.refundToOr ?? [];
  const derived = data.refundLinkState ?? {
    state: rows.length ? ("linked" as const) : ("not_available" as const),
    label: rows.length ? "Live N3 Confirmed" : "Not Available",
    note: "",
    acceptedRefundDetails: 0,
    refundsWithKnockoffs: 0,
    comparisonRows: rows.length,
  };
  const badgeColor =
    derived.state === "linked" ? TEAL : derived.state === "unapplied" ? GOLD : "#8B98A9";
  return (
    <section
      className="rounded-xl border bg-white p-5 shadow-sm"
      style={{ borderColor: `${NAVY}1F` }}
    >
      <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
        Refund ↔ OR Identity Check{" "}
        <span
          data-testid="refund-link-state"
          className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: badgeColor }}
        >
          {derived.label}
        </span>
      </h2>
      {derived.state !== "linked" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {derived.note ||
            (derived.state === "unapplied"
              ? "The Customer Refund was retrieved successfully but currently has no AR Receipt (OR) knockoff."
              : "No refund knockoff rows matched an AR Receipt in this date range.")}
        </p>
      ) : (

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase text-muted-foreground">
                <th className="p-2">Refund (RF)</th>
                <th className="p-2">Knockoff DocId</th>
                <th className="p-2">OR UUID</th>
                <th className="p-2">Same UUID?</th>
                <th className="p-2">Applied</th>
                <th className="p-2">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k: RefundKnockoffMatch, i: number) => (
                <tr key={i} className="border-t align-top">
                  <td className="p-2">
                    {k.refundDocNo}
                    <br />
                    <span className="text-muted-foreground">{k.refundId}</span>
                  </td>
                  <td className="p-2">
                    {k.docNo ?? "—"}
                    <br />
                    <span className="text-muted-foreground">{k.docId ?? "—"}</span>
                  </td>
                  <td className="p-2">
                    {k.candidateReceiptDocNo ?? "—"}
                    <br />
                    <span className="text-muted-foreground">{k.candidateReceiptId ?? "—"}</span>
                  </td>
                  <td className="p-2">{k.sameUuid === null ? "—" : k.sameUuid ? "Yes" : "No"}</td>
                  <td className="p-2">{k.appliedAmount ?? "—"}</td>
                  <td className="p-2">{k.evidenceLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ResourceCard({ report, extra }: { report: ResourceReport; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section
      className="rounded-xl border bg-white p-5 shadow-sm"
      style={{ borderColor: `${NAVY}1F` }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
          {labelFor(report.resource)} <MafBadge label={report.mafLabel} />
        </h2>
        <StatusBadge status={report.status} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Endpoint:{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5">
          {report.chosenEndpoint ?? "— none matched —"}
        </code>{" "}
        · {report.matched} matched / {report.fetched} fetched · {report.pagesFetched} pages ·{" "}
        {report.elapsedMs} ms {report.truncated ? "· truncated" : ""}
      </p>
      {report.contractValidation ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Contract: {report.contractValidation.passed ? "passed" : "FAILED"} —{" "}
          {report.contractValidation.reason}
          {report.contractValidation.suspectedResource
            ? ` (suspected: ${report.contractValidation.suspectedResource})`
            : ""}
        </p>
      ) : null}
      {report.filterDiagnostic ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Filter: {report.filterDiagnostic.beforeCount} → {report.filterDiagnostic.afterCount}
          {report.filterDiagnostic.mismatches.length
            ? ` · missing fields: ${report.filterDiagnostic.mismatches.join(", ")}`
            : ""}
          {report.filterDiagnostic.rejected
            ? ` · rejected ${report.filterDiagnostic.rejected.field}: ${report.filterDiagnostic.rejected.reason}`
            : ""}
        </p>
      ) : null}
      {report.detailFanOut ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Detail reads: {report.detailFanOut.performed} performed / {report.detailFanOut.requested}{" "}
          requested · {report.detailFanOut.normalized} normalized (cap {report.detailFanOut.cap})
          {report.detailFanOut.skipped
            ? ` · skipped: ${report.detailFanOut.reason ?? "unknown"}`
            : ""}
        </p>
      ) : null}
      {extra}
      <div className="mt-3">
        <button type="button" className="text-xs underline" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"} sanitized evidence ({report.endpointAttempts.length} call
          {report.endpointAttempts.length === 1 ? "" : "s"}
          {report.detailFanOut ? `, ${report.detailFanOut.evidence.length} detail` : ""})
        </button>
        {open ? (
          <pre className="mt-2 max-h-80 overflow-auto rounded bg-slate-950 p-3 text-[11px] leading-snug text-slate-100">
            {JSON.stringify(
              {
                endpointAttempts: report.endpointAttempts,
                contractValidation: report.contractValidation,
                filterDiagnostic: report.filterDiagnostic,
                detailFanOut: report.detailFanOut,
                sample: report.rows.slice(0, 3),
              },
              null,
              2,
            )}
          </pre>
        ) : null}
      </div>
    </section>
  );
}

function KnockoffCard({ data }: { data: ApiResponse }) {
  const rows = data.comparisons.orToCashMemo;
  return (
    <section
      className="rounded-xl border bg-white p-5 shadow-sm"
      style={{ borderColor: `${NAVY}1F` }}
    >
      <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
        OR ↔ Cash Memo Identity Check{" "}
        <MafBadge label={rows.length ? "Live N3 Confirmed" : "Not Available"} />
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No INV-type knockoff rows were returned for this date range. Correlation cannot be proven
          without a live matched row.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase text-muted-foreground">
                <th className="p-2">Receipt (OR)</th>
                <th className="p-2">Knockoff DocId</th>
                <th className="p-2">Cash Sales UUID</th>
                <th className="p-2">Same UUID?</th>
                <th className="p-2">Applied</th>
                <th className="p-2">Correlation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k: KnockoffMatch, i: number) => (
                <tr key={i} className="border-t align-top">
                  <td className="p-2">
                    {k.receiptDocNo}
                    <br />
                    <span className="text-muted-foreground">{k.receiptId}</span>
                  </td>
                  <td className="p-2">
                    {k.docNo}
                    <br />
                    <span className="text-muted-foreground">{k.docId}</span>
                  </td>
                  <td className="p-2">
                    {k.candidateCashSalesDocNo ?? "—"}
                    <br />
                    <span className="text-muted-foreground">{k.candidateCashSalesId ?? "—"}</span>
                  </td>
                  <td className="p-2">{k.sameUuid === null ? "—" : k.sameUuid ? "Yes" : "No"}</td>
                  <td className="p-2">{k.appliedAmount ?? "—"}</td>
                  <td className="p-2">
                    {k.correlation === "immutable_id"
                      ? "Immutable ID"
                      : k.correlation === "document_number_only"
                        ? "Document-number correlation only — not proven"
                        : "None"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function GlAccountsTable({ data }: { data: ApiResponse }) {
  const rows = data.glEligibility;
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] uppercase text-muted-foreground">
            <th className="p-2">Code</th>
            <th className="p-2">Name</th>
            <th className="p-2">Special Type</th>
            <th className="p-2">Eligibility</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r: GlEligibilityRow, i: number) => {
            const row = (r.row ?? {}) as Record<string, unknown>;
            return (
              <tr key={i} className="border-t">
                <td className="p-2">{String(row.Code ?? row.code ?? "—")}</td>
                <td className="p-2">{String(row.Name ?? row.name ?? "—")}</td>
                <td className="p-2">{String(row.SpecialType ?? row.specialType ?? "—")}</td>
                <td className="p-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white"
                    style={{
                      backgroundColor:
                        r.eligibility === "bank"
                          ? TEAL
                          : r.eligibility === "cash"
                            ? GOLD
                            : "#8B98A9",
                    }}
                  >
                    {r.eligibility}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 100 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Showing first 100 of {rows.length} accounts.
        </p>
      ) : null}
    </div>
  );
}

function OrOriginTable(_props: { data: ApiResponse }) {
  return null;
}
