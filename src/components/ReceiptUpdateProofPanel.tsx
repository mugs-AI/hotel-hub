import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import type { ProofSummary, ProofReport } from "@/lib/receipt-update-proof";
import { formatMyDate } from "@/lib/malaysia-date";
const API = "/api/hotel/receipt-update-proof";
export function ReceiptUpdateProofPanel({ identityKey }: { identityKey: string }) {
  const [cases, setCases] = useState<ProofSummary[]>([]),
    [selected, setSelected] = useState<ProofSummary | null>(null);
  const [permit, setPermit] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false);
  const [error, setError] = useState(""),
    [report, setReport] = useState<ProofReport | null>(null);
  const lock = useRef(false),
    alive = useRef(true);
  const storageKey = `hh-receipt-proof:${identityKey}`;
  useEffect(() => {
    alive.current = true;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        setPermit(saved);
        setSent(true);
        fetch(`${API}?permitId=${encodeURIComponent(saved)}`, { credentials: "same-origin" })
          .then(async (r) => {
            if (!r.ok) throw Error("Unavailable");
            return r.json();
          })
          .then((b) => {
            if (!alive.current) return;
            setSelected(b.summary ?? null);
            setSent(b.phase !== "prepared");
            setReport(b.safeReport ?? null);
          })
          .catch(() => {
            if (alive.current) setError("Use Check N3 result to recover this test.");
          });
      }
    } catch {
      /* storage may be unavailable */
    }
    fetch(API, { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) throw Error("Session or proof tool unavailable.");
        return r.json();
      })
      .then((b) => {
        if (alive.current) setCases(b.cases ?? []);
      })
      .catch(() => {
        if (alive.current) setError("Reopen HotelHub from N3 if your session has expired.");
      });
    return () => {
      alive.current = false;
    };
  }, [storageKey]);
  async function act(action: "prepare" | "run" | "check") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    if (action === "run") setSent(true); // Lost responses always recover by GET, never resend.
    try {
      const r = await fetch(
        action === "check" ? `${API}?action=check&permitId=${encodeURIComponent(permit!)}` : API,
        {
          credentials: "same-origin",
          ...(action === "check"
            ? {}
            : {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(
                  action === "prepare"
                    ? {
                        action,
                        caseId: selected!.caseId,
                        receiptId: selected!.receiptId,
                        approvedPackageHash: selected!.packageHash,
                      }
                    : { action, permitId: permit },
                ),
              }),
        },
      );
      const b = await r.json();
      if (!r.ok) throw Error(b.error ?? "Proof unavailable");
      if (!alive.current) return;
      if (action === "prepare") {
        setPermit(b.permitId);
        try {
          sessionStorage.setItem(storageKey, b.permitId);
        } catch {
          /* result still shows permit */
        }
      } else {
        setReport(b.safeReport ?? null);
        if (b.phase === "prepared") {
          setSelected(b.summary);
          setSent(false);
        }
      }
    } catch {
      if (alive.current)
        setError(
          action === "run"
            ? "Result unknown. Use Check N3 result; do not submit another update."
            : "Unable to verify. Ask Admin to check the test package and N3 session.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border border-teal-200 bg-teal-50 p-4 space-y-3">
      <h2 className="font-semibold">Receipt amount edit test</h2>
      <p className="text-sm">
        Owner only. Updates the same designated test OR. Existing hotel receipts are excluded.
      </p>
      {!cases.length && !permit ? (
        <p className="text-sm text-muted-foreground">
          Disabled — no approved test receipt is configured.
        </p>
      ) : null}
      {cases.length && !permit ? (
        <select
          aria-label="Approved test case"
          className="w-full rounded border bg-white p-2"
          value={selected?.caseId ?? ""}
          onChange={(e) => setSelected(cases.find((c) => c.caseId === e.target.value) ?? null)}
        >
          <option value="">Select test case</option>
          {cases.map((c) => (
            <option key={c.caseId} value={c.caseId}>
              {c.companyName} · {c.docCode}
            </option>
          ))}
        </select>
      ) : null}
      {selected ? (
        <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          <div>
            <dt>Company / OR</dt>
            <dd>
              {selected.companyName} · {selected.docCode}
            </dd>
          </div>
          <div>
            <dt>Date / Amount</dt>
            <dd>
              {formatMyDate(selected.documentDate)} · RM{(selected.beforeCents / 100).toFixed(2)} →
              RM{(selected.afterCents / 100).toFixed(2)}
            </dd>
          </div>
        </dl>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!permit ? (
          <Button disabled={busy || !selected} onClick={() => act("prepare")}>
            Prepare test
          </Button>
        ) : !sent && selected ? (
          <Button disabled={busy} onClick={() => act("run")}>
            Update this test OR once
          </Button>
        ) : null}
        {permit ? (
          <Button variant="outline" disabled={busy} onClick={() => act("check")}>
            Check N3 result
          </Button>
        ) : null}
      </div>
      {report?.outcome === "verified" ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            try {
              sessionStorage.removeItem(storageKey);
            } catch {
              /* storage unavailable */
            }
            setPermit(null);
            setSelected(null);
            setReport(null);
            setSent(false);
          }}
        >
          Next approved test
        </Button>
      ) : null}
      {permit ? <p className="break-all text-xs">Test reference: {permit}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {report ? (
        <div role="status" className="text-sm">
          <p>
            {report.outcome === "verified"
              ? "Same OR amount and journal verified."
              : "Needs review — keep the existing result on hold."}
          </p>
          <p>External concurrency protection: not proven.</p>
          <Button
            variant="outline"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "HotelHub-receipt-edit-proof.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download result
          </Button>
        </div>
      ) : null}
    </section>
  );
}
