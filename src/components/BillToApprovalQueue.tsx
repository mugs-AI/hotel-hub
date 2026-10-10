import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { BillToChangeDTO } from "@/lib/hotel-change-controls";
import {
  billToChangesKey,
  listBillToChanges,
  decideBillToChange,
  useChangePolicy,
} from "@/lib/hotel-change-controls-client";
import { useReceiptIdentity, invalidateReceiptEffects } from "@/lib/receipt-controls-client";
import { formatMyTimestamp } from "@/lib/malaysia-date";
export function BillToChangeCard({
  request: r,
  busy,
  onDecide,
}: {
  request: BillToChangeDTO;
  busy?: boolean;
  onDecide?: (decision: "approve" | "reject") => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded border bg-white p-3 lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{r.bookingReference} · Billing contact</p>
        <p className="text-sm">
          {r.reason} · {r.requestedByLabel ?? "staff"} · {formatMyTimestamp(r.requestedAt)}
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <strong>Original</strong>
            {Object.entries(r.original).map(([k, v]) => (
              <p key={k} className="break-words text-sm">
                {k}: {v || "—"}
              </p>
            ))}
          </div>
          <div>
            <strong>Proposed</strong>
            {Object.entries(r.requested).map(([k, v]) => (
              <p key={k} className="break-words text-sm">
                {k}: {v || "—"}
              </p>
            ))}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 lg:ml-auto">
        {r.canReject ? (
          <button
            disabled={busy}
            className="rounded border px-3 py-2"
            onClick={() => onDecide?.("reject")}
          >
            Reject
          </button>
        ) : null}
        {r.canApprove ? (
          <button
            disabled={busy}
            className="rounded bg-teal-700 px-3 py-2 text-white"
            onClick={() => onDecide?.("approve")}
          >
            {busy ? "Applying…" : "Approve"}
          </button>
        ) : null}
      </div>
    </li>
  );
}
export function BillToApprovalQueue({ enabled }: { enabled: boolean }) {
  const identity = useReceiptIdentity(),
    policy = useChangePolicy(),
    qc = useQueryClient();
  const owner = identity?.endsWith(":owner") === true;
  const q = useInfiniteQuery({
    queryKey: billToChangesKey(identity ?? "none"),
    queryFn: ({ pageParam }) => listBillToChanges(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.offset + last.requests.length < last.total
        ? last.offset + last.requests.length
        : undefined,
    enabled: enabled && owner && policy.available,
    retry: false,
  });
  const decision = useMutation({
    mutationKey: ["bill-to-changes", identity ?? "none", "decide"],
    mutationFn: (v: { request: BillToChangeDTO; decision: "approve" | "reject" }) =>
      decideBillToChange(v.request, v.decision),
    onSuccess: () => invalidateReceiptEffects(qc),
  });
  if (!enabled || !owner || !policy.available) return null;
  const rows = q.isError ? [] : (q.data?.pages.flatMap((p) => p.requests) ?? []);
  return (
    <section aria-label="Billing contact requests" className="rounded-xl border bg-slate-50 p-5">
      <h2 className="font-semibold">Billing contact requests</h2>
      {q.isPending ? <p>Loading…</p> : null}
      {q.error || decision.error ? (
        <p role="alert">Could not read or apply billing contact requests. Refresh to retry.</p>
      ) : null}
      {!q.isPending && !q.error && rows.length === 0 ? (
        <p className="text-sm">No billing contact requests waiting.</p>
      ) : null}
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <BillToChangeCard
            key={r.id}
            request={r}
            busy={decision.isPending}
            onDecide={(value) => decision.mutate({ request: r, decision: value })}
          />
        ))}
      </ul>
      {q.hasNextPage ? (
        <button disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          Load more
        </button>
      ) : null}
    </section>
  );
}
