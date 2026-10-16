import { useWorkspaceDraft } from "@/lib/workspace-context";
import {
  MAX_SETTLEMENT_PAYMENT_LINES,
  parsePaymentAmount,
  validateSettlementPaymentLines,
  type SettlementPaymentLine,
} from "@/lib/settlement-payment-entry";
import type { PaymentAccountChoice } from "@/lib/deposits-client";

type Draft = { rows: Array<{ accountId: string; amount: string }>; confirmation: string | null };
const money = (cents: number, currency: string) => `${currency} ${(cents / 100).toFixed(2)}`;
export function SettlementPaymentForm({
  reservationId,
  billId,
  revision,
  balanceCents,
  currency,
  accounts,
  unavailable,
  pending,
  splitAllowed,
  onReceive,
}: {
  reservationId: string;
  billId: string;
  revision: string;
  balanceCents: number;
  currency: string;
  accounts: PaymentAccountChoice[];
  unavailable: boolean;
  pending: boolean;
  splitAllowed: boolean;
  onReceive(lines: SettlementPaymentLine[]): void;
}) {
  const [draft, setDraft] = useWorkspaceDraft<Draft>(
    "settlement-payment",
    { rows: [{ accountId: "", amount: "" }], confirmation: null },
    (d) => d.rows.some((r) => Boolean(r.accountId || r.amount)),
    `reservation:${reservationId.toLowerCase()}`,
  );
  const converted = draft.rows.map((row) => ({
    accountId: row.accountId,
    amountCents: parsePaymentAmount(row.amount),
  }));
  const result = validateSettlementPaymentLines(converted, balanceCents);
  const known = draft.rows.every((row) =>
    accounts.some((a) => a.show !== false && a.id.toLowerCase() === row.accountId.toLowerCase()),
  );
  const splitBlocked = draft.rows.length > 1 && !splitAllowed;
  const valid = result.kind === "confirmed" && known && !unavailable && !splitBlocked;
  const signature = JSON.stringify({ billId, revision, balanceCents, currency, rows: converted });
  const confirmed = valid && draft.confirmation === signature;
  const total = converted.reduce((n, row) => n + (row.amountCents ?? 0), 0);
  function change(index: number, patch: Partial<Draft["rows"][number]>) {
    setDraft((d) => ({
      rows: d.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      confirmation: null,
    }));
  }
  return (
    <div className="mt-4 space-y-3 rounded-lg border p-4 text-sm" aria-label="Receive Payment">
      <h3 className="font-semibold">Receive Payment</h3>
      <p>
        Balance to receive: <strong>{money(balanceCents, currency)}</strong>
      </p>
      <p className="text-muted-foreground">
        Enter the amounts actually received. Cash notes and card can be separate lines on the same
        receipt.
      </p>
      <fieldset disabled={pending || unavailable} className="space-y-3">
        {draft.rows.map((row, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
            <label>
              Payment method {index + 1}
              <select
                className="mt-1 block w-full rounded border bg-background p-2"
                aria-label={`Payment method ${index + 1}`}
                value={row.accountId}
                onChange={(e) => change(index, { accountId: e.target.value })}
              >
                <option value="">Select account</option>
                {accounts
                  .filter((a) => a.show !== false)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Amount {index + 1}
              <input
                className="mt-1 block w-full rounded border p-2"
                aria-label={`Amount ${index + 1}`}
                inputMode="decimal"
                value={row.amount}
                onChange={(e) => change(index, { amount: e.target.value })}
                onBlur={() => {
                  const cents = parsePaymentAmount(row.amount);
                  if (cents !== null) change(index, { amount: (cents / 100).toFixed(2) });
                }}
              />
            </label>
            {draft.rows.length > 1 ? (
              <button
                type="button"
                className="self-end rounded border px-3 py-2"
                onClick={() =>
                  setDraft((d) => ({
                    rows: d.rows.filter((_, i) => i !== index),
                    confirmation: null,
                  }))
                }
              >
                Remove method {index + 1}
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          className="rounded border px-3 py-2"
          disabled={draft.rows.length >= MAX_SETTLEMENT_PAYMENT_LINES}
          onClick={() =>
            setDraft((d) => ({
              rows: [...d.rows, { accountId: "", amount: "" }],
              confirmation: null,
            }))
          }
        >
          Add payment method
        </button>
        <p>
          Entered total: <strong>{money(total, currency)}</strong>
        </p>
        {result.kind !== "confirmed" ? (
          <p className="text-amber-900">
            Enter positive amounts in distinct accounts totalling exactly{" "}
            {money(balanceCents, currency)}.
          </p>
        ) : null}
        {splitBlocked ? (
          <p className="text-amber-900">
            Split payment posting requires N3 verification before it can be enabled. No payment has
            been posted.
          </p>
        ) : null}
        {unavailable ? (
          <p className="text-destructive">
            Payment accounts are unavailable. Refresh before receiving payment.
          </p>
        ) : null}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            disabled={!valid}
            checked={confirmed}
            onChange={(e) =>
              setDraft((d) => ({ ...d, confirmation: e.target.checked ? signature : null }))
            }
          />
          <span>I confirm these payment amounts were received into the selected accounts.</span>
        </label>
        <button
          type="button"
          className="rounded-md bg-teal-700 px-3 py-2 font-semibold text-white disabled:opacity-50"
          disabled={pending || unavailable || !confirmed}
          onClick={() => {
            if (!pending && !unavailable && confirmed && result.kind === "confirmed")
              onReceive(result.value);
          }}
        >
          Receive Payment
        </button>
      </fieldset>
    </div>
  );
}
