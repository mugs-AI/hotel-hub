// Reservation operations UI: contextual check-in / request actions, the
// Pending Approvals ledger and the reservation Timeline.
// Server enforces every permission; this is only a usability layer.
import { useMemo } from "react";
import { toast } from "sonner";
import {
  directActionLabel,
  effectiveExceptionMode,
  exceptionActionLabel,
  exceptionSubmitLabel,
  operationErrorMessage,
  operationStateLabel,
  operationTypeLabel,
  lateCheckoutLocal,
  timelineEventLabel,
  useCheckIn,
  useDecideOperation,
  useRequestOperation,
  useReservationOperations,
  useReservationTimeline,
  type OperationRequestDTO,
  type OperationType,
} from "@/lib/operations-client";
import {
  formatCreatedAt,
  formatIsoDate,
  roomLabel as formatRoomLabel,
} from "@/lib/reservations-ui";
import { useQuery } from "@tanstack/react-query";
import { hotelJson } from "@/lib/hotel-settings-client";
import { useHousekeepingBoard } from "@/lib/housekeeping-client";
import { CONDITION_LABELS, type HousekeepingCondition } from "@/lib/housekeeping";
import { useSessionMe } from "@/lib/session-client";
import { MalaysianDateInput } from "@/components/malaysia-date-input";
import { CardInfoPopover } from "@/components/CardInfoPopover";
import { useWorkspaceDraft } from "@/lib/workspace-context";
import { useOperationControls } from "@/lib/operation-controls-client";

// Semantic action-button colours. Colour is never the only signal — every
// button also keeps an explicit text label and meets contrast requirements.
const ACTION_COLORS = {
  checkIn: "#0E7C57", // teal/green — primary, most common action
  earlyCheckIn: "#0E7CA8", // teal/blue
  lateCheckout: "#B4790A", // amber
  stayExtension: "#1D4ED8", // blue
  roomChange: "#3730A3", // indigo/teal
  rateChange: "#B8860B", // gold/amber
  approve: "#0E7C57", // green/teal
  reject: "#B42318", // red, used only as an outline/soft treatment
} as const;

/** Per-operation request-button colour (semantic, label always present). */
const REQUEST_COLOR: Record<OperationType, string> = {
  early_check_in: ACTION_COLORS.earlyCheckIn,
  late_checkout: ACTION_COLORS.lateCheckout,
  stay_extension: ACTION_COLORS.stayExtension,
  room_change: ACTION_COLORS.roomChange,
  rate_change: ACTION_COLORS.rateChange,
};

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const ERR = "#C2413B";

function errText(err: unknown, operationType?: string): string {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
  const message = operationErrorMessage(code, operationType);
  const reference =
    err && typeof err === "object" && "reference" in err
      ? String((err as { reference: unknown }).reference ?? "")
      : "";
  return reference && /^(operation_request_failed|request_failed)$/.test(code)
    ? `${message} Support reference: ${reference}.`
    : message;
}

function savedOperationError(error: unknown): { code: string; reference?: string } {
  const row =
    error && typeof error === "object" ? (error as { code?: unknown; reference?: unknown }) : {};
  return {
    code:
      typeof row.code === "string" && /^[a-z_]{1,80}$/.test(row.code) ? row.code : "request_failed",
    ...(typeof row.reference === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(row.reference)
      ? { reference: row.reference }
      : {}),
  };
}

/** Safe-only readiness blocker codes that can surface on a pending decision. */
const READINESS_BLOCKER_CODES = new Set([
  "housekeeping_not_initialized",
  "room_not_ready",
  "room_dirty",
  "room_cleaning",
  "room_inspected",
  "dnd_active",
  "handoff_pending",
  "readiness_read_failed",
  "destination_housekeeping_not_initialized",
  "destination_room_not_ready",
  "destination_room_dirty",
  "destination_room_cleaning",
  "destination_room_inspected",
  "destination_not_ready",
  "destination_dnd_active",
  "destination_handoff_pending",
  "destination_readiness_read_failed",
]);

function isReadinessBlockerCode(code: string): boolean {
  return READINESS_BLOCKER_CODES.has(code);
}

/**
 * Per-action status rules. The server is authoritative; this only keeps the
 * card usable after check-in instead of blanket read-only.
 */
const REQUESTABLE: Array<{
  type: OperationType;
  label: string;
  help: string;
  statuses: readonly string[];
}> = [
  {
    type: "early_check_in",
    label: "Early check-in",
    help: "Arrive before the standard time.",
    statuses: ["confirmed"],
  },
  {
    type: "late_checkout",
    label: "Late checkout",
    help: "Leave later on the same day.",
    statuses: ["confirmed", "checked_in"],
  },
  {
    type: "stay_extension",
    label: "Stay extension",
    help: "Stay one or more extra nights.",
    statuses: ["confirmed", "checked_in"],
  },
  {
    type: "room_change",
    label: "Room change",
    help: "Move a stay to a different room.",
    statuses: ["confirmed", "checked_in"],
  },
  {
    type: "rate_change",
    label: "Rate change",
    help: "Change the agreed nightly rate.",
    statuses: ["confirmed", "checked_in"],
  },
];

/** Statuses that end the stay: nothing further can be requested. */
const TERMINAL_STATUSES = new Set(["cancelled", "checked_out", "no_show", "completed"]);

export type ActionRoom = {
  /** hotel_reservation_rooms.id */
  id: string;
  /** hotel_rooms.id — the room the guest is physically in right now. */
  hotelRoomId: string;
  label: string;
  agreedRate: number;
};

type PropertyRoom = {
  id: string;
  roomNumber: string;
  displayName: string | null;
  n3StockName: string | null;
  roomType: string;
  floor: string | null;
  maxOccupancy: number;
  baseRate: number;
  isActive: boolean;
};

function usePropertyRooms(enabled: boolean) {
  return useQuery({
    queryKey: ["property-rooms"],
    enabled,
    queryFn: () => hotelJson<{ rooms: PropertyRoom[] }>("/api/hotel/rooms"),
  });
}

/** Housekeeping status badge text for a target room, derived from the
 * Housekeeping board only — never a guess when data is unavailable. */
function housekeepingBadge(
  hotelRoomId: string,
  board:
    | {
        rooms: Array<{
          roomId: string;
          initialized: boolean;
          condition: HousekeepingCondition | null;
          dndActive: boolean;
        }>;
      }
    | undefined,
): string {
  const room = board?.rooms.find((r) => r.roomId === hotelRoomId);
  if (!room) return "Housekeeping unknown";
  if (room.dndActive) return "DND";
  if (!room.initialized || !room.condition) return "Not set up";
  return CONDITION_LABELS[room.condition];
}

function housekeepingBadgeTone(label: string): string {
  switch (label) {
    case "Ready":
      return "#0E7C57";
    case "Dirty":
      return "#B42318";
    case "Cleaning":
    case "Inspected":
      return "#B4790A";
    case "DND":
      return "#7C2D12";
    default:
      return "#6B7280";
  }
}

export function LateCheckoutFields({
  departureDate,
  time,
  reason,
  onTimeChange,
  onReasonChange,
}: {
  departureDate: string;
  time: string;
  reason: string;
  onTimeChange: (value: string) => void;
  onReasonChange: (value: string) => void;
}) {
  return (
    <>
      <p className="mt-1 text-xs text-muted-foreground">
        Departure: {formatIsoDate(departureDate)} · Property local time. Use Extend Stay for another
        day.
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <label className="min-w-0 text-xs">
          <span className="text-muted-foreground">Requested checkout time</span>
          <input
            type="time"
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            className="mt-1 w-full min-w-0 rounded-md border border-input px-2 py-1"
          />
        </label>
        <label className="min-w-0 text-xs">
          <span className="text-muted-foreground">Reason (optional)</span>
          <input
            value={reason}
            maxLength={300}
            onChange={(e) => onReasonChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-input px-2 py-1"
          />
        </label>
      </div>
    </>
  );
}

export function ReservationActionsCard({
  reservationId,
  updatedAt,
  status,
  checkedInAt,
  departureDate,
  checkInAction,
  checkInBlockedReason,
  canCheckIn,
  canRequest,
  rooms,
}: {
  reservationId: string;
  updatedAt: string;
  status: string;
  checkedInAt: string | null;
  departureDate: string;
  checkInAction: "early_check_in" | "check_in" | null;
  checkInBlockedReason?: string | null;
  canCheckIn: boolean;
  canRequest: boolean;
  rooms: ActionRoom[];
}) {
  const checkIn = useCheckIn(reservationId, {
    onMutate: startFlow,
    onSuccess: (id, result) => {
      if (result.folioWarning === "folio_needs_preparation")
        toast.warning(
          "Checked in. The guest folio was not prepared — open the folio and choose Prepare before checkout.",
        );
      finishFlow(id);
    },
    onError: failFlow,
  });
  const request = useRequestOperation(reservationId, {
    onMutate: startFlow,
    onSuccess: finishFlow,
    onError: failFlow,
  });
  const controls = useOperationControls(canRequest);
  const canChangeRate = controls.isSuccess && controls.data.rateChangeEnabled;
  // SME approval policy. The server is authoritative; this only makes the
  // buttons tell the truth about what pressing them will do.
  const session = useSessionMe();
  // Effective authority = server session role + server setting. An Owner is
  // always direct, so Owner labels never promise an approval that waits for
  // themself.
  const approvalMode = effectiveExceptionMode(
    session.data?.authenticated ? session.data.role : null,
    session.data?.authenticated ? session.data.exceptionApprovalMode : null,
  );
  // Stable per-flow identity: minted when a flow opens, cleared on cancel or
  // a completed server result, so a safe HTTP retry cannot duplicate work.
  const initialDraft = {
    flow: null as { kind: "check_in" | OperationType; id: string } | null,
    detail: "",
    reason: "",
    reservationRoomId: "",
    targetRoomId: "",
    newRate: "",
    pending: false,
    error: null as ReturnType<typeof savedOperationError> | null,
  };
  const [draft, setDraft] = useWorkspaceDraft(
    "reservation-action",
    initialDraft,
    (value) => value.flow !== null,
    `reservation:${reservationId.toLowerCase()}`,
    (value) =>
      value.pending
        ? "An action is still applying. Wait for its saved result before closing this tab."
        : null,
  );
  const { flow, detail, reason, reservationRoomId, targetRoomId, newRate } = draft;
  const working = draft.pending || checkIn.isPending || request.isPending;
  function startFlow(id: string) {
    setDraft((value) => (value.flow?.id === id ? { ...value, pending: true, error: null } : value));
  }
  function finishFlow(id: string) {
    setDraft((value) => (value.flow?.id === id ? initialDraft : value));
  }
  function failFlow(id: string, error: unknown) {
    setDraft((value) =>
      value.flow?.id === id
        ? { ...value, pending: false, error: savedOperationError(error) }
        : value,
    );
  }
  const setFlow = (flow: typeof draft.flow) => setDraft((value) => ({ ...value, flow }));
  const setDetail = (detail: string) => setDraft((value) => ({ ...value, detail }));
  const setReason = (reason: string) => setDraft((value) => ({ ...value, reason }));
  const setReservationRoomId = (reservationRoomId: string) =>
    setDraft((value) => ({ ...value, reservationRoomId }));
  const setTargetRoomId = (targetRoomId: string) =>
    setDraft((value) => ({ ...value, targetRoomId }));
  const setNewRate = (newRate: string) => setDraft((value) => ({ ...value, newRate }));
  const propertyRooms = usePropertyRooms(flow?.kind === "room_change");
  const hkBoard = useHousekeepingBoard(flow?.kind === "room_change");
  const currentReservationRoom = rooms.find((r) => r.id === reservationRoomId) ?? null;
  const currentAgreedRate = currentReservationRoom?.agreedRate ?? null;
  const currentHotelRoomId = currentReservationRoom?.hotelRoomId ?? null;
  const targetRoom = (propertyRooms.data?.rooms ?? []).find((r) => r.id === targetRoomId);
  const rateDiff =
    currentAgreedRate !== null && targetRoom ? targetRoom.baseRate - currentAgreedRate : null;

  if (!canCheckIn && !canRequest) return null;
  // Terminal stays only are globally read-only; a checked-in stay keeps its
  // applicable request actions.
  const readOnly = TERMINAL_STATUSES.has(status);
  const available = REQUESTABLE.filter(
    (r) =>
      r.statuses.includes(status) &&
      (r.type !== "rate_change" || canChangeRate) &&
      (r.type !== "early_check_in" || checkInAction === "early_check_in"),
  );
  const showCheckIn = canCheckIn && status === "confirmed" && checkInAction === "check_in";

  const close = () => {
    if (working) return;
    setDraft(initialDraft);
    checkIn.reset();
    request.reset();
  };

  const submitRequest = (type: OperationType) => {
    if (!flow || working) return;
    if (type === "rate_change" && !canChangeRate) return;
    const checkoutLocal =
      type === "late_checkout" ? lateCheckoutLocal(departureDate, detail) : null;
    if (type === "late_checkout" && !checkoutLocal) return;
    const payload: Record<string, unknown> =
      type === "late_checkout"
        ? { expectedCheckOutLocal: checkoutLocal, reason: reason || undefined }
        : type === "stay_extension"
          ? { newDepartureDate: detail, reason: reason || undefined }
          : type === "room_change"
            ? {
                reservationRoomId,
                toHotelRoomId: targetRoomId,
                preserveRate: true,
                reason: reason || undefined,
              }
            : type === "rate_change"
              ? {
                  reservationRoomId,
                  newAgreedRate: Number(newRate),
                  reason: reason.trim(),
                }
              : { reason: reason || undefined };
    request.mutate({ operationType: type, payload, clientRequestId: flow.id });
  };

  return (
    <section
      className="rounded-lg border bg-white p-5 shadow-sm"
      style={{ borderColor: `${GOLD}33`, borderLeft: `4px solid ${GOLD}` }}
    >
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
          Actions
        </h2>
        <CardInfoPopover label="About reservation actions">
          Update this stay here. Changes are recorded in the timeline and follow the property’s
          approval setting.
        </CardInfoPopover>
      </div>
      {readOnly ? (
        <p className="mt-2 text-sm text-muted-foreground">
          This reservation is {status} and is read-only.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {status === "confirmed" && checkInBlockedReason ? (
            <p role="status" className="text-sm text-amber-900">
              {operationErrorMessage(checkInBlockedReason)}
            </p>
          ) : null}
          {showCheckIn || checkedInAt ? (
            checkedInAt ? (
              <p className="text-sm text-muted-foreground">
                Checked in on {formatCreatedAt(checkedInAt)}.
              </p>
            ) : flow?.kind === "check_in" ? (
              <div className="rounded-md border p-3 text-sm" style={{ borderColor: `${NAVY}22` }}>
                <p style={{ color: NAVY }}>Confirm standard check-in for this reservation?</p>
                {checkIn.error || draft.error ? (
                  <p className="mt-1 text-xs" style={{ color: ERR }}>
                    {errText(checkIn.error ?? draft.error)}
                  </p>
                ) : null}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={working}
                    onClick={() =>
                      checkIn.mutate({ expectedUpdatedAt: updatedAt, clientRequestId: flow.id })
                    }
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                    style={{ backgroundColor: ACTION_COLORS.checkIn }}
                  >
                    {working ? "Checking in…" : "Confirm check-in"}
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    disabled={working}
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
                style={{ backgroundColor: ACTION_COLORS.checkIn }}
              >
                Check in
              </button>
            )
          ) : null}

          {canRequest && available.length > 0 ? (
            <div>
              <div className="flex flex-wrap gap-2">
                {available.map((r) => (
                  <button
                    key={r.type}
                    type="button"
                    title={r.help}
                    disabled={working}
                    onClick={() => {
                      setFlow({ kind: r.type, id: crypto.randomUUID() });
                      setDetail("");
                      setReason("");
                      // One-room reservation: there is nothing to choose, so
                      // preselect it instead of forcing a pointless first step.
                      setReservationRoomId(rooms.length === 1 ? rooms[0]!.id : "");
                      setTargetRoomId("");
                      request.reset();
                    }}
                    className="rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
                    style={{ backgroundColor: REQUEST_COLOR[r.type] }}
                  >
                    {exceptionActionLabel(
                      approvalMode === "direct" ? directActionLabel(r.type, r.label) : r.label,
                      approvalMode,
                    )}
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
                    <LateCheckoutFields
                      departureDate={departureDate}
                      time={detail}
                      reason={reason}
                      onTimeChange={setDetail}
                      onReasonChange={setReason}
                    />
                  ) : null}
                  {flow.kind === "room_change" || flow.kind === "rate_change" ? (
                    <label className="mt-2 block text-xs">
                      <span className="text-muted-foreground">Room in this reservation</span>
                      <select
                        value={reservationRoomId}
                        onChange={(e) => setReservationRoomId(e.target.value)}
                        className="mt-1 w-full rounded-md border border-input px-2 py-1"
                      >
                        <option value="">Select a room…</option>
                        {rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {flow.kind === "room_change" ? (
                    <div className="mt-2">
                      <p className="text-xs text-muted-foreground">Move to room</p>
                      {propertyRooms.isPending ? (
                        <p className="mt-1 text-xs text-muted-foreground">Loading rooms…</p>
                      ) : (
                        <ul className="mt-1 grid gap-2 sm:grid-cols-2">
                          {(propertyRooms.data?.rooms ?? [])
                            .filter((r) => r.isActive)
                            // Never offer the room the guest is already in as
                            // its own destination.
                            .filter((r) => r.id !== currentHotelRoomId)
                            .map((r) => {
                              const label = formatRoomLabel(
                                r.displayName,
                                r.n3StockName,
                                r.roomNumber,
                              );
                              const badge = housekeepingBadge(r.id, hkBoard.data);
                              const selected = r.id === targetRoomId;
                              return (
                                <li key={r.id}>
                                  <button
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => setTargetRoomId(r.id)}
                                    className="w-full rounded-md border bg-white p-2 text-left"
                                    style={{
                                      borderColor: selected
                                        ? ACTION_COLORS.roomChange
                                        : `${NAVY}22`,
                                      boxShadow: selected
                                        ? `inset 0 0 0 1px ${ACTION_COLORS.roomChange}`
                                        : undefined,
                                    }}
                                  >
                                    <span
                                      className="block text-sm font-semibold"
                                      style={{ color: NAVY }}
                                    >
                                      {label}
                                      {selected ? " · Selected" : ""}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                      Room {r.roomNumber}
                                      {r.floor ? ` · Floor ${r.floor}` : ""} · {r.roomType} · max{" "}
                                      {r.maxOccupancy}
                                    </span>
                                    <span className="mt-1 flex flex-wrap items-center gap-2">
                                      <span className="text-xs" style={{ color: NAVY }}>
                                        Base rate {r.baseRate.toFixed(2)}
                                      </span>
                                      <span
                                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                        style={{
                                          color: housekeepingBadgeTone(badge),
                                          backgroundColor: `${housekeepingBadgeTone(badge)}18`,
                                        }}
                                      >
                                        {badge}
                                      </span>
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                        </ul>
                      )}
                      <div
                        className="mt-2 rounded-md border p-2 text-[11px]"
                        style={{ borderColor: `${NAVY}18` }}
                      >
                        <p style={{ color: NAVY }}>
                          Current agreed rate:{" "}
                          {currentAgreedRate === null ? "—" : currentAgreedRate.toFixed(2)} · Target
                          base rate: {targetRoom ? targetRoom.baseRate.toFixed(2) : "—"}
                          {rateDiff === null
                            ? ""
                            : ` · Difference per night: ${rateDiff >= 0 ? "+" : ""}${rateDiff.toFixed(2)}`}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          Current agreed rate will be preserved. Target base rate difference is
                          informational. Availability and housekeeping readiness are re-checked by
                          the server{" "}
                          {approvalMode === "direct"
                            ? "when you apply the change."
                            : "when the Owner approves."}
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {flow.kind === "rate_change" ? (
                    <label className="mt-2 block text-xs">
                      <span className="text-muted-foreground">New agreed rate</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={newRate}
                        onChange={(e) => setNewRate(e.target.value)}
                        className="mt-1 w-full rounded-md border border-input px-2 py-1"
                      />
                    </label>
                  ) : null}
                  {flow.kind === "stay_extension" ? (
                    <label className="mt-2 block text-xs">
                      <span className="text-muted-foreground">New departure date</span>
                      <MalaysianDateInput
                        value={detail}
                        className="mt-1"
                        pickerLabel="Choose the new departure date"
                        onChange={setDetail}
                      />
                    </label>
                  ) : null}
                  {flow.kind !== "late_checkout" ? (
                    <label className="mt-2 block text-xs">
                      <span className="text-muted-foreground">
                        {flow.kind === "rate_change" ? "Reason (required)" : "Reason (optional)"}
                      </span>
                      <input
                        value={reason}
                        maxLength={300}
                        onChange={(e) => setReason(e.target.value)}
                        className="mt-1 w-full rounded-md border border-input px-2 py-1"
                      />
                    </label>
                  ) : null}
                  {request.error || draft.error ? (
                    <p className="mt-1 text-xs" style={{ color: ERR }}>
                      {errText(request.error ?? draft.error, flow.kind)}
                    </p>
                  ) : null}
                  {flow.kind === "rate_change" && !canChangeRate ? (
                    <p role="status" className="mt-2 text-xs text-amber-900">
                      Change rate is disabled or its setting could not be checked. Cancel this
                      action or refresh the reservation.
                    </p>
                  ) : null}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={
                        working ||
                        (flow.kind === "rate_change" && !canChangeRate) ||
                        (flow.kind === "late_checkout" && !lateCheckoutLocal(departureDate, detail))
                      }
                      onClick={() => submitRequest(flow.kind as OperationType)}
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                      style={{ backgroundColor: REQUEST_COLOR[flow.kind as OperationType] }}
                    >
                      {exceptionSubmitLabel(approvalMode, working)}
                    </button>
                    <button
                      type="button"
                      onClick={close}
                      disabled={working}
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

/**
 * Destination detail for a pending room change. The room is located by EXACT
 * server-supplied id against the tenant-scoped property room list — never by
 * reading the summary text — and housekeeping readiness is informational
 * only: the server re-checks it fail-closed when the Owner approves.
 */
function PendingDestinationBlock({
  destinationHotelRoomId,
  propertyRooms,
  board,
}: {
  destinationHotelRoomId: string | null;
  propertyRooms: PropertyRoom[] | undefined;
  board: Parameters<typeof housekeepingBadge>[1];
}) {
  const room = destinationHotelRoomId
    ? (propertyRooms ?? []).find((r) => r.id === destinationHotelRoomId)
    : undefined;
  if (!room) {
    return (
      <p className="mt-1 text-[11px] text-muted-foreground">
        Destination room: unknown — this request does not carry a recognised destination room.
      </p>
    );
  }
  const badge = housekeepingBadge(room.id, board);
  return (
    <div className="mt-1 rounded-md border p-2 text-[11px]" style={{ borderColor: `${NAVY}18` }}>
      <p style={{ color: NAVY }}>
        Destination room: {formatRoomLabel(room.displayName, room.n3StockName, room.roomNumber)}
      </p>
      <p className="text-muted-foreground">
        Room {room.roomNumber}
        {room.floor ? ` · Floor ${room.floor}` : ""} · {room.roomType} · max {room.maxOccupancy} ·
        Base rate {room.baseRate.toFixed(2)}
      </p>
      <span
        className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={{
          color: housekeepingBadgeTone(badge),
          backgroundColor: `${housekeepingBadgeTone(badge)}18`,
        }}
      >
        Housekeeping now: {badge}
      </span>
    </div>
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
  const decide = useDecideOperation(reservationId, {
    onMutate: startDecision,
    onSuccess: finishDecision,
    onError: failDecision,
  });
  const controls = useOperationControls(canView);
  const canChangeRate = controls.isSuccess && controls.data.rateChangeEnabled;
  const propertyRooms = usePropertyRooms(canView);
  const hkBoard = useHousekeepingBoard(canView);
  const [draft, setDraft] = useWorkspaceDraft(
    "operation-decision",
    {
      confirm: null as {
        request: OperationRequestDTO;
        decision: "approve" | "reject";
        id: string;
      } | null,
      note: "",
      pending: false,
      error: null as ReturnType<typeof savedOperationError> | null,
    },
    (value) => value.confirm !== null,
    `reservation:${reservationId.toLowerCase()}`,
    (value) =>
      value.pending
        ? "A decision is still applying. Wait for its saved result before closing this tab."
        : null,
  );
  const { confirm, note } = draft;
  const working = draft.pending || decide.isPending;
  function startDecision(id: string) {
    setDraft((value) =>
      value.confirm?.id === id ? { ...value, pending: true, error: null } : value,
    );
  }
  function finishDecision(id: string) {
    setDraft((value) =>
      value.confirm?.id === id ? { confirm: null, note: "", pending: false, error: null } : value,
    );
  }
  function failDecision(id: string, error: unknown) {
    setDraft((value) =>
      value.confirm?.id === id
        ? { ...value, pending: false, error: savedOperationError(error) }
        : value,
    );
  }
  const setConfirm = (confirm: typeof draft.confirm) =>
    setDraft((value) => ({ ...value, confirm }));
  const setNote = (note: string) => setDraft((value) => ({ ...value, note }));
  const decisionError = decide.error ?? draft.error;
  const decideCode =
    decisionError && typeof decisionError === "object" && "code" in decisionError
      ? String((decisionError as { code: string }).code)
      : "";

  if (!canView) return null;
  const requests = q.data?.requests ?? [];
  const pending = requests.filter((r) => r.state === "pending");
  const history = requests.filter((r) => r.state !== "pending");

  const close = () => {
    if (working) return;
    setDraft({ confirm: null, note: "", pending: false, error: null });
    decide.reset();
  };

  return (
    <section
      className="rounded-lg border bg-white p-5 shadow-sm"
      style={{ borderColor: `${NAVY}22`, borderLeft: `4px solid ${NAVY}` }}
    >
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
          Pending approvals ({pending.length})
        </h2>
        <CardInfoPopover label="About pending approvals">
          Requests waiting for the Owner appear here. Completed decisions remain in the timeline.
        </CardInfoPopover>
      </div>
      {q.isPending ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading requests…</p>
      ) : requests.length === 0 ? null : (
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
              {r.operationType === "room_change" ? (
                <PendingDestinationBlock
                  destinationHotelRoomId={r.destinationHotelRoomId}
                  propertyRooms={propertyRooms.data?.rooms}
                  board={hkBoard.data}
                />
              ) : null}
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
                    {decisionError ? (
                      <p
                        className="mt-1"
                        style={{ color: isReadinessBlockerCode(decideCode) ? GOLD : ERR }}
                      >
                        {errText(decisionError, r.operationType)}
                        {isReadinessBlockerCode(decideCode)
                          ? " This request stays pending until the room is ready."
                          : ""}
                      </p>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={
                          working ||
                          (confirm.decision === "approve" &&
                            r.operationType === "rate_change" &&
                            !canChangeRate)
                        }
                        onClick={() =>
                          decide.mutate({
                            requestId: r.id,
                            decision: confirm.decision,
                            note: note.trim() || null,
                            clientRequestId: confirm.id,
                          })
                        }
                        className="rounded-md px-3 py-1 font-medium text-white"
                        style={{
                          backgroundColor:
                            confirm.decision === "approve"
                              ? ACTION_COLORS.approve
                              : ACTION_COLORS.reject,
                        }}
                      >
                        {working ? "Saving…" : "Confirm"}
                      </button>
                      <button
                        type="button"
                        onClick={close}
                        disabled={working}
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
                      disabled={working}
                      className="rounded-md px-3 py-1 font-medium text-white"
                      style={{ backgroundColor: ACTION_COLORS.approve }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirm({ request: r, decision: "reject", id: crypto.randomUUID() })
                      }
                      disabled={working}
                      className="rounded-md border border-input px-3 py-1"
                      style={{
                        color: ACTION_COLORS.reject,
                        borderColor: `${ACTION_COLORS.reject}55`,
                      }}
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
          {events.map((e, i) => (
            <li
              key={`${e.occurredAt}-${e.eventType}-${i}`}
              className="border-l-2 pl-3"
              style={{ borderColor: `${TEAL}55` }}
            >
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
