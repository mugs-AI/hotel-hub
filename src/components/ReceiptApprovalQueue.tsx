// Owner Dashboard queue: Review / Approve / Reject / Verify receipt requests.
// Approval never changes totals; the manual N3 change plus Verify does.
import { useEffect, useRef, useState } from "react";
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
  verifyReceiptControl,
  recoverReceiptControl,
  applyReceiptControl,
  checkReceiptControlResult,
  normalizeReceiptControl,
} from "@/lib/receipt-controls-client";
import type { ReceiptAutomationDTO } from "@/lib/receipt-automation";
import { formatMyTimestamp } from "@/lib/malaysia-date";
import { ReceiptAlertStatus } from "@/components/ReceiptAlertStatus";

export function ReceiptRequestCard({
  r: raw,
  busy,
  onDecide,
  onVerify,
  onRecover,
  onApply,
  onCheckResult,
}: {
  r: ReceiptControlRequestDTO & Partial<ReceiptAutomationDTO>;
  busy?: boolean;
  onDecide?: (decision: "approve" | "reject") => void;
  onVerify?: () => void;
  onRecover?: () => void;
  onApply?: () => void;
  onCheckResult?: () => void;
}) {
  const r = normalizeReceiptControl(raw),
    automatic = r.automation !== null;
  return (
    <li className="flex flex-col gap-3 rounded-md border border-amber-200 bg-white p-3 text-sm lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong>
            {r.bookingReference} · {r.original.docCode} ·{" "}
            {r.proposal.kind === "void" ? "Void" : "Correction"}
          </strong>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
            {busy && automatic ? "Applying…" : RECEIPT_CONTROL_STATE_LABEL[r.state]}
          </span>
        </div>
        <p className="mt-1">Reason: {r.reason}</p>
        <p className="text-muted-foreground">
          Requested by {r.requestedByLabel ?? "staff"} · {formatMyTimestamp(r.requestedAt)}
          {r.selfApproved ? " · Owner approved own request (audited)" : ""}
        </p>
        <dl className="my-2 grid gap-2 sm:grid-cols-2">
          {r.comparison.fields.map((f) => (
            <div key={f.label} className="min-w-0 rounded bg-slate-50 p-2">
              <dt className="font-medium">{f.label}</dt>
              <dd className="whitespace-pre-wrap break-words">
                <span className="text-slate-600">Original: </span>
                {f.original || "—"}
                <span className="mx-2">→</span>
                <span className="text-slate-600">Proposed: </span>
                {f.requested || "—"}
              </dd>
            </div>
          ))}
        </dl>
        <p>
          {r.state === "applied" ? "Verified change:" : "Requested change:"} Deposits{" "}
          {formatReceiptDelta(r.comparison.depositDeltaCents, r.original.currency)} · Balance{" "}
          {formatReceiptDelta(r.comparison.balanceDeltaCents, r.original.currency)}
        </p>
        {!automatic && r.state === "approved_awaiting_n3" ? (
          <p className="mt-1 font-medium text-amber-900">
            Approval recorded. Complete this change in N3, then verify here. Totals update only
            after verification.
          </p>
        ) : r.outcomeMessage ? (
          <p role="status" className="font-medium">
            {r.outcomeMessage}
          </p>
        ) : null}
        <ReceiptAlertStatus alert={r.alert} />
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 lg:ml-auto">
        {r.canReject ? (
          <button
            disabled={busy}
            className="rounded border border-red-300 px-3 py-2 text-red-700"
            onClick={() => onDecide?.("reject")}
          >
            Reject
          </button>
        ) : null}
        {!automatic && r.canVerify ? (
          <button
            disabled={busy}
            className="rounded border px-3 py-2"
            title="Reads the N3 receipt and journal. Does not edit N3."
            onClick={onVerify}
          >
            Verify N3 change
          </button>
        ) : null}
        {!automatic && r.canRecover ? (
          <button
            disabled={busy}
            className="rounded border border-amber-400 px-3 py-2"
            onClick={onRecover}
          >
            Recover interrupted verification
          </button>
        ) : null}
        {r.canCheckResult ? (
          <button disabled={busy} className="rounded border px-3 py-2" onClick={onCheckResult}>
            Check N3 result
          </button>
        ) : null}
        {r.canApply ? (
          <button
            disabled={busy}
            className="rounded bg-teal-700 px-3 py-2 text-white"
            onClick={onApply}
          >
            {busy ? "Applying…" : "Apply"}
          </button>
        ) : null}
        {r.canApprove ? (
          <button
            disabled={busy}
            className="rounded bg-teal-700 px-3 py-2 text-white"
            onClick={() => onDecide?.("approve")}
          >
            {busy ? (automatic ? "Applying…" : "Approving…") : "Approve"}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function ReceiptApprovalQueue({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const me = useSessionMe();
  const identity = identityFromSession(me);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  // Auth switch: drop every receipt snapshot cached for another tenant/user/role
  // and any captured error from the previous identity.
  useEffect(() => {
    purgeForeignReceiptCache(qc, identity);
    setError("");
    setResult("");
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
    if (currentIdentity.current !== identity) return;
    setError("");
    invalidateReceiptEffects(qc);
  };
  const fail = (e: unknown) =>
    setError(receiptControlMessage(e instanceof ReceiptControlClientError ? e.code : ""));
  const decide = useMutation({
    mutationKey: ["receipt-controls", identity ?? "none", "decide"],
    mutationFn: (v: { r: ReceiptControlRequestDTO; decision: "approve" | "reject" }) =>
      decideReceiptControl(v.r.id, { decision: v.decision, expectedVersion: v.r.version }),
    onSuccess: (v) => {
      setResult(
        v.request.outcomeMessage ??
          (v.request.state === "applied" ? "N3 change verified." : "Decision recorded."),
      );
      done();
    },
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
  const apply = useMutation({
    mutationKey: ["receipt-controls", identity ?? "none", "apply"],
    mutationFn: (r: ReceiptControlRequestDTO) => applyReceiptControl(r.id, r.version),
    onSuccess: (v) => {
      if (currentIdentity.current !== identity) return;
      setResult(v.request.outcomeMessage ?? receiptControlMessage(v.code));
      done();
    },
    onError: fail,
  });
  const check = useMutation({
    mutationKey: ["receipt-controls", identity ?? "none", "check-result"],
    mutationFn: (r: ReceiptControlRequestDTO) => checkReceiptControlResult(r.id),
    onSuccess: (v) => {
      if (currentIdentity.current !== identity) return;
      setResult(v.request.outcomeMessage ?? receiptControlMessage(v.code));
      done();
    },
    onError: fail,
  });
  if (!enabled || !identity?.endsWith(":owner")) return null;
  const code = q.error instanceof ReceiptControlClientError ? q.error.code : null;
  const rows = q.isError ? [] : (q.data?.pages.flatMap((p) => p.requests) ?? []);
  const total = q.data?.pages.at(-1)?.total ?? 0;
  return (
    <section
      aria-label="Receipt requests"
      className="rounded-xl border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 p-5 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-[#102A43]">Receipt requests</h2>
      {q.isPending ? <p className="text-sm text-amber-900">Loading…</p> : null}
      {code ? <p className="text-sm text-amber-900">{receiptControlMessage(code)}</p> : null}
      {!q.isPending && !code && rows.length === 0 ? (
        <p className="text-sm text-amber-900">No receipt requests waiting.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {error}
        </p>
      ) : null}
      {result ? (
        <p role="status" className="mt-2 text-sm font-medium">
          {result}
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <ReceiptRequestCard
            key={r.id}
            r={r}
            busy={
              (decide.isPending && decide.variables?.r.id === r.id) ||
              (verify.isPending && verify.variables?.id === r.id) ||
              (recover.isPending && recover.variables?.id === r.id) ||
              (apply.isPending && apply.variables?.id === r.id) ||
              (check.isPending && check.variables?.id === r.id)
            }
            onDecide={(decision) => decide.mutate({ r, decision })}
            onVerify={() => verify.mutate(r)}
            onRecover={() => recover.mutate(r)}
            onApply={() => apply.mutate(r)}
            onCheckResult={() => check.mutate(r)}
          />
        ))}
      </ul>
      {rows.length > 0 ? (
        <p className="mt-2 text-xs text-amber-900">
          Showing {rows.length} of {total} open requests
        </p>
      ) : null}
      {q.hasNextPage ? (
        <button
          type="button"
          className="mt-2 rounded border border-amber-300 bg-white px-2 py-1 text-sm"
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {q.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}
