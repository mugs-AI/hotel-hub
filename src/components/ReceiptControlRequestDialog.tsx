// Request correction / Request void for a posted deposit receipt.
// Shows original vs requested and the provisional deposit/balance difference.
// Submitting only records a request; nothing changes in N3 or in totals.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePaymentAccounts, type DepositDTO } from "@/lib/deposits-client";
import { formatReceiptDelta, formatReceiptMoney } from "@/lib/receipt-controls";
import {
  createReceiptControl,
  getReceiptOriginal,
  type ReceiptOriginalDTO,
  ReceiptControlClientError,
  receiptControlMessage,
  journalReasonLabel,
  type ReceiptControlProposalInput,
  useReceiptIdentity,
} from "@/lib/receipt-controls-client";

const NAVY = "#102A43";

/** Provisional (pre-approval) difference lines shown before submitting. */
export function provisionalDeltaLines(
  originalCents: number,
  requestedCents: number | null,
  currency: string,
) {
  const delta = requestedCents === null ? -originalCents : requestedCents - originalCents;
  return {
    deposits: `Deposits ${formatReceiptDelta(delta, currency)}`,
    balance: `Balance ${formatReceiptDelta(-delta, currency)} (provisional — nothing changes until verified in N3)`,
  };
}

export function parseAmountInput(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

export type ContactDraft = { name: string; address: string; phone: string; email: string };

/** Prefill the edit form from the SAVED N3 contact (never blank). */
export function contactDraftFromOriginal(c: ReceiptOriginalDTO["contact"]): ContactDraft {
  return {
    name: c.customerName,
    address: `${c.remark1}${c.remark2}`,
    phone: c.remark3,
    email: c.remark4,
  };
}

/**
 * Build the correction proposal. Contact is sent ONLY in explicit edit mode
 * and only when it differs from the saved contact; otherwise the server keeps
 * the saved N3 name/remarks exactly. An amount-only change never erases them.
 */
export function buildCorrectionProposal(args: {
  amount: number;
  accountId: string;
  editContact: boolean;
  draft: ContactDraft;
  saved: ContactDraft;
}): ReceiptControlProposalInput {
  const out: Extract<ReceiptControlProposalInput, { kind: "correction" }> = {
    kind: "correction",
    amount: args.amount,
    accountId: args.accountId,
  };
  const changed = (Object.keys(args.saved) as Array<keyof ContactDraft>).some(
    (k) => args.draft[k].trim() !== args.saved[k].trim(),
  );
  if (args.editContact && changed) out.contact = { ...args.draft };
  return out;
}

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-000000000000";

export function ReceiptControlRequestDialog({
  reservationId,
  deposit,
  kind,
  onClose,
}: {
  reservationId: string;
  deposit: DepositDTO;
  kind: "correction" | "void";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const identity = useReceiptIdentity();
  const accounts = usePaymentAccounts(kind === "correction");
  const originalCents = Math.round(deposit.amount * 100);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(deposit.amount.toFixed(2));
  const [accountId, setAccountId] = useState("");
  const [editContact, setEditContact] = useState(false);
  const [contact, setContact] = useState<ContactDraft>({
    name: "",
    address: "",
    phone: "",
    email: "",
  });
  const original = useQuery({
    queryKey: ["receipt-controls", identity ?? "none", "original", reservationId, deposit.id],
    queryFn: () => getReceiptOriginal(reservationId, deposit.id),
    enabled: identity !== null,
    retry: false,
    staleTime: 0,
  });
  const saved = original.data ? contactDraftFromOriginal(original.data.original.contact) : null;
  useEffect(() => {
    if (!original.data) return;
    setContact(contactDraftFromOriginal(original.data.original.contact));
    setAccountId((cur) => cur || original.data.original.accountId || "");
  }, [original.data]);
  // Stable identity for this dialog attempt; retries replay the same request.
  const [clientRequestId] = useState(newKey);
  const [error, setError] = useState("");
  const submit = useMutation({
    mutationKey: ["receipt-controls", identity ?? "none", "request", deposit.id],
    mutationFn: (proposal: ReceiptControlProposalInput) =>
      createReceiptControl(reservationId, deposit.id, {
        clientRequestId,
        reason: reason.trim(),
        proposal,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipt-controls"] });
      onClose();
    },
    onError: (e) =>
      setError(receiptControlMessage(e instanceof ReceiptControlClientError ? e.code : "")),
  });
  const parsed = kind === "correction" ? parseAmountInput(amount) : null;
  const requestedCents = parsed === null ? null : Math.round(parsed * 100);
  const lines = provisionalDeltaLines(
    originalCents,
    kind === "void" ? null : (requestedCents ?? originalCents),
    deposit.currency,
  );
  const journalBlocked = original.data?.original.journal?.exact === false;
  const journalReasons = original.data?.original.journal?.reasons ?? [];
  const reasonOk = reason.trim().length > 0 && reason.trim().length <= 500;
  const onSubmit = () => {
    setError("");
    if (!reasonOk) return setError(receiptControlMessage("invalid_reason"));
    if (kind === "void") return submit.mutate({ kind: "void" });
    if (parsed === null) return setError(receiptControlMessage("invalid_amount"));
    if (!saved) return setError(receiptControlMessage("n3_evidence_unavailable"));
    if (!accountId) return setError(receiptControlMessage("invalid_account"));
    submit.mutate(
      buildCorrectionProposal({ amount: parsed, accountId, editContact, draft: contact, saved }),
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={kind === "void" ? "Request void" : "Request correction"}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:items-center"
    >
      <div
        data-testid="receipt-request-panel"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 text-base shadow-lg"
      >
        <h2 className="text-xl font-semibold" style={{ color: NAVY }}>
          {kind === "void" ? "Request void" : "Request correction"} —{" "}
          {deposit.n3DocCode ?? "receipt"}
        </h2>
        <p className="text-base text-muted-foreground">
          The Owner reviews this request. Totals change only after the change is made in N3 and
          verified.
        </p>
        <table className="w-full text-base">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>Field</th>
              <th>Original</th>
              <th>Requested</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Amount</td>
              <td>{formatReceiptMoney(originalCents, deposit.currency)}</td>
              <td>
                {kind === "void"
                  ? "Void"
                  : requestedCents
                    ? formatReceiptMoney(requestedCents, deposit.currency)
                    : "—"}
              </td>
            </tr>
            {kind === "correction" && saved
              ? (
                  [
                    ["name", "Bill-to name"],
                    ["address", "Address"],
                    ["phone", "Phone"],
                    ["email", "Email"],
                  ] as const
                ).map(([k, label]) => (
                  <tr key={k}>
                    <td>{label}</td>
                    <td>{saved[k] || "—"}</td>
                    <td>
                      {!editContact || contact[k].trim() === saved[k].trim()
                        ? "Unchanged"
                        : contact[k].trim() || "(cleared)"}
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
        {kind === "correction" ? (
          <div className="grid gap-2 text-base">
            <label>
              Amount
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Deposit to
              <select
                className="mt-1 w-full rounded border px-2 py-1"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">Choose account…</option>
                {original.data?.original.accountId &&
                !(accounts.data?.accounts ?? []).some(
                  (a) => a.id.toLowerCase() === original.data.original.accountId!.toLowerCase(),
                ) ? (
                  <option value={original.data.original.accountId}>
                    {original.data.original.accountLabel ?? "Current account"} (current —
                    contact-only changes)
                  </option>
                ) : null}
                {(accounts.data?.accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            {original.isPending ? (
              <p className="text-muted-foreground">Loading saved receipt details from N3…</p>
            ) : null}
            {original.isError ? (
              <p role="alert" className="text-red-700">
                Saved receipt details could not be read from N3.{" "}
                {receiptControlMessage(
                  original.error instanceof ReceiptControlClientError ? original.error.code : "",
                )}
              </p>
            ) : null}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editContact}
                disabled={!saved}
                onChange={(e) => {
                  setEditContact(e.target.checked);
                  if (!e.target.checked && saved) setContact(saved);
                }}
              />
              Change bill-to contact (otherwise the saved N3 contact is kept)
            </label>
            {editContact &&
              (["name", "address", "phone", "email"] as const).map((k) => (
                <label key={k} className="capitalize">
                  {k === "name" ? "Bill-to name" : k}
                  <input
                    className="mt-1 w-full rounded border px-2 py-1"
                    value={contact[k]}
                    onChange={(e) => setContact({ ...contact, [k]: e.target.value })}
                  />
                </label>
              ))}
          </div>
        ) : null}
        <div className="rounded-md bg-amber-50 p-2 text-base">
          <p>{lines.deposits}</p>
          <p>{lines.balance}</p>
        </div>
        <label className="block text-base">
          Reason (required)
          <textarea
            className="mt-1 w-full rounded border px-2 py-1"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {journalBlocked ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-2 text-base text-red-800"
          >
            <p>This receipt’s N3 journal could not be verified. Sending is blocked.</p>
            {journalReasons.length ? (
              <ul className="mt-1 list-disc pl-5" aria-label="Journal checks that failed">
                {journalReasons.map((r) => (
                  <li key={r}>
                    {journalReasonLabel(r)} <code className="text-sm">({r})</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1">Ask the Owner to open this dialog to see which check failed.</p>
            )}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-base text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5 text-base" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded px-3 py-1.5 text-base font-semibold text-white"
            style={{ backgroundColor: NAVY }}
            disabled={
              submit.isPending || !reasonOk || (kind === "correction" && !saved) || journalBlocked
            }
            onClick={onSubmit}
          >
            {submit.isPending ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}
