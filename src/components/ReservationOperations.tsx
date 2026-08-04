// Reservation operations UI: contextual check-in / request actions, the
// Pending Approvals ledger and the reservation Timeline.
// Server enforces every permission; this is only a usability layer.
import { useState } from "react";
import {
  operationErrorMessage,
  operationStateLabel,
  operationTypeLabel,
  timelineEventLabel,
  useCheckIn,
  useDecideOperation,
  useRequestOperation,
  useReservationOperations,
  useReservationTimeline,
  type OperationRequestDTO,
  type OperationType,
} from "@/lib/operations-client";
import { formatCreatedAt } from "@/lib/reservations-ui";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const ERR = "#C2413B";

function errText(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
  return operationErrorMessage(code);
}

const REQUESTABLE: Array<{ type: OperationType; label: string; help: string }> = [
  { type: "early_check_in", label: "Early check-in", help: "Arrive before the standard time." },
  { type: "late_checkout", label: "Late checkout", help: "Leave later on the same day." },
  { type: "stay_extension", label: "Stay extension", help: "Stay one or more extra nights." },
];

export function ReservationActionsCard({
  reservationId,
  updatedAt,
  status,
  checkedInAt,
  canCheckIn,
  canRequest,
}: {
  reservationId: string;
  updatedAt: string;
  status: string;
  checkedInAt: string | null;
  canCheckIn: boolean;
  canRequest: boolean;
}) {
  const checkIn = useCheckIn(reservationId);
  const request = useRequestOperation(reservationId);
  // Stable per-flow identity: minted when a flow opens, cleared on cancel or
  // a completed server result, so a safe HTTP retry cannot duplicate work.
  const [flow, setFlow] = useState<{ kind: "check_in" | OperationType; id: string } | null>(null);
  const [detail, setDetail] = useState("");
  const [reason, setReason] = useState("");

  if (!canCheckIn && !canRequest) return null;
  const readOnly = status !== "confirmed";

  const close = () => {
    setFlow(null);
    setDetail("");
    setReason("");
    checkIn.reset();
    request.reset();
  };

  const submitRequest = (type: OperationType) => {
    if (!flow) return;
    const payload: Record<string, unknown> =
      type === "late_checkout"
        ? { expectedCheckOutAt: detail, reason: reason || undefined }
        : type === "stay_extension"
          ? { newDepartureDate: detail, reason: reason || undefined }
          : { reason: reason || undefined };
    request.mutate(
      { operationType: type, payload, clientRequestId: flow.id },
      { onSuccess: close },
    );
  };

  return (
    <section
      className="rounded-lg border bg-white p-5 shadow-sm"
      style={{ borderColor: `${GOLD}33`, borderLeft: `4px solid ${GOLD}` }}
    >
      <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
        Actions
      </h2>
      {readOnly ? (
        <p className="mt-2 text-sm text-muted-foreground">
          This reservation is {status} and is read-only.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {canCheckIn ? (
            checkedInAt ? (
              <p className="text-sm text-muted-foreground">
                Checked in on {formatCreatedAt(checkedInAt)}.
              </p>
            ) : flow?.kind === "check_in" ? (
              <div className="rounded-md border p-3 text-sm" style={{ borderColor: `${NAVY}22` }}>
                <p style={{ color: NAVY }}>Confirm standard check-in for this reservation?</p>
                {checkIn.error ? (
                  <p className="mt-1 text-xs" style={{ color: ERR }}>
                    {errText(checkIn.error)}
                  </p>
                ) : null}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={checkIn.isPending}
                    onClick={() =>
                      checkIn.mutate(
                        { expectedUpdatedAt: updatedAt, clientRequestId: flow.id },
                        { onSuccess: close },
                      )
                    }
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                    style={{ backgroundColor: TEAL }}
                  >
                    {checkIn.isPending ? "Checking in…" : "Confirm check-in"}
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-input px-3 py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setFlow({ kind: "check_in", id: crypto.randomUUID() })}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                style={{ backgroundColor: NAVY }}
              >
                Check in
              </button>
            )
          ) : null}

          {canRequest ? (
            <div>
              <p className="text-xs text-muted-foreground">
                Exceptions need Owner approval before they take effect.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {REQUESTABLE.map((r) => (
                  <button
                    key={r.type}
                    type="button"
                    title={r.help}
                    onClick={() => {
                      setFlow({ kind: r.type, id: crypto.randomUUID() });
                      setDetail("");
                      setReason("");
                      request.reset();
                    }}
                    className="rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium"
                    style={{ color: NAVY }}
                  >
                    Request {r.label.toLowerCase()}
                  </button>
                ))}
              </div>
              {flow && flow.kind !== "check_in" ? (
                <div
                  className="mt-3 rounded-md border p-3 text-sm"
                  style={{ borderColor: `${NAVY}22` }}
                >
                  <p className="font-medium" style={{ color: NAVY }}>
                    {operationTypeLabel(flow.kind)}
                  </p>
                  {flow.kind === "late_checkout" ? (
                    <label className="mt-2 block text-xs">
                      <span className="text-muted-foreground">Requested checkout time</span>
                      <input
                        type="datetime-local"
                        value={detail}
                        onChange={(e) => setDetail(`${e.target.value}:00+08:00`.replace(/:00:00/, ":00"))}
                        className="mt-1 w-full rounded-md border border-input px-2 py-1"
                      />
                    </label>
                  ) : null}
                  {flow.kind === "stay_extension" ? (
                    <label className="mt-2 block text-xs">
                      <span className="text-muted-foreground">New departure date</span>
                      <input
                        type="date"
                        value={detail}
                        onChange={(e) => setDetail(e.target.value)}
                        className="mt-1 w-full rounded-md border border-input px-2 py-1"
                      />
                    </label>
                  ) : null}
                  <label className="mt-2 block text-xs">
                    <span className="text-muted-foreground">Reason (optional)</span>
                    <input
                      value={reason}
                      maxLength={300}
                      onChange={(e) => setReason(e.target.value)}
                      className="mt-1 w-full rounded-md border border-input px-2 py-1"
                    />
                  </label>
                  {request.error ? (
                    <p className="mt-1 text-xs" style={{ color: ERR }}>
                      {errText(request.error)}
                    </p>
                  ) : null}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={request.isPending}
                      onClick={() => submitRequest(flow.kind as OperationType)}
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                      style={{ backgroundColor: NAVY }}
                    >
                      {request.isPending ? "Sending…" : "Send for approval"}
                    </button>
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-md border border-input px-3 py-1.5 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function PendingApprovalsCard({
  reservationId,
  canView,
  canApprove,
}: {
  reservationId: string;
  canView: boolean;
  canApprove: boolean;
}) {
  const q = useReservationOperations(reservationId, canView);
  const decide = useDecideOperation(reservationId);
  const [confirm, setConfirm] = useState<{
    request: OperationRequestDTO;
    decision: "approve" | "reject";
    id: string;
  } | null>(null);
  const [note, setNote] = useState("");

  if (!canView) return null;
  const requests = q.data?.requests ?? [];
  const pending = requests.filter((r) => r.state === "pending");
  const history = requests.filter((r) => r.state !== "pending");

  const close = () => {
    setConfirm(null);
    setNote("");
    decide.reset();
  };

  return (
    <section
      className="rounded-lg border bg-white p-5 shadow-sm"
      style={{ borderColor: `${NAVY}22`, borderLeft: `4px solid ${NAVY}` }}
    >
      <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
        Pending approvals ({pending.length})
      </h2>
      {q.isPending ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading requests…</p>
      ) : requests.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No change requests have been raised for this reservation.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {[...pending, ...history].map((r) => (
            <li
              key={r.id}
              className="rounded-md border p-3 text-xs"
              style={{ borderColor: `${NAVY}22` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold" style={{ color: NAVY }}>
                  {operationTypeLabel(r.operationType)}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    backgroundColor: r.state === "pending" ? `${GOLD}22` : `${TEAL}22`,
                    color: r.state === "pending" ? GOLD : TEAL,
                  }}
                >
                  {operationStateLabel(r.state)}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{r.summary}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Requested {formatCreatedAt(r.requestedAt)}
                {r.requestedByLabel ? ` · ${r.requestedByLabel}` : ""}
              </p>
              {r.decisionNote ? (
                <p className="mt-1 text-[11px] text-muted-foreground">Note: {r.decisionNote}</p>
              ) : null}
              {r.state === "pending" && canApprove ? (
                confirm?.request.id === r.id ? (
                  <div className="mt-2 rounded-md border p-2" style={{ borderColor: `${NAVY}22` }}>
                    <p style={{ color: NAVY }}>
                      Confirm {confirm.decision === "approve" ? "approval" : "rejection"} of this
                      request?
                    </p>
                    <input
                      value={note}
                      maxLength={300}
                      placeholder="Note (optional)"
                      onChange={(e) => setNote(e.target.value)}
                      className="mt-2 w-full rounded-md border border-input px-2 py-1"
                    />
                    {decide.error ? (
                      <p className="mt-1" style={{ color: ERR }}>
                        {errText(decide.error)}
                      </p>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={decide.isPending}
                        onClick={() =>
                          decide.mutate(
                            {
                              requestId: r.id,
                              decision: confirm.decision,
                              note: note.trim() || null,
                              clientRequestId: confirm.id,
                            },
                            { onSuccess: close },
                          )
                        }
                        className="rounded-md px-3 py-1 font-medium text-white"
                        style={{
                          backgroundColor: confirm.decision === "approve" ? TEAL : ERR,
                        }}
                      >
                        {decide.isPending ? "Saving…" : "Confirm"}
                      </button>
                      <button
                        type="button"
                        onClick={close}
                        className="rounded-md border border-input px-3 py-1"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setConfirm({ request: r, decision: "approve", id: crypto.randomUUID() })
                      }
                      className="rounded-md px-3 py-1 font-medium text-white"
                      style={{ backgroundColor: TEAL }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirm({ request: r, decision: "reject", id: crypto.randomUUID() })
                      }
                      className="rounded-md border border-input px-3 py-1"
                      style={{ color: ERR }}
                    >
                      Reject
                    </button>
                  </div>
                )
              ) : r.state === "pending" ? (
                <p className="mt-2 font-medium" style={{ color: GOLD }}>
                  Owner approval required
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReservationTimelineCard({
  reservationId,
  canView,
}: {
  reservationId: string;
  canView: boolean;
}) {
  const q = useReservationTimeline(reservationId, canView);
  if (!canView) return null;
  const events = q.data?.events ?? [];
  return (
    <section
      className="rounded-lg border bg-white p-5 shadow-sm"
      style={{ borderColor: `${TEAL}33`, borderLeft: `4px solid ${TEAL}` }}
    >
      <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
        Reservation timeline
      </h2>
      {q.isPending ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading timeline…</p>
      ) : events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No recorded history yet for this reservation.
        </p>
      ) : (
        <ol className="mt-3 space-y-3">
          {events.map((e) => (
            <li key={e.id} className="border-l-2 pl-3" style={{ borderColor: `${TEAL}55` }}>
              <p className="text-sm font-medium" style={{ color: NAVY }}>
                {timelineEventLabel(e.eventType)}
              </p>
              <p className="text-xs text-muted-foreground">{e.summary}</p>
              <p className="text-[11px] text-muted-foreground">
                {formatCreatedAt(e.occurredAt)} · {e.actorLabel ?? "System"}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
