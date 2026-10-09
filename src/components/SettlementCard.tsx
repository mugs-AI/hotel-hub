import { SECURITY_ERRORS } from "@/lib/security-cash";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSettlement,
  submitSettlementStep,
  reconcileSettlementClient,
  SettlementApiError,
  invalidateSettlementReaders,
} from "@/lib/settlement-client";
import { settlementPresentation } from "@/lib/settlement-view";
import { usePaymentAccounts } from "@/lib/deposits-client";
import type { SettlementStepInput, SettlementView } from "@/lib/settlement";
import { isoToMyDate } from "@/lib/malaysia-date";
export const settlementMessage = (code: string) =>
  SECURITY_ERRORS[code] ||
  {
    settlement_setup_required: "Settlement is unavailable while setup is pending.",
    n3_settlement_master_contract_unverified:
      "Settlement is unavailable until accounting mappings are verified.",
    n3_billing_contract_unverified:
      "Settlement is unavailable until accounting verification is complete.",
    settlement_snapshot_changed:
      "Billing facts changed. Review the saved settlement before proceeding.",
    settlement_identity_requires_review:
      "The result needs verification. Check N3 result to recover the saved attempt.",
    settlement_excess_or_refund_requires_review: "A receipt remainder or refund needs review.",
    settlement_stale_revision: "The status changed on another device. Refresh the settlement.",
    n3_session_expired: "Your session expired. Relaunch HotelHub from N3.",
  }[code] ||
  "Settlement needs review. Check the accounting result before proceeding.";
const amount = (cents: number, currency: string) => `${currency} ${(cents / 100).toFixed(2)}`;
export function SettlementStatus({ view, owner }: { view: SettlementView; owner: boolean }) {
  const p = settlementPresentation(view, owner);
  return (
    <>
      <p className="text-sm text-muted-foreground">{p.message}</p>
      <p className="mt-2 text-sm font-medium">
        {(view.state || "Unavailable").replaceAll("_", " ")}
      </p>
      {p.showMoney && view.bill ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <dt>Bill · {view.bill.code}</dt>
          <dd className="text-right">{amount(view.bill.totalCents, view.currency)}</dd>
          <dt>Document date</dt>
          <dd className="text-right">{isoToMyDate(view.bill.documentDate)}</dd>
          <dt>Outstanding</dt>
          <dd className="text-right font-semibold">
            {amount(view.bill.outstandingCents, view.currency)}
          </dd>
        </dl>
      ) : null}
      {p.showMoney
        ? view.receipts.map((r) => (
            <p key={r.id} className="mt-2 text-sm">
              {r.code} · {isoToMyDate(r.documentDate)} · {amount(r.amountCents, view.currency)} ·
              remaining {amount(r.remainderCents, view.currency)}
            </p>
          ))
        : null}
      {view.blockers.map((code) => (
        <p key={code} className="mt-2 text-sm text-destructive">
          {settlementMessage(code)}
        </p>
      ))}
    </>
  );
}
export function SettlementCard({
  reservationId,
  owner,
}: {
  reservationId: string;
  owner: boolean;
}) {
  const q = useSettlement(reservationId),
    qc = useQueryClient(),
    v = q.data;
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [account, setAccount] = useState(""),
    [confirmation, setConfirmation] = useState<{ revision: string; account: string } | null>(null);
  const confirmed = confirmation?.revision === v?.revision && confirmation?.account === account;
  const requestId = useRef<string | null>(null);
  const accounts = usePaymentAccounts(
    owner && Boolean(v?.allowedActions.includes("receive_balance")),
  );

  const run = async (action: SettlementStepInput["action"] | "reconcile") => {
    if (!v || pending) return;
    setPending(true);
    setError(null);
    try {
      let result: SettlementView | undefined;
      if (action === "reconcile") {
        if (v.intentId) result = await reconcileSettlementClient(reservationId, v.intentId);
      } else {
        if (action === "receive_balance" && (!confirmed || !account)) return;
        let input: SettlementStepInput;
        if (action === "post_bill") {
          if (!v.snapshotDigest) return;
          if (!requestId.current) requestId.current = crypto.randomUUID();
          input = {
            action,
            clientRequestId: requestId.current,
            snapshotDigest: v.snapshotDigest,
            expectedRevision: v.revision,
            ...(v.intentId ? { intentId: v.intentId } : {}),
          };
        } else {
          if (!v.intentId) return;
          input = {
            action,
            intentId: v.intentId,
            expectedRevision: v.revision,
            ...(action === "receive_balance" ? { selectedAccountId: account } : {}),
          };
        }
        result = await submitSettlementStep(reservationId, input);
      }
      if (
        result &&
        result.tenantId === v.tenantId &&
        result.reservationId === reservationId &&
        result.revision !== v.revision
      )
        invalidateSettlementReaders(reservationId);
      await qc.invalidateQueries({ queryKey: ["settlement"] });
    } catch (e) {
      if (e instanceof SettlementApiError && e.status === 401) {
        qc.removeQueries({ queryKey: ["settlement"] });
        await qc.invalidateQueries({ queryKey: ["session", "me"] });
      }
      setError(
        e instanceof SettlementApiError && e.status === 401
          ? "Your session expired. Relaunch HotelHub from N3."
          : "The saved action needs review. Refresh or check N3 result; do not repeat the payment.",
      );
    } finally {
      setPending(false);
    }
  };
  const buttons = {
    post_bill: "Post bill",
    apply_deposits: "Apply deposits",
    receive_balance: "Confirm balance payment",
    apply_balance: "Apply received payment",
    close: "Complete checkout",
  };
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Final settlement</h2>
        <details className="relative text-sm text-muted-foreground">
          <summary className="cursor-pointer list-none" aria-label="Settlement guidance">
            [i]
          </summary>
          <p className="absolute right-0 z-10 mt-2 w-64 rounded border bg-background p-3 shadow-sm">
            Each action is saved before dispatch. After an interruption, check N3 result to recover
            the saved write.
          </p>
        </details>
      </div>
      {q.isPending ? <p className="mt-2 text-sm">Checking settlement…</p> : null}
      {q.error ? (
        <p className="mt-2 text-sm text-destructive">
          {q.error instanceof SettlementApiError && q.error.status === 401
            ? "Your session expired. Relaunch HotelHub from N3."
            : "Settlement status is unavailable. Refresh to check the saved result."}
        </p>
      ) : null}
      {v ? (
        <div className="mt-3">
          <SettlementStatus view={v} owner={owner} />
          {owner && v.allowedActions.includes("receive_balance") ? (
            <div className="mt-3 space-y-2 text-sm">
              <label className="block">
                Payment account
                <select
                  className="ml-2 rounded border bg-background p-2"
                  value={account}
                  onChange={(e) => {
                    setAccount(e.target.value);
                    setConfirmation(null);
                  }}
                >
                  <option value="">Select account</option>
                  {accounts.data?.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) =>
                    setConfirmation(
                      e.target.checked && v ? { revision: v.revision, account } : null,
                    )
                  }
                />
                <span>I confirm the displayed balance payment and selected account.</span>
              </label>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {owner
              ? v.allowedActions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                    disabled={pending || (action === "receive_balance" && (!confirmed || !account))}
                    onClick={() => void run(action)}
                  >
                    {buttons[action]}
                  </button>
                ))
              : null}
            {settlementPresentation(v, owner).canReconcile ? (
              <button
                type="button"
                disabled={pending}
                className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                onClick={() => void run("reconcile")}
              >
                Check N3 result
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending || q.isFetching}
              className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              onClick={() => void q.refetch()}
            >
              Refresh
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
