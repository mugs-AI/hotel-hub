import { ExternalMatchingCheck } from "./ExternalMatchingCheck";
import { SECURITY_ERRORS } from "@/lib/security-cash";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSettlement,
  submitSettlementStep,
  reconcileSettlementClient,
  SettlementApiError,
  invalidateSettlementReaders,
  useSettlementPaymentAccounts,
} from "@/lib/settlement-client";
import { settlementPresentation } from "@/lib/settlement-view";
import { useWorkspace, useWorkspaceDraft } from "@/lib/workspace-context";
import { useSessionMe, SESSION_QUERY_KEY, type SessionMe } from "@/lib/session-client";
import {
  receivePaymentAndMatch,
  SavedPaymentMatchingError,
} from "@/lib/settlement-payment-sequence";
import { identityFromSession } from "@/lib/receipt-controls-client";
import { SettlementPaymentForm } from "./SettlementPaymentForm";
import type { SettlementPaymentLine } from "@/lib/settlement-payment-entry";
import type { SettlementStepInput, SettlementView } from "@/lib/settlement";
import { isoToMyDate } from "@/lib/malaysia-date";
export const settlementMessage = (code: string) =>
  SECURITY_ERRORS[code] ||
  {
    settlement_setup_required: "Settlement is unavailable while setup is pending.",
    settlement_prepared_posting_rows_required:
      "Tax and charges are not ready for N3 posting. Refer Admin.",
    settlement_room_uom_required: "A room billing unit needs confirmation. Refer Admin.",
    settlement_local_mapping_required: "A billing item needs its N3 mapping. Refer Admin.",
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
    settlement_payment_invalid: "Review the payment amounts and selected accounts.",
    settlement_payment_total_mismatch:
      "The balance changed. Refresh and enter the exact amount received.",
    n3_split_balance_contract_unverified:
      "Split payment posting requires N3 verification before it can be enabled.",
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
  const session = useSessionMe();
  const identity = identityFromSession(session);
  const current = session.data?.authenticated === true ? session.data : null;
  return identity && current?.authenticated === true ? (
    <SettlementCardBody
      key={`${identity}:${reservationId}`}
      reservationId={reservationId}
      owner={owner}
      tenantId={current.tenant.tenantId}
      identity={identity}
    />
  ) : null;
}
function SettlementCardBody({
  reservationId,
  owner,
  tenantId,
  identity,
}: {
  reservationId: string;
  owner: boolean;
  tenantId: string;
  identity: string;
}) {
  const q = useSettlement(reservationId),
    qc = useQueryClient(),
    v = q.data;
  const workspace = useWorkspace();
  const [actionState, setActionState] = useWorkspaceDraft<{
    pending: boolean;
    error: string | null;
    requestId: string | null;
    recovery: boolean;
  }>(
    "settlement-action",
    { pending: false, error: null, requestId: null, recovery: false },
    (d) => d.pending || d.recovery,
    `reservation:${reservationId.toLowerCase()}`,
    (d) => (d.pending ? "Wait for the saved checkout action to finish." : null),
  );
  const pending = actionState.pending,
    error = actionState.error;
  const executing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const sameSession = () =>
    identityFromSession({
      data: qc.getQueryData<SessionMe>(SESSION_QUERY_KEY),
      isError: qc.getQueryState(SESSION_QUERY_KEY)?.status === "error",
    }) === identity;
  const isCurrent = () => mounted.current && (!workspace || workspace.isCurrent()) && sameSession();
  const accounts = useSettlementPaymentAccounts(
    reservationId,
    owner && Boolean(v?.allowedActions.includes("receive_balance")),
  );

  async function refresh() {
    if (pending || executing.current) return;
    executing.current = true;
    setActionState((s) => ({ ...s, pending: true }));
    try {
      const observed = await q.refetch({ throwOnError: true });
      if (workspace && !workspace.isCurrent()) return;
      const fresh = observed.data;
      if (!fresh || fresh.tenantId !== tenantId || fresh.reservationId !== reservationId)
        throw new SettlementApiError(503, "settlement_scope_mismatch");
      // Only authoritative, action-ready absence of a saved intent clears an
      // interrupted first confirmation. Keep its original idempotency key.
      // Saved/uncertain financial attempts still require explicit reconciliation.
      if (
        fresh.intentId === null &&
        fresh.blockers.length === 0 &&
        fresh.snapshotDigest &&
        fresh.allowedActions.includes("post_bill")
      )
        setActionState((s) => ({ ...s, recovery: false, error: null }));
      if (fresh.allowedActions.includes("receive_balance"))
        await accounts.refetch({ throwOnError: true });
    } catch {
      if (!workspace || workspace.isCurrent())
        setActionState((s) => ({
          ...s,
          error: "Unable to refresh checkout details. Refresh again to check the saved result.",
        }));
    } finally {
      executing.current = false;
      setActionState((s) => ({ ...s, pending: false }));
    }
  }

  const run = async (
    action: SettlementStepInput["action"] | "reconcile",
    paymentLines?: SettlementPaymentLine[],
  ) => {
    if (!v || pending || executing.current || (actionState.recovery && action !== "reconcile"))
      return;
    executing.current = true;
    setActionState((s) => ({ ...s, pending: true, error: null }));
    try {
      let result: SettlementView | undefined;
      if (action === "reconcile") {
        if (v.intentId) result = await reconcileSettlementClient(reservationId, v.intentId);
      } else {
        if (action === "receive_balance" && !paymentLines?.length) return;
        let input: SettlementStepInput;
        if (action === "post_bill") {
          if (!v.snapshotDigest) return;
          const requestId = actionState.requestId ?? crypto.randomUUID();
          setActionState((s) => ({ ...s, requestId }));
          input = {
            action,
            clientRequestId: requestId,
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
            ...(action === "receive_balance" ? { paymentLines } : {}),
          };
        }
        result =
          action === "receive_balance"
            ? await receivePaymentAndMatch(v, paymentLines!, {
                submit: (step) => submitSettlementStep(reservationId, step),
                isCurrent,
              })
            : await submitSettlementStep(reservationId, input);
      }
      if (!isCurrent()) {
        if (sameSession())
          setActionState((s) => ({
            ...s,
            recovery: true,
            error: "Check the saved checkout result; do not repeat the payment.",
          }));
        return;
      }
      if (result && (result.tenantId !== v.tenantId || result.reservationId !== reservationId))
        throw new SettlementApiError(503, "settlement_scope_mismatch");
      if (result)
        setActionState((s) => ({
          ...s,
          recovery: result!.blockers.length > 0,
          error: result!.blockers.length ? settlementMessage(result!.blockers[0]) : null,
        }));
      if (
        result &&
        result.tenantId === v.tenantId &&
        result.reservationId === reservationId &&
        result.revision !== v.revision
      )
        invalidateSettlementReaders(reservationId);
      await qc.invalidateQueries({ queryKey: ["settlement"] });
    } catch (e) {
      // Retain recovery on this booking's draft even when its tab was unmounted.
      // Never write a late result into a changed account's workspace.
      if (!sameSession()) return;
      const failure = e instanceof SavedPaymentMatchingError ? e.cause : e;
      if (failure instanceof SettlementApiError && failure.status === 401) {
        qc.removeQueries({ queryKey: ["settlement"] });
        await qc.invalidateQueries({ queryKey: ["session", "me"] });
      }
      const message =
        failure instanceof SettlementApiError && failure.status === 401
          ? "Your session expired. Relaunch HotelHub from N3. Do not repeat the payment."
          : e instanceof SavedPaymentMatchingError && e.receiptVerified
            ? "Payment saved; matching needs checking. Use Check N3 result; do not repeat the payment."
            : "The saved action needs review. Refresh or check N3 result; do not repeat the payment.";
      setActionState((s) => ({ ...s, error: message, recovery: true }));
    } finally {
      executing.current = false;
      setActionState((s) => ({ ...s, pending: false }));
    }
  };
  const buttons = {
    post_bill: "Confirm Folio & Post to N3",
    apply_deposits: "Match Deposit",
    receive_balance: "Receive Payment",
    apply_balance: "Apply received payment",
    close: "Complete Checkout",
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
          <ol className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Checkout payment steps">
            <li className="rounded-md border p-3 text-sm">
              <p className="font-semibold">1. Post to N3</p>
              <p className="mt-1 text-muted-foreground">
                {v.bill && !v.blockers.length
                  ? "Bill verified in N3."
                  : "Confirm the folio, then verify its N3 bill."}
              </p>
            </li>
            <li className="rounded-md border p-3 text-sm">
              <p className="font-semibold">2. Match Deposit</p>
              <p className="mt-1 text-muted-foreground">
                {v.blockers.length
                  ? "Check the saved result before continuing."
                  : !v.bill
                    ? "Available after the bill is verified."
                    : v.allowedActions.includes("receive_balance") && !v.receipts.length
                      ? "Not applicable: no linked deposits."
                      : v.allowedActions.some((a) =>
                            ["receive_balance", "apply_balance", "close"].includes(a),
                          )
                        ? "Deposit step complete."
                        : "Match this booking’s existing N3 receipts before collecting the balance."}
              </p>
            </li>
            <li className="rounded-md border p-3 text-sm">
              <p className="font-semibold">3. Receive Payment</p>
              <p className="mt-1 text-muted-foreground">
                {v.allowedActions.includes("close")
                  ? "No further payment required."
                  : v.allowedActions.includes("apply_balance")
                    ? "Payment saved. Match the saved receipt; do not collect again."
                    : "Save the actual balance payment, then verify its matching."}
              </p>
              {owner && !v.allowedActions.includes("receive_balance") ? (
                <button
                  type="button"
                  disabled
                  className="mt-2 rounded-md border px-3 py-2 text-sm opacity-50"
                >
                  Receive Payment
                </button>
              ) : null}
            </li>
          </ol>
          {owner && v.bill && !v.blockers.length && v.allowedActions.includes("receive_balance") ? (
            <SettlementPaymentForm
              reservationId={reservationId}
              billId={v.bill.id}
              revision={v.revision}
              balanceCents={v.bill.outstandingCents}
              currency={v.currency}
              accounts={accounts.data?.accounts ?? []}
              unavailable={accounts.isPending || Boolean(accounts.error)}
              pending={pending || actionState.recovery}
              splitAllowed={v.canSplitPayment === true}
              onReceive={(lines) => void run("receive_balance", lines)}
            />
          ) : null}
          {v.intentId && v.state !== "closed" ? (
            <ExternalMatchingCheck
              reservationId={reservationId}
              intentId={v.intentId}
              revision={v.revision}
              currency={v.currency}
              disabled={pending || q.isFetching}
            />
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {owner
              ? v.allowedActions
                  .filter((action) => action !== "receive_balance")
                  .map((action) => (
                    <button
                      key={action}
                      type="button"
                      className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                      disabled={pending || actionState.recovery || q.isFetching}
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
          </div>
        </div>
      ) : null}
      <button
        type="button"
        disabled={pending || q.isFetching}
        className="mt-3 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        onClick={() => void refresh()}
      >
        Refresh
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
