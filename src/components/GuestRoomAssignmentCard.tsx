/**
 * Run 5D2.5 §9 — Guest → Room assignment card (Reservation Detail).
 *
 * Presentation only: every rule (policy, concurrency, idempotency) is enforced
 * server-side by `hotelhub_assign_guest_rooms_v2`. Identity numbers are never
 * rendered here — the DTO only ever carries masked values.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useAssignGuestRooms,
  type ReservationEditCapabilitiesDTO,
  type ReservationDetailDTO,
} from "@/lib/reservations-client";
import { roomDisplayName } from "@/lib/reservations-ui";

const NAVY = "#0F2748";
const TEAL = "#0E7C86";
const GOLD = "#C8A44D";

type Props = {
  reservationId: string;
  data: ReservationDetailDTO;
  capabilities: ReservationEditCapabilitiesDTO;
};

export function GuestRoomAssignmentCard({ reservationId, data, capabilities }: Props) {
  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const g of data.guests) m[g.id] = g.assignedReservationRoomId ?? "";
    return m;
  }, [data.guests]);

  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [reason, setReason] = useState("");
  const mutation = useAssignGuestRooms(reservationId);

  if (!capabilities.canAssignGuestRooms) return null;

  const dirty = data.guests.some((g) => (draft[g.id] ?? "") !== (initial[g.id] ?? ""));

  // Advisory capacity feedback; the database performs the authoritative check.
  const perRoomCount: Record<string, number> = {};
  for (const g of data.guests) {
    const rid = draft[g.id] ?? "";
    if (rid) perRoomCount[rid] = (perRoomCount[rid] ?? 0) + 1;
  }
  const overCapacity = data.rooms.filter(
    (r) => (perRoomCount[r.id] ?? 0) > (r.maxOccupancy || 0),
  );

  const reasonRequired = capabilities.correctionReasonRequired;
  const canSave = dirty && !mutation.isPending && (!reasonRequired || reason.trim().length > 0);

  async function save() {
    try {
      const result = await mutation.mutateAsync({
        clientRequestId: crypto.randomUUID(),
        expectedUpdatedAt: data.updatedAt,
        correctionReason: reasonRequired ? reason.trim() : null,
        assignments: data.guests.map((g) => ({
          reservationGuestId: g.id,
          reservationRoomId: draft[g.id] ? draft[g.id] : null,
        })),
      });
      setReason("");
      toast.success(
        result.replayed ? "Assignment already applied." : "Guest room assignment saved.",
      );
    } catch (err) {
      const code = (err as { code?: string }).code ?? "guest_assignment_failed";
      toast.error(assignmentMessage(code));
    }
  }

  return (
    <section
      className="rounded-lg border bg-white p-5 shadow-sm"
      style={{ borderColor: `${NAVY}22`, borderLeft: `4px solid ${TEAL}` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: NAVY }}>
          Guest room assignment
        </h2>
        <p className="text-xs text-muted-foreground">
          Assign each guest to one of this reservation&rsquo;s rooms.
        </p>
      </div>

      <div className="mt-4 space-y-3">
        {data.guests.map((g) => (
          <div
            key={g.id}
            className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
            style={{ borderColor: `${NAVY}18` }}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" style={{ color: NAVY }}>
                {g.fullName}
                {g.isPrimary ? (
                  <span
                    className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                    style={{ backgroundColor: `${GOLD}22`, color: GOLD }}
                  >
                    Primary
                  </span>
                ) : null}
              </p>
              {g.mobile ? (
                <p className="truncate text-xs text-muted-foreground">{g.mobile}</p>
              ) : null}
            </div>
            <label className="text-xs text-muted-foreground">
              <span className="sr-only">Room for {g.fullName}</span>
              <select
                className="w-full rounded-md border px-2 py-1.5 text-sm sm:w-64"
                style={{ borderColor: `${NAVY}33` }}
                value={draft[g.id] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [g.id]: e.target.value }))}
              >
                <option value="">Unassigned</option>
                {data.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {roomDisplayName(r)} · max {r.maxOccupancy}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
      </div>

      {overCapacity.length > 0 ? (
        <p className="mt-3 text-xs font-medium text-destructive">
          Over capacity: {overCapacity.map((r) => roomDisplayName(r)).join(", ")}. Reduce guests in
          these rooms before saving.
        </p>
      ) : null}

      {reasonRequired ? (
        <label className="mt-4 block text-xs font-medium" style={{ color: NAVY }}>
          Correction reason (required after check-in)
          <textarea
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: `${NAVY}33` }}
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this assignment being corrected?"
          />
        </label>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: TEAL }}
        >
          {mutation.isPending ? "Saving…" : "Save assignment"}
        </button>
        {dirty ? (
          <button
            type="button"
            className="text-xs underline text-muted-foreground"
            onClick={() => setDraft(initial)}
            disabled={mutation.isPending}
          >
            Reset
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Safe, user-facing text for allow-listed assignment error codes. */
export function assignmentMessage(code: string): string {
  switch (code) {
    case "stale_reservation":
      return "This reservation changed elsewhere. Refresh and try again.";
    case "guest_edit_locked":
      return "Guest changes are locked after check-in by your Guest Controls policy.";
    case "correction_reason_required":
      return "A correction reason is required after check-in.";
    case "room_capacity_exceeded":
      return "A room would exceed its maximum guests.";
    case "reservation_not_editable":
      return "This reservation can no longer be edited.";
    case "unauthenticated":
      return "Your session expired. Relaunch HotelHub from N3.";
    case "forbidden":
      return "You do not have permission to assign guests.";
    default:
      return "Could not save the guest assignment. Please try again.";
  }
}
