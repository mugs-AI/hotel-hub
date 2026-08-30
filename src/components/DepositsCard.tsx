// Reservation deposit panel.
// Owner + Front Desk read the ledger; only the Owner may post to N3.
// The client request id is minted ONCE when the Owner opens the confirmation
// flow so a safe HTTP retry cannot create a second N3 document.
import { useState } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  depositErrorMessage,
  depositStatusLabel,
  isRecoverableDeposit,
  useCreateDeposit,
  useDepositPreview,
  useReconcileDeposit,
  useReservationDeposits,
} from "@/lib/deposits-client";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const ERR = "#C2413B";

/**
 * Pure, testable compact-summary text for the "no deposits" state.
 * Uncertainty/error warnings on individual deposits are rendered separately
 * and are NEVER summarised away by this helper — it only applies when
 * there are zero deposits to summarise.
 */
export function depositsCompactSummary(opts: { gateOpen: boolean }): string {
  return opts.gateOpen
    ? "Deposits: None"
    : "Deposits: None · N3 posting disabled for this property";
}

/**
 * One-line headline for the COLLAPSED card. Deposits are the exception, not
 * the rule, for an SME front desk, so the quiet default is "No deposit" and
 * the money detail only appears when there is money to show.
 */
export function depositsHeadline(opts: {
  count: number;
  currency: string | null;
  total: number;
  statuses?: ReadonlyArray<string>;
}): string {
  if (opts.count === 0) return "No deposit";
  const money = `${opts.currency ?? ""} ${opts.total.toFixed(2)}`.trim();
  const statuses = opts.statuses ?? [];
  const noun = opts.count === 1 ? "1 deposit" : `${opts.count} deposits`;
  const status = depositsStatusSummary(statuses);
  return status ? `${noun} · ${money} · ${status}` : `${noun} · ${money}`;
}

/** Compact, honest status word for the collapsed header. */
export function compactDepositStatus(status: string): string {
  switch (status) {
    case "posted":
      return "Posted";
    case "failed":
      return "Failed";
    case "unknown":
      return "Unconfirmed";
    default:
      return "Submitting";
  }
}

/**
 * Real status, never a euphemism: one deposit shows its own status, several
 * show a compact count per status. The critical failed/unconfirmed warning is
 * rendered separately and is never replaced by this line.
 */
export function depositsStatusSummary(statuses: ReadonlyArray<string>): string {
  if (statuses.length === 0) return "";
  if (statuses.length === 1) return compactDepositStatus(statuses[0]!);
  const counts = new Map<string, number>();
  for (const s of statuses) {
    const label = compactDepositStatus(s);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, n]) => `${label} ${n}`).join(" · ");
}

/** Collapsed-state attention line: never hide an unconfirmed or failed post. */
export function depositsAttentionLine(deposits: ReadonlyArray<{ status: string }>): string | null {
  const failed = deposits.filter((d) => d.status === "failed").length;
  const unconfirmed = deposits.filter((d) =>
    isRecoverableDeposit(d.status as Parameters<typeof isRecoverableDeposit>[0]),
  ).length;

  if (failed === 0 && unconfirmed === 0) return null;
  const parts: string[] = [];
  if (unconfirmed > 0) {
    parts.push(`${unconfirmed} unconfirmed in N3 — do not re-post, check N3 first`);
  }
  if (failed > 0) parts.push(`${failed} failed`);
  return `Needs attention: ${parts.join(" · ")}`;
}

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
  const preview = useDepositPreview(reservationId);
  const [amount, setAmount] = useState("");
  // Stable per-confirmation-attempt identity. Minted on "Add deposit",
  // cleared only on cancel or a completed server result.
  const [attempt, setAttempt] = useState<{ clientRequestId: string; amount: number } | null>(null);

  if (!canView) return null;
  const deposits = q.data?.deposits ?? [];
  const gateOpen = q.data?.capability.canCreate === true;
  const canPost = canCreate && gateOpen && eligible;

  const openConfirm = () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    const rounded = Math.round(value * 100) / 100;
    setAttempt({ clientRequestId: crypto.randomUUID(), amount: rounded });
    preview.reset();
    preview.mutate({ amount: rounded });
  };

  const cancelConfirm = () => {
    setAttempt(null);
    preview.reset();
    create.reset();
  };

  const submit = () => {
    if (!attempt) return;
    create.mutate(
      { amount: attempt.amount, clientRequestId: attempt.clientRequestId },
      {
        onSuccess: () => {
          setAmount("");
          setAttempt(null);
          preview.reset();
        },
      },
    );
  };

  const p = preview.data?.preview;

  const total = deposits.reduce((sum, d) => sum + d.amount, 0);
  const headline = depositsHeadline({
    count: deposits.length,
    currency: deposits[0]?.currency ?? null,
    total,
    statuses: deposits.map((d) => d.status),
  });
  const attention = depositsAttentionLine(deposits);

  return (
    <section
      className="rounded-lg border p-5 shadow-sm"
      style={{
        // Light teal/blue money card: deposits are money in, and read as money.
        backgroundColor: "#F1FAFB",
        borderColor: `${TEAL}40`,
        borderLeft: `4px solid ${TEAL}`,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
            Deposits
          </h2>
          <Popover>
            <PopoverTrigger
              type="button"
              aria-label="About deposits"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-input bg-white"
              style={{ color: TEAL }}
            >
              <Info className="h-3 w-3" aria-hidden />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 text-xs">
              <p>Money taken before the stay. Each deposit is saved in N3 as a payment received.</p>
              <p className="mt-2">HotelHub never keeps a payment only on its own records.</p>
              <p className="mt-2">
                A payment entered straight into N3 will not appear here on its own.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        <span className="text-sm" style={{ color: NAVY }}>
          {q.isPending ? "Loading…" : headline}
        </span>
      </div>
      {attention ? (
        <p className="mt-1 text-xs font-medium" style={{ color: GOLD }}>
          {attention}
        </p>
      ) : null}

      {q.isPending ? (
            <p className="mt-3 text-sm text-muted-foreground">Loading deposits…</p>
          ) : deposits.length === 0 ? (
            <div className="mt-3 space-y-1 text-sm text-muted-foreground">
              <p className="font-medium" style={{ color: NAVY }}>
                {depositsCompactSummary({ gateOpen })}
              </p>
              <p>No deposits recorded for this booking.</p>
              {!gateOpen ? <p>Deposits are switched off for this property.</p> : null}
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {deposits.map((d) => (
                <li
                  key={d.id}
                  className="rounded-md border p-3 text-xs"
                  style={{ borderColor: `${NAVY}22` }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold tabular-nums" style={{ color: NAVY }}>
                      {d.currency} {d.amount.toFixed(2)}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{
                        backgroundColor:
                          d.status === "posted"
                            ? `${TEAL}22`
                            : d.status === "failed"
                              ? `${ERR}1A`
                              : `${GOLD}22`,
                        color: d.status === "posted" ? TEAL : d.status === "failed" ? ERR : GOLD,
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
                      <dd>{d.createdByLabel ?? "System"}</dd>
                    </div>
                  </dl>
                  {isRecoverableDeposit(d.status) ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span style={{ color: GOLD }}>
                        HotelHub could not confirm the N3 result. Do not re-post — check N3 first.
                      </span>
                      {canCreate ? (
                        <button
                          type="button"
                          onClick={() => reconcile.mutate({ depositId: d.id })}
                          disabled={reconcile.isPending}
                          className="rounded-md border border-input bg-white px-2 py-1 font-medium"
                          style={{ color: NAVY }}
                        >
                          Check N3 result
                        </button>
                      ) : null}
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

          {!canCreate ? (
            <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
              Only the Owner can send a deposit to N3.
            </p>
          ) : (
            <div className="mt-4 border-t pt-4">
              {!gateOpen ? (
                <p className="text-xs text-muted-foreground">
                  Deposits are not switched on for this property yet.
                </p>
              ) : !eligible ? (
                <p className="text-xs text-muted-foreground">
                  You can only take a deposit on a confirmed booking.
                </p>
              ) : !attempt ? (
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
                    onClick={openConfirm}
                    className="rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
                    style={{ backgroundColor: GOLD, color: NAVY }}
                  >
                    Add deposit
                  </button>
                </div>
              ) : (
                <div className="rounded-md border p-3 text-xs" style={{ borderColor: `${GOLD}55` }}>
                  {preview.isPending ? (
                    <p className="text-muted-foreground">Checking the details in N3…</p>
                  ) : preview.error ? (
                    <p style={{ color: ERR }}>{depositErrorMessage(preview.error.code)}</p>
                  ) : p ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Booking</dt>
                        <dd className="font-mono">{p.bookingReference}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Customer</dt>
                        <dd>{p.customerLabel}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Amount</dt>
                        <dd className="tabular-nums">
                          {p.currency} {p.amount.toFixed(2)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Payment account</dt>
                        <dd>{p.accountLabel ?? "—"}</dd>
                      </div>
                    </dl>
                  ) : null}
                  <p className="mt-2 font-semibold" style={{ color: NAVY }}>
                    {p?.warning ?? "This creates a real accounting document in N3."} It cannot be
                    undone from HotelHub.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={submit}
                      disabled={create.isPending || preview.isPending || !p}
                      className="rounded-md px-3 py-1.5 font-medium text-white disabled:opacity-50"
                      style={{ backgroundColor: NAVY }}
                    >
                      {create.isPending ? "Posting…" : "Confirm and post to N3"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelConfirm}
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
          )}
    </section>
  );
}
