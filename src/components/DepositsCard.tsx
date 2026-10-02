// Reservation deposit panel.
// Owner + Front Desk read the ledger; only the Owner may post to N3.
// The client request id is minted ONCE when the Owner opens the confirmation
// flow so a safe HTTP retry cannot create a second N3 document.
import { useEffect, useRef, useState } from "react";
import { depositEntry, formatDepositInput } from "@/lib/deposit-entry";
import { useWorkspaceDraft } from "@/lib/workspace-context";
import { CardInfoPopover } from "@/components/CardInfoPopover";
import { N3ReceiptPrintLink } from "@/components/N3ReceiptPrintLink";
import { ReceiptControlRequestDialog } from "@/components/ReceiptControlRequestDialog";
import { useQuery } from "@tanstack/react-query";
import { listReceiptControls, receiptControlsKey } from "@/lib/receipt-controls-client";
import { ACTIVE_RECEIPT_CONTROL_STATES, RECEIPT_CONTROL_STATE_LABEL } from "@/lib/receipt-controls";
import { formatMyTimestamp } from "@/lib/malaysia-date";
import {
  depositErrorMessage,
  DepositApiError,
  depositStatusLabel,
  isRecoverableDeposit,
  useCreateDeposit,
  useDepositPreview,
  usePaymentAccounts,
  type PaymentLine,
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
  void opts;
  return "No deposit";
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
  canRequestReceiptChange = false,
  eligible,
}: {
  reservationId: string;
  canView: boolean;
  canCreate: boolean;
  canRequestReceiptChange?: boolean;
  eligible: boolean;
}) {
  const [receiptDialog, setReceiptDialog] = useState<{
    depositId: string;
    kind: "correction" | "void";
  } | null>(null);
  const receiptRequests = useQuery({
    queryKey: receiptControlsKey("session", `reservation:${reservationId}`),
    queryFn: () => listReceiptControls({ reservationId }),
    enabled: canView && canRequestReceiptChange,
    retry: false,
  });
  const q = useReservationDeposits(reservationId, canView);
  const create = useCreateDeposit(reservationId);
  const reconcile = useReconcileDeposit(reservationId);
  const preview = useDepositPreview(reservationId);
  const accounts = usePaymentAccounts(canCreate && eligible);
  const tabKey = `reservation:${reservationId.toLowerCase()}`;
  const [lines, setLines] = useWorkspaceDraft<Array<{ accountId: string; amount: string }>>(
    "deposit-lines",
    [{ accountId: "", amount: "" }],
    (value) => value.some((line) => Boolean(line.accountId || line.amount.trim())),
    tabKey,
  );
  const [formError, setFormError] = useState("");
  // Stable per-confirmation-attempt identity. Minted on "Add deposit",
  // cleared only on cancel or a completed server result.
  const [attempt, setAttempt] = useWorkspaceDraft<{
    clientRequestId: string;
    amount: number;
    paymentLines: PaymentLine[];
    phase: "review" | "posting" | "unknown";
  } | null>(
    "deposit-attempt",
    null,
    (value) => value !== null,
    tabKey,
    (value) =>
      value?.phase === "posting"
        ? "Deposit posting is in progress. Wait for the result before closing this tab."
        : value?.phase === "unknown"
          ? "The deposit result is uncertain. Check N3 before closing this tab."
          : null,
  );
  const submitClaim = useRef(false);

  // Recover only this exact browser intent from the authoritative ledger.
  // Amount/account similarity is not evidence that an uncertain post completed.
  useEffect(() => {
    if (attempt?.phase !== "unknown") return;
    const result = q.data?.deposits.find((d) => d.clientRequestId === attempt.clientRequestId);
    if (result?.status !== "posted" && result?.status !== "failed") return;
    setLines([{ accountId: "", amount: "" }]);
    setAttempt(null);
    setFormError("");
  }, [attempt, q.data, setAttempt, setLines]);

  if (!canView) return null;
  const deposits = q.data?.deposits ?? [];
  const gateOpen = q.data?.capability.canCreate === true;
  const canSplit = q.data?.capability.canSplit === true;
  const canPost = canCreate && gateOpen && eligible;
  const entry = depositEntry(lines, canSplit);
  const unresolved = deposits.some((deposit) => isRecoverableDeposit(deposit.status));

  const openConfirm = () => {
    if (!entry.ok) {
      setFormError(entry.message);
      return;
    }
    setFormError("");
    setAttempt({
      clientRequestId: crypto.randomUUID(),
      amount: entry.amount,
      paymentLines: entry.paymentLines,
      phase: "review",
    });
    preview.reset();
    preview.mutate({ amount: entry.amount, paymentLines: entry.paymentLines });
  };

  const cancelConfirm = () => {
    if (attempt?.phase === "posting" || attempt?.phase === "unknown") return;
    setAttempt(null);
    preview.reset();
    create.reset();
  };

  const submit = async () => {
    if (
      !attempt ||
      attempt.phase !== "review" ||
      submitClaim.current ||
      !preview.data?.preview ||
      preview.error ||
      preview.isPending
    )
      return;
    submitClaim.current = true;
    setAttempt({ ...attempt, phase: "posting" });
    try {
      // Await outside component-bound mutation callbacks: it still resolves the same
      // retained intent when the Owner switches to another work tab meanwhile.
      await create.mutateAsync({
        amount: attempt.amount,
        clientRequestId: attempt.clientRequestId,
        paymentLines: attempt.paymentLines,
      });
      setLines([{ accountId: "", amount: "" }]);
      setAttempt(null);
      preview.reset();
    } catch (error) {
      const definite =
        error instanceof DepositApiError &&
        [
          "invalid_amount",
          "receipt_contact_too_long",
          "receipt_contact_unavailable",
          "invalid_payment_lines",
          "invalid_client_request_id",
          "deposit_writes_disabled",
          "forbidden",
          "unauthorized",
          "cross_site_denied",
          "reservation_not_found",
          "reservation_not_eligible",
          "walk_in_customer_not_mapped",
          "n3_defaults_unavailable",
          "n3_defaults_invalid",
          "n3_defaults_rejected",
          "n3_defaults_type_invalid",
          "n3_defaults_currency_missing",
          "n3_defaults_currency_invalid",
          "n3_defaults_currency_code_missing",
          "n3_defaults_currency_conflict",
          "n3_defaults_rate_invalid",
          "n3_defaults_account_invalid",
          "n3_deposit_account_unavailable",
          "n3_deposit_account_invalid",
          "n3_preflight_unavailable",
          "reference_conflict",
          "multi_payment_contract_unverified",
          "payment_method_hidden",
        ].includes(error.code);
      setAttempt({ ...attempt, phase: definite ? "review" : "unknown" });
      setFormError(
        depositErrorMessage(error instanceof DepositApiError ? error.code : "n3_result_uncertain"),
      );
      void q.refetch();
    } finally {
      submitClaim.current = false;
    }
  };

  const p = preview.data?.preview;

  const total = q.data?.summary?.total ?? 0;
  const totalLabel = q.data?.summary
    ? `${q.data.summary.currency === "MYR" ? "RM" : (q.data.summary.currency ?? "")} ${q.data.summary.total.toFixed(2)}`.trim()
    : "Unavailable";
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
          <CardInfoPopover label="About deposits">
            Deposits are advance payments recorded through N3. After an approved N3 tenant is
            enabled by the HotelHub administrator, an Owner can add one after saving a Confirmed
            booking, including while the guest is Checked in. It remains unapplied until a Cash Memo
            is posted and matched. Unconfirmed N3 results are always shown for checking.
          </CardInfoPopover>
        </div>
        <span className="text-sm" style={{ color: NAVY }}>
          {q.isPending
            ? "Loading…"
            : q.isError
              ? "Deposits unavailable"
              : q.data?.summary
                ? headline
                : "Deposit total unavailable"}
        </span>
      </div>
      {attention ? (
        <p className="mt-1 text-xs font-medium" style={{ color: GOLD }}>
          {attention}
        </p>
      ) : null}

      {receiptDialog
        ? (() => {
            const dep = deposits.find((x) => x.id === receiptDialog.depositId);
            return dep ? (
              <ReceiptControlRequestDialog
                reservationId={reservationId}
                deposit={dep}
                kind={receiptDialog.kind}
                onClose={() => setReceiptDialog(null)}
              />
            ) : null;
          })()
        : null}
      {q.isPending ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading deposits…</p>
      ) : deposits.length === 0 ? null : (
        <ul className="mt-3 space-y-2">
          {deposits.map((d) => (
            <li
              key={d.id}
              className="rounded-md border px-3 py-2 text-base"
              style={{ borderColor: `${NAVY}22` }}
            >
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="font-mono font-medium">{d.n3DocCode ?? "—"}</span>
                <time dateTime={d.createdAt}>{formatMyTimestamp(d.createdAt).slice(0, 10)}</time>
                <span>
                  {d.paymentLines?.length
                    ? d.paymentLines
                        .map((l) =>
                          l.code && l.displayName ? `${l.code} (${l.displayName})` : l.accountLabel,
                        )
                        .join("; ")
                    : (d.accountLabel ?? "—")}
                </span>
                <span className="font-semibold tabular-nums" style={{ color: NAVY }}>
                  {d.currency === "MYR" ? "RM" : d.currency} {d.amount.toFixed(2)}
                </span>
                <CardInfoPopover label={`Deposit ${d.n3DocCode ?? "unconfirmed"} details`}>
                  <p>{depositStatusLabel(d.status)}</p>
                  <p>Customer: {d.customerLabel ?? "—"}</p>
                  <p>Recorded by: {d.createdByLabel ?? "System"}</p>
                  <p>Recorded: {formatMyTimestamp(d.createdAt)}</p>
                  <p>{d.description}</p>
                  {d.paymentLines?.length > 1
                    ? d.paymentLines.map((line, index) => (
                        <p key={index}>
                          {line.accountLabel}: {d.currency} {line.amount.toFixed(2)}
                        </p>
                      ))
                    : null}
                </CardInfoPopover>
                <N3ReceiptPrintLink status={d.status} receiptId={d.n3ReceiptId} />
                {(() => {
                  const open = (receiptRequests.data?.requests ?? []).find(
                    (r) => r.depositId === d.id && ACTIVE_RECEIPT_CONTROL_STATES.includes(r.state),
                  );
                  if (d.effectiveState === "voided")
                    return (
                      <span className="text-xs font-semibold" style={{ color: ERR }}>
                        Voided in N3 — not counted
                      </span>
                    );
                  if (open)
                    return (
                      <span className="text-xs font-medium" style={{ color: GOLD }}>
                        Request: {RECEIPT_CONTROL_STATE_LABEL[open.state]}
                      </span>
                    );
                  if (!canRequestReceiptChange || d.status !== "posted" || receiptRequests.isError)
                    return null;
                  return (
                    <>
                      <button
                        type="button"
                        className="text-xs font-medium underline"
                        style={{ color: NAVY }}
                        onClick={() => setReceiptDialog({ depositId: d.id, kind: "correction" })}
                      >
                        Request correction
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium underline"
                        style={{ color: ERR }}
                        onClick={() => setReceiptDialog({ depositId: d.id, kind: "void" })}
                      >
                        Request void
                      </button>
                    </>
                  );
                })()}
                {d.effectiveState === "needs_review" ? (
                  <span className="text-xs font-semibold" style={{ color: GOLD }}>
                    Needs review
                  </span>
                ) : null}
                {d.originalAmount != null && d.effectiveState === "active" ? (
                  <span className="text-xs text-muted-foreground">
                    Corrected from {d.originalAmount.toFixed(2)}
                  </span>
                ) : null}
                {d.status !== "posted" ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{
                      backgroundColor: d.status === "failed" ? `${ERR}1A` : `${GOLD}22`,
                      color: d.status === "failed" ? ERR : GOLD,
                    }}
                  >
                    {depositStatusLabel(d.status)}
                  </span>
                ) : null}
              </div>
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

      {q.isError ? (
        <div className="mt-3 text-sm" role="alert">
          <p style={{ color: ERR }}>Could not load deposits. Retry before adding a deposit.</p>
          <button
            type="button"
            className="mt-2 rounded-md border bg-white px-3 py-2"
            onClick={() => void q.refetch()}
          >
            Retry deposits
          </button>
        </div>
      ) : q.isPending ? null : !canCreate ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Only the Owner can add a deposit. You can view recorded deposits here.
        </p>
      ) : (
        <div className="mt-3 border-t pt-3">
          {!gateOpen ? (
            <p className="text-xs text-muted-foreground">
              Deposit collection is not enabled for this property. Refer to Admin.
            </p>
          ) : !eligible ? (
            <p className="text-xs text-muted-foreground">
              Deposits are available on saved Confirmed or Checked-in reservations.
            </p>
          ) : !attempt && unresolved ? (
            <p className="text-sm" style={{ color: GOLD }}>
              Check the unconfirmed deposit in N3 before adding another deposit.
            </p>
          ) : !attempt ? (
            <div className="flex flex-wrap items-center gap-3">
              {lines.map((line, index) => (
                <div key={index} className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <span>{index === 0 ? "Deposit to" : `Payment ${index + 1}`}</span>
                    <select
                      className="min-w-0 max-w-full rounded-md border border-input bg-white px-2 py-2 text-sm"
                      value={line.accountId}
                      onChange={(e) =>
                        setLines((current) =>
                          current.map((l, i) =>
                            i === index ? { ...l, accountId: e.target.value } : l,
                          ),
                        )
                      }
                    >
                      <option value="">Choose bank or cash account</option>
                      {accounts.data?.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label} ({a.code})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <span>Amount</span>
                    <input
                      inputMode="decimal"
                      className="w-28 rounded-md border border-input bg-white px-2 py-2 text-sm"
                      value={line.amount}
                      placeholder="0.00"
                      onBlur={() =>
                        setLines((current) =>
                          current.map((l, i) =>
                            i === index ? { ...l, amount: formatDepositInput(l.amount) } : l,
                          ),
                        )
                      }
                      onChange={(e) =>
                        setLines((current) =>
                          current.map((l, i) =>
                            i === index ? { ...l, amount: e.target.value } : l,
                          ),
                        )
                      }
                    />
                  </label>
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      className="rounded-md border px-2 py-1 text-xs"
                      onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
              {accounts.error ? (
                <div className="text-xs" style={{ color: ERR }}>
                  {depositErrorMessage(accounts.error.code)}
                  <button
                    type="button"
                    className="ml-2 rounded-md border bg-white px-2 py-1"
                    onClick={() => void accounts.refetch()}
                  >
                    Retry payment methods
                  </button>
                </div>
              ) : null}
              {accounts.isSuccess && accounts.data.accounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No shown bank or cash payment methods. Check Payment method names in Settings.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {canSplit ? (
                  <button
                    type="button"
                    className="rounded-md border px-2 py-1 text-xs"
                    disabled={lines.length >= 10}
                    onClick={() =>
                      setLines((current) => [...current, { accountId: "", amount: "" }])
                    }
                  >
                    Add another payment method
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={
                    !canPost ||
                    !entry.ok ||
                    accounts.isPending ||
                    Boolean(accounts.error) ||
                    !accounts.data?.accounts.length ||
                    lines.some((l) => !accounts.data?.accounts.some((a) => a.id === l.accountId))
                  }
                  onClick={openConfirm}
                  className="rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
                  style={{ backgroundColor: GOLD, color: NAVY }}
                >
                  Add deposit
                </button>
                <CardInfoPopover label="About this deposit entry">
                  <p>
                    {canSplit
                      ? "Choose the enabled payment methods and their amounts."
                      : "One payment method per deposit."}
                  </p>
                  <p>
                    Total Deposits includes posted payments only. Failed and unconfirmed entries are
                    excluded.
                  </p>
                </CardInfoPopover>
                <span className="ml-2 text-sm font-semibold tabular-nums">
                  Total Deposits: {totalLabel}
                </span>
              </div>
              {!entry.ok && lines.some((l) => l.amount.trim()) ? (
                <p className="text-xs" style={{ color: ERR }}>
                  {entry.message}
                </p>
              ) : null}
              {accounts.isPending ? (
                <p className="text-xs text-muted-foreground">Loading payment methods…</p>
              ) : null}
              {formError ? (
                <p className="text-xs" style={{ color: ERR }}>
                  {formError}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {attempt.phase === "posting" ? (
                <p role="status">Posting this deposit to N3…</p>
              ) : attempt.phase === "unknown" ? (
                <div role="alert">
                  <p>
                    The deposit result is uncertain. Do not submit another deposit. Check the
                    recorded result below or refer to Admin.
                  </p>
                  <button
                    type="button"
                    className="mt-2 rounded-md border bg-white px-3 py-2"
                    onClick={() => void q.refetch()}
                  >
                    Reload deposits
                  </button>
                </div>
              ) : null}
              {attempt.phase === "review" && !p && !preview.isPending && !preview.error ? (
                <button
                  type="button"
                  className="rounded-md border bg-white px-3 py-2"
                  onClick={() =>
                    preview.mutate({ amount: attempt.amount, paymentLines: attempt.paymentLines })
                  }
                >
                  Review deposit
                </button>
              ) : null}
              {preview.isPending ? (
                <p className="text-muted-foreground">Checking the details in N3…</p>
              ) : preview.error ? (
                <p style={{ color: ERR }}>{depositErrorMessage(preview.error.code)}</p>
              ) : p ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    Deposit to{" "}
                    <strong>{p.paymentLines.map((l) => l.accountLabel).join("; ")}</strong>
                  </span>
                  <span>
                    Amount{" "}
                    <strong className="tabular-nums">
                      {p.currency} {p.amount.toFixed(2)}
                    </strong>
                  </span>
                </div>
              ) : null}
              {p && !preview.error && !preview.isPending && attempt.phase === "review" ? (
                <CardInfoPopover label="About confirming this deposit">
                  <p>
                    {p.bookingReference} · {p.customerLabel}
                  </p>
                  <p>One payment method per deposit unless split payments are enabled.</p>
                </CardInfoPopover>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={submit}
                  disabled={
                    attempt.phase !== "review" ||
                    create.isPending ||
                    preview.isPending ||
                    Boolean(preview.error) ||
                    !p
                  }
                  className="rounded-md px-3 py-1.5 font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: NAVY }}
                >
                  {create.isPending ? "Posting…" : "Confirm and post to N3"}
                </button>
                <button
                  type="button"
                  onClick={cancelConfirm}
                  disabled={attempt.phase !== "review"}
                  className="rounded-md border border-input bg-white px-3 py-1.5 font-medium"
                  style={{ color: NAVY }}
                >
                  Cancel
                </button>
                <span className="ml-2 font-semibold tabular-nums">
                  Total Deposits: {totalLabel}
                </span>
              </div>
              {p && !preview.error && !preview.isPending && attempt.phase === "review" ? (
                <p className="w-full text-sm" style={{ color: NAVY }}>
                  {p.warning} It cannot be undone from HotelHub.
                </p>
              ) : null}
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
