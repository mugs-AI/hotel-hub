import { useState } from "react";
import { useReservationPayer, sourcePolicyMessage } from "@/lib/source-policy-client";
import type { CollectionMode } from "@/lib/source-billing";
import { CardInfoPopover } from "./CardInfoPopover";
type Query = ReturnType<typeof useReservationPayer>;
export function ReservationPayerCard({ reservationId }: { reservationId: string }) {
  const q = useReservationPayer(reservationId);
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-[#102A43]">Billing collection</h3>
        <CardInfoPopover label="About billing collection">
          The saved payer determines the room bill. Guest extras remain on the guest bill. Source
          settings do not automatically change an existing saved payer. Only the Owner can change it
          before billing freezes.
        </CardInfoPopover>
      </div>
      {!q.identity ? (
        <p>Sign in to view billing collection.</p>
      ) : q.error ? (
        <p role="alert">{sourcePolicyMessage(q.error.code)}</p>
      ) : !q.data ? (
        <p>Loading billing collection…</p>
      ) : (
        <PayerForm key={`${q.identity}:${reservationId}`} q={q} />
      )}
    </section>
  );
}
function PayerForm({ q }: { q: Query }) {
  const v = q.data!,
    [selected, setSelected] = useState<CollectionMode>(
      v.payer?.collectionMode ?? v.policy?.defaultCollectionMode ?? "guest",
    ),
    [revision, setRevision] = useState(v.revision),
    [review, setReview] = useState({
      sourceId: v.sourceId,
      policyVersion: v.policy?.version ?? null,
      reservationUpdatedAt: v.updatedAt,
    });
  const policy = v.policy,
    stale =
      revision !== v.revision ||
      review.sourceId !== v.sourceId ||
      review.policyVersion !== (v.policy?.version ?? null) ||
      review.reservationUpdatedAt !== v.updatedAt;
  return (
    <div className="space-y-3 text-sm">
      <p>
        {v.payer
          ? v.payer.collectionMode === "guest"
            ? "Guest pays"
            : "Booking source pays"
          : "Payer not yet confirmed"}
      </p>
      {v.payer ? (
        <p className="text-muted-foreground">
          Saved payer: Guest N3 account #{v.payer.policy.guestCustomerId}
          {v.payer.collectionMode === "source"
            ? ` · Source N3 account #${v.payer.policy.sourceCustomerId}`
            : ""}
        </p>
      ) : null}
      {v.frozen ? (
        <p>Billing is frozen. The payer cannot be changed.</p>
      ) : !q.owner ? (
        <p>Only the Owner can change billing collection.</p>
      ) : !policy ? (
        <p>{sourcePolicyMessage(v.blockers[0] ?? "source_billing_policy_missing")}</p>
      ) : (
        <>
          {v.payer && v.payer.policy.version !== policy.version ? (
            <p>Source settings changed. Saving applies the current policy to this booking.</p>
          ) : null}
          <div className="rounded border bg-slate-50 p-3" aria-label="Payer to save">
            <p className="font-medium">Payer to save — policy {policy.version}</p>
            <p>
              Room bill:{" "}
              {selected === "guest"
                ? `Guest N3 account #${policy.guestCustomerId}`
                : policy.allowedCollectionModes.includes(selected)
                  ? `Source N3 account #${policy.sourceCustomerId}`
                  : "Choose an allowed collection mode"}
            </p>
            <p>Guest extras: Guest N3 account #{policy.guestCustomerId}</p>
          </div>
          <label className="block">
            Collection mode
            <select
              aria-label="Collection mode"
              value={policy.allowedCollectionModes.includes(selected) ? selected : ""}
              disabled={q.saving || q.isFetching || stale}
              onChange={(e) => setSelected(e.target.value as CollectionMode)}
              className="mt-1 block w-full rounded border p-2"
            >
              <option value="" disabled>
                Choose a current collection mode
              </option>
              {policy.allowedCollectionModes.map((m) => (
                <option key={m} value={m}>
                  {m === "guest"
                    ? "Collect room payment from guest"
                    : "Room payment owed by booking source"}
                </option>
              ))}
            </select>
          </label>
          {stale ? (
            <p role="alert">This booking changed. Refresh and review the saved payer.</p>
          ) : null}
          <button
            type="button"
            disabled={
              q.saving || q.isFetching || stale || !policy.allowedCollectionModes.includes(selected)
            }
            className="rounded bg-[#0F9D8A] px-3 py-2 text-white disabled:opacity-50"
            onClick={async () => {
              try {
                const r = await q.save({
                  collectionMode: selected,
                  expectedRevision: revision,
                  expectedSourceId: review.sourceId,
                  expectedPolicyVersion: review.policyVersion!,
                  expectedReservationUpdatedAt: review.reservationUpdatedAt,
                });
                setRevision(r.revision);
                setReview({
                  sourceId: r.sourceId,
                  policyVersion: r.policy?.version ?? null,
                  reservationUpdatedAt: r.updatedAt,
                });
                setSelected(r.payer!.collectionMode);
              } catch {
                /* error belongs to its original query scope */
              }
            }}
          >
            {q.saving ? "Saving…" : "Save payer"}
          </button>
        </>
      )}
      <button
        type="button"
        disabled={q.saving || q.isFetching}
        className="ml-2 rounded border px-3 py-2 disabled:opacity-50"
        onClick={async () => {
          const r = await q.refetch();
          if (r.data) {
            setRevision(r.data.revision);
            setReview({
              sourceId: r.data.sourceId,
              policyVersion: r.data.policy?.version ?? null,
              reservationUpdatedAt: r.data.updatedAt,
            });
            setSelected(
              r.data.payer?.collectionMode ?? r.data.policy?.defaultCollectionMode ?? "guest",
            );
          }
        }}
      >
        Refresh payer
      </button>
      {q.saveError ? <p role="alert">{sourcePolicyMessage(q.saveError.code)}</p> : null}
    </div>
  );
}
