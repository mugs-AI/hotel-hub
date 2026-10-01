import { useEffect, useState } from "react";
import { CardInfoPopover } from "@/components/CardInfoPopover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { hotelJson } from "@/lib/hotel-settings-client";
import { useSessionMe } from "@/lib/session-client";
import { billToKey, useFolioBillTo } from "@/lib/folio-bill-to-client";
import type { FolioBillTo } from "@/routes/api/hotel/reservations.$id.folio.bill-to";

const fields: Array<{ key: keyof FolioBillTo; label: string; multiline?: boolean }> = [
  { key: "name", label: "Guest / contact name" },
  { key: "company", label: "Bill to company (optional)" },
  { key: "address", label: "Billing address", multiline: true },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
];

export function FolioBillToCard({
  reservationId,
  canEdit,
}: {
  reservationId: string;
  canEdit: boolean;
}) {
  const query = useFolioBillTo(reservationId);
  const session = useSessionMe();
  const tenantId = session.data?.authenticated === true ? session.data.tenant.tenantId : null;
  const qc = useQueryClient();
  const [form, setForm] = useState<FolioBillTo | null>(null);
  useEffect(() => {
    if (query.data?.billTo) setForm(query.data.billTo);
  }, [query.data?.billTo]);
  const save = useMutation({
    mutationFn: (billTo: FolioBillTo) =>
      hotelJson<{ billTo: FolioBillTo }>(`/api/hotel/reservations/${reservationId}/folio/bill-to`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(billTo),
      }),
    onSuccess: (value) => qc.setQueryData(billToKey(tenantId, reservationId), value),
  });
  return (
    <section className="relative rounded-lg border bg-white p-4 shadow-sm">
      <div className="absolute right-3 top-3">
        <CardInfoPopover label="About guest billing details">
          Enter the guest’s requested company and address before printing. This changes the prepared
          folio only.
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
        {form ? (
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (canEdit && !save.isPending) save.mutate(form);
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
                    disabled={!canEdit}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                ) : (
                  <input
                    className="w-full rounded-md border px-3 py-2"
                    type={key === "email" ? "email" : "text"}
                    maxLength={
                      key === "company" ? 200 : key === "name" ? 160 : key === "phone" ? 60 : 254
                    }
                    value={form[key]}
                    disabled={!canEdit}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                )}
              </label>
            ))}
            {canEdit ? (
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={save.isPending || (!form.name.trim() && !form.company.trim())}
                  className="rounded-md bg-[#102A43] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {save.isPending ? "Saving…" : "Save bill to details"}
                </button>
                {save.isSuccess ? (
                  <span role="status" className="ml-3 text-sm text-teal-800">
                    Saved. Reopen print folio to see it.
                  </span>
                ) : null}
                {save.error ? (
                  <p role="alert" className="mt-2 text-sm text-red-700">
                    Unable to save billing details. Check the fields and try again.
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
