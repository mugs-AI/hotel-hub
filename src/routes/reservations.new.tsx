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
  applyGuestCountryChange,
  bookingSourceLabel,
  buildCreatePayload,
  emptyGuestDraft,
  EXTERNAL_REF_MAX,
  formatIsoDate,
  friendlyError,
  makeRoomDraft,
  normalizeExternalBookingReference,
  rateOverrideRequired,
  removeGuestSafe,
  setPrimaryGuest,
  validateGuests,
  validateRoom,
  validateStayDates,
  type GuestDraft,
  type RoomDraft,
} from "@/lib/reservations-ui";
import { MalaysianDateInput } from "@/components/malaysia-date-input";
import { COUNTRIES, countryName } from "@/lib/iso-countries";
import { MALAYSIAN_STATES, malaysianStateName } from "@/lib/malaysia-states";
import { IDENTITY_TYPES, identityTypeLabel } from "@/lib/guest-identity";
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
  hint,
}: {
  label: string;
  children: React.ReactNode;
  error?: string | null;
  hint?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium" style={{ color: NAVY }}>
        {label}
      </span>
      {children}
      {hint && !error ? (
        <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
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
  const [externalRef, setExternalRef] = useState("");
  const [notes, setNotes] = useState("");
  const [rooms, setRooms] = useState<RoomDraft[]>([]);
  const [guests, setGuests] = useState<GuestDraft[]>([emptyGuestDraft(true)]);
  const [formError, setFormError] = useState<string | null>(null);
  const [availabilityMsg, setAvailabilityMsg] = useState<string | null>(null);

  const stayValid = validateStayDates(arrival, departure);
  const extRefCheck = normalizeExternalBookingReference(externalRef);
  const availability = useAvailability(arrival, departure, {
    enabled: stayValid.ok,
  });

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
    stayValid.ok &&
    !!bookingSource &&
    rooms.length > 0 &&
    guests.length > 0 &&
    extRefCheck.ok &&
    !create.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!stayValid.ok) return setFormError(friendlyError("invalid_stay_dates"));
    if (!bookingSource) return setFormError(friendlyError("invalid_booking_source"));
    if (!extRefCheck.ok) return setFormError(friendlyError(extRefCheck.code));
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
      externalBookingReference: externalRef,
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
            <MalaysianDateInput value={arrival} onChange={setArrival} required />
          </Field>
          <Field
            label="Departure date"
            error={!departure ? null : stayValid.ok ? null : "Departure must be after arrival"}
          >
            <MalaysianDateInput value={departure} onChange={setDeparture} required />
          </Field>
          <Field label="Booking source">
            <ActiveBookingSourceSelect value={bookingSource} onChange={setBookingSource} />
          </Field>
          <Field
            label="External booking reference (optional)"
            hint={`OTA/portal booking ID. Max ${EXTERNAL_REF_MAX} characters.`}
            error={extRefCheck.ok ? null : friendlyError(extRefCheck.code)}
          >
            <input
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              maxLength={EXTERNAL_REF_MAX + 20}
              placeholder="e.g. AGD-12345"
            />
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
          externalRef={externalRef}
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

// ---------- Searchable country / nationality datalist input ----------
function CountryPicker({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (alpha3: string) => void;
  placeholder: string;
}) {
  const [text, setText] = useState<string>(value ? countryName(value) : "");
  useEffect(() => {
    setText(value ? countryName(value) : "");
  }, [value]);

  function resolve(next: string) {
    const trimmed = next.trim().toLowerCase();
    if (!trimmed) {
      onChange("");
      return;
    }
    const exact = COUNTRIES.find(
      (c) => c.name.toLowerCase() === trimmed || c.alpha3.toLowerCase() === trimmed,
    );
    if (exact) onChange(exact.alpha3);
  }

  const listId = `${id}-list`;
  return (
    <>
      <input
        id={id}
        list={listId}
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          resolve(e.target.value);
        }}
        onBlur={(e) => resolve(e.target.value)}
        autoComplete="off"
      />
      <datalist id={listId}>
        {COUNTRIES.map((c) => (
          <option key={c.alpha3} value={c.name} />
        ))}
      </datalist>
    </>
  );
}

function GuestCard({
  guest,
  index,
  total,
  onChange,
  onSetPrimary,
  onRemove,
}: {
  guest: GuestDraft;
  index: number;
  total: number;
  onChange: (g: GuestDraft) => void;
  onSetPrimary: () => void;
  onRemove: () => void;
}) {
  const isMY = guest.countryCode === "MYS";
  return (
    <div className="rounded-md border p-3" style={{ borderColor: `${NAVY}22` }}>
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="radio"
            name="primary-guest"
            checked={guest.isPrimary === true}
            onChange={onSetPrimary}
          />
          <span style={{ color: NAVY }}>Primary guest</span>
        </label>
        {total > 1 ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
            style={{ color: ERR }}
            aria-label={`Remove guest ${index + 1}`}
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            Remove
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Full name">
          <input
            required
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={guest.fullName}
            onChange={(e) => onChange({ ...guest, fullName: e.target.value })}
          />
        </Field>
        <Field label="Mobile">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={guest.mobile}
            onChange={(e) => onChange({ ...guest, mobile: e.target.value })}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={guest.email}
            onChange={(e) => onChange({ ...guest, email: e.target.value })}
          />
        </Field>

        <Field label="Nationality">
          <CountryPicker
            id={`nat-${index}`}
            value={guest.nationalityCode}
            onChange={(v) => onChange({ ...guest, nationalityCode: v })}
            placeholder="Search country…"
          />
        </Field>
        <Field label="Identity type">
          <select
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={guest.identityType}
            onChange={(e) =>
              onChange({
                ...guest,
                identityType: (e.target.value as GuestDraft["identityType"]) || "",
              })
            }
          >
            <option value="">—</option>
            {IDENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {identityTypeLabel(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={
            guest.identityType === "mykad" || guest.identityType === "mypr"
              ? "Identity number (12 digits)"
              : "Identity number"
          }
        >
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={guest.identityNumber}
            onChange={(e) => onChange({ ...guest, identityNumber: e.target.value })}
            maxLength={50}
            autoComplete="off"
          />
        </Field>

        <Field label="Address line 1">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={guest.addressLine1}
            onChange={(e) => onChange({ ...guest, addressLine1: e.target.value })}
          />
        </Field>
        <Field label="Address line 2">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={guest.addressLine2}
            onChange={(e) => onChange({ ...guest, addressLine2: e.target.value })}
          />
        </Field>
        <Field label="Address line 3">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={guest.addressLine3}
            onChange={(e) => onChange({ ...guest, addressLine3: e.target.value })}
          />
        </Field>

        <Field label="City">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={guest.city}
            onChange={(e) => onChange({ ...guest, city: e.target.value })}
          />
        </Field>
        <Field label="Postcode">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={guest.postcode}
            onChange={(e) => onChange({ ...guest, postcode: e.target.value })}
            maxLength={20}
          />
        </Field>
        <Field label="Country">
          <CountryPicker
            id={`country-${index}`}
            value={guest.countryCode}
            onChange={(v) => onChange(applyGuestCountryChange(guest, v))}
            placeholder="Search country…"
          />
        </Field>

        {isMY ? (
          <Field label="State">
            <select
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={guest.stateCode}
              onChange={(e) => onChange({ ...guest, stateCode: e.target.value, stateProvince: "" })}
            >
              <option value="">—</option>
              {MALAYSIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : guest.countryCode ? (
          <Field label="State / Province">
            <input
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={guest.stateProvince}
              onChange={(e) =>
                onChange({ ...guest, stateProvince: e.target.value, stateCode: "" })
              }
              maxLength={100}
            />
          </Field>
        ) : null}

        <Field label="Guest notes">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={guest.notes}
            onChange={(e) => onChange({ ...guest, notes: e.target.value })}
          />
        </Field>
      </div>
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
        <GuestCard
          key={i}
          guest={g}
          index={i}
          total={guests.length}
          onChange={(next) => onChange(guests.map((x, j) => (j === i ? next : x)))}
          onSetPrimary={() => onChange(setPrimaryGuest(guests, i))}
          onRemove={() => onChange(removeGuestSafe(guests, i))}
        />
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
  externalRef,
  rooms,
  guests,
  notes,
}: {
  arrival: string;
  departure: string;
  bookingSource: string;
  externalRef: string;
  rooms: RoomDraft[];
  guests: GuestDraft[];
  notes: string;
}) {
  const primary = guests.find((g) => g.isPrimary === true);
  const additional = guests.length - (primary ? 1 : 0);
  const extNorm = normalizeExternalBookingReference(externalRef);
  const extDisplay = extNorm.ok ? extNorm.value ?? "—" : "—";
  return (
    <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-[max-content_1fr]">
      <dt className="text-muted-foreground">Stay</dt>
      <dd>
        {formatIsoDate(arrival)} → {formatIsoDate(departure)}
      </dd>
      <dt className="text-muted-foreground">Source</dt>
      <dd>{bookingSource ? bookingSourceLabel(bookingSource) : "—"}</dd>
      <dt className="text-muted-foreground">External reference</dt>
      <dd>{extDisplay}</dd>
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
      <dd>
        {primary?.fullName || "—"}
        {primary?.nationalityCode ? ` · ${countryName(primary.nationalityCode)}` : ""}
      </dd>
      <dt className="text-muted-foreground">Additional guests</dt>
      <dd>{additional}</dd>
      <dt className="text-muted-foreground">Address (primary)</dt>
      <dd>
        {primary
          ? [
              primary.addressLine1,
              primary.addressLine2,
              primary.addressLine3,
              [primary.postcode, primary.city].filter(Boolean).join(" "),
              primary.countryCode === "MYS"
                ? malaysianStateName(primary.stateCode)
                : primary.stateProvince,
              countryName(primary.countryCode),
            ]
              .map((s) => (s ?? "").trim())
              .filter(Boolean)
              .join(", ") || "—"
          : "—"}
      </dd>
      <dt className="text-muted-foreground">Notes</dt>
      <dd>{notes.trim() || "—"}</dd>
    </dl>
  );
}
