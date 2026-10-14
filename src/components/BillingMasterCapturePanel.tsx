import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SESSION_QUERY_KEY, useSessionMe } from "@/lib/session-client";
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
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function capture() {
    if (busy) return;
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
      setReport(body.report);
    } catch {
      if (live.current)
        setError("Unable to capture current billing masters. Check your connection and try again.");
    } finally {
      if (live.current) setBusy(false);
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
      "HH_BILLING_MASTER_CAPTURE_" + report.capturedAt.slice(0, 10).replaceAll("-", "") + ".json";
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
        For Admin setup review: enter the current IDs from N3 for the hotel's configured billing
        mappings. This reads the selected masters; it creates no bill, payment or match.
      </p>
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
              onChange={(event) => setValues((v) => ({ ...v, [kind]: event.target.value }))}
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
          <p className="font-semibold">Captured responses require review</p>
          <p>
            {report.evidence.filter((e) => e.status === "captured").length} of{" "}
            {report.evidence.length} requested responses captured. Billing contract acceptance is
            still pending.
          </p>
          <button type="button" className="mt-2 rounded-md border px-3 py-2" onClick={download}>
            Download billing master evidence
          </button>
        </div>
      ) : null}
    </section>
  );
}
