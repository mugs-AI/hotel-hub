import { useState } from "react";
import { useChargeAttribution } from "@/lib/source-policy-client";
import { attributionMessage } from "@/lib/charge-attribution";
import type { BillingLegKind } from "@/lib/source-billing";
export function ChargeAttributionCard({ reservationId }: { reservationId: string }) {
  const [active, setActive] = useState(false),
    q = useChargeAttribution(reservationId, active);
  return (
    <section className="rounded-xl border bg-white p-4 space-y-3 shadow-sm">
      <h3 className="text-base font-semibold text-[#102A43]">Bill charge allocation</h3>
      <p className="text-sm text-muted-foreground">
        Review which bill carries each prepared charge. Only the Owner can change allocation before
        billing freezes.
      </p>
      {!q.identity ? (
        <p>Sign in to review charges.</p>
      ) : !active ? (
        <button type="button" className="rounded border px-3 py-2" onClick={() => setActive(true)}>
          Review charges
        </button>
      ) : q.error ? (
        <div>
          <p role="alert">{attributionMessage(q.error.code)}</p>
          <button type="button" onClick={() => void q.refetch()}>
            Reload allocation
          </button>
        </div>
      ) : !q.data ? (
        <p role="status">Verifying prepared charges…</p>
      ) : (
        <AllocationForm key={`${q.identity}:${reservationId}`} q={q} />
      )}
    </section>
  );
}
function AllocationForm({ q }: { q: ReturnType<typeof useChargeAttribution> }) {
  const [review, setReview] = useState(q.data!),
    [choices, setChoices] = useState(() => new Map(q.data!.rows.map((r) => [r.lineId, r.leg]))),
    [message, setMessage] = useState<string | null>(null);
  const v = q.data!,
    changed =
      v.basisDigest !== review.basisDigest ||
      v.revision !== review.revision ||
      v.frozen !== review.frozen;
  const editable = q.owner && !v.frozen && !changed && !q.saving && !q.isFetching;
  const missing = review.rows.some((r) => !choices.get(r.lineId));
  async function reload() {
    setMessage(null);
    const r = await q.refetch();
    if (r.data && !r.error) {
      setReview(r.data);
      setChoices(new Map(r.data.rows.map((row) => [row.lineId, row.leg])));
    }
  }
  async function save() {
    setMessage(null);
    try {
      const result = await q.save({
        expectedRevision: review.revision,
        basisDigest: review.basisDigest,
        assignments: review.rows.map((r) => ({ lineId: r.lineId, leg: choices.get(r.lineId)! })),
      });
      setReview(result);
      setChoices(new Map(result.rows.map((r) => [r.lineId, r.leg])));
      setMessage("Allocation saved.");
    } catch (e) {
      setMessage(attributionMessage((e as { code: string }).code));
    }
  }
  return (
    <div className="space-y-3">
      {changed ? (
        <p role="alert">Charges, payer or allocation changed. Reload and review before saving.</p>
      ) : review.stale ? (
        <p role="alert">
          The saved allocation is stale. Review every current charge and save again.
        </p>
      ) : null}
      {v.frozen ? (
        <p>Billing is frozen. Allocation is read-only.</p>
      ) : !q.owner ? (
        <p>Front Desk can view allocation. Ask the Owner for changes.</p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Charge</th>
              <th className="text-right">Amount</th>
              <th className="text-left">Bill</th>
            </tr>
          </thead>
          <tbody>
            {review.rows.map((row, index) => (
              <tr key={row.lineId} className="border-t">
                <td className="py-2 pr-3">{row.description}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">
                  {review.currency} {(row.totalCents / 100).toFixed(2)}
                </td>
                <td className="py-2">
                  <select
                    aria-label={`Bill for charge ${index + 1}: ${row.description}`}
                    className="rounded border p-2"
                    disabled={!editable || review.collectionMode === "guest"}
                    value={choices.get(row.lineId) ?? ""}
                    onChange={(e) => {
                      const leg = e.target.value as BillingLegKind;
                      setChoices((old) => new Map(old).set(row.lineId, leg));
                      setMessage(null);
                    }}
                  >
                    <option value="" disabled>
                      Choose bill…
                    </option>
                    <option value="guest">Guest bill</option>
                    {review.collectionMode === "source" ? (
                      <option value="source_room">Source / OTA bill</option>
                    ) : null}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">
        Guest account #{review.guestCustomerId}
        {review.collectionMode === "source" ? `; source account #${review.sourceCustomerId}` : ""}.
        Tax stays with its charge. Source bills cannot receive guest payment.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border px-3 py-2"
          disabled={q.saving || q.isFetching}
          onClick={() => void reload()}
        >
          Reload allocation
        </button>
        {q.owner && !v.frozen ? (
          <button
            type="button"
            className="rounded bg-[#102A43] text-white px-3 py-2 disabled:opacity-50"
            disabled={!editable || missing}
            onClick={() => void save()}
          >
            {q.saving ? "Saving…" : "Save allocation"}
          </button>
        ) : null}
      </div>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
