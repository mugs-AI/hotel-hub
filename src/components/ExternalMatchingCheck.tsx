import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { checkExternalMatchingClient, SettlementApiError } from "@/lib/settlement-client";
import { useSessionMe, SESSION_QUERY_KEY } from "@/lib/session-client";
import { identityFromSession } from "@/lib/receipt-controls-client";
import type { ExternalMatchingCheckView } from "@/lib/saved-documents-check";
import { formatMyTimestamp } from "@/lib/malaysia-date";
function matchingMessage(code: string): string {
  if (code === "n3_settlement_master_contract_unverified")
    return "Matching is unavailable until billing setup is verified.";
  if (code === "settlement_pending_financial_operation")
    return "Recover the saved transaction with Check N3 result before checking matching; do not collect again.";
  if (code === "settlement_guest_bill_unpaid")
    return "The guest bill is not settled. Ask the accountant to review matching for these saved documents; do not collect again based on this check.";
  if (
    code === "settlement_evidence_changed" ||
    code === "settlement_snapshot_changed" ||
    code === "settlement_stale_revision"
  )
    return "The saved billing facts changed during the check. Refresh them and review these exact documents; do not collect again.";
  return "Matching needs review. Ask the accountant to check these exact saved documents in N3, then check again here; do not collect again because verification failed.";
}

export function ExternalMatchingCheck(props: {
  reservationId: string;
  intentId: string;
  revision: string;
  currency: string;
  disabled: boolean;
}) {
  const session = useSessionMe();
  const identity = identityFromSession(session);
  return identity &&
    session.data?.authenticated === true &&
    ["owner", "front_desk"].includes(session.data.role ?? "") ? (
    <MatchingCheckBody
      key={`${identity}:${props.reservationId}:${props.intentId}:${props.revision}`}
      {...props}
      tenantId={session.data.tenant.tenantId}
    />
  ) : null;
}
function MatchingCheckBody({
  reservationId,
  intentId,
  currency,
  disabled,
  tenantId,
}: {
  reservationId: string;
  intentId: string;
  revision: string;
  currency: string;
  disabled: boolean;
  tenantId: string;
}) {
  const qc = useQueryClient();
  const [result, setResult] = useState<ExternalMatchingCheckView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  async function check() {
    if (active.current || disabled) return;
    const controller = new AbortController();
    active.current = controller;
    setResult(null);
    setError("");
    setBusy(true);
    try {
      const next = await checkExternalMatchingClient(reservationId, intentId, controller.signal);
      if (active.current !== controller || controller.signal.aborted) return;
      if (next.tenantId !== tenantId)
        throw new SettlementApiError(503, "saved_check_scope_mismatch");
      setResult(next);
    } catch (e) {
      if (active.current !== controller || controller.signal.aborted) return;
      if (e instanceof SettlementApiError && e.status === 401) {
        qc.removeQueries({ queryKey: ["settlement"] });
        void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
        setError("Your session expired. Relaunch HotelHub from N3.");
      } else
        setError("Matching could not be checked. Review the saved N3 documents and check again.");
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <div className="mt-4 space-y-2 border-t pt-3 text-sm" aria-label="Match in N3">
      <h3 className="font-semibold">Match in N3</h3>
      <p>
        Ask the accountant to match this booking's saved receipts to its bill in N3, then check the
        result here.
      </p>
      <button
        type="button"
        disabled={busy || disabled}
        className="rounded-md border px-3 py-2 disabled:opacity-50"
        onClick={() => void check()}
      >
        {busy ? "Checking N3 matching…" : "Check N3 matching"}
      </button>
      {busy ? (
        <button
          type="button"
          className="ml-2 rounded-md border px-3 py-2"
          onClick={() => {
            active.current?.abort();
            active.current = null;
            setBusy(false);
          }}
        >
          Cancel check
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {result ? (
        <div role="status">
          <p>
            {result.status === "confirmed"
              ? "N3 matching verified for this booking."
              : matchingMessage(result.code)}
          </p>
          {result.status === "confirmed" ? (
            <>
              <p>
                Bill outstanding: {currency} 0.00 · {formatMyTimestamp(result.checkedAt)}
              </p>
              {result.externalMatching?.receiptObservations.map((r) => (
                <p key={r.receiptId}>
                  Receipt {result.documents.find((d) => d.id === r.receiptId)?.code ?? r.receiptId}{" "}
                  · remaining {currency} {(r.remainderCents / 100).toFixed(2)} · refunded {currency}{" "}
                  {(r.refundCents / 100).toFixed(2)}
                </p>
              ))}
              {result.externalMatching?.receiptObservations.some(
                (r) => r.remainderCents > 0 || r.refundCents > 0,
              ) ? (
                <p className="text-amber-800">
                  A retained receipt remainder or refund requires accountant review before checkout.
                </p>
              ) : null}
              <p>Complete Checkout still requires the final settlement check and room handoff.</p>
            </>
          ) : null}
          {result.documents.map((d) => (
            <p key={d.id}>
              {d.kind === "bill" ? "Bill" : "Receipt"}: {d.code}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
