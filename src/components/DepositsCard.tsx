// Owner-only reservation deposit panel. Displays the local ledger and, when the
// server reports the capability, allows posting one N3 AR Receive Payment.
import { useState } from "react";
import {
  depositErrorMessage,
  depositStatusLabel,
  useCreateDeposit,
  useReconcileDeposit,
  useReservationDeposits,
} from "@/lib/deposits-client";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const ERR = "#C2413B";

export function DepositsCard({
  reservationId,
  canView,
  canCreate,
  eligible,
}: {
  reservationId: string;
  canView: boolean;
  canCreate: boolean;
  eligible: boolean;
}) {
  const q = useReservationDeposits(reservationId, canView);
  const create = useCreateDeposit(reservationId);
  const reconcile = useReconcileDeposit(reservationId);
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);

  if (!canView) return null;
  const deposits = q.data?.deposits ?? [];
  const gateOpen = q.data?.capability.canCreate === true;
  const canPost = canCreate && gateOpen && eligible;

  const submit = () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    create.mutate(
      { amount: Math.round(value * 100) / 100, clientRequestId: crypto.randomUUID() },
      { onSuccess: () => { setAmount(""); setConfirming(false); } },
    );
  };

  return (
    <section
      className="rounded-lg border bg-white p-5 shadow-sm"
      style={{ borderColor: `${TEAL}33`, borderLeft: `4px solid ${TEAL}` }}
    >
      <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
        Deposits / Receive Payments
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Deposits are recorded in N3 as AR Receive Payments. HotelHub never records a local-only
        payment.
      </p>

      {q.isPending ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading deposits…</p>
      ) : deposits.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No deposits recorded.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {deposits.map((d) => (
            <li key={d.id} className="rounded-md border p-3 text-xs" style={{ borderColor: `${NAVY}22` }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold tabular-nums" style={{ color: NAVY }}>
                  {d.currency} {d.amount.toFixed(2)}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    backgroundColor:
                      d.status === "posted" ? `${TEAL}22` : d.status === "unknown" ? `${GOLD}22` : `${ERR}1A`,
                    color: d.status === "posted" ? TEAL : d.status === "unknown" ? GOLD : ERR,
                  }}
                >
                  {depositStatusLabel(d.status)}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">N3 document</dt>
                  <dd className="font-mono">{d.n3DocCode ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Customer</dt>
                  <dd>{d.customerLabel ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Account</dt>
                  <dd>{d.accountLabel ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Recorded by</dt>
                  <dd className="font-mono break-all">{d.createdByN3UserKey}</dd>
                </div>
              </dl>
              {d.status === "unknown" ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span style={{ color: GOLD }}>
                    HotelHub could not confirm the N3 result. Do not re-post — check N3 first.
                  </span>
                  <button
                    type="button"
                    onClick={() => reconcile.mutate({ depositId: d.id })}
                    disabled={reconcile.isPending}
                    className="rounded-md border border-input bg-white px-2 py-1 font-medium"
                    style={{ color: NAVY }}
                  >
                    Check N3 result
                  </button>
                </div>
              ) : null}
              {d.status === "failed" ? (
                <p className="mt-2" style={{ color: ERR }}>
                  {depositErrorMessage(d.errorCode)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canCreate ? (
        <div className="mt-4 border-t pt-4">
          {!gateOpen ? (
            <p className="text-xs text-muted-foreground">
              Deposit posting to N3 is not enabled for this property yet.
            </p>
          ) : !eligible ? (
            <p className="text-xs text-muted-foreground">
              Only confirmed reservations can take a deposit.
            </p>
          ) : !confirming ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs">
                <span className="block text-muted-foreground">Deposit amount</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-40 rounded-md border border-input px-2 py-1 text-sm tabular-nums"
                  placeholder="0.00"
                />
              </label>
              <button
                type="button"
                disabled={!canPost || !amount.trim()}
                onClick={() => setConfirming(true)}
                className="rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: GOLD, color: NAVY }}
              >
                Add deposit
              </button>
            </div>
          ) : (
            <div className="rounded-md border p-3 text-xs" style={{ borderColor: `${GOLD}55` }}>
              <p style={{ color: NAVY }}>
                This posts a real AR Receive Payment in N3 for {amount}. It cannot be undone from
                HotelHub.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={submit}
                  disabled={create.isPending}
                  className="rounded-md px-3 py-1.5 font-medium text-white"
                  style={{ backgroundColor: NAVY }}
                >
                  {create.isPending ? "Posting…" : "Confirm and post to N3"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-input bg-white px-3 py-1.5 font-medium"
                  style={{ color: NAVY }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {create.error ? (
            <p className="mt-2 text-xs" style={{ color: ERR }}>
              {depositErrorMessage(create.error.code)}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
