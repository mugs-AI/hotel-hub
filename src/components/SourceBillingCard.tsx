import { useState } from "react";
import { useSourceBilling } from "@/lib/source-billing-client";
import type { SourceCheckoutView } from "@/lib/source-billing-checkout";
import { SettlementCard } from "./SettlementCard";
import { useSettlementPaymentAccounts } from "@/lib/settlement-client";
import { SettlementPaymentForm } from "./SettlementPaymentForm";
import { SavedPaymentMatchingError } from "@/lib/settlement-payment-sequence";
import type { SettlementPaymentLine } from "@/lib/settlement-payment-entry";
import { isoToMyDate } from "@/lib/malaysia-date";
const button =
  "rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed";
function message(code: string) {
  if (/session|unauthorized|unauthenticated|scope_changed/.test(code))
    return "Your session or booking changed. Reopen this booking.";
  if (/payer/.test(code))
    return "Ask the Owner to confirm this booking’s billing collection first.";
  if (/attribution/.test(code))
    return "Review charge allocation and ask the Owner to resolve unassigned or changed charges.";
  if (/contract/.test(code)) return "N3 bill posting is awaiting verification. Refer Admin.";
  if (/snapshot_changed|revision|conflict/.test(code))
    return "The bill details changed. Reload and review before posting.";
  if (/setup|preparation|master|mapping/.test(code))
    return "Prepare the folio and verify the billing setup. Refer Admin.";
  return "Bill verification is unavailable. Reload the saved status before taking further action. Refer Admin.";
}
const amount = (n: number, c: string) => `${c} ${(n / 100).toFixed(2)}`;
export function SourceBillingCard({ reservationId }: { reservationId: string }) {
  const [active, setActive] = useState(false),
    q = useSourceBilling(reservationId, active);
  if (q.data?.legacy) return <SettlementCard reservationId={reservationId} owner />;
  return (
    <section aria-label="Final bills" className="rounded-xl border bg-card p-4 space-y-3 shadow-sm">
      <h3 className="text-base font-semibold text-[#102A43]">
        Knock Off / Settlement · N3 Cash Memo
      </h3>
      {!active ? (
        <>
          <p className="text-sm text-muted-foreground">
            Review the prepared folio and payer before issuing the final bills.
          </p>
          <button
            type="button"
            className={button}
            disabled={!q.identity}
            onClick={() => setActive(true)}
          >
            Review final bills
          </button>
        </>
      ) : q.error ? (
        <>
          <p role="alert">{message(q.error.code)}</p>
          <button type="button" className={button} onClick={() => void q.refetch()}>
            Reload bills
          </button>
        </>
      ) : !q.data ? (
        <p role="status">Verifying final bills…</p>
      ) : (
        <BillReview key={`${q.identity}:${reservationId}`} q={q} />
      )}
    </section>
  );
}
function BillReview({ q }: { q: ReturnType<typeof useSourceBilling> }) {
  const [review, setReview] = useState(q.data!.review),
    [status, setStatus] = useState<string | null>(null),
    v = q.data!;
  const changed = !!review && v.review?.planDigest !== review.planDigest;
  async function execute(action: () => Promise<SourceCheckoutView>) {
    setStatus(null);
    try {
      await action();
      setStatus("Saved bill status refreshed.");
    } catch (e) {
      setStatus(
        e instanceof SavedPaymentMatchingError
          ? "Payment saved; matching needs checking. Use Check N3 result; do not repeat the payment."
          : message((e as { code: string }).code ?? ""),
      );
    }
  }
  async function reload() {
    const r = await q.refetch();
    if (r.data && !r.error) {
      setReview(r.data.review);
      setStatus(null);
    }
  }
  return (
    <div className="space-y-3">
      {v.blockers.map((code) => (
        <p key={code} className="text-sm text-amber-900">
          {message(code)}
        </p>
      ))}
      {review && !v.stay ? (
        <>
          {changed ? (
            <p role="alert">Bill details changed. Reload and review before posting.</p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {review.legs.map((l) => (
              <div key={l.legId} className="rounded-lg border p-3">
                <strong>{l.kind === "source_room" ? "Source bill" : "Guest bill"}</strong>
                <p>{amount(l.totalCents, review.currency)}</p>
                <p className="text-xs text-muted-foreground">Customer #{l.customerId}</p>
              </div>
            ))}
          </div>
          <p className="text-sm">
            Confirming freezes all reviewed charges and issues each eligible bill once. Keep this
            booking open while the result is checked.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${button} bg-[#102A43] text-white`}
              disabled={
                q.pending || q.isFetching || changed || !review.canConfirm || !v.review?.canConfirm
              }
              onClick={() => void execute(() => q.confirm(review))}
            >
              Confirm and post bills
            </button>
            <button
              type="button"
              className={button}
              disabled={q.pending || q.isFetching}
              onClick={() => void reload()}
            >
              Reload bills
            </button>
          </div>
        </>
      ) : null}
      {v.stay ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {v.stay.legs.map((l) => (
              <article key={l.legId} className="rounded-lg border p-3 space-y-2">
                <h4 className="font-semibold">
                  {l.kind === "source_room" ? "Source bill" : "Guest bill"} · {l.hhNumber}
                </h4>
                {l.view.bill ? (
                  <>
                    <p>
                      N3: <strong>{l.view.bill.code}</strong> ·{" "}
                      {isoToMyDate(l.view.bill.documentDate)}
                    </p>
                    <p>
                      {amount(l.view.bill.totalCents, l.view.currency)} · Outstanding{" "}
                      {amount(l.view.bill.outstandingCents, l.view.currency)}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">{l.view.bill.id}</p>
                  </>
                ) : (
                  <p className="text-sm">
                    {["bill_dispatched", "needs_review"].includes(l.view.state ?? "")
                      ? "Outcome pending. Check the N3 result before further action."
                      : "Bill not yet verified in N3."}
                  </p>
                )}
                {l.kind === "source_room" ? (
                  <p className="text-xs text-muted-foreground">
                    Source receivable. Guest payments cannot be applied to this bill.
                  </p>
                ) : null}
                {l.kind === "guest" ? (
                  <GuestSettlement key={l.legId} stay={v.stay!} leg={l} q={q} execute={execute} />
                ) : null}
                {l.view.allowedActions.includes("post_bill") ? (
                  <button
                    type="button"
                    className={button}
                    disabled={q.pending || q.isFetching}
                    onClick={() => void execute(() => q.postLeg(v.stay!, l))}
                  >
                    Post {l.kind === "source_room" ? "source" : "guest"} bill
                  </button>
                ) : null}
              </article>
            ))}
          </div>
          <button
            type="button"
            className={button}
            disabled={q.pending || q.isFetching}
            onClick={() => void execute(() => q.reconcile(v.stay!.planDigest))}
          >
            Check N3 result
          </button>
          <p className="text-xs text-muted-foreground">
            Billing does not release rooms. Complete checkout still requires verified settlement.
          </p>
        </>
      ) : null}
      {!review && !v.stay ? (
        <button
          type="button"
          className={button}
          disabled={q.pending || q.isFetching}
          onClick={() => void reload()}
        >
          Reload bills
        </button>
      ) : null}
      {q.pending ? <p role="status">Checking the requested bill action…</p> : null}
      {status ? <p role="status">{status}</p> : null}
    </div>
  );
}

function GuestSettlement({
  stay,
  leg,
  q,
  execute,
}: {
  stay: NonNullable<SourceCheckoutView["stay"]>;
  leg: NonNullable<SourceCheckoutView["stay"]>["legs"][number];
  q: ReturnType<typeof useSourceBilling>;
  execute(action: () => Promise<SourceCheckoutView>): Promise<void>;
}) {
  const v = leg.view;
  const [entering, setEntering] = useState(false);
  const canReceive = v.allowedActions.includes("receive_balance") && !v.blockers.length;
  const accounts = useSettlementPaymentAccounts(v.reservationId, entering && canReceive);
  const disabled = q.pending || q.isFetching || !!v.blockers.length;
  function receive(lines: SettlementPaymentLine[]) {
    void execute(() => q.receive(stay, leg, lines));
  }
  return (
    <div className="space-y-3" aria-label="Guest settlement">
      <ol className="grid gap-2 text-sm" aria-label="Settlement steps">
        <li>
          <strong>1. Post to N3</strong>
          <p>{v.bill ? "Bill verified in N3." : "Verify the posted bill before matching."}</p>
        </li>
        <li>
          <strong>2. Match Deposit</strong>
          <p>
            {v.allowedActions.includes("apply_deposits")
              ? "Match this booking’s existing receipts to this guest bill."
              : !v.bill
                ? "Available after bill verification."
                : canReceive && !v.receipts.length
                  ? "No linked deposits to match."
                  : "Check the saved matching status below."}
          </p>
        </li>
        <li>
          <strong>3. Receive Payment</strong>
          <p>
            {v.state === "settled"
              ? "No further payment required."
              : v.allowedActions.includes("apply_balance") || v.state === "balance_dispatched"
                ? "Payment saved. Match the saved receipt; do not collect again."
                : "Receive only the verified outstanding balance."}
          </p>
        </li>
      </ol>
      {v.receipts.length ? (
        <ul aria-label="Linked receipts" className="space-y-2 text-sm">
          {v.receipts.map((r) => (
            <li key={r.id} className="rounded border p-2">
              <strong>{r.code}</strong> · {isoToMyDate(r.documentDate)}
              <p>
                Receipt {amount(r.amountCents, v.currency)} · Matched{" "}
                {amount(r.allocatedCents, v.currency)} · Remaining{" "}
                {amount(r.remainderCents, v.currency)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {v.allowedActions.includes("apply_deposits") ? (
          <button
            type="button"
            className={button}
            disabled={disabled}
            onClick={() => void execute(() => q.step(stay, leg, "apply_deposits"))}
          >
            Match Deposit
          </button>
        ) : null}
        {v.allowedActions.includes("apply_balance") ? (
          <button
            type="button"
            className={button}
            disabled={disabled}
            onClick={() => void execute(() => q.step(stay, leg, "apply_balance"))}
          >
            Match saved payment
          </button>
        ) : null}
        {!entering || !canReceive ? (
          <button
            type="button"
            className={button}
            disabled={disabled || !canReceive}
            onClick={() => setEntering(true)}
          >
            Receive Payment
          </button>
        ) : null}
      </div>
      {entering && canReceive && v.bill ? (
        <SettlementPaymentForm
          key={`${leg.legId}:${v.bill.id}:${v.revision}`}
          reservationId={v.reservationId}
          billId={v.bill.id}
          revision={v.revision}
          balanceCents={v.bill.outstandingCents}
          currency={v.currency}
          accounts={accounts.data?.accounts ?? []}
          unavailable={!!accounts.error || !accounts.data || accounts.isFetching}
          pending={disabled}
          splitAllowed={v.canSplitPayment === true}
          onReceive={receive}
        />
      ) : null}
    </div>
  );
}
