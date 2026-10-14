import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SESSION_QUERY_KEY, useSessionMe } from "@/lib/session-client";
import type { ConfiguredMasterIds } from "@/lib/n3-settlement-master-config.server";
import { isN3Guid } from "@/lib/n3-guid";
import type {
  MasterCapture,
  MasterCaptureInput,
  MasterKind,
} from "@/lib/n3-settlement-master-diagnostics.server";
const kinds: Array<{ kind: MasterKind; label: string }> = [
  { kind: "customer", label: "Customer IDs" },
  { kind: "currency", label: "Currency IDs" },
  { kind: "stock", label: "Stock IDs" },
  { kind: "uom", label: "UOM IDs" },
  { kind: "tax", label: "Tax code IDs" },
  { kind: "account", label: "Posting account IDs" },
];
const failureMessages: Record<string, string> = {
  transport_error: "Request failed before an HTTP response was recorded",
  request_timeout: "Request timed out",
  batch_deadline: "Not attempted: batch time limit reached",
  response_limit: "Response size limit reached",
  redirect_refused: "Redirect refused; credentials were not forwarded",
  http_error: "N3 returned an unsuccessful HTTP status",
  body_unavailable: "Response body unavailable",
  invalid_response: "Response could not be verified as an N3 master record",
};
export function BillingMasterCapturePanel() {
  const me = useSessionMe();
  if (!me.data?.authenticated || me.data.role !== "owner") return null;
  return <Panel key={`${me.data.tenant.tenantId}:${me.data.user.n3UserKey}:${me.data.role}`} />;
}
function Panel() {
  const qc = useQueryClient();
  const [values, setValues] = useState<Partial<Record<MasterKind, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MasterCapture | null>(null);
  const [configured, setConfigured] = useState<ConfiguredMasterIds | null>(null);
  const [batch, setBatch] = useState(0);
  const batchReports = useRef(new Map<number, MasterCapture>());
  const pending = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  function fillBatch(saved: ConfiguredMasterIds, index: number) {
    const next: Partial<Record<MasterKind, string>> = {};
    for (const row of saved.masters.slice(index * 20, (index + 1) * 20))
      next[row.kind] = next[row.kind] ? `${next[row.kind]}, ${row.id}` : String(row.id);
    setValues(next);
    setBatch(index);
    setError(null);
    setReport(batchReports.current.get(index) ?? null);
  }
  async function loadSaved() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/n3/settlement-master-capture", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!live.current) return;
      if (response.status === 401) {
        setError("Your session ended. Open HotelHub from N3 again.");
        void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
        return;
      }
      if (!response.ok) {
        setError(
          response.status === 403
            ? "Only the Owner can load saved billing IDs."
            : "Unable to load saved billing IDs. Check your connection and try again.",
        );
        return;
      }
      const saved = body.configured;
      const seen = new Set<string>();
      if (
        saved?.schemaVersion !== "hh-configured-master-ids-v1" ||
        saved.contractAccepted !== false ||
        !Number.isSafeInteger(saved.invalidReferenceCount) ||
        saved.invalidReferenceCount < 0 ||
        !Array.isArray(saved.missingKinds) ||
        saved.missingKinds.some((kind: unknown) => !kinds.some((k) => k.kind === kind)) ||
        !Array.isArray(saved.masters) ||
        saved.masters.length > 1000 ||
        saved.masters.some((row: unknown) => {
          if (!row || typeof row !== "object") return true;
          const { kind, id } = row as { kind: MasterKind; id: unknown };
          if (
            !kinds.some((k) => k.kind === kind) ||
            !(kind === "account"
              ? isN3Guid(id)
              : typeof id === "number" && Number.isInteger(id) && id > 0 && id <= 2147483647)
          )
            return true;
          const key = `${kind}:${String(id).toLowerCase()}`;
          if (seen.has(key)) return true;
          seen.add(key);
          return false;
        })
      ) {
        setError("The saved billing IDs response is incomplete. Ask Admin to review it.");
        return;
      }
      if (!saved.masters.length) {
        setError("No usable billing IDs are saved yet. Check Room & Rates and Financial Settings.");
        return;
      }
      const projected: ConfiguredMasterIds = {
        schemaVersion: "hh-configured-master-ids-v1",
        contractAccepted: false,
        invalidReferenceCount: saved.invalidReferenceCount,
        masters: saved.masters.map((row: { kind: MasterKind; id: number | string }) => ({
          kind: row.kind,
          id: row.kind === "account" ? String(row.id).toLowerCase() : row.id,
        })),
        missingKinds: kinds
          .map((k) => k.kind)
          .filter((kind) => !saved.masters.some((row: { kind: MasterKind }) => row.kind === kind)),
      };
      batchReports.current.clear();
      setConfigured(projected);
      fillBatch(projected, 0);
    } catch {
      if (live.current)
        setError("Unable to load saved billing IDs. Check your connection and try again.");
    } finally {
      if (live.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  async function capture() {
    if (pending.current) return;
    if (configured) batchReports.current.delete(batch);
    setError(null);
    setReport(null);
    const masters: MasterCaptureInput["masters"] = [];
    const unique = new Set<string>();
    for (const { kind } of kinds)
      for (const entry of (values[kind] ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)) {
        const valid =
          kind === "account"
            ? isN3Guid(entry)
            : /^[1-9]\d{0,9}$/.test(entry) && Number(entry) <= 2147483647;
        const id = kind === "account" ? entry.toLowerCase() : Number(entry);
        const key = `${kind}:${id}`;
        if (!valid || unique.has(key)) {
          setError("Enter valid, distinct N3 master IDs. Separate multiple IDs with commas.");
          return;
        }
        unique.add(key);
        masters.push({ kind, id });
      }
    if (!masters.length || masters.length > 20) {
      setError("Enter between 1 and 20 valid N3 master IDs in total.");
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/n3/settlement-master-capture", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ masters }),
      });
      const body = await response.json().catch(() => ({}));
      if (!live.current) return;
      if (response.status === 401) {
        setError("Your session ended. Open HotelHub from N3 again.");
        void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
        return;
      }
      if (!response.ok) {
        setError(
          response.status === 403
            ? "Only the Owner can capture billing setup evidence."
            : "Unable to capture current billing masters. Check N3 access and try again.",
        );
        return;
      }
      if (
        body.report?.schemaVersion !== "hh-master-capture-v1" ||
        body.report?.contractAccepted !== false ||
        !Array.isArray(body.report.evidence)
      ) {
        setError("The capture response is incomplete. Ask Admin to review it.");
        return;
      }
      if (configured) batchReports.current.set(batch, body.report);
      setReport(body.report);
    } catch {
      if (live.current)
        setError("Unable to capture current billing masters. Check your connection and try again.");
    } finally {
      if (live.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download =
      "HH_BILLING_MASTER_CAPTURE_" +
      report.capturedAt.slice(0, 10).replaceAll("-", "") +
      (configured && configured.masters.length > 20
        ? `_batch${batch + 1}of${Math.ceil(configured.masters.length / 20)}`
        : "") +
      ".json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section
      className="rounded-xl border bg-white p-5 shadow-sm"
      aria-labelledby="billing-master-heading"
    >
      <h2 id="billing-master-heading" className="font-semibold">
        Current billing master evidence
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Load your saved billing IDs, or enter selected IDs from N3. Capture reads their current N3
        records for setup review; it creates no bill, payment or match.
      </p>
      <button
        type="button"
        className="mt-3 rounded-md border px-3 py-2 text-sm"
        disabled={busy}
        onClick={() => void loadSaved()}
      >
        Use saved billing IDs
      </button>
      {configured ? (
        <div className="mt-3 text-sm" role="status">
          <p>
            Batch {batch + 1} of {Math.ceil(configured.masters.length / 20)} ·{" "}
            {configured.masters.length} saved IDs. Capture and download each batch. Saved mappings
            still need current N3 verification.
          </p>
          {configured.missingKinds.length ? (
            <p>
              No saved IDs for:{" "}
              {configured.missingKinds
                .map((kind) => kinds.find((k) => k.kind === kind)!.label.replace(" IDs", ""))
                .join(", ")}
              . These references need review in the current N3 responses.
            </p>
          ) : null}
          {configured.invalidReferenceCount ? (
            <p>
              {configured.invalidReferenceCount} saved references could not be used. Ask Admin to
              check their mappings.
            </p>
          ) : null}
          {configured.masters.length > 20 ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded-md border px-3 py-2"
                disabled={busy || batch === 0}
                onClick={() => fillBatch(configured, batch - 1)}
              >
                Previous batch
              </button>
              <button
                type="button"
                className="rounded-md border px-3 py-2"
                disabled={busy || (batch + 1) * 20 >= configured.masters.length}
                onClick={() => fillBatch(configured, batch + 1)}
              >
                Next batch
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kinds.map(({ kind, label }) => (
          <label key={kind} className="text-sm">
            {label}
            <input
              name={`master-${kind}`}
              className="mt-1 block w-full rounded-md border px-3 py-2"
              value={values[kind] ?? ""}
              disabled={busy}
              autoComplete="off"
              onChange={(event) => {
                setValues((v) => ({ ...v, [kind]: event.target.value }));
                setConfigured(null);
                batchReports.current.clear();
                setReport(null);
                setError(null);
              }}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="mt-3 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white"
        disabled={busy}
        onClick={() => void capture()}
      >
        {busy ? "Capturing…" : "Capture current billing masters"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {report ? (
        <div className="mt-3 text-sm" role="status">
          <p className="font-semibold">
            {report.status === "partial" && !report.evidence.some((e) => e.status === "captured")
              ? "No N3 responses captured"
              : "Captured responses require review"}
          </p>
          <p>
            {report.evidence.filter((e) => e.status === "captured").length} of{" "}
            {report.evidence.length} requested responses captured. Billing contract acceptance is
            still pending.
          </p>
          {report.evidence.some((e) => e.status === "unavailable") ? (
            <details className="mt-2">
              <summary className="cursor-pointer">Capture failure details</summary>
              <ul className="mt-2 space-y-1">
                {report.evidence
                  .filter((e) => e.status === "unavailable")
                  .map((e) => (
                    <li key={`${e.kind}:${e.id}`}>
                      {kinds.find((k) => k.kind === e.kind)?.label.replace(" IDs", "")} {e.id}:{" "}
                      {typeof e.failureReason === "string" &&
                      Object.hasOwn(failureMessages, e.failureReason)
                        ? failureMessages[e.failureReason]
                        : "Failure reason not recorded; ask Admin to review the capture"}
                      {typeof e.httpStatus === "number" ? ` (HTTP ${e.httpStatus})` : ""}.
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
          <button type="button" className="mt-2 rounded-md border px-3 py-2" onClick={download}>
            Download billing master evidence
          </button>
        </div>
      ) : null}
    </section>
  );
}
