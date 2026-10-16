import { useState } from "react";
import { useSourceBillingPolicy, sourcePolicyMessage } from "@/lib/source-policy-client";
import { sourcePolicySchema } from "@/lib/source-policy-view";
import type { CollectionMode, SourceBillingPolicy } from "@/lib/source-billing";
import { N3Picker } from "./N3Picker";
import { CardInfoPopover } from "./CardInfoPopover";
type Source = { id: string; displayName: string; isActive: boolean };
export function SourceBillingPolicyPanel({ sources }: { sources: Source[] }) {
  const [id, setId] = useState("");
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-[#102A43]">Source billing policy</h2>
        <CardInfoPopover label="About source billing policy">
          Choose permitted collection modes and verified N3 customer accounts. New settings leave
          previously saved booking payers unchanged. Guest document wording does not change the N3
          accounting document type.
        </CardInfoPopover>
      </div>
      <label className="block text-sm">
        Booking source
        <select
          aria-label="Billing source"
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="mt-1 block w-full rounded border p-2"
        >
          <option value="">Choose a booking source</option>
          {sources
            .filter((s) => s.isActive)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
        </select>
      </label>
      {id ? <PolicyEditor key={id} sourceId={id} /> : null}
    </section>
  );
}
function PolicyEditor({ sourceId }: { sourceId: string }) {
  const q = useSourceBillingPolicy(sourceId);
  if (!q.owner) return <p>Only the Owner can change billing collection.</p>;
  if (q.error && q.error.code !== "source_billing_policy_missing")
    return <p role="alert">{sourcePolicyMessage(q.error.code)}</p>;
  if (!q.data && !q.error) return <p>Loading billing policy…</p>;
  return <PolicyForm key={`${q.identity}:${sourceId}`} sourceId={sourceId} q={q} />;
}
function blank(sourceId: string): SourceBillingPolicy {
  return {
    sourceId,
    version: "0",
    defaultCollectionMode: "guest",
    allowedCollectionModes: ["guest"],
    guestCustomerId: 0,
    sourceCustomerId: null,
    guestDocumentTitle: "Guest folio",
    guestItemDescription: "Accommodation",
    showRoomPrices: true,
  };
}
function PolicyForm({
  q,
  sourceId,
}: {
  q: ReturnType<typeof useSourceBillingPolicy>;
  sourceId: string;
}) {
  const [draft, setDraft] = useState(() => q.data?.policy ?? blank(sourceId)),
    [picker, setPicker] = useState<"guest" | "source" | null>(null);
  const changed = q.data && draft.version !== q.data.policy.version;
  const valid = sourcePolicySchema.safeParse(draft).success;
  function patch(p: Partial<SourceBillingPolicy>) {
    setDraft((d) => ({ ...d, ...p }));
  }
  function toggle(mode: CollectionMode, on: boolean) {
    const allowed = on
      ? [...draft.allowedCollectionModes, mode]
      : draft.allowedCollectionModes.filter((m) => m !== mode);
    patch({
      allowedCollectionModes: allowed,
      defaultCollectionMode: allowed.includes(draft.defaultCollectionMode)
        ? draft.defaultCollectionMode
        : (allowed[0] ?? "guest"),
    });
  }
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || changed || q.saving || q.isFetching) return;
        try {
          const r = await q.save({ expectedVersion: draft.version, policy: draft });
          setDraft(r.policy);
          setPicker(null);
        } catch {
          /* scoped client displays the failure */
        }
      }}
    >
      {q.data?.blockers.length ? (
        <p role="alert">
          Current customer verification needs attention. Choose replacement accounts; saving
          verifies the updated policy.
        </p>
      ) : null}
      <fieldset
        disabled={q.saving || q.isFetching || !!changed}
        className="space-y-3 disabled:opacity-60"
      >
        <div className="flex flex-wrap gap-4">
          {(["guest", "source"] as const).map((m) => (
            <label key={m} className="flex gap-2">
              <input
                type="checkbox"
                checked={draft.allowedCollectionModes.includes(m)}
                onChange={(e) => toggle(m, e.target.checked)}
              />
              {m === "guest" ? "Allow guest collection" : "Allow source collection"}
            </label>
          ))}
        </div>
        <label className="block">
          Default collection
          <select
            aria-label="Default collection"
            value={draft.defaultCollectionMode}
            onChange={(e) => patch({ defaultCollectionMode: e.target.value as CollectionMode })}
            className="ml-2 rounded border p-2"
          >
            {draft.allowedCollectionModes.map((m) => (
              <option key={m} value={m}>
                {m === "guest" ? "Guest" : "Booking source"}
              </option>
            ))}
          </select>
        </label>
        <p>
          Guest N3 account:{" "}
          {draft.guestCustomerId > 0 ? `#${draft.guestCustomerId}` : "Not selected"}{" "}
          <button
            type="button"
            className="rounded border px-3 py-2"
            onClick={() => setPicker(picker === "guest" ? null : "guest")}
          >
            Choose guest customer
          </button>
        </p>
        {draft.allowedCollectionModes.includes("source") ? (
          <p>
            Source N3 account:{" "}
            {draft.sourceCustomerId ? `#${draft.sourceCustomerId}` : "Not selected"}{" "}
            <button
              type="button"
              className="rounded border px-3 py-2"
              onClick={() => setPicker(picker === "source" ? null : "source")}
            >
              Choose source customer
            </button>
          </p>
        ) : null}
        {picker ? (
          <N3Picker
            kind="customers"
            onPick={(row) => {
              const n = Number(row.id);
              if (!Number.isInteger(n) || n < 1 || n > 2147483647) return;
              patch(picker === "guest" ? { guestCustomerId: n } : { sourceCustomerId: n });
              setPicker(null);
            }}
          />
        ) : null}
        <label className="block">
          Guest document title
          <input
            aria-label="Guest document title"
            maxLength={160}
            value={draft.guestDocumentTitle}
            onInput={(e) => patch({ guestDocumentTitle: e.currentTarget.value })}
            className="mt-1 block w-full rounded border p-2"
          />
        </label>
        <label className="block">
          Room description
          <input
            aria-label="Guest room description"
            maxLength={600}
            value={draft.guestItemDescription}
            onInput={(e) => patch({ guestItemDescription: e.currentTarget.value })}
            className="mt-1 block w-full rounded border p-2"
          />
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={draft.showRoomPrices}
            onChange={(e) => patch({ showRoomPrices: e.target.checked })}
          />
          Show room prices on the source guest document
        </label>
        {!valid ? (
          <p>Choose distinct guest/source N3 accounts and complete the policy before saving.</p>
        ) : null}
        <button
          type="submit"
          disabled={!valid || q.saving || q.isFetching || !!changed}
          className="rounded bg-[#0F9D8A] px-3 py-2 text-white disabled:opacity-50"
        >
          {q.saving ? "Saving…" : "Save billing policy"}
        </button>
      </fieldset>
      {changed ? (
        <p role="alert">Source settings changed. Reload the saved settings before saving.</p>
      ) : null}
      <button
        type="button"
        disabled={q.saving || q.isFetching}
        className="rounded border px-3 py-2"
        onClick={async () => {
          const r = await q.refetch();
          if (r.data) {
            setDraft(r.data.policy);
            setPicker(null);
          }
        }}
      >
        Reload saved settings
      </button>
      {q.saveError ? <p role="alert">{sourcePolicyMessage(q.saveError.code)}</p> : null}
    </form>
  );
}
