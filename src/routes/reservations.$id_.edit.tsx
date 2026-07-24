// Atomic edit for a confirmed, pre-check-in reservation.
//
// Scope: edit stay dates, booking source, external reference, notes, and
// per-room agreed rate / occupancy / remark / override reason. Adding or
// removing rooms and editing guest identity are out of scope for this
// wizard and require Cancel + Create.
//
// Concurrency: PATCH sends `expectedUpdatedAt` from the last read. A
// `stale_reservation` response prompts the user to reload.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import {
  tenantSourceLabel,
  useBookingSources,
  useReservationDetail,
  useUpdateReservation,
  type ReservationDetailDTO,
  type UpdateReservationPayload,
} from "@/lib/reservations-client";
import { MalaysianDateInput } from "@/components/malaysia-date-input";
import { addDaysIso, todayInKualaLumpurIso } from "@/lib/malaysia-date";
import {
  EXTERNAL_REF_MAX,
  friendlyError,
  normalizeExternalBookingReference,
  rateOverrideRequired,
  roomLabel,
  ROOM_REMARK_MAX,
} from "@/lib/reservations-ui";
import { ArrowLeft, Save } from "lucide-react";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const SOFT_BG = "#F4F8FC";
const ERR = "#C2413B";

export const Route = createFileRoute("/reservations/$id_/edit")({
  head: () => ({
    meta: [
      { title: "Edit Reservation — HotelHub" },
      { name: "description", content: "Edit a confirmed pre-check-in reservation." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EditPage,
});

function EditPage() {
  const { id } = Route.useParams();
  const session = useSessionMe();
  const data = session.data;
  const role = data && data.authenticated === true ? data.role : null;
  const canEdit = hasPermission(role, "hotel:reservations:create");
  const query = useReservationDetail(id);

  return (
    <AppShell>
      <div className="space-y-4" style={{ backgroundColor: SOFT_BG }}>
        <Header id={id} />
        {data?.authenticated !== true ? null : !canEdit ? (
          <NoAccess />
        ) : query.isPending ? (
          <p className="text-sm text-muted-foreground">Loading reservation…</p>
        ) : query.error ? (
          <p className="text-sm text-destructive">
            {friendlyError(query.error.code, "Unable to load this reservation.")}
          </p>
        ) : query.data ? (
          <EditForm id={id} data={query.data.reservation} />
        ) : null}
      </div>
    </AppShell>
  );
}

function Header({ id }: { id: string }) {
  return (
    <section
      className="rounded-lg p-5 text-white shadow-sm"
      style={{ background: `linear-gradient(135deg, ${NAVY}, ${TEAL})` }}
    >
      <Link
        to="/reservations/$id"
        params={{ id }}
        className="inline-flex items-center gap-1 text-xs text-white/80 underline underline-offset-2"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        Back to reservation
      </Link>
      <span
        className="mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{ backgroundColor: GOLD, color: NAVY }}
      >
        Front Desk
      </span>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Edit Reservation</h1>
      <p className="mt-1 max-w-2xl text-sm text-white/85">
        Adjust stay details and per-room fields. To add or remove a room, or replace guest
        identity information, cancel this reservation and create a new one.
      </p>
    </section>
  );
}

function NoAccess() {
  return (
    <div
      role="alert"
      className="rounded-md border p-4 text-sm"
      style={{ borderColor: `${ERR}33`, backgroundColor: `${ERR}1A` }}
    >
      <p className="font-semibold" style={{ color: ERR }}>
        Access denied
      </p>
      <p className="mt-1 text-muted-foreground">
        Only Owner and Front Desk can edit reservations.
      </p>
    </div>
  );
}

type RoomState = {
  id: string;
  label: string;
  baseRate: number;
  currency: string;
  maxOccupancy: number;
  agreedRate: number;
  adults: number;
  children: number;
  remark: string;
  rateOverrideReason: string;
};

function EditForm({ id, data }: { id: string; data: ReservationDetailDTO }) {
  const navigate = useNavigate();
  const update = useUpdateReservation(id);
  const sourcesQ = useBookingSources({ activeOnly: true });
  const sources = sourcesQ.data?.sources ?? [];

  const [today] = useState(() => todayInKualaLumpurIso());
  const editable =
    data.status === "confirmed" && data.rooms.every((r) => r.allocationStatus === "reserved");

  const [arrival, setArrival] = useState(data.arrivalDate);
  const [departure, setDeparture] = useState(data.departureDate);
  const [bookingSource, setBookingSource] = useState(data.bookingSource);
  const [externalRef, setExternalRef] = useState(data.externalBookingReference ?? "");
  const [notes, setNotes] = useState(data.notes ?? "");
  const [rooms, setRooms] = useState<RoomState[]>(() =>
    data.rooms.map((r) => ({
      id: r.id,
      label: roomLabel(r.displayName, r.n3StockName, r.roomNumber),
      baseRate: Number(r.baseRateSnapshot),
      currency: data.currency,
      // maxOccupancy isn't in the DTO; conservatively allow current sum + 4
      // as a soft ceiling for the form. Server enforces the real max.
      maxOccupancy: Math.max(r.adults + r.children, 8),
      agreedRate: Number(r.agreedRate),
      adults: r.adults,
      children: r.children,
      remark: r.remark ?? "",
      rateOverrideReason: r.rateOverrideReason ?? "",
    })),
  );
  const [error, setError] = useState<string | null>(null);

  function handleArrivalChange(next: string) {
    setArrival(next);
    if (next && (!departure || departure <= next)) setDeparture(addDaysIso(next, 1));
  }

  const extCheck = useMemo(() => normalizeExternalBookingReference(externalRef), [externalRef]);
  const datesOk = arrival && departure && departure > arrival && arrival >= today;
  const validRooms = rooms.every(
    (r) =>
      Number.isInteger(r.adults) &&
      r.adults >= 1 &&
      Number.isInteger(r.children) &&
      r.children >= 0 &&
      r.adults + r.children <= r.maxOccupancy &&
      Number.isFinite(r.agreedRate) &&
      r.agreedRate >= 0 &&
      (!rateOverrideRequired(r.baseRate, r.agreedRate) || r.rateOverrideReason.trim().length > 0) &&
      r.remark.trim().length <= ROOM_REMARK_MAX,
  );
  const canSave =
    !!bookingSource && !!datesOk && extCheck.ok && validRooms && !update.isPending && editable;

  async function submit() {
    setError(null);
    if (!editable) return setError("This reservation can no longer be edited.");
    if (!datesOk) return setError(friendlyError("invalid_stay_dates"));
    if (!extCheck.ok) return setError(friendlyError(extCheck.code));
    if (!validRooms) return setError("Please fix highlighted room fields.");

    const payload: UpdateReservationPayload = {
      expectedUpdatedAt: data.updatedAt,
      bookingSource,
      arrivalDate: arrival,
      departureDate: departure,
      notes: notes.trim() || null,
      externalBookingReference: extCheck.value,
      rooms: rooms.map((r) => {
        const overridden = rateOverrideRequired(r.baseRate, r.agreedRate);
        const remark = r.remark.trim();
        return {
          id: r.id,
          agreedRate: r.agreedRate,
          adults: r.adults,
          children: r.children,
          rateOverrideReason: overridden ? r.rateOverrideReason.trim() || null : null,
          remark: remark.length > 0 ? remark : null,
        };
      }),
    };
    try {
      await update.mutateAsync(payload);
      navigate({ to: "/reservations/$id", params: { id } });
    } catch (err) {
      const code = (err as { code?: string }).code ?? "reservation_update_failed";
      setError(friendlyError(code, "We couldn’t save your changes. Please try again."));
    }
  }

  useEffect(() => {
    if (update.error?.code === "stale_reservation") {
      setError(
        "Someone else changed this reservation while you were editing. Please reload to continue.",
      );
    }
  }, [update.error]);

  if (!editable) {
    return (
      <section className="rounded-md border bg-white p-5 text-sm">
        <h2 className="font-semibold" style={{ color: NAVY }}>
          This reservation can’t be edited
        </h2>
        <p className="mt-1 text-muted-foreground">
          Editing is only available for confirmed reservations that have not been checked in yet.
        </p>
        <div className="mt-3">
          <Link
            to="/reservations/$id"
            params={{ id }}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium"
            style={{ color: NAVY }}
          >
            Back to reservation
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-white p-4 shadow-sm" style={{ borderColor: `${NAVY}22` }}>
        <h2 className="mb-3 text-sm font-semibold" style={{ color: NAVY }}>
          Stay details
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="mb-1 block font-medium" style={{ color: NAVY }}>
              Arrival date
            </span>
            <MalaysianDateInput
              value={arrival}
              onChange={handleArrivalChange}
              required
              minIso={today}
              pickerLabel="Choose arrival date"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium" style={{ color: NAVY }}>
              Departure date
            </span>
            <MalaysianDateInput
              value={departure}
              onChange={setDeparture}
              required
              minIso={arrival ? addDaysIso(arrival, 1) : today}
              pickerLabel="Choose departure date"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium" style={{ color: NAVY }}>
              Booking source
            </span>
            <select
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={bookingSource}
              onChange={(e) => setBookingSource(e.target.value)}
              disabled={sourcesQ.isPending}
            >
              <option value="">
                {sourcesQ.isPending
                  ? "Loading…"
                  : sources.length === 0
                    ? "No active sources"
                    : "Select a source…"}
              </option>
              {sources.map((s) => (
                <option key={s.id} value={s.sourceCode}>
                  {s.displayName}
                </option>
              ))}
              {/* Preserve the historical source when inactive */}
              {bookingSource && !sources.some((s) => s.sourceCode === bookingSource) ? (
                <option value={bookingSource}>
                  {tenantSourceLabel(sources, bookingSource)} (inactive)
                </option>
              ) : null}
            </select>
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium" style={{ color: NAVY }}>
              External booking reference
            </span>
            <input
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              maxLength={EXTERNAL_REF_MAX + 20}
              placeholder="Optional"
            />
            {!extCheck.ok ? (
              <span className="mt-1 block text-[11px]" style={{ color: ERR }}>
                {friendlyError(extCheck.code)}
              </span>
            ) : null}
          </label>
          <label className="block text-xs sm:col-span-2">
            <span className="mb-1 block font-medium" style={{ color: NAVY }}>
              Internal notes
            </span>
            <input
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-4 shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <h2 className="mb-3 text-sm font-semibold" style={{ color: NAVY }}>
          Rooms
        </h2>
        <ul className="space-y-2">
          {rooms.map((r, i) => (
            <RoomRow
              key={r.id}
              room={r}
              onChange={(next) => setRooms(rooms.map((x, j) => (i === j ? next : x)))}
            />
          ))}
        </ul>
      </section>

      <section className="rounded-lg border bg-white p-4 shadow-sm" style={{ borderColor: `${GOLD}55` }}>
        <h2 className="mb-2 text-sm font-semibold" style={{ color: NAVY }}>
          Guests
        </h2>
        <p className="text-xs text-muted-foreground">
          Guest identity, mobile, email, address, and notes remain unchanged. Raw identity numbers
          never leave the server. To replace or clear a guest identity, cancel this reservation and
          create a new one.
        </p>
        <ul className="mt-3 space-y-1 text-xs">
          {data.guests.map((g) => (
            <li key={g.id} className="rounded-md border p-2" style={{ borderColor: `${NAVY}22` }}>
              <span className="font-semibold" style={{ color: NAVY }}>
                {g.fullName}
              </span>
              {g.isPrimary ? (
                <span
                  className="ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase"
                  style={{ backgroundColor: `${GOLD}22`, color: GOLD }}
                >
                  Primary
                </span>
              ) : null}
              {g.identityNumberMasked ? (
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  {g.identityType ?? "id"} · {g.identityNumberMasked}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {error ? (
        <div
          role="alert"
          className="rounded-md border p-3 text-sm"
          style={{ borderColor: `${ERR}33`, backgroundColor: `${ERR}12`, color: ERR }}
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/reservations/$id"
          params={{ id }}
          className="rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium"
          style={{ color: NAVY }}
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: NAVY }}
        >
          <Save className="h-3.5 w-3.5" aria-hidden />
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function RoomRow({ room, onChange }: { room: RoomState; onChange: (r: RoomState) => void }) {
  const overridden = rateOverrideRequired(room.baseRate, room.agreedRate);
  return (
    <li className="rounded-md border p-3 text-xs" style={{ borderColor: `${NAVY}22` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold" style={{ color: NAVY }}>
            {room.label}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Base {room.currency} {room.baseRate.toFixed(2)}
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="mb-0.5 block text-muted-foreground">Adults</span>
          <input
            type="number"
            min={1}
            step={1}
            value={room.adults}
            onChange={(e) => onChange({ ...room, adults: parseInt(e.target.value, 10) || 0 })}
            className="w-full rounded border border-input bg-background px-1 py-0.5 text-right"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-muted-foreground">Children</span>
          <input
            type="number"
            min={0}
            step={1}
            value={room.children}
            onChange={(e) => onChange({ ...room, children: parseInt(e.target.value, 10) || 0 })}
            className="w-full rounded border border-input bg-background px-1 py-0.5 text-right"
          />
        </label>
        <label className="col-span-2 block">
          <span className="mb-0.5 block text-muted-foreground">
            Agreed rate ({room.currency})
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={room.agreedRate}
            onChange={(e) =>
              onChange({
                ...room,
                agreedRate: Number.isFinite(parseFloat(e.target.value))
                  ? parseFloat(e.target.value)
                  : 0,
              })
            }
            className="w-full rounded border border-input bg-background px-1 py-0.5 text-right"
            style={{ color: overridden ? GOLD : undefined, fontWeight: overridden ? 600 : 400 }}
          />
        </label>
      </div>
      {overridden ? (
        <input
          className="mt-2 w-full rounded border border-input bg-background px-1.5 py-1 text-xs"
          placeholder="Reason for rate change"
          value={room.rateOverrideReason}
          onChange={(e) => onChange({ ...room, rateOverrideReason: e.target.value })}
          maxLength={200}
        />
      ) : null}
      <textarea
        className="mt-2 w-full rounded border border-input bg-background px-1.5 py-1 text-xs"
        placeholder="Room remark (optional)"
        value={room.remark}
        onChange={(e) => onChange({ ...room, remark: e.target.value })}
        maxLength={ROOM_REMARK_MAX}
        rows={2}
      />
      <div className="mt-0.5 text-right text-[10px] text-muted-foreground">
        {room.remark.length}/{ROOM_REMARK_MAX}
      </div>
    </li>
  );
}
