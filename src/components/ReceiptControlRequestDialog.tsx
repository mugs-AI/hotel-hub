// Request correction / Request void for a posted deposit receipt.
// Shows original vs requested and the provisional deposit/balance difference.
// Submitting only records a request; nothing changes in N3 or in totals.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePaymentAccounts, type DepositDTO } from "@/lib/deposits-client";
import { formatReceiptDelta, formatReceiptMoney } from "@/lib/receipt-controls";
import {
  createReceiptControl,
  ReceiptControlClientError,
  receiptControlMessage,
  type ReceiptControlProposalInput,
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
  const accounts = usePaymentAccounts(kind === "correction");
  const originalCents = Math.round(deposit.amount * 100);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(deposit.amount.toFixed(2));
  const [accountId, setAccountId] = useState("");
  const [contact, setContact] = useState({ name: "", address: "", phone: "", email: "" });
  // Stable identity for this dialog attempt; retries replay the same request.
  const [clientRequestId] = useState(newKey);
  const [error, setError] = useState("");
  const submit = useMutation({
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
  const reasonOk = reason.trim().length > 0 && reason.trim().length <= 500;
  const onSubmit = () => {
    setError("");
    if (!reasonOk) return setError(receiptControlMessage("invalid_reason"));
    if (kind === "void") return submit.mutate({ kind: "void" });
    if (parsed === null) return setError(receiptControlMessage("invalid_amount"));
    if (!accountId) return setError(receiptControlMessage("invalid_account"));
    submit.mutate({ kind: "correction", amount: parsed, accountId, contact });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={kind === "void" ? "Request void" : "Request correction"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-full max-w-lg space-y-3 rounded-xl bg-white p-5 shadow-lg">
        <h2 className="text-lg font-semibold" style={{ color: NAVY }}>
          {kind === "void" ? "Request void" : "Request correction"} —{" "}
          {deposit.n3DocCode ?? "receipt"}
        </h2>
        <p className="text-sm text-muted-foreground">
          The Owner reviews this request. Totals change only after the change is made in N3 and
          verified.
        </p>
        <table className="w-full text-sm">
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
          </tbody>
        </table>
        {kind === "correction" ? (
          <div className="grid gap-2 text-sm">
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
                {(accounts.data?.accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            {(["name", "address", "phone", "email"] as const).map((k) => (
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
        <div className="rounded-md bg-amber-50 p-2 text-sm">
          <p>{lines.deposits}</p>
          <p>{lines.balance}</p>
        </div>
        <label className="block text-sm">
          Reason (required)
          <textarea
            className="mt-1 w-full rounded border px-2 py-1"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded px-3 py-1.5 text-sm font-semibold text-white"
            style={{ backgroundColor: NAVY }}
            disabled={submit.isPending || !reasonOk}
            onClick={onSubmit}
          >
            {submit.isPending ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}
