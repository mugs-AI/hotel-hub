import type { useInitialBookingPayer } from "@/lib/source-policy-client";
import { sourcePolicyMessage } from "@/lib/source-policy-client";
export function InitialBookingPayerControl({
  payer,
  sourceCode,
}: {
  payer: ReturnType<typeof useInitialBookingPayer>;
  sourceCode: string;
}) {
  if (!sourceCode) return null;
  if (payer.error)
    return (
      <section className="rounded-lg border p-4">
        <p role="alert">{sourcePolicyMessage(payer.error.code)}</p>
        <button
          type="button"
          onClick={() => {
            payer.clear();
            void payer.refetch();
          }}
        >
          Reload billing collection
        </button>
      </section>
    );
  if (!payer.data) return <p role="status">Loading billing collection…</p>;
  if (!payer.data.required) return null;
  const p = payer.data.policy;
  return (
    <section className="rounded-lg border bg-white p-4 space-y-2">
      <h3 className="font-semibold">Billing collection</h3>
      <label className="block">
        Room charges paid by
        <select
          className="ml-2 rounded border p-2"
          value={payer.collectionMode}
          disabled={payer.isFetching}
          onChange={(e) => payer.choose(e.target.value as "guest" | "source")}
        >
          {p.allowedCollectionModes.map((mode) => (
            <option key={mode} value={mode}>
              {mode === "source" ? "Booking source / OTA" : "Guest"}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm">
        Room account: #{payer.collectionMode === "source" ? p.sourceCustomerId : p.guestCustomerId}.
        Guest extras account: #{p.guestCustomerId}.
      </p>
      <label className="flex gap-2 items-start">
        <input
          type="checkbox"
          checked={payer.confirmed}
          disabled={payer.isFetching}
          onChange={(e) => payer.confirm(e.target.checked)}
        />
        I confirm this collection arrangement for the new booking.
      </label>
      <p className="text-sm text-muted-foreground">
        Only the Owner can change this after creation. Policy version {p.version}.
      </p>
    </section>
  );
}
