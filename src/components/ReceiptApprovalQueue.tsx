// Owner Dashboard queue: Review / Approve / Reject / Verify receipt requests.
// Approval never changes totals; the manual N3 change plus Verify does.
import { useEffect, useState } from "react";
import { useSessionMe } from "@/lib/session-client";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  formatReceiptDelta,
  RECEIPT_CONTROL_STATE_LABEL,
  type ReceiptControlRequestDTO,
} from "@/lib/receipt-controls";
import {
  decideReceiptControl,
  listReceiptControls,
  ReceiptControlClientError,
  receiptControlMessage,
  invalidateReceiptEffects,
  purgeForeignReceiptCache,
  receiptControlsKey,
  identityFromSession,
  receiptIdentityKey,
  verifyReceiptControl,
  recoverReceiptControl,
} from "@/lib/receipt-controls-client";
import { ReceiptAlertStatus } from "@/components/ReceiptAlertStatus";

export function ReceiptRequestCard({
  r,
  busy,
  onDecide,
  onVerify,
  onRecover,
}: {
  r: ReceiptControlRequestDTO;
  busy?: boolean;
  onDecide?: (decision: "approve" | "reject") => void;
  onVerify?: () => void;
  onRecover?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Plan: the Owner must open Review and acknowledge the comparison before Approve.
  const [ack, setAck] = useState(false);
  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {r.bookingReference} · {r.original.docCode} ·{" "}
          {r.proposal.kind === "void" ? "Void" : "Correction"}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
          {RECEIPT_CONTROL_STATE_LABEL[r.state]}
        </span>
      </div>
      <p className="mt-1">Reason: {r.reason}</p>
      <p className="text-muted-foreground">
        Requested by {r.requestedByLabel ?? "staff"}
        {r.selfApproved ? " · Owner approved own request (audited)" : ""}
      </p>
      <p>
        Deposits {formatReceiptDelta(r.comparison.depositDeltaCents, r.original.currency)} · Balance{" "}
        {formatReceiptDelta(r.comparison.balanceDeltaCents, r.original.currency)}
      </p>
      {r.outcomeMessage ? <p className="font-medium">{r.outcomeMessage}</p> : null}
      <ReceiptAlertStatus alert={r.alert} />
      {open ? (
        <table className="mt-2 w-full">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>Field</th>
              <th>Original</th>
              <th>Requested</th>
            </tr>
          </thead>
          <tbody>
            {r.comparison.fields.map((f) => (
              <tr key={f.label}>
                <td>{f.label}</td>
                <td>{f.original || "—"}</td>
                <td>{f.requested || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {open && r.canApprove ? (
        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I
          reviewed the original and requested values
        </label>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="rounded border px-2 py-1" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Review"}
        </button>
        {r.canApprove && open && ack ? (
          <button
            type="button"
            disabled={busy}
            className="rounded bg-teal-700 px-2 py-1 text-white"
            onClick={() => onDecide?.("approve")}
          >
            Approve
          </button>
        ) : null}
        {r.canReject ? (
          <button
            type="button"
            disabled={busy}
            className="rounded border border-red-300 px-2 py-1 text-red-700"
            onClick={() => onDecide?.("reject")}
          >
            Reject
          </button>
        ) : null}
        {r.canVerify ? (
          <button
            type="button"
            disabled={busy}
            className="rounded border px-2 py-1"
            onClick={() => onVerify?.()}
          >
            Verify in N3
          </button>
        ) : null}
        {r.canRecover ? (
          <button
            type="button"
            disabled={busy}
            className="rounded border border-amber-400 px-2 py-1 text-amber-800"
            title="Releases a verification that stopped part-way. Nothing is sent to N3."
            onClick={() => onRecover?.()}
          >
            Recover interrupted verification
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function ReceiptApprovalQueue({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const me = useSessionMe();
  const identity = identityFromSession(me);
  // Auth switch: drop every receipt snapshot cached for another tenant/user/role
  // and any captured error from the previous identity.
  useEffect(() => {
    purgeForeignReceiptCache(qc, identity);
    setError("");
  }, [qc, identity]);
  const q = useInfiniteQuery({
    queryKey: receiptControlsKey(identity ?? "none", "queue"),
    queryFn: ({ pageParam }) => listReceiptControls({ queue: true, offset: pageParam, limit: 50 }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: enabled && identity !== null,
    retry: false,
  });
  const done = () => {
    setError("");
    invalidateReceiptEffects(qc);
  };
  const fail = (e: unknown) =>
    setError(receiptControlMessage(e instanceof ReceiptControlClientError ? e.code : ""));
  const decide = useMutation({
    mutationKey: ["receipt-controls", identity ?? "none", "decide"],
    mutationFn: (v: { r: ReceiptControlRequestDTO; decision: "approve" | "reject" }) =>
      decideReceiptControl(v.r.id, { decision: v.decision, expectedVersion: v.r.version }),
    onSuccess: done,
    onError: fail,
  });
  const verify = useMutation({
    mutationKey: ["receipt-controls", identity ?? "none", "verify"],
    mutationFn: (r: ReceiptControlRequestDTO) => verifyReceiptControl(r.id, r.version),
    onSuccess: done,
    onError: fail,
  });
  const recover = useMutation({
    mutationKey: ["receipt-controls", identity ?? "none", "recover"],
    mutationFn: (r: ReceiptControlRequestDTO) => recoverReceiptControl(r.id, r.version),
    onSuccess: done,
    onError: fail,
  });
  if (!enabled) return null;
  const code = q.error instanceof ReceiptControlClientError ? q.error.code : null;
  const rows = q.data?.pages.flatMap((p) => p.requests) ?? [];
  const total = q.data?.pages.at(-1)?.total ?? 0;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-[#102A43]">Receipt requests</h2>
      {q.isPending ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {code ? <p className="text-sm text-muted-foreground">{receiptControlMessage(code)}</p> : null}
      {!q.isPending && !code && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No receipt requests waiting.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <ReceiptRequestCard
            key={r.id}
            r={r}
            busy={decide.isPending || verify.isPending || recover.isPending}
            onDecide={(decision) => decide.mutate({ r, decision })}
            onVerify={() => verify.mutate(r)}
            onRecover={() => recover.mutate(r)}
          />
        ))}
      </ul>
      {rows.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing {rows.length} of {total} open requests
        </p>
      ) : null}
      {q.hasNextPage ? (
        <button
          type="button"
          className="mt-2 rounded border px-2 py-1 text-sm"
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {q.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}
