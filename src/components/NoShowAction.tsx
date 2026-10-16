import { useWorkspaceDraft } from "@/lib/workspace-context";
import { useMarkNoShow, useNoShowState, noShowMessage } from "@/lib/reservation-no-show-client";
import type { NoShowResult } from "@/lib/reservation-no-show";
export function NoShowAction({
  reservationId,
  canEdit,
}: {
  reservationId: string;
  canEdit: boolean;
}) {
  const state = useNoShowState(reservationId, canEdit);
  const initial = {
    flow: null as { id: string; revision: string } | null,
    reason: "",
    pending: false,
    error: null as string | null,
    result: null as NoShowResult | null,
  };
  const [draft, setDraft] = useWorkspaceDraft(
    "no-show-action",
    initial,
    (v) => Boolean(v.flow),
    `reservation:${reservationId.toLowerCase()}`,
    (v) =>
      v.pending
        ? "No-show is still applying. Wait for its saved result before closing this tab."
        : null,
  );
  const mark = useMarkNoShow(reservationId, {
    onSuccess: (result, input) =>
      setDraft((v) => (v.flow?.id === input.clientRequestId ? { ...initial, result } : v)),
    onError: (error, input) =>
      setDraft((v) =>
        v.flow?.id === input.clientRequestId
          ? { ...v, pending: false, error: noShowMessage(error) }
          : v,
      ),
  });
  if (!canEdit) return null;
  if (draft.result)
    return (
      <section className="rounded-md border bg-white p-4 text-sm" role="status">
        No-show recorded; reserved rooms released.{" "}
        {draft.result.accountingReviewRequired
          ? "Deposits are retained for accounting review."
          : "Deposits and housekeeping conditions are unchanged."}
      </section>
    );
  if (!draft.flow && !state.data?.eligible) return null;
  return (
    <section className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
      <p>
        This guest's arrival date has passed. Confirm whether the guest will arrive before releasing
        rooms.
      </p>
      {!draft.flow ? (
        <button
          type="button"
          className="mt-2 rounded-md border px-3 py-2 font-semibold"
          onClick={() =>
            setDraft({
              ...initial,
              flow: { id: crypto.randomUUID(), revision: state.data!.updatedAt },
            })
          }
        >
          Mark no-show and release rooms
        </button>
      ) : (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.pending || !draft.flow || !draft.reason.trim()) return;
            const input = {
              reservationId,
              expectedUpdatedAt: draft.flow.revision,
              clientRequestId: draft.flow.id,
              reason: draft.reason,
            };
            setDraft((v) => ({ ...v, pending: true, error: null }));
            mark.mutate(input);
          }}
        >
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            Reason
            <input
              name="no-show-reason"
              className="rounded-md border bg-white px-3 py-2"
              maxLength={500}
              required
              value={draft.reason}
              disabled={draft.pending}
              onChange={(event) => setDraft((v) => ({ ...v, reason: event.target.value }))}
            />
          </label>
          <p className="w-full">
            This releases only reserved rooms. Receipts remain recorded; no refund or N3 charge is
            created.
          </p>
          <button
            type="submit"
            className="rounded-md bg-amber-700 px-3 py-2 font-semibold text-white"
            disabled={draft.pending || !draft.reason.trim()}
          >
            {draft.pending ? "Applying…" : "Confirm no-show"}
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-2"
            disabled={draft.pending}
            onClick={() => setDraft(initial)}
          >
            Cancel
          </button>
          {draft.error ? (
            <p role="alert" className="w-full text-red-700">
              {draft.error}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
