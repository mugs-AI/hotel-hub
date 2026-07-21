import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import {
  useAvailability,
  useBookingSources,
  useCreateReservation,
  type AvailabilityRoomDTO,
} from "@/lib/reservations-client";
import {
  addRoomIfNew,
  bookingSourceLabel,
  buildCreatePayload,
  emptyGuestDraft,
  formatIsoDate,
  friendlyError,
  makeRoomDraft,
  rateOverrideRequired,
  removeGuestSafe,
  setPrimaryGuest,
  validateGuests,
  validateRoom,
  validateStayDates,
  type GuestDraft,
  type RoomDraft,
} from "@/lib/reservations-ui";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const SOFT_BG = "#F4F8FC";
const ERR = "#C2413B";

export const Route = createFileRoute("/reservations/new")({
  head: () => ({
    meta: [
      { title: "New Reservation — HotelHub" },
      {
        name: "description",
        content: "Create a new hotel reservation with multi-room and multi-guest support.",
      },
    ],
  }),
  component: NewReservationPage,
});

function NewReservationPage() {
  const session = useSessionMe();
  const data = session.data;
  const role = data && data.authenticated === true ? data.role : null;
  const canCreate = hasPermission(role, "hotel:reservations:create");
  const isAuthed = data?.authenticated === true;

  return (
    <AppShell>
      <div className="space-y-6" style={{ backgroundColor: SOFT_BG }}>
        <Header />
        {!isAuthed ? null : !canCreate ? <NoAccess /> : <NewReservationForm />}
      </div>
    </AppShell>
  );
}

function Header() {
  return (
    <section
      className="rounded-lg p-6 text-white shadow-sm"
      style={{ background: `linear-gradient(135deg, ${NAVY}, ${TEAL})` }}
    >
      <Link
        to="/reservations"
        className="inline-flex items-center gap-1 text-xs text-white/80 underline underline-offset-2"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        Back to Reservations
      </Link>
      <span
        className="mt-3 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{ backgroundColor: GOLD, color: NAVY }}
      >
        Front Desk
      </span>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">New Reservation</h1>
      <p className="mt-1 max-w-2xl text-sm text-white/85">
        Enter stay details, pick available rooms, add guests, and confirm.
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
        Only Owner and Front Desk can create reservations.
      </p>
    </div>
  );
}

function Card({
  title,
  accent,
  tag,
  children,
}: {
  title: string;
  accent: string;
  tag: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-lg border bg-white p-5 shadow-sm"
      style={{ borderColor: `${accent}33`, borderLeft: `4px solid ${accent}` }}
    >
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
          {title}
        </h2>
        <span
          className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ backgroundColor: `${accent}22`, color: accent }}
        >
          {tag}
        </span>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string | null;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium" style={{ color: NAVY }}>
        {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px]" style={{ color: ERR }}>
          {error}
        </span>
      ) : null}
    </label>
  );
}

function NewReservationForm() {
  const navigate = useNavigate();
  const create = useCreateReservation();

  const [arrival, setArrival] = useState("");
  const [departure, setDeparture] = useState("");
  const [bookingSource, setBookingSource] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [rooms, setRooms] = useState<RoomDraft[]>([]);
  const [guests, setGuests] = useState<GuestDraft[]>([emptyGuestDraft(true)]);
  const [formError, setFormError] = useState<string | null>(null);
  const [availabilityMsg, setAvailabilityMsg] = useState<string | null>(null);

  const stayValid = validateStayDates(arrival, departure);
  const availability = useAvailability(arrival, departure, {
    enabled: stayValid.ok,
  });

  // Clear stale selections whenever dates change and become invalid, or when
  // availability refresh removes selected rooms.
  useEffect(() => {
    if (!stayValid.ok && rooms.length > 0) {
      setRooms([]);
      setAvailabilityMsg("Dates changed — please reselect rooms.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival, departure]);

  useEffect(() => {
    if (!availability.data) return;
    const availIds = new Set(availability.data.rooms.map((r) => r.hotelRoomId));
    setRooms((prev) => {
      const kept = prev.filter((r) => availIds.has(r.hotelRoomId));
      if (kept.length !== prev.length) {
        setAvailabilityMsg(
          "Some previously selected rooms are no longer available and were removed.",
        );
      }
      return kept;
    });
  }, [availability.data]);

  const canSubmit =
    stayValid.ok && !!bookingSource && rooms.length > 0 && guests.length > 0 && !create.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!stayValid.ok) return setFormError(friendlyError("invalid_stay_dates"));
    if (!bookingSource) return setFormError(friendlyError("invalid_booking_source"));
    if (rooms.length === 0) return setFormError(friendlyError("room_required"));
    for (const r of rooms) {
      const v = validateRoom(r);
      if (!v.ok) return setFormError(friendlyError(v.code));
    }
    const g = validateGuests(guests);
    if (!g.ok) return setFormError(friendlyError(g.code));

    const payload = buildCreatePayload({
      bookingSource,
      arrivalDate: arrival,
      departureDate: departure,
      notes,
      rooms,
      guests,
    });

    try {
      const res = await create.mutateAsync(payload);
      navigate({ to: "/reservations/$id", params: { id: res.reservationId } });
    } catch (err) {
      const code = (err as { code?: string }).code ?? "reservation_create_failed";
      setFormError(friendlyError(code));
      if (code === "room_not_available") {
        // Preserve stay+guest input, refresh availability, drop the offending rooms
        void availability.refetch();
      }
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit} noValidate>
      <Card title="Stay details" accent={NAVY} tag="Step 1">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Arrival date"
            error={!arrival ? null : stayValid.ok ? null : "Choose a valid arrival date"}
          >
            <input
              type="date"
              required
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={arrival}
              onChange={(e) => setArrival(e.target.value)}
            />
          </Field>
          <Field
            label="Departure date"
            error={!departure ? null : stayValid.ok ? null : "Departure must be after arrival"}
          >
            <input
              type="date"
              required
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
            />
          </Field>
          <Field label="Booking source">
            <ActiveBookingSourceSelect value={bookingSource} onChange={setBookingSource} />
          </Field>
          <Field label="Internal notes (optional)">
            <input
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </Field>
        </div>
      </Card>

      <Card title="Available rooms" accent={TEAL} tag="Step 2">
        {!stayValid.ok ? (
          <p className="text-xs text-muted-foreground">
            Enter valid arrival and departure dates to load availability.
          </p>
        ) : availability.isPending ? (
          <p className="text-xs text-muted-foreground">Loading availability…</p>
        ) : availability.error ? (
          <p className="text-xs" style={{ color: ERR }}>
            {friendlyError(availability.error.code, "Unable to load availability.")}
          </p>
        ) : (
          <AvailabilityList
            rooms={availability.data?.rooms ?? []}
            selected={rooms}
            onAdd={(r) => {
              const next = addRoomIfNew(rooms, makeRoomDraft(r));
              setRooms(next.rooms);
            }}
          />
        )}
        {availabilityMsg ? (
          <p className="mt-2 text-xs text-muted-foreground">{availabilityMsg}</p>
        ) : null}
      </Card>

      {rooms.length > 0 ? (
        <Card title="Selected rooms" accent={GOLD} tag="Occupancy & rate">
          <div className="space-y-3">
            {rooms.map((r, i) => (
              <SelectedRoomRow
                key={r.hotelRoomId}
                room={r}
                onChange={(next) => setRooms(rooms.map((x, j) => (i === j ? next : x)))}
                onRemove={() => setRooms(rooms.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="Guests" accent={NAVY} tag="Step 3">
        <GuestList guests={guests} onChange={setGuests} />
      </Card>

      <Card title="Review & create" accent={TEAL} tag="Step 4">
        <Review
          arrival={arrival}
          departure={departure}
          bookingSource={bookingSource}
          rooms={rooms}
          guests={guests}
          notes={notes}
        />
        {formError ? (
          <div
            role="alert"
            className="mt-3 rounded-md border p-3 text-sm"
            style={{ borderColor: `${ERR}33`, backgroundColor: `${ERR}12`, color: ERR }}
          >
            {formError}
          </div>
        ) : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <Link
            to="/reservations"
            className="rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium"
            style={{ color: NAVY }}
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: NAVY }}
          >
            {create.isPending ? "Creating…" : "Create Reservation"}
          </button>
        </div>
      </Card>
    </form>
  );
}

function AvailabilityList({
  rooms,
  selected,
  onAdd,
}: {
  rooms: AvailabilityRoomDTO[];
  selected: RoomDraft[];
  onAdd: (r: AvailabilityRoomDTO) => void;
}) {
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.hotelRoomId)), [selected]);
  if (rooms.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        <p>No rooms are available for those dates.</p>
        <p className="mt-1 text-xs">
          Check{" "}
          <Link to="/rooms-rates" className="underline" style={{ color: NAVY }}>
            Rooms &amp; Rates
          </Link>{" "}
          to ensure active rooms are configured.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase" style={{ color: NAVY }}>
            <th className="py-2 pr-4">Room #</th>
            <th className="py-2 pr-4">Type</th>
            <th className="py-2 pr-4">Floor</th>
            <th className="py-2 pr-4">Max guests</th>
            <th className="py-2 pr-4">Base rate</th>
            <th className="py-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => {
            const already = selectedIds.has(r.hotelRoomId);
            return (
              <tr key={r.hotelRoomId} className="border-t border-border/60">
                <td className="py-2 pr-4 font-mono text-xs">{r.roomNumber}</td>
                <td className="py-2 pr-4">{r.roomType}</td>
                <td className="py-2 pr-4">{r.floor ?? "—"}</td>
                <td className="py-2 pr-4 text-center">{r.maxOccupancy}</td>
                <td className="py-2 pr-4 tabular-nums">
                  {r.currency} {r.baseRate.toFixed(2)}
                </td>
                <td className="py-2 pr-4">
                  <button
                    type="button"
                    onClick={() => onAdd(r)}
                    disabled={already}
                    className="rounded-md px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                    style={{ backgroundColor: TEAL }}
                    aria-label={
                      already
                        ? `Room ${r.roomNumber} already selected`
                        : `Select room ${r.roomNumber}`
                    }
                  >
                    {already ? "Selected" : "Select"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SelectedRoomRow({
  room,
  onChange,
  onRemove,
}: {
  room: RoomDraft;
  onChange: (r: RoomDraft) => void;
  onRemove: () => void;
}) {
  const overridden = rateOverrideRequired(room.baseRate, room.agreedRate);
  const v = validateRoom(room);
  const err = v.ok ? null : v;
  return (
    <div className="rounded-md border p-3" style={{ borderColor: `${NAVY}22` }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: NAVY }}>
          Room {room.roomNumber} — {room.roomType} · Max {room.maxOccupancy}
        </p>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
          style={{ color: ERR }}
          aria-label={`Remove room ${room.roomNumber}`}
        >
          <Trash2 className="h-3 w-3" aria-hidden />
          Remove
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Adults" error={err?.field === "adults" ? friendlyError(err.code) : null}>
          <input
            type="number"
            min={1}
            step={1}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={room.adults}
            onChange={(e) => onChange({ ...room, adults: parseInt(e.target.value, 10) || 0 })}
          />
        </Field>
        <Field label="Children" error={err?.field === "children" ? friendlyError(err.code) : null}>
          <input
            type="number"
            min={0}
            step={1}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={room.children}
            onChange={(e) => onChange({ ...room, children: parseInt(e.target.value, 10) || 0 })}
          />
        </Field>
        <Field label={`Base rate (${room.currency})`}>
          <input
            readOnly
            value={room.baseRate.toFixed(2)}
            className="w-full rounded-md border border-input bg-muted px-2 py-1.5 text-sm text-muted-foreground"
          />
        </Field>
        <Field
          label={`Room rate (${room.currency})`}
          error={err?.field === "agreedRate" ? friendlyError(err.code) : null}
        >
          <input
            type="number"
            min={0}
            step="0.01"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={room.agreedRate}
            onChange={(e) =>
              onChange({
                ...room,
                agreedRate: Number.isFinite(parseFloat(e.target.value))
                  ? parseFloat(e.target.value)
                  : 0,
              })
            }
          />
        </Field>
      </div>
      {overridden ? (
        <div className="mt-3">
          <Field
            label="Reason for rate change"
            error={err?.field === "rateOverrideReason" ? friendlyError(err.code) : null}
          >
            <input
              required
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={room.rateOverrideReason}
              onChange={(e) => onChange({ ...room, rateOverrideReason: e.target.value })}
              maxLength={200}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function GuestList({
  guests,
  onChange,
}: {
  guests: GuestDraft[];
  onChange: (g: GuestDraft[]) => void;
}) {
  return (
    <div className="space-y-3">
      {guests.map((g, i) => (
        <div key={i} className="rounded-md border p-3" style={{ borderColor: `${NAVY}22` }}>
          <div className="flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-xs font-medium">
              <input
                type="radio"
                name="primary-guest"
                checked={g.isPrimary === true}
                onChange={() => onChange(setPrimaryGuest(guests, i))}
              />
              <span style={{ color: NAVY }}>Primary guest</span>
            </label>
            {guests.length > 1 ? (
              <button
                type="button"
                onClick={() => onChange(removeGuestSafe(guests, i))}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                style={{ color: ERR }}
                aria-label={`Remove guest ${i + 1}`}
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                Remove
              </button>
            ) : null}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Full name">
              <input
                required
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={g.fullName}
                onChange={(e) =>
                  onChange(guests.map((x, j) => (j === i ? { ...x, fullName: e.target.value } : x)))
                }
              />
            </Field>
            <Field label="Mobile">
              <input
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={g.mobile}
                onChange={(e) =>
                  onChange(guests.map((x, j) => (j === i ? { ...x, mobile: e.target.value } : x)))
                }
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={g.email}
                onChange={(e) =>
                  onChange(guests.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))
                }
              />
            </Field>
            <Field label="Nationality">
              <input
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={g.nationality}
                onChange={(e) =>
                  onChange(
                    guests.map((x, j) => (j === i ? { ...x, nationality: e.target.value } : x)),
                  )
                }
              />
            </Field>
            <Field label="Guest notes">
              <input
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={g.notes}
                onChange={(e) =>
                  onChange(guests.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))
                }
              />
            </Field>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...guests, emptyGuestDraft(false)])}
        className="inline-flex items-center gap-1 rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium"
        style={{ color: NAVY }}
      >
        <Plus className="h-3 w-3" aria-hidden />
        Add another guest
      </button>
    </div>
  );
}

function ActiveBookingSourceSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const q = useBookingSources({ activeOnly: true });
  const sources = q.data?.sources ?? [];
  return (
    <select
      required
      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={q.isPending}
    >
      <option value="">
        {q.isPending ? "Loading…" : sources.length === 0 ? "No active sources" : "Select a source…"}
      </option>
      {sources.map((s) => (
        <option key={s.id} value={s.sourceCode}>
          {s.displayName}
        </option>
      ))}
    </select>
  );
}

function Review({
  arrival,
  departure,
  bookingSource,
  rooms,
  guests,
  notes,
}: {
  arrival: string;
  departure: string;
  bookingSource: string;
  rooms: RoomDraft[];
  guests: GuestDraft[];
  notes: string;
}) {
  const primary = guests.find((g) => g.isPrimary === true);
  const additional = guests.length - (primary ? 1 : 0);
  return (
    <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-[max-content_1fr]">
      <dt className="text-muted-foreground">Stay</dt>
      <dd>
        {formatIsoDate(arrival)} → {formatIsoDate(departure)}
      </dd>
      <dt className="text-muted-foreground">Source</dt>
      <dd>{bookingSource ? bookingSourceLabel(bookingSource) : "—"}</dd>
      <dt className="text-muted-foreground">Rooms</dt>
      <dd>
        {rooms.length === 0 ? (
          "—"
        ) : (
          <ul className="space-y-1">
            {rooms.map((r) => {
              const overridden = rateOverrideRequired(r.baseRate, r.agreedRate);
              return (
                <li key={r.hotelRoomId}>
                  <span className="font-mono">{r.roomNumber}</span> · {r.adults}A/{r.children}C ·{" "}
                  base {r.currency} {r.baseRate.toFixed(2)} · rate {r.currency}{" "}
                  {r.agreedRate.toFixed(2)}
                  {overridden ? ` · reason: ${r.rateOverrideReason || "—"}` : ""}
                </li>
              );
            })}
          </ul>
        )}
      </dd>
      <dt className="text-muted-foreground">Primary guest</dt>
      <dd>{primary?.fullName || "—"}</dd>
      <dt className="text-muted-foreground">Additional guests</dt>
      <dd>{additional}</dd>
      <dt className="text-muted-foreground">Notes</dt>
      <dd>{notes.trim() || "—"}</dd>
    </dl>
  );
}
