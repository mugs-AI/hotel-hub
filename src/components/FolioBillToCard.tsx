import { useEffect, useRef, useState } from "react";
import { CardInfoPopover } from "@/components/CardInfoPopover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  billToKey,
  useFolioBillTo,
  saveFolioBillTo,
  saveLegacyFolioBillTo,
} from "@/lib/folio-bill-to-client";
import { useChangePolicy } from "@/lib/hotel-change-controls-client";
import { useReceiptIdentity, invalidateReceiptEffects } from "@/lib/receipt-controls-client";
import type { FolioBillTo, BillToSaveInput } from "@/lib/hotel-change-controls";
const fields: Array<{ key: keyof FolioBillTo; label: string; multiline?: boolean }> = [
  { key: "name", label: "Guest / contact name" },
  { key: "company", label: "Bill to company (optional)" },
  { key: "address", label: "Billing address", multiline: true },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
];
type Draft = {
  scope: string;
  value: FolioBillTo;
  original: FolioBillTo;
  revision: string;
  dirty: boolean;
};
export function FolioBillToCard({
  reservationId,
  canEdit,
}: {
  reservationId: string;
  canEdit: boolean;
}) {
  const query = useFolioBillTo(reservationId),
    policy = useChangePolicy(),
    identity = useReceiptIdentity(),
    scope = `${identity ?? "none"}:${reservationId}`,
    scopeRef = useRef(scope);
  scopeRef.current = scope;
  const qc = useQueryClient(),
    [draft, setDraft] = useState<Draft | null>(null),
    [reason, setReason] = useState("");
  const attempt = useRef<string | null>(null);
  const installed = query.data?.controlsInstalled === true;
  const approval = installed && policy.policy?.contactApprovalRequired === true;
  const save = useMutation({
    mutationKey: ["folio-bill-to", identity ?? "none", "save", reservationId],
    mutationFn: (input: BillToSaveInput) =>
      installed
        ? saveFolioBillTo(reservationId, input)
        : saveLegacyFolioBillTo(reservationId, input.billTo),
    onSuccess: (value) => {
      if (scopeRef.current !== scope || !identity) return;
      qc.setQueryData(billToKey(identity, reservationId), {
        ...value,
        controlsInstalled: installed,
      });
      setDraft({
        scope,
        value: value.billTo,
        original: value.billTo,
        revision: value.effectiveRevision,
        dirty: false,
      });
      setReason("");
      attempt.current = null;
      invalidateReceiptEffects(qc);
    },
  });
  const resetSave = save.reset;
  useEffect(() => {
    if (draft?.scope !== scope) {
      setDraft(null);
      setReason("");
      attempt.current = null;
      resetSave();
    }
  }, [scope, draft?.scope, resetSave]); // identity/reservation reset, never an unrelated refresh
  useEffect(() => {
    if (!query.data?.billTo || query.isError || !identity) return;
    setDraft((current) =>
      current?.scope === scope && current.dirty
        ? current
        : {
            scope,
            value: query.data!.billTo,
            original: query.data!.billTo,
            revision: query.data!.effectiveRevision,
            dirty: false,
          },
    );
  }, [query.data, query.isError, identity, scope]);
  const form = draft?.scope === scope && !query.isError && identity ? draft.value : null;
  const conflict =
    draft?.scope === scope &&
    draft.dirty &&
    !!query.data &&
    (draft.revision !== query.data.effectiveRevision ||
      JSON.stringify(draft.original) !== JSON.stringify(query.data.billTo));
  const pending = query.isError ? null : query.data?.pending;
  const editable =
    canEdit &&
    !!identity &&
    !pending &&
    !conflict &&
    (!installed || policy.available) &&
    !save.isPending;
  const change = (key: keyof FolioBillTo, value: string) => {
    if (!draft) return;
    setDraft({ ...draft, value: { ...draft.value, [key]: value }, dirty: true });
    attempt.current = null;
    save.reset();
  };
  return (
    <section className="relative rounded-lg border bg-white p-4 shadow-sm">
      <div className="absolute right-3 top-3">
        <CardInfoPopover label="About guest billing details">
          This changes the local guest folio billing details. A selected N3 receipt contact uses its
          separate correction request.
        </CardInfoPopover>
      </div>
      <details>
        <summary className="cursor-pointer pr-10 font-semibold text-[#102A43] hover:underline">
          Bill to details for guest folio ▾
        </summary>
        {query.isPending ? <p className="mt-3 text-sm">Loading guest details…</p> : null}
        {query.error ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            Unable to load guest billing details. Refresh to retry.
          </p>
        ) : null}
        {pending ? (
          <div role="status" className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
            <p className="font-medium">
              Billing contact approval pending. Original details remain effective for print and
              checkout.
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <strong>Original</strong>
                {fields.map((f) => (
                  <p key={f.key} className="break-words text-sm">
                    {f.label}: {pending.original[f.key] || "—"}
                  </p>
                ))}
              </div>
              <div>
                <strong>Proposed</strong>
                {fields.map((f) => (
                  <p key={f.key} className="break-words text-sm">
                    {f.label}: {pending.requested[f.key] || "—"}
                  </p>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        {conflict ? (
          <p role="alert" className="mt-3 text-red-700">
            Effective billing details changed while you were editing. Your draft is retained. Reload
            details before submitting.
          </p>
        ) : null}
        {form ? (
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!editable || !draft) return;
              attempt.current ??= crypto.randomUUID();
              save.mutate({
                billTo: form,
                expectedRevision: draft.revision,
                clientRequestId: attempt.current,
                reason: reason.trim(),
              });
            }}
          >
            {fields.map(({ key, label, multiline }) => (
              <label key={key} className={`text-sm ${multiline ? "sm:col-span-2" : ""}`}>
                <span className="mb-1 block font-medium">{label}</span>
                {multiline ? (
                  <textarea
                    className="w-full rounded-md border px-3 py-2"
                    rows={3}
                    maxLength={600}
                    value={form[key]}
                    disabled={!editable}
                    onChange={(e) => change(key, e.target.value)}
                  />
                ) : (
                  <input
                    className="w-full rounded-md border px-3 py-2"
                    type={key === "email" ? "email" : "text"}
                    maxLength={
                      key === "company" ? 200 : key === "name" ? 160 : key === "phone" ? 60 : 254
                    }
                    value={form[key]}
                    disabled={!editable}
                    onChange={(e) => change(key, e.target.value)}
                  />
                )}
              </label>
            ))}
            {installed && canEdit && !pending ? (
              <label className="sm:col-span-2">
                Reason {approval ? "(required)" : "(optional)"}
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  maxLength={500}
                  value={reason}
                  disabled={!editable}
                  onChange={(e) => {
                    setReason(e.target.value);
                    attempt.current = null;
                    save.reset();
                  }}
                />
              </label>
            ) : null}
            {canEdit ? (
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={
                    !editable ||
                    (!form.name.trim() && !form.company.trim()) ||
                    (approval && !reason.trim())
                  }
                  className="rounded-md bg-[#102A43] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {save.isPending
                    ? "Saving…"
                    : approval
                      ? "Request contact change"
                      : "Save bill to details"}
                </button>
                {save.isSuccess ? (
                  <span role="status" className="ml-3 text-sm text-teal-800">
                    {save.data.outcome === "pending"
                      ? "Request submitted. Original details remain effective."
                      : "Saved. Reopen print folio to see it."}
                  </span>
                ) : null}
                {conflict ? (
                  <button
                    type="button"
                    className="ml-3 underline"
                    onClick={() => {
                      setDraft(null);
                      attempt.current = null;
                      void query.refetch();
                    }}
                  >
                    Reload details
                  </button>
                ) : null}
                {save.error ? (
                  <p role="alert" className="mt-2 text-sm text-red-700">
                    Unable to save billing details. Refresh and check the fields before retrying.
                  </p>
                ) : null}
                {installed && !policy.available ? (
                  <p role="alert" className="mt-2 text-amber-900">
                    Approval controls could not be read. Saving is unavailable.
                  </p>
                ) : null}
              </div>
            ) : null}
          </form>
        ) : null}
      </details>
    </section>
  );
}
