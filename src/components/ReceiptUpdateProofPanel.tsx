import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import type { ProofSummary, ProofReport, HeldProofSummary } from "@/lib/receipt-update-proof";
import { formatMyDate } from "@/lib/malaysia-date";
export function ReceiptProofDiagnostics({ report }: { report: ProofReport }) {
  return (
    <div className="space-y-1">
      {report.attempt ? (
        <>
          <p>
            Update call: {report.attempt.dispatch === "attempted" ? "started" : "not started"}. This
            does not prove N3 accepted the change.
          </p>
          <p>
            Stage: {report.attempt.stage}. Result: {report.attempt.reason ?? "verified"}.
          </p>
          {report.attempt.httpStatus !== null ? (
            <p>
              N3 response: HTTP {report.attempt.httpStatus}; code{" "}
              {report.attempt.envelopeCode ?? "unavailable"}.
            </p>
          ) : null}
        </>
      ) : (
        <p>Earlier attempt details were not recorded.</p>
      )}
      {report.readback ? (
        <p>
          Last read:{" "}
          {report.readback.observedCents === null
            ? "amount unavailable"
            : `RM${(report.readback.observedCents / 100).toFixed(2)}`}
          . Result: {report.readback.reason ?? report.readback.outcome}.
        </p>
      ) : null}
      {report.readback?.reason === "receipt_detail_id_changed" ? (
        <p>
          The receipt detail ID changed. The amount above is what N3 returned, but the existing test
          still needs review. Do not run Update again.
        </p>
      ) : null}
      {report.outcome === "needs_review" ? <p>Use Check N3 result; do not resend.</p> : null}
    </div>
  );
}
const API = "/api/hotel/receipt-update-proof";
export function ReceiptUpdateProofPanel({ identityKey }: { identityKey: string }) {
  const [cases, setCases] = useState<ProofSummary[]>([]),
    [selected, setSelected] = useState<ProofSummary | null>(null);
  const [held, setHeld] = useState<HeldProofSummary[]>([]);
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
        if (alive.current) {
          setCases(b.cases ?? []);
          setHeld(b.held ?? []);
        }
      })
      .catch(() => {
        if (alive.current) setError("Reopen HotelHub from N3 if your session has expired.");
      });
    return () => {
      alive.current = false;
    };
  }, [storageKey]);
  async function recover(item: HeldProofSummary) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`${API}?permitId=${encodeURIComponent(item.permitId)}`, {
        credentials: "same-origin",
      });
      if (!r.ok) throw Error("Unavailable");
      const b = await r.json();
      // Recovery never opens a Prepare/Run path, including an unexpected response.
      if (
        b.permitId !== item.permitId ||
        !b.summary ||
        (b.phase !== "reserved" && b.phase !== "unknown")
      )
        throw Error("Unavailable");
      if (!alive.current) return;
      setPermit(b.permitId);
      setSelected(b.summary);
      setSent(true);
      setReport(b.safeReport ?? null);
      try {
        sessionStorage.setItem(storageKey, b.permitId);
      } catch {
        /* recovery remains available without browser storage */
      }
    } catch {
      if (alive.current)
        setError("Recovery unavailable. Reopen HotelHub from N3 and use the same Owner account.");
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
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
          New tests disabled — no active approved test package.
        </p>
      ) : null}
      {held.length > 0 && !permit ? (
        <div className="space-y-2 text-sm">
          <p>
            Recover an existing held test. This only loads its saved result; it does not send an
            Update.
          </p>
          {held.map((item) => (
            <div key={item.permitId} className="flex flex-wrap items-center gap-2">
              <span>
                {item.summary.companyName} · {item.summary.docCode} · Needs review
              </span>
              <Button variant="outline" disabled={busy} onClick={() => recover(item)}>
                Recover {item.summary.docCode}
              </Button>
            </div>
          ))}
        </div>
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
          <ReceiptProofDiagnostics report={report} />
          <Button
            variant="outline"
            disabled={busy}
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
