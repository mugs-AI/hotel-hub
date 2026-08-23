// Browser-side reservation-operation queries/mutations. Same-origin,
// cookie-authenticated, no direct Supabase or N3 access.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type OperationType =
  | "early_check_in"
  | "late_checkout"
  | "room_change"
  | "stay_extension"
  | "rate_change";

export type OperationState = "pending" | "approved" | "rejected" | "applied" | "cancelled";

export type OperationRequestDTO = {
  id: string;
  reservationId: string;
  operationType: OperationType;
  state: OperationState;
  summary: string;
  requestedByLabel: string | null;
  requestedAt: string;
  decidedByLabel: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedAt: string | null;
};

export type ReservationEventDTO = {
  eventType: string;
  summary: string;
  actorLabel: string | null;
  occurredAt: string;
};

export class OperationApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "OperationApiError";
  }
}

async function opFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "request_failed";
    throw new OperationApiError(code, res.status);
  }
  return body as T;
}

const OPERATION_LABELS: Record<string, string> = {
  early_check_in: "Early check-in",
  late_checkout: "Late checkout",
  room_change: "Room change",
  stay_extension: "Stay extension",
  rate_change: "Rate change",
};

export function operationTypeLabel(t: string): string {
  return OPERATION_LABELS[t] ?? t.replace(/_/g, " ");
}

const EVENT_LABELS: Record<string, string> = {
  "reservation.created": "Reservation created",
  "reservation.updated": "Reservation updated",
  "reservation.checked_in": "Checked in",
  "reservation.guests_assigned": "Guests assigned to rooms",
  "operation.requested": "Change requested",
  "operation.approved": "Change approved",
  "operation.rejected": "Change rejected",
  "operation.applied": "Change applied",
};

export function timelineEventLabel(t: string): string {
  return EVENT_LABELS[t] ?? t.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function operationStateLabel(s: string): string {
  switch (s) {
    case "pending":
      return "Owner approval required";
    case "approved":
      return "Approved";
    case "applied":
      return "Applied";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
    default:
      return s;
  }
}

export function operationErrorMessage(code: string, operationType?: string): string {
  switch (code) {
    case "operation_stale":
      return "This request is out of date and was not applied. Reload and try again.";
    case "operation_pending":
      return operationType === "room_change"
        ? "A room-change request is already pending. Approve or Reject it below before creating another."
        : "A similar request is already waiting for Owner approval.";
    case "invalid_transition":
      return "This change is not allowed for the reservation's current status.";
    case "reservation_changed":
      return "The reservation changed while you were working. Reload and try again.";
    case "early_check_in_required":
      return "It is before the standard check-in time — request an early check-in instead.";
    case "room_unavailable":
      return "The room is not available for that period.";
    case "room_capacity_exceeded":
      return "That room cannot hold this many guests.";
    // Check-in readiness — the room a guest is being checked into now.
    case "housekeeping_not_initialized":
      return "This room is not set up for housekeeping yet. Mark it Ready in Housekeeping before check-in.";
    case "room_not_ready":
      return "This room is not Ready yet. Finish housekeeping and mark it Ready before check-in.";
    case "dnd_active":
      return "Do Not Disturb is active for this room. Clear DND before check-in.";
    case "handoff_pending":
      return "This room is still being released from a previous stay. Please wait for Housekeeping to finish the room handoff.";
    case "readiness_read_failed":
      return "We could not confirm this room's housekeeping status. Please try again, or contact support if this continues.";
    // Same blockers, restated from the destination room's point of view
    // (early check-in / room change into a room that is not yet Ready).
    case "destination_housekeeping_not_initialized":
      return "The destination room is not set up for housekeeping yet. Mark it Ready in Housekeeping first.";
    case "destination_room_not_ready":
    case "destination_not_ready":
      return "The destination room is not Ready yet. Finish housekeeping and mark it Ready first.";
    case "destination_dnd_active":
      return "Do Not Disturb is active for the destination room. Clear DND first.";
    case "destination_handoff_pending":
      return "The destination room is still being released from a previous stay. Please wait for Housekeeping to finish the room handoff.";
    case "destination_readiness_read_failed":
      return "We could not confirm the destination room's housekeeping status. Please try again, or contact support if this continues.";
    case "forbidden":
    case "role_unassigned":
      return "Your role does not allow this action.";
    case "unauthenticated":
    case "unauthorized":
      return "Your session has ended. Please relaunch HotelHub from N3.";
    default:
      return "The request could not be completed. Please try again.";
  }
}

export function useReservationOperations(reservationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["reservation-operations", reservationId],
    enabled,
    queryFn: () =>
      opFetch<{ requests: OperationRequestDTO[] }>(
        `/api/hotel/reservations/${reservationId}/operations`,
      ),
  });
}

export function useReservationTimeline(reservationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["reservation-timeline", reservationId],
    enabled,
    queryFn: () =>
      opFetch<{ events: ReservationEventDTO[] }>(
        `/api/hotel/reservations/${reservationId}/timeline`,
      ),
  });
}

function useInvalidateReservation(reservationId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["reservation", reservationId] });
    void qc.invalidateQueries({ queryKey: ["reservation-operations", reservationId] });
    void qc.invalidateQueries({ queryKey: ["reservation-timeline", reservationId] });
    void qc.invalidateQueries({ queryKey: ["reservations"] });
    void qc.invalidateQueries({ queryKey: ["reservation-calendar"] });
  };
}

export function useCheckIn(reservationId: string) {
  const invalidate = useInvalidateReservation(reservationId);
  return useMutation({
    mutationFn: (input: { expectedUpdatedAt: string | null; clientRequestId: string }) =>
      opFetch<{ status: string; checkedInAt: string | null; updatedAt: string }>(
        `/api/hotel/reservations/${reservationId}/check-in`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: invalidate,
  });
}

export function useRequestOperation(reservationId: string) {
  const invalidate = useInvalidateReservation(reservationId);
  return useMutation({
    mutationFn: (input: {
      operationType: OperationType;
      payload: Record<string, unknown>;
      clientRequestId: string;
    }) =>
      opFetch<{ requestId: string; state: OperationState }>(
        `/api/hotel/reservations/${reservationId}/operations`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: invalidate,
  });
}

export function useDecideOperation(reservationId: string) {
  const invalidate = useInvalidateReservation(reservationId);
  return useMutation({
    mutationFn: (input: {
      requestId: string;
      decision: "approve" | "reject";
      note: string | null;
      clientRequestId: string;
    }) =>
      opFetch<{ requestId: string; state: OperationState }>(
        `/api/hotel/reservations/${reservationId}/operations/${input.requestId}/decision`,
        {
          method: "POST",
          body: JSON.stringify({
            decision: input.decision,
            note: input.note,
            clientRequestId: input.clientRequestId,
          }),
        },
      ),
    onSuccess: invalidate,
  });
}
