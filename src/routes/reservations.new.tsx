import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import {
  useAvailability,
  useBookingSources,
  useCreateReservation,
  tenantSourceLabel,
  type AvailabilityRoomDTO,
} from "@/lib/reservations-client";
import {
  addRoomIfNew,
  applyGuestCountryChange,
  buildCreatePayload,
  emptyGuestDraft,
  EXTERNAL_REF_MAX,
  formatIsoDate,
  friendlyError,
  groupRoomsByFloor,
  makeRoomDraft,
  naturalCompare,
  normalizeExternalBookingReference,
  rateOverrideRequired,
  removeGuestSafe,
  roomLabel,
  setPrimaryGuest,
  UNASSIGNED_FLOOR,
  validateGuests,
  validateRoom,
  validateStayDates,
  type GuestDraft,
  type RoomDraft,
} from "@/lib/reservations-ui";
import {
  clearDraft,
  createDraftScheduler,
  loadDraft,
  saveDraft,
} from "@/lib/reservation-draft";
import { widthContainerClass } from "@/lib/display-preference";

import { MalaysianDateInput } from "@/components/malaysia-date-input";
import { CountryCombobox } from "@/components/country-combobox";
import { countryName } from "@/lib/iso-countries";
import { MALAYSIAN_STATES, malaysianStateName } from "@/lib/malaysia-states";
import { IDENTITY_TYPES, identityTypeLabel } from "@/lib/guest-identity";
import { addDaysIso, todayInKualaLumpurIso } from "@/lib/malaysia-date";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Plus, Save, Trash2, X } from "lucide-react";

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
  const authed = data && data.authenticated === true;
  const role = authed ? data.role : null;
  const canCreate = hasPermission(role, "hotel:reservations:create");
  const tenantId = authed ? data.tenant.tenantId : null;
  const n3UserKey = authed ? data.user.n3UserKey : null;

  return (
    <AppShell>
      <div className="space-y-4" style={{ backgroundColor: SOFT_BG }}>
        <Header />
        {!authed ? null : !canCreate ? (
          <NoAccess />
        ) : tenantId && n3UserKey ? (
          <NewReservationWizard tenantId={tenantId} n3UserKey={n3UserKey} />
        ) : null}
      </div>
    </AppShell>
  );
}

function Header() {
  return (
    <section
      className="rounded-lg p-5 text-white shadow-sm"
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
        className="mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{ backgroundColor: GOLD, color: NAVY }}
      >
        Front Desk
      </span>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New Reservation</h1>
      <p className="mt-1 max-w-2xl text-sm text-white/85">
        Complete the four steps below to book a stay. Your progress is saved automatically.
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

// ---------- Wizard ----------

type Step = 1 | 2 | 3 | 4;
const STEP_LABELS: Record<Step, string> = {
  1: "Stay details",
  2: "Rooms & rates",
  3: "Guests",
  4: "Review & create",
};

function NewReservationWizard({
  tenantId,
  n3UserKey,
}: {
  tenantId: string;
  n3UserKey: string;
}) {
  const navigate = useNavigate();
  const create = useCreateReservation();

  const [today] = useState(() => todayInKualaLumpurIso());
  const [step, setStep] = useState<Step>(1);
  const [arrival, setArrival] = useState<string>(today);
  const [departure, setDeparture] = useState<string>(() => addDaysIso(today, 1));
  const [bookingSource, setBookingSource] = useState<string>("");
  const [externalRef, setExternalRef] = useState("");
  const [notes, setNotes] = useState("");
  const [rooms, setRooms] = useState<RoomDraft[]>([]);
  const [guests, setGuests] = useState<GuestDraft[]>([emptyGuestDraft(true)]);
  const [formError, setFormError] = useState<string | null>(null);
  const [availabilityMsg, setAvailabilityMsg] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<"restored" | "saved" | null>(null);
  const [showDiscard, setShowDiscard] = useState(false);

  // ---------- Draft recovery: load once on mount, scoped by tenant + N3 user. ----------
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const d = loadDraft(tenantId, n3UserKey);
    if (!d) return;
    if (d.arrival) setArrival(d.arrival);
    if (d.departure) setDeparture(d.departure);
    if (d.bookingSource) setBookingSource(d.bookingSource);
    if (d.externalRef) setExternalRef(d.externalRef);
    if (d.notes) setNotes(d.notes);
    if (d.rooms.length > 0) setRooms(d.rooms);
    if (d.guests.length > 0) {
      // identityNumber intentionally left blank; user re-enters.
      setGuests(d.guests.map((g) => ({ ...g, identityNumber: "" })) as GuestDraft[]);
    }
    setStep(d.step as Step);
    setDraftStatus("restored");
    setTimeout(() => setDraftStatus(null), 3000);
  }, [tenantId, n3UserKey]);

  // ---------- Debounced draft save on any state change. ----------
  const scheduler = useRef(createDraftScheduler(400));
  useEffect(() => {
    scheduler.current.schedule(() => {
      const ok = saveDraft({
        tenantId,
        n3UserKey,
        step,
        arrival,
        departure,
        bookingSource,
        externalRef,
        notes,
        rooms,
        guests: guests.map((g) => ({ ...g, identityNumber: "" as const })),
      });
      if (ok) {
        setDraftStatus("saved");
        setTimeout(() => setDraftStatus((s) => (s === "saved" ? null : s)), 1500);
      }
    });
    return () => {
      /* nothing; scheduler is per-effect-safe */
    };
  }, [tenantId, n3UserKey, step, arrival, departure, bookingSource, externalRef, notes, rooms, guests]);

  // ---------- Stay validity ----------
  const stayValid = validateStayDates(arrival, departure, { today });
  const arrivalPast = !!arrival && arrival < today;
  const extRefCheck = normalizeExternalBookingReference(externalRef);
  const availability = useAvailability(arrival, departure, { enabled: stayValid.ok });

  function handleArrivalChange(next: string) {
    setArrival(next);
    if (next && (!departure || departure <= next)) {
      setDeparture(addDaysIso(next, 1));
    }
  }

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

  // ---------- Step completion helpers ----------
  const stayComplete = stayValid.ok && !!bookingSource && extRefCheck.ok;
  const roomsComplete = rooms.length > 0 && rooms.every((r) => validateRoom(r).ok);
  const guestsComplete = validateGuests(guests).ok;

  const canSubmit = stayComplete && roomsComplete && guestsComplete && !create.isPending;

  async function handleSubmit() {
    setFormError(null);
    if (!stayValid.ok) return setFormError(friendlyError(stayValid.code));
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
      clearDraft(tenantId, n3UserKey);
      navigate({ to: "/reservations/$id", params: { id: res.reservationId } });
    } catch (err) {
      const code = (err as { code?: string }).code ?? "reservation_create_failed";
      setFormError(friendlyError(code));
      if (code === "room_not_available") void availability.refetch();
    }
  }

  function goNext() {
    setFormError(null);
    if (step === 1) {
      if (!stayComplete) return setFormError("Please complete the stay details.");
      setStep(2);
    } else if (step === 2) {
      if (!roomsComplete) return setFormError(friendlyError("room_required"));
      setStep(3);
    } else if (step === 3) {
      const v = validateGuests(guests);
      if (!v.ok) return setFormError(friendlyError(v.code));
      setStep(4);
    }
  }
  function goBack() {
    setFormError(null);
    if (step > 1) setStep((step - 1) as Step);
  }

  return (
    <div className="space-y-4">
      <Stepper
        step={step}
        onGoto={setStep}
        complete={{ 1: stayComplete, 2: roomsComplete, 3: guestsComplete, 4: false }}
      />
      <DraftBar
        status={draftStatus}
        onDiscard={() => setShowDiscard(true)}
      />
      {showDiscard ? (
        <DiscardConfirm
          onCancel={() => setShowDiscard(false)}
          onConfirm={() => {
            clearDraft(tenantId, n3UserKey);
            setStep(1);
            setArrival(today);
            setDeparture(addDaysIso(today, 1));
            setBookingSource("");
            setExternalRef("");
            setNotes("");
            setRooms([]);
            setGuests([emptyGuestDraft(true)]);
            setShowDiscard(false);
          }}
        />
      ) : null}

      {step === 1 ? (
        <StayDetailsStep
          today={today}
          arrival={arrival}
          departure={departure}
          arrivalPast={arrivalPast}
          stayValid={stayValid.ok}
          bookingSource={bookingSource}
          externalRef={externalRef}
          extRefCheck={extRefCheck}
          notes={notes}
          onArrivalChange={handleArrivalChange}
          onDepartureChange={setDeparture}
          onSourceChange={setBookingSource}
          onExternalRefChange={setExternalRef}
          onNotesChange={setNotes}
        />
      ) : step === 2 ? (
        <RoomsStep
          availability={availability.data?.rooms ?? []}
          isLoading={availability.isPending}
          error={availability.error?.code ?? null}
          stayValid={stayValid.ok}
          availabilityMsg={availabilityMsg}
          selected={rooms}
          onAdd={(r) => {
            const next = addRoomIfNew(rooms, makeRoomDraft(r));
            setRooms(next.rooms);
          }}
          onChange={setRooms}
          onRefetch={() => availability.refetch()}
        />
      ) : step === 3 ? (
        <GuestsStep guests={guests} onChange={setGuests} />
      ) : (
        <ReviewStep
          arrival={arrival}
          departure={departure}
          bookingSource={bookingSource}
          externalRef={externalRef}
          rooms={rooms}
          guests={guests}
          notes={notes}
        />
      )}

      {formError ? (
        <div
          role="alert"
          className="rounded-md border p-3 text-sm"
          style={{ borderColor: `${ERR}33`, backgroundColor: `${ERR}12`, color: ERR }}
        >
          {formError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 1}
          className="inline-flex items-center gap-1 rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ color: NAVY }}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Back
        </button>
        <div className="flex items-center gap-2">
          <Link
            to="/reservations"
            className="rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium"
            style={{ color: NAVY }}
          >
            Cancel
          </Link>
          {step < 4 ? (
            <button
              type="button"
              onClick={goNext}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white"
              style={{ backgroundColor: NAVY }}
            >
              Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: NAVY }}
            >
              {create.isPending ? "Creating…" : "Create Reservation"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Stepper ----------

function Stepper({
  step,
  onGoto,
  complete,
}: {
  step: Step;
  onGoto: (s: Step) => void;
  complete: Record<Step, boolean>;
}) {
  const steps: Step[] = [1, 2, 3, 4];
  return (
    <nav aria-label="Reservation steps" className="rounded-lg border bg-white p-3 shadow-sm">
      <ol className="flex flex-wrap items-center gap-2">
        {steps.map((n, i) => {
          const active = n === step;
          const isComplete = complete[n];
          const canJump = n < step || (n === step);
          return (
            <li key={n} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (canJump ? onGoto(n) : undefined)}
                disabled={!canJump}
                aria-current={active ? "step" : undefined}
                className="inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-60"
                style={{
                  backgroundColor: active ? NAVY : isComplete ? `${TEAL}18` : "transparent",
                  color: active ? "white" : NAVY,
                }}
              >
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{
                    backgroundColor: active ? "white" : isComplete ? TEAL : `${NAVY}22`,
                    color: active ? NAVY : isComplete ? "white" : NAVY,
                  }}
                >
                  {isComplete && !active ? <Check className="h-3 w-3" aria-hidden /> : n}
                </span>
                {STEP_LABELS[n]}
              </button>
              {i < steps.length - 1 ? (
                <span aria-hidden className="h-px w-4" style={{ backgroundColor: `${NAVY}33` }} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function DraftBar({
  status,
  onDiscard,
}: {
  status: "restored" | "saved" | null;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Save className="h-3 w-3" aria-hidden />
        {status === "restored"
          ? "Draft restored from your last visit."
          : status === "saved"
            ? "Draft saved."
            : "Your progress is saved automatically."}
      </span>
      <button
        type="button"
        onClick={onDiscard}
        className="inline-flex items-center gap-1 rounded border border-input bg-white px-2 py-0.5 text-[11px] font-medium"
        style={{ color: NAVY }}
      >
        <Trash2 className="h-3 w-3" aria-hidden /> Discard draft
      </button>
    </div>
  );
}

function DiscardConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      role="alertdialog"
      className="rounded-md border p-3 text-sm"
      style={{ borderColor: `${ERR}55`, backgroundColor: `${ERR}0F` }}
    >
      <p className="font-semibold" style={{ color: ERR }}>
        Discard this draft?
      </p>
      <p className="mt-1 text-muted-foreground text-xs">
        All fields on this page will be cleared. This can’t be undone.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-input bg-white px-2 py-1 text-xs"
          style={{ color: NAVY }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded px-2 py-1 text-xs font-medium text-white"
          style={{ backgroundColor: ERR }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

// ---------- Field / Card ----------

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm" style={{ borderColor: `${NAVY}22` }}>
      <h2 className="mb-3 text-sm font-semibold" style={{ color: NAVY }}>
        {title}
      </h2>
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

// ---------- Step 1: Stay Details ----------

function StayDetailsStep(props: {
  today: string;
  arrival: string;
  departure: string;
  arrivalPast: boolean;
  stayValid: boolean;
  bookingSource: string;
  externalRef: string;
  extRefCheck: { ok: true; value: string | null } | { ok: false; code: string };
  notes: string;
  onArrivalChange: (v: string) => void;
  onDepartureChange: (v: string) => void;
  onSourceChange: (v: string) => void;
  onExternalRefChange: (v: string) => void;
  onNotesChange: (v: string) => void;
}) {
  const arrivalError = !props.arrival
    ? null
    : props.arrivalPast
      ? friendlyError("arrival_date_in_past")
      : props.stayValid
        ? null
        : "Choose a valid arrival date";
  const departureError = !props.departure
    ? null
    : props.arrivalPast
      ? null
      : props.stayValid
        ? null
        : "Departure must be after arrival";
  return (
    <Card title={STEP_LABELS[1]}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Arrival date" error={arrivalError}>
          <MalaysianDateInput
            value={props.arrival}
            onChange={props.onArrivalChange}
            required
            minIso={props.today}
            pickerLabel="Choose arrival date"
          />
        </Field>
        <Field label="Departure date" error={departureError}>
          <MalaysianDateInput
            value={props.departure}
            onChange={props.onDepartureChange}
            required
            minIso={props.arrival ? addDaysIso(props.arrival, 1) : props.today}
            pickerLabel="Choose departure date"
          />
        </Field>
        <Field label="Booking source">
          <ActiveBookingSourceSelect value={props.bookingSource} onChange={props.onSourceChange} />
        </Field>
        <Field
          label="External booking reference (optional)"
          hint={`OTA/portal booking ID. Max ${EXTERNAL_REF_MAX} characters.`}
          error={props.extRefCheck.ok ? null : friendlyError(props.extRefCheck.code)}
        >
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={props.externalRef}
            onChange={(e) => props.onExternalRefChange(e.target.value)}
            maxLength={EXTERNAL_REF_MAX + 20}
            placeholder="e.g. AGD-12345"
          />
        </Field>
        <Field label="Internal notes (optional)">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={props.notes}
            onChange={(e) => props.onNotesChange(e.target.value)}
            maxLength={500}
          />
        </Field>
      </div>
    </Card>
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

// ---------- Step 2: Rooms ----------

function RoomsStep({
  availability,
  isLoading,
  error,
  stayValid,
  availabilityMsg,
  selected,
  onAdd,
  onChange,
  onRefetch,
}: {
  availability: AvailabilityRoomDTO[];
  isLoading: boolean;
  error: string | null;
  stayValid: boolean;
  availabilityMsg: string | null;
  selected: RoomDraft[];
  onAdd: (r: AvailabilityRoomDTO) => void;
  onChange: (rooms: RoomDraft[]) => void;
  onRefetch: () => void;
}) {
  const [search, setSearch] = useState("");
  const [floor, setFloor] = useState<string>("__all__");
  const [roomType, setRoomType] = useState<string>("__all__");
  const [minCapacity, setMinCapacity] = useState<number>(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(20);

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.hotelRoomId)), [selected]);
  const grouped = useMemo(() => groupRoomsByFloor(availability), [availability]);
  const roomTypes = useMemo(
    () => Array.from(new Set(availability.map((r) => r.roomType))).sort((a, b) => naturalCompare(a, b)),
    [availability],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = availability.filter((r) => {
      if (floor !== "__all__") {
        const rf = (r.floor ?? "").trim() || UNASSIGNED_FLOOR;
        if (rf !== floor) return false;
      }
      if (roomType !== "__all__" && r.roomType !== roomType) return false;
      if (minCapacity > 0 && r.maxOccupancy < minCapacity) return false;
      if (q) {
        const label = roomLabel(r.displayName, r.n3StockName, r.roomNumber).toLowerCase();
        if (
          !label.includes(q) &&
          !r.roomNumber.toLowerCase().includes(q) &&
          !r.n3StockCode.toLowerCase().includes(q) &&
          !(r.n3StockName ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
    // natural sort: floor then label
    list.sort((a, b) => {
      const fa = (a.floor ?? "").trim();
      const fb = (b.floor ?? "").trim();
      const f = naturalCompare(fa || "~unassigned", fb || "~unassigned");
      if (f !== 0) return f;
      return naturalCompare(
        roomLabel(a.displayName, a.n3StockName, a.roomNumber),
        roomLabel(b.displayName, b.n3StockName, b.roomNumber),
      );
    });
    return list;
  }, [availability, search, floor, roomType, minCapacity]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const from = filtered.length === 0 ? 0 : (page - 1) * pageSize;
  const paged = filtered.slice(from, from + pageSize);

  // Reset to page 1 whenever filters change.
  useEffect(() => setPage(1), [search, floor, roomType, minCapacity, pageSize]);

  return (
    <div className={`grid grid-cols-1 gap-4 ${widthContainerClass("full").includes("max-w-none") ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""}`}>
      <Card title={STEP_LABELS[2]}>
        {!stayValid ? (
          <p className="text-xs text-muted-foreground">
            Enter valid arrival and departure dates to load availability.
          </p>
        ) : isLoading ? (
          <p className="text-xs text-muted-foreground">Loading availability…</p>
        ) : error ? (
          <p className="text-xs" style={{ color: ERR }}>
            {friendlyError(error, "Unable to load availability.")}{" "}
            <button type="button" onClick={onRefetch} className="underline">
              Retry
            </button>
          </p>
        ) : (
          <>
            {/* Filter row */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                type="search"
                placeholder="Search room, stock code, or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="min-w-[220px] flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                aria-label="Search rooms"
              />
              <select
                value={roomType}
                onChange={(e) => setRoomType(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                aria-label="Room type"
              >
                <option value="__all__">All types</option>
                {roomTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                Min capacity
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={minCapacity}
                  onChange={(e) => setMinCapacity(Math.max(0, Number(e.target.value) || 0))}
                  className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
              </label>
            </div>

            {/* Floor chips */}
            <FloorChips
              floors={grouped.floors}
              counts={new Map(grouped.floors.map((f) => [f, grouped.byFloor.get(f)?.length ?? 0]))}
              active={floor}
              onChange={setFloor}
              total={availability.length}
            />

            {/* Result table */}
            <div className="mt-3 max-h-[520px] overflow-auto rounded-md border" style={{ borderColor: `${NAVY}22` }}>
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white">
                  <tr className="text-left text-xs uppercase" style={{ color: NAVY }}>
                    <th className="py-2 pl-3 pr-2">Room</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Floor</th>
                    <th className="py-2 pr-2">Max</th>
                    <th className="py-2 pr-2">Base</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                        No rooms match your filters.
                      </td>
                    </tr>
                  ) : null}
                  {paged.map((r, i) => {
                    const already = selectedIds.has(r.hotelRoomId);
                    return (
                      <tr
                        key={r.hotelRoomId}
                        className="border-t border-border/60"
                        style={{ backgroundColor: i % 2 === 1 ? `${TEAL}06` : "white" }}
                      >
                        <td className="py-1.5 pl-3 pr-2">
                          <div className="font-medium" style={{ color: NAVY }}>
                            {roomLabel(r.displayName, r.n3StockName, r.roomNumber)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            <span className="font-mono">{r.roomNumber}</span>
                            {r.n3StockName ? ` · ${r.n3StockName}` : ""}
                          </div>
                        </td>
                        <td className="py-1.5 pr-2 text-xs">{r.roomType}</td>
                        <td className="py-1.5 pr-2 text-xs">{r.floor ?? "—"}</td>
                        <td className="py-1.5 pr-2 text-center text-xs">{r.maxOccupancy}</td>
                        <td className="py-1.5 pr-2 text-xs tabular-nums">
                          {r.currency} {r.baseRate.toFixed(2)}
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          <button
                            type="button"
                            onClick={() => onAdd(r)}
                            disabled={already}
                            className="rounded-md px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                            style={{ backgroundColor: TEAL }}
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

            {/* Pager */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <label className="inline-flex items-center gap-1 text-muted-foreground">
                Rows per page
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as 10 | 20 | 50)}
                  className="rounded border border-input bg-background px-1.5 py-1"
                >
                  {[10, 20, 50].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-muted-foreground">
                {filtered.length === 0
                  ? "0 rooms"
                  : `${from + 1}–${Math.min(filtered.length, from + pageSize)} of ${filtered.length}`}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-input bg-white px-2 py-1 disabled:opacity-40"
                  style={{ color: NAVY }}
                >
                  Prev
                </button>
                <span className="tabular-nums" style={{ color: NAVY }}>
                  Page {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded border border-input bg-white px-2 py-1 disabled:opacity-40"
                  style={{ color: NAVY }}
                >
                  Next
                </button>
              </div>
            </div>

            {availabilityMsg ? (
              <p className="mt-2 text-xs text-muted-foreground">{availabilityMsg}</p>
            ) : null}
          </>
        )}
      </Card>

      <SelectedRoomsPanel rooms={selected} onChange={onChange} />
    </div>
  );
}

function FloorChips({
  floors,
  counts,
  active,
  onChange,
  total,
}: {
  floors: string[];
  counts: Map<string, number>;
  active: string;
  onChange: (v: string) => void;
  total: number;
}) {
  const chip = (id: string, label: string, count: number) => {
    const isActive = active === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onChange(id)}
        aria-pressed={isActive}
        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
        style={{
          borderColor: isActive ? NAVY : `${NAVY}22`,
          backgroundColor: isActive ? NAVY : "white",
          color: isActive ? "white" : NAVY,
        }}
      >
        {label}
        <span
          className="rounded-full px-1 text-[10px]"
          style={{ backgroundColor: isActive ? "rgba(255,255,255,0.2)" : `${NAVY}0F` }}
        >
          {count}
        </span>
      </button>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by floor">
      {chip("__all__", "All floors", total)}
      {floors.map((f) =>
        chip(f, f === UNASSIGNED_FLOOR ? "Unassigned" : `Floor ${f}`, counts.get(f) ?? 0),
      )}
    </div>
  );
}

function SelectedRoomsPanel({
  rooms,
  onChange,
}: {
  rooms: RoomDraft[];
  onChange: (rooms: RoomDraft[]) => void;
}) {
  const totals = useMemo(() => {
    let adults = 0;
    let children = 0;
    let nightly = 0;
    for (const r of rooms) {
      adults += r.adults;
      children += r.children;
      nightly += r.agreedRate;
    }
    return { adults, children, nightly };
  }, [rooms]);

  return (
    <aside
      className="h-fit rounded-lg border bg-white p-3 shadow-sm lg:sticky lg:top-4"
      style={{ borderColor: `${GOLD}55` }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: NAVY }}>
          Selected rooms
        </h3>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ backgroundColor: `${GOLD}22`, color: GOLD }}
        >
          {rooms.length}
        </span>
      </div>
      {rooms.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Pick rooms from the list. Selected rooms appear here.
        </p>
      ) : (
        <ul className="space-y-2">
          {rooms.map((r, i) => (
            <CompactRoomRow
              key={r.hotelRoomId}
              room={r}
              onChange={(next) => onChange(rooms.map((x, j) => (i === j ? next : x)))}
              onRemove={() => onChange(rooms.filter((_, j) => j !== i))}
            />
          ))}
        </ul>
      )}
      <dl className="mt-3 border-t pt-2 text-[11px]" style={{ borderColor: `${NAVY}18` }}>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Adults / Children</dt>
          <dd className="tabular-nums">
            {totals.adults} / {totals.children}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Nightly room total</dt>
          <dd className="tabular-nums font-semibold" style={{ color: NAVY }}>
            {rooms[0]?.currency ?? "MYR"} {totals.nightly.toFixed(2)}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

function CompactRoomRow({
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
    <li className="rounded-md border p-2 text-xs" style={{ borderColor: `${NAVY}22` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold" style={{ color: NAVY }}>
            {roomLabel(room.displayName, room.n3StockName, room.roomNumber)}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {room.floor ? `Fl ${room.floor} · ` : ""}
            {room.roomType} · Max {room.maxOccupancy}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-[11px]"
          style={{ color: ERR }}
          aria-label="Remove room"
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <label className="flex items-center justify-between gap-1">
          <span className="text-muted-foreground">Adults</span>
          <input
            type="number"
            min={1}
            step={1}
            value={room.adults}
            onChange={(e) => onChange({ ...room, adults: parseInt(e.target.value, 10) || 0 })}
            className="w-14 rounded border border-input bg-background px-1 py-0.5 text-right text-xs"
          />
        </label>
        <label className="flex items-center justify-between gap-1">
          <span className="text-muted-foreground">Children</span>
          <input
            type="number"
            min={0}
            step={1}
            value={room.children}
            onChange={(e) => onChange({ ...room, children: parseInt(e.target.value, 10) || 0 })}
            className="w-14 rounded border border-input bg-background px-1 py-0.5 text-right text-xs"
          />
        </label>
        <label className="col-span-2 flex items-center justify-between gap-1">
          <span className="text-muted-foreground">
            Room rate ({room.currency})
            <span className="ml-1 text-[10px]">Base {room.baseRate.toFixed(2)}</span>
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
            className="w-20 rounded border border-input bg-background px-1 py-0.5 text-right text-xs"
            style={{ color: overridden ? GOLD : undefined, fontWeight: overridden ? 600 : 400 }}
          />
        </label>
      </div>
      {overridden ? (
        <input
          className="mt-1 w-full rounded border border-input bg-background px-1.5 py-1 text-xs"
          placeholder="Reason for rate change"
          value={room.rateOverrideReason}
          onChange={(e) => onChange({ ...room, rateOverrideReason: e.target.value })}
          maxLength={200}
        />
      ) : null}
      {err ? (
        <p className="mt-1 text-[11px]" style={{ color: ERR }}>
          {friendlyError(err.code)}
        </p>
      ) : null}
    </li>
  );
}

// ---------- Step 3: Guest Roster ----------

function GuestsStep({
  guests,
  onChange,
}: {
  guests: GuestDraft[];
  onChange: (g: GuestDraft[]) => void;
}) {
  const [active, setActive] = useState<number>(() =>
    Math.max(0, guests.findIndex((g) => g.isPrimary)),
  );
  useEffect(() => {
    if (active >= guests.length) setActive(Math.max(0, guests.length - 1));
  }, [active, guests.length]);

  function addGuest() {
    onChange([...guests, emptyGuestDraft(false)]);
    setActive(guests.length);
  }
  function removeGuest(i: number) {
    // Primary guest cannot be removed while another primary is not set.
    if (guests[i].isPrimary && guests.length > 1) {
      alert("Set another guest as primary before removing this one.");
      return;
    }
    onChange(removeGuestSafe(guests, i));
    if (i <= active) setActive(Math.max(0, active - 1));
  }
  function setPrimary(i: number) {
    onChange(setPrimaryGuest(guests, i));
  }
  function updateGuest(i: number, next: GuestDraft) {
    onChange(guests.map((g, j) => (i === j ? next : g)));
  }

  const g = guests[active];
  return (
    <Card title={STEP_LABELS[3]}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Roster tabs */}
        <div className="rounded-md border p-2" style={{ borderColor: `${NAVY}22` }}>
          <ul className="space-y-1">
            {guests.map((gu, i) => {
              const complete = gu.fullName.trim().length > 0;
              const isActive = i === active;
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => setActive(i)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
                    style={{
                      backgroundColor: isActive ? NAVY : "white",
                      color: isActive ? "white" : NAVY,
                      border: `1px solid ${isActive ? NAVY : NAVY + "22"}`,
                    }}
                  >
                    <span
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                      style={{
                        backgroundColor: complete ? TEAL : `${NAVY}22`,
                        color: complete ? "white" : NAVY,
                      }}
                    >
                      {complete ? <Check className="h-2.5 w-2.5" aria-hidden /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {gu.fullName.trim() || `Guest ${i + 1}`}
                    </span>
                    {gu.isPrimary ? (
                      <span
                        className="rounded-full px-1.5 text-[9px] font-semibold uppercase"
                        style={{
                          backgroundColor: isActive ? "rgba(255,255,255,0.2)" : `${GOLD}22`,
                          color: isActive ? "white" : GOLD,
                        }}
                      >
                        Primary
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={addGuest}
            className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded border border-dashed border-input px-2 py-1 text-xs"
            style={{ color: NAVY }}
          >
            <Plus className="h-3 w-3" aria-hidden />
            Add guest
          </button>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Additional guests are optional. Exactly one primary contact is required.
          </p>
        </div>

        {/* Active guest form */}
        {g ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs font-medium">
                <input
                  type="radio"
                  name="primary-guest"
                  checked={g.isPrimary}
                  onChange={() => setPrimary(active)}
                />
                <span style={{ color: NAVY }}>Primary booking contact</span>
              </label>
              {guests.length > 1 && !g.isPrimary ? (
                <button
                  type="button"
                  onClick={() => removeGuest(active)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
                  style={{ color: ERR }}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                  Remove guest
                </button>
              ) : null}
            </div>
            <GuestForm
              guest={g}
              index={active}
              onChange={(next) => updateGuest(active, next)}
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function GuestForm({
  guest,
  index,
  onChange,
}: {
  guest: GuestDraft;
  index: number;
  onChange: (g: GuestDraft) => void;
}) {
  const isMY = guest.countryCode === "MYS";
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
        <CountryCombobox
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
        hint="Never saved in browser draft — please re-enter each session."
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
        <CountryCombobox
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
            onChange={(e) => onChange({ ...guest, stateProvince: e.target.value, stateCode: "" })}
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
  );
}

// ---------- Step 4: Review ----------

function ReviewStep({
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
  const sourcesQ = useBookingSources({ activeOnly: false });
  const primary = guests.find((g) => g.isPrimary);
  const additional = guests.filter((g) => !g.isPrimary);
  const extNorm = normalizeExternalBookingReference(externalRef);
  const extDisplay = extNorm.ok ? (extNorm.value ?? "—") : "—";
  const nightlyTotal = rooms.reduce((s, r) => s + r.agreedRate, 0);
  return (
    <Card title={STEP_LABELS[4]}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">Stay</dt>
        <dd>
          {formatIsoDate(arrival)} → {formatIsoDate(departure)}
        </dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd>{bookingSource ? tenantSourceLabel(sourcesQ.data?.sources, bookingSource) : "—"}</dd>
        <dt className="text-muted-foreground">External reference</dt>
        <dd>{extDisplay}</dd>
        <dt className="text-muted-foreground">Notes</dt>
        <dd>{notes.trim() || "—"}</dd>
      </dl>
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide" style={{ color: NAVY }}>
        Rooms ({rooms.length}) · Nightly {rooms[0]?.currency ?? "MYR"} {nightlyTotal.toFixed(2)}
      </h3>
      <ul className="mt-1 space-y-1 text-xs">
        {rooms.map((r) => {
          const overridden = rateOverrideRequired(r.baseRate, r.agreedRate);
          return (
            <li key={r.hotelRoomId} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold" style={{ color: NAVY }}>
                {roomLabel(r.displayName, r.n3StockName, r.roomNumber)}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">{r.roomNumber}</span>
              <span>· {r.adults}A/{r.children}C</span>
              <span>
                · {r.currency} {r.agreedRate.toFixed(2)}
                {overridden ? ` (base ${r.baseRate.toFixed(2)})` : ""}
              </span>
              {overridden && r.rateOverrideReason ? (
                <span className="text-muted-foreground">— {r.rateOverrideReason}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide" style={{ color: NAVY }}>
        Primary booking contact
      </h3>
      {primary ? (
        <div className="text-xs">
          <div className="font-medium" style={{ color: NAVY }}>
            {primary.fullName || "—"}
          </div>
          <div className="text-muted-foreground">
            {[primary.mobile, primary.email].filter(Boolean).join(" · ") || "—"}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {[
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
              .join(", ") || "—"}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No primary guest set.</p>
      )}
      <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide" style={{ color: NAVY }}>
        Additional guests ({additional.length})
      </h3>
      {additional.length === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <ul className="text-xs">
          {additional.map((g, i) => (
            <li key={i} className="text-muted-foreground">
              · {g.fullName || `Guest ${i + 2}`}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
