/**
 * Run 5D2.6 §8 — one-page Edit Reservation editor.
 *
 * Capability-driven: `editCapabilities` from the detail API decides what is
 * shown. The API + `hotelhub_update_reservation_v2` remain authoritative.
 *
 * Privacy: stored identity numbers are only ever rendered masked. A
 * replacement number is write-only local state — it is sent once with the
 * mutation and never written into the query cache, URL or browser storage.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import {
  tenantSourceLabel,
  useAvailability,
  useBookingSources,
  useReservationDetail,
  submitReservationFullUpdate,
  useInvalidateReservationUpdate,
  type AvailabilityRoomDTO,
  type ReservationDetailDTO,
  type ReservationEditCapabilitiesDTO,
  type UpdateReservationFullPayload,
} from "@/lib/reservations-client";
import { MalaysianDateInput } from "@/components/malaysia-date-input";
import { CountryCombobox } from "@/components/country-combobox";
import { MALAYSIAN_STATES } from "@/lib/malaysia-states";
import { addDaysIso } from "@/lib/malaysia-date";
import { useIdempotentRequestId } from "@/lib/idempotency";
import { buildSafeUpdateSignature, newIdentityRevision } from "@/lib/reservation-update-signature";
import {
  EXTERNAL_REF_MAX,
  friendlyError,
  normalizeExternalBookingReference,
  rateOverrideRequired,
  roomLabel,
  ROOM_REMARK_MAX,
} from "@/lib/reservations-ui";
import { IDENTITY_TYPES, identityTypeLabel } from "@/lib/guest-identity";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const SOFT_BG = "#F4F8FC";
const ERR = "#C2413B";

export const Route = createFileRoute("/reservations/$id_/edit")({
  head: () => ({
    meta: [
      { title: "Edit Reservation — HotelHub" },
      { name: "description", content: "Edit reservation stay, rooms and guests in one page." },
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
  const canEdit = hasPermission(role, "hotel:reservations:edit");
  const query = useReservationDetail(id);

  return (
    <AppShell>
      <div className="space-y-4" style={{ backgroundColor: SOFT_BG }}>
        {data?.authenticated !== true ? null : !canEdit ? (
          <>
            <Header id={id} reference="" status="" role={role} notice="" />
            <NoAccess />
          </>
        ) : query.isPending ? (
          <p className="text-sm text-muted-foreground">Loading reservation…</p>
        ) : query.error ? (
          <p className="text-sm text-destructive">
            {friendlyError(query.error.code, "Unable to load this reservation.")}
          </p>
        ) : query.data ? (
          <EditForm
            id={id}
            data={query.data.reservation}
            capabilities={query.data.editCapabilities}
            role={role}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

function roleLabel(role: string | null): string {
  if (role === "owner") return "Owner";
  if (role === "front_desk") return "Front Desk";
  if (role === "housekeeper") return "Housekeeping";
  return "Staff";
}

function modeNotice(caps: ReservationEditCapabilitiesDTO): string {
  switch (caps.mode) {
    case "full":
      return "Full editing is available before check-in: stay details, rooms, guests and room assignments.";
    case "contact":
      return "After check-in your Guest Controls policy allows contact corrections only: mobile, email and guest notes.";
    case "owner_correction":
      return "Owner correction after check-in: guest details only, and a correction reason is required. Stay and room inventory stay unchanged.";
    default:
      return "This reservation is read-only.";
  }
}

function lockedMessage(reasonCode: string | null): string {
  switch (reasonCode) {
    case "reservation_checked_out":
      return "This reservation is already checked out and can no longer be edited.";
    case "reservation_cancelled":
      return "This reservation was cancelled and can no longer be edited.";
    case "reservation_no_show":
      return "This reservation is marked no-show and can no longer be edited.";
    case "guest_edit_locked":
      return "Guest changes are locked after check-in by your Guest Controls policy. Ask the Owner to make a correction.";
    case "role_not_permitted":
      return "Your role cannot edit reservations.";
    default:
      return "This reservation cannot be edited right now.";
  }
}

function Header({
  id,
  reference,
  status,
  role,
  notice,
}: {
  id: string;
  reference: string;
  status: string;
  role: string | null;
  notice: string;
}) {
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
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ backgroundColor: GOLD, color: NAVY }}
        >
          {roleLabel(role)}
        </span>
        {status ? (
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            {status.replace(/_/g, " ")}
          </span>
        ) : null}
        {reference ? (
          <span className="break-all font-mono text-xs text-white/85">{reference}</span>
        ) : null}
      </div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Edit Reservation</h1>
      {notice ? <p className="mt-1 max-w-2xl text-sm text-white/85">{notice}</p> : null}
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
      <p className="mt-1 text-muted-foreground">Only Owner and Front Desk can edit reservations.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft state
// ---------------------------------------------------------------------------
type RoomDraftState = {
  clientKey: string;
  reservationRoomId: string | null;
  hotelRoomId: string;
  label: string;
  baseRate: number;
  maxOccupancy: number;
  agreedRate: number;
  adults: number;
  children: number;
  rateOverrideReason: string;
  remark: string;
};

type GuestDraftState = {
  clientKey: string;
  reservationGuestId: string | null;
  fullName: string;
  mobile: string;
  email: string;
  notes: string;
  nationalityCode: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  city: string;
  postcode: string;
  countryCode: string;
  stateCode: string;
  stateProvince: string;
  isPrimary: boolean;
  assignedRoomClientKey: string;
  identityMasked: string | null;
  identityTypeExisting: string | null;
  identityAction: "keep" | "replace" | "clear";
  /** Write-only: never cached, never rendered back from the server. */
  identityType: string;
  identityNumber: string;
  /**
   * Opaque, client-only revision token. Rotated whenever the replacement
   * identity input or action changes so the idempotency signature can react
   * to an identity change WITHOUT ever containing the number itself.
   * Never sent to the server.
   */
  identityRevision: string;
};

let keySeq = 0;
function newKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}-${keySeq}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildRoomDrafts(data: ReservationDetailDTO): RoomDraftState[] {
  return data.rooms.map((r) => ({
    clientKey: `rr-${r.id}`,
    reservationRoomId: r.id,
    hotelRoomId: r.hotelRoomId,
    label: roomLabel(r.displayName, r.n3StockName, r.roomNumber),
    baseRate: Number(r.baseRateSnapshot),
    maxOccupancy: Number(r.maxOccupancy) || 0,
    agreedRate: Number(r.agreedRate),
    adults: r.adults,
    children: r.children,
    rateOverrideReason: r.rateOverrideReason ?? "",
    remark: r.remark ?? "",
  }));
}

function buildGuestDrafts(data: ReservationDetailDTO): GuestDraftState[] {
  return data.guests.map((g) => ({
    clientKey: `rg-${g.id}`,
    reservationGuestId: g.id,
    fullName: g.fullName,
    mobile: g.mobile ?? "",
    email: g.email ?? "",
    notes: g.notes ?? "",
    nationalityCode: g.nationalityCode ?? "",
    addressLine1: g.addressLine1 ?? "",
    addressLine2: g.addressLine2 ?? "",
    addressLine3: g.addressLine3 ?? "",
    city: g.city ?? "",
    postcode: g.postcode ?? "",
    countryCode: g.countryCode ?? "",
    stateCode: g.stateCode ?? "",
    stateProvince: g.stateProvince ?? "",
    isPrimary: g.isPrimary,
    assignedRoomClientKey: g.assignedReservationRoomId ? `rr-${g.assignedReservationRoomId}` : "",
    identityMasked: g.identityNumberMasked,
    identityTypeExisting: g.identityType,
    identityAction: "keep",
    identityType: "",
    identityNumber: "",
    identityRevision: newIdentityRevision(),
  }));
}

function EditForm({
  id,
  data,
  capabilities,
  role,
}: {
  id: string;
  data: ReservationDetailDTO;
  capabilities: ReservationEditCapabilitiesDTO;
  role: string | null;
}) {
  const navigate = useNavigate();
  const invalidateAfterUpdate = useInvalidateReservationUpdate(id);
  const [saving, setSaving] = useState(false);
  const sourcesQ = useBookingSources({ activeOnly: true });
  const sources = sourcesQ.data?.sources ?? [];
  const requestId = useIdempotentRequestId();

  const full = capabilities.mode === "full";
  const contactOnly = capabilities.mode === "contact";
  const ownerCorrection = capabilities.mode === "owner_correction";

  const [arrival, setArrival] = useState(data.arrivalDate);
  const [departure, setDeparture] = useState(data.departureDate);
  const [bookingSource, setBookingSource] = useState(data.bookingSource);
  const [externalRef, setExternalRef] = useState(data.externalBookingReference ?? "");
  const [notes, setNotes] = useState(data.notes ?? "");
  const [correctionReason, setCorrectionReason] = useState("");
  const [rooms, setRooms] = useState<RoomDraftState[]>(() => buildRoomDrafts(data));
  const [guests, setGuests] = useState<GuestDraftState[]>(() => buildGuestDrafts(data));
  const [errors, setErrors] = useState<string[]>([]);

  // Re-seed the draft when the authoritative version changes underneath an
  // untouched form. A dirty form is never silently overwritten.
  const baseVersion = useRef(data.updatedAt);
  const dirty = useRef(false);
  useEffect(() => {
    if (data.updatedAt === baseVersion.current) return;
    baseVersion.current = data.updatedAt;
    if (dirty.current) return;
    setArrival(data.arrivalDate);
    setDeparture(data.departureDate);
    setBookingSource(data.bookingSource);
    setExternalRef(data.externalBookingReference ?? "");
    setNotes(data.notes ?? "");
    setRooms(buildRoomDrafts(data));
    setGuests(buildGuestDrafts(data));
  }, [data]);

  function markDirty() {
    dirty.current = true;
  }

  const availabilityQ = useAvailability(arrival, departure, {
    enabled: full,
    excludeReservationId: id,
  });
  const availableRooms: AvailabilityRoomDTO[] = availabilityQ.data?.rooms ?? [];
  const selectedHotelRoomIds = new Set(rooms.map((r) => r.hotelRoomId));
  const addableRooms = availableRooms.filter((r) => !selectedHotelRoomIds.has(r.hotelRoomId));

  const extCheck = useMemo(() => normalizeExternalBookingReference(externalRef), [externalRef]);

  const perRoomGuests: Record<string, number> = {};
  for (const g of guests) {
    if (g.assignedRoomClientKey) {
      perRoomGuests[g.assignedRoomClientKey] = (perRoomGuests[g.assignedRoomClientKey] ?? 0) + 1;
    }
  }
  const overCapacityRooms = rooms.filter((r) => (perRoomGuests[r.clientKey] ?? 0) > r.maxOccupancy);
  const unassignedGuests = guests.filter(
    (g) => !g.assignedRoomClientKey || !rooms.some((r) => r.clientKey === g.assignedRoomClientKey),
  );
  const primaryCount = guests.filter((g) => g.isPrimary).length;

  function validate(): string[] {
    const out: string[] = [];
    if (full) {
      if (!bookingSource) out.push("Choose a booking source.");
      if (!arrival || !departure || departure <= arrival)
        out.push(friendlyError("invalid_stay_dates", "Departure must be after arrival."));
      if (!extCheck.ok) out.push(friendlyError(extCheck.code));
      if (rooms.length === 0) out.push("Add at least one room.");
      for (const r of rooms) {
        if (!Number.isInteger(r.adults) || r.adults < 1)
          out.push(`${r.label}: adults must be at least 1.`);
        if (!Number.isInteger(r.children) || r.children < 0)
          out.push(`${r.label}: children cannot be negative.`);
        if (r.maxOccupancy > 0 && r.adults + r.children > r.maxOccupancy)
          out.push(`${r.label}: occupancy exceeds the room maximum of ${r.maxOccupancy}.`);
        if (!Number.isFinite(r.agreedRate) || r.agreedRate < 0)
          out.push(`${r.label}: agreed rate is invalid.`);
        if (
          rateOverrideRequired(r.baseRate, r.agreedRate) &&
          r.rateOverrideReason.trim().length === 0
        )
          out.push(`${r.label}: a rate override reason is required.`);
        if (r.remark.trim().length > ROOM_REMARK_MAX) out.push(`${r.label}: remark is too long.`);
      }
    }
    if (guests.length === 0) out.push("At least one guest is required.");
    if (primaryCount !== 1) out.push("Choose exactly one primary guest.");
    for (const g of guests) {
      if (!g.fullName.trim()) out.push("Every guest needs a full name.");
      if (g.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email.trim()))
        out.push(`${g.fullName || "Guest"}: email address is invalid.`);
      if (g.identityAction === "replace") {
        if (!g.identityType || !g.identityNumber.trim())
          out.push(`${g.fullName || "Guest"}: enter the new identity type and number.`);
        else if (
          (g.identityType === "mykad" || g.identityType === "mypr") &&
          !/^\d{12}$/.test(g.identityNumber.replace(/[\s-]/g, ""))
        )
          out.push(`${g.fullName || "Guest"}: MyKad/MyPR must be 12 digits.`);
      }
    }
    if (unassignedGuests.length > 0) out.push("Assign every guest to a room.");
    if (overCapacityRooms.length > 0)
      out.push(
        `Over capacity: ${overCapacityRooms.map((r) => r.label).join(", ")}. Move guests before saving.`,
      );
    if (capabilities.correctionReasonRequired && correctionReason.trim().length === 0)
      out.push("A correction reason is required.");
    return out;
  }

  const blockingIssues =
    unassignedGuests.length > 0 ||
    overCapacityRooms.length > 0 ||
    primaryCount !== 1 ||
    (capabilities.correctionReasonRequired && correctionReason.trim().length === 0);

  function buildPayload(clientRequestId: string): UpdateReservationFullPayload {
    return {
      clientRequestId,
      expectedUpdatedAt: data.updatedAt,
      bookingSource: full ? bookingSource : data.bookingSource,
      arrivalDate: full ? arrival : data.arrivalDate,
      departureDate: full ? departure : data.departureDate,
      notes: full ? notes.trim() || null : data.notes,
      externalBookingReference: full
        ? extCheck.ok
          ? extCheck.value
          : null
        : data.externalBookingReference,
      correctionReason: correctionReason.trim() || null,
      rooms: rooms.map((r) => ({
        clientKey: r.clientKey,
        reservationRoomId: r.reservationRoomId,
        hotelRoomId: r.hotelRoomId,
        agreedRate: r.agreedRate,
        adults: r.adults,
        children: r.children,
        rateOverrideReason: rateOverrideRequired(r.baseRate, r.agreedRate)
          ? r.rateOverrideReason.trim() || null
          : null,
        remark: r.remark.trim() || null,
      })),
      guests: guests.map((g) => ({
        clientKey: g.clientKey,
        reservationGuestId: g.reservationGuestId,
        fullName: g.fullName.trim(),
        mobile: g.mobile.trim() || null,
        email: g.email.trim() || null,
        notes: g.notes.trim() || null,
        nationalityCode: g.nationalityCode.trim() || null,
        addressLine1: g.addressLine1.trim() || null,
        addressLine2: g.addressLine2.trim() || null,
        addressLine3: g.addressLine3.trim() || null,
        city: g.city.trim() || null,
        postcode: g.postcode.trim() || null,
        countryCode: g.countryCode.trim() || null,
        stateCode: g.countryCode === "MYS" ? g.stateCode.trim() || null : null,
        stateProvince: g.countryCode === "MYS" ? null : g.stateProvince.trim() || null,
        isPrimary: g.isPrimary,
        assignedRoomClientKey: g.assignedRoomClientKey || null,
        identityAction: g.identityAction,
        identityType: g.identityAction === "replace" ? g.identityType || null : null,
        identityNumber: g.identityAction === "replace" ? g.identityNumber.trim() || null : null,
      })),
    };
  }

  /**
   * Safe idempotency signature (Run 5D2.7 §5.3). Built field by field from
   * non-sensitive values only — a replacement identity number NEVER enters
   * it; each guest contributes its opaque `identityRevision` instead.
   */
  function safeSignature(): string {
    return buildSafeUpdateSignature({
      reservationId: id,
      expectedUpdatedAt: data.updatedAt,
      bookingSource: full ? bookingSource : data.bookingSource,
      arrivalDate: full ? arrival : data.arrivalDate,
      departureDate: full ? departure : data.departureDate,
      notes: full ? notes.trim() || null : data.notes,
      externalBookingReference: full
        ? extCheck.ok
          ? extCheck.value
          : null
        : data.externalBookingReference,
      correctionReason: correctionReason.trim() || null,
      rooms: rooms.map((r) => ({
        clientKey: r.clientKey,
        reservationRoomId: r.reservationRoomId,
        hotelRoomId: r.hotelRoomId,
        agreedRate: r.agreedRate,
        adults: r.adults,
        children: r.children,
        rateOverrideReason: rateOverrideRequired(r.baseRate, r.agreedRate)
          ? r.rateOverrideReason.trim() || null
          : null,
        remark: r.remark.trim() || null,
      })),
      guests: guests.map((g) => ({
        clientKey: g.clientKey,
        reservationGuestId: g.reservationGuestId,
        fullName: g.fullName.trim(),
        mobile: g.mobile.trim() || null,
        email: g.email.trim() || null,
        notes: g.notes.trim() || null,
        nationalityCode: g.nationalityCode.trim() || null,
        addressLine1: g.addressLine1.trim() || null,
        addressLine2: g.addressLine2.trim() || null,
        addressLine3: g.addressLine3.trim() || null,
        city: g.city.trim() || null,
        postcode: g.postcode.trim() || null,
        countryCode: g.countryCode.trim() || null,
        stateCode: g.countryCode === "MYS" ? g.stateCode.trim() || null : null,
        stateProvince: g.countryCode === "MYS" ? null : g.stateProvince.trim() || null,
        isPrimary: g.isPrimary,
        assignedRoomClientKey: g.assignedRoomClientKey || null,
        identityAction: g.identityAction,
        identityType: g.identityAction === "replace" ? g.identityType || null : null,
        identityRevision: g.identityRevision,
      })),
    });
  }

  async function submit() {
    const issues = validate();
    setErrors(issues);
    if (issues.length > 0) return;
    const clientRequestId = requestId.get(safeSignature());
    setSaving(true);
    try {
      // The payload (which may carry a write-only replacement number) is
      // created here, sent once, and never handed to React Query.
      const result = await submitReservationFullUpdate(id, buildPayload(clientRequestId));
      requestId.rotate();
      // Authoritative success: drop the replacement values from memory.
      setGuests((prev) =>
        prev.map((g) => ({
          ...g,
          identityNumber: "",
          identityRevision: newIdentityRevision(),
        })),
      );
      invalidateAfterUpdate();
      toast.success(result.replayed ? "Changes already applied." : "Reservation updated.");
      navigate({ to: "/reservations/$id", params: { id } });
    } catch (err) {
      const code = (err as { code?: string }).code ?? "reservation_update_failed";
      if (code === "network_error") {
        // Keep the request ID so a retry of the same payload is a safe replay.
        setErrors(["We couldn’t reach the server. Please retry — your changes are not lost."]);
        return;
      }
      requestId.rotate();
      if (code === "stale_reservation") {
        setErrors([
          "Someone else changed this reservation while you were editing. Reload before saving so their changes are not overwritten.",
        ]);
        return;
      }
      if (code === "room_unavailable") {
        await availabilityQ.refetch();
        setErrors([
          "One of the selected rooms is no longer available for these dates. Choose another room.",
        ]);
        return;
      }
      setErrors([editErrorMessage(code)]);
    } finally {
      setSaving(false);
    }
  }

  if (capabilities.mode === "none" || !capabilities.canOpenEditor) {
    return (
      <>
        <Header
          id={id}
          reference={data.bookingReference}
          status={data.status}
          role={role}
          notice=""
        />
        <section className="rounded-md border bg-white p-5 text-sm">
          <h2 className="font-semibold" style={{ color: NAVY }}>
            This reservation is read-only
          </h2>
          <p className="mt-1 text-muted-foreground">{lockedMessage(capabilities.reasonCode)}</p>
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
      </>
    );
  }

  const readOnlyStay = !full;

  return (
    <>
      <Header
        id={id}
        reference={data.bookingReference}
        status={data.status}
        role={role}
        notice={modeNotice(capabilities)}
      />

      {errors.length > 0 ? (
        <div
          role="alert"
          className="rounded-md border p-3 text-sm"
          style={{ borderColor: `${ERR}33`, backgroundColor: `${ERR}12`, color: ERR }}
        >
          <p className="font-semibold">Please fix the following</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ------------------------------ Stay ------------------------------ */}
      <section
        className="rounded-lg border bg-white p-4 shadow-sm"
        style={{ borderColor: `${NAVY}22` }}
      >
        <h2 className="mb-3 text-sm font-semibold" style={{ color: NAVY }}>
          Stay details
        </h2>
        {readOnlyStay ? (
          <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <ReadOnlyField label="Arrival" value={formatMy(data.arrivalDate)} />
            <ReadOnlyField label="Departure" value={formatMy(data.departureDate)} />
            <ReadOnlyField
              label="Booking source"
              value={tenantSourceLabel(sources, data.bookingSource)}
            />
            <ReadOnlyField
              label="External reference"
              value={data.externalBookingReference ?? "—"}
            />
            <ReadOnlyField label="Notes" value={data.notes ?? "—"} />
          </dl>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block font-medium" style={{ color: NAVY }}>
                Arrival date
              </span>
              <MalaysianDateInput
                value={arrival}
                onChange={(next) => {
                  markDirty();
                  setArrival(next);
                  if (next && (!departure || departure <= next)) setDeparture(addDaysIso(next, 1));
                }}
                required
                pickerLabel="Choose arrival date"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium" style={{ color: NAVY }}>
                Departure date
              </span>
              <MalaysianDateInput
                value={departure}
                onChange={(v) => {
                  markDirty();
                  setDeparture(v);
                }}
                required
                minIso={arrival ? addDaysIso(arrival, 1) : undefined}
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
                onChange={(e) => {
                  markDirty();
                  setBookingSource(e.target.value);
                }}
                disabled={sourcesQ.isPending}
              >
                <option value="">{sourcesQ.isPending ? "Loading…" : "Select a source…"}</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.sourceCode}>
                    {s.displayName}
                  </option>
                ))}
                {/* An inactive historical source stays selectable, unchanged. */}
                {data.bookingSource && !sources.some((s) => s.sourceCode === data.bookingSource) ? (
                  <option value={data.bookingSource}>
                    {tenantSourceLabel(sources, data.bookingSource)} (inactive)
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
                onChange={(e) => {
                  markDirty();
                  setExternalRef(e.target.value);
                }}
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
                onChange={(e) => {
                  markDirty();
                  setNotes(e.target.value);
                }}
                maxLength={500}
              />
            </label>
          </div>
        )}
      </section>

      {/* ------------------------------ Rooms ----------------------------- */}
      <section
        className="rounded-lg border bg-white p-4 shadow-sm"
        style={{ borderColor: `${TEAL}33` }}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
            Rooms &amp; rates
          </h2>
          {full ? (
            <p className="text-[11px] text-muted-foreground">
              {availabilityQ.isFetching
                ? "Checking availability…"
                : `${addableRooms.length} more room(s) available`}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Read-only after check-in — use an approved operation request.
            </p>
          )}
        </div>
        <ul className="space-y-2">
          {rooms.map((r, i) => (
            <RoomRow
              key={r.clientKey}
              room={r}
              guestCount={perRoomGuests[r.clientKey] ?? 0}
              currency={data.currency}
              readOnly={!full}
              canRemove={full && rooms.length > 1}
              onChange={(next) => {
                markDirty();
                setRooms(rooms.map((x, j) => (i === j ? next : x)));
              }}
              onRemove={() => {
                if (!window.confirm(`Remove ${r.label} from this reservation?`)) {
                  return;
                }
                markDirty();
                setRooms(rooms.filter((_, j) => j !== i));
                setGuests((gs) =>
                  gs.map((g) =>
                    g.assignedRoomClientKey === r.clientKey
                      ? { ...g, assignedRoomClientKey: "" }
                      : g,
                  ),
                );
              }}
            />
          ))}
        </ul>

        {full ? (
          <div className="mt-3">
            <label className="block text-xs">
              <span className="mb-1 block font-medium" style={{ color: NAVY }}>
                Add a room
              </span>
              <select
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm sm:max-w-md"
                value=""
                onChange={(e) => {
                  const hit = addableRooms.find((a) => a.hotelRoomId === e.target.value);
                  if (!hit) return;
                  markDirty();
                  setRooms((prev) => [
                    ...prev,
                    {
                      clientKey: newKey("new-room"),
                      reservationRoomId: null,
                      hotelRoomId: hit.hotelRoomId,
                      label: roomLabel(hit.displayName, hit.n3StockName, hit.roomNumber),
                      baseRate: Number(hit.baseRate),
                      maxOccupancy: Number(hit.maxOccupancy) || 0,
                      agreedRate: Number(hit.baseRate),
                      adults: 1,
                      children: 0,
                      rateOverrideReason: "",
                      remark: "",
                    },
                  ]);
                }}
                disabled={addableRooms.length === 0}
              >
                <option value="">
                  {addableRooms.length === 0
                    ? "No other rooms available for these dates"
                    : "Choose an available room…"}
                </option>
                {addableRooms.map((a) => (
                  <option key={a.hotelRoomId} value={a.hotelRoomId}>
                    {roomLabel(a.displayName, a.n3StockName, a.roomNumber)} · max {a.maxOccupancy} ·{" "}
                    {a.currency} {Number(a.baseRate).toFixed(2)}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-2">
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Plus className="h-3 w-3" aria-hidden /> Newly added rooms can be assigned to guests
                immediately.
              </span>
            </div>
          </div>
        ) : null}
      </section>

      {/* ------------------------------ Guests ---------------------------- */}
      <section
        className="rounded-lg border bg-white p-4 shadow-sm"
        style={{ borderColor: `${GOLD}55` }}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
            Guests &amp; room assignment
          </h2>
          {capabilities.canAddRemoveGuests ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs font-medium"
              style={{ color: NAVY }}
              onClick={() => {
                markDirty();
                setGuests((prev) => [
                  ...prev,
                  {
                    clientKey: newKey("new-guest"),
                    reservationGuestId: null,
                    fullName: "",
                    mobile: "",
                    email: "",
                    notes: "",
                    nationalityCode: "",
                    addressLine1: "",
                    addressLine2: "",
                    addressLine3: "",
                    city: "",
                    postcode: "",
                    countryCode: "",
                    stateCode: "",
                    stateProvince: "",
                    isPrimary: prev.length === 0,
                    assignedRoomClientKey: rooms[0]?.clientKey ?? "",
                    identityMasked: null,
                    identityTypeExisting: null,
                    identityAction: "replace",
                    identityType: "",
                    identityNumber: "",
                    identityRevision: newIdentityRevision(),
                  },
                ]);
              }}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add guest
            </button>
          ) : null}
        </div>

        <div className="space-y-3">
          {guests.map((g, i) => (
            <GuestCard
              key={g.clientKey}
              guest={g}
              rooms={rooms}
              capabilities={capabilities}
              contactOnly={contactOnly}
              canRemove={capabilities.canAddRemoveGuests && guests.length > 1}
              onChange={(next) => {
                markDirty();
                setGuests(guests.map((x, j) => (i === j ? next : x)));
              }}
              onMakePrimary={() => {
                markDirty();
                setGuests(guests.map((x, j) => ({ ...x, isPrimary: i === j })));
              }}
              onRemove={() => {
                if (!window.confirm(`Remove ${g.fullName || "this guest"} from the reservation?`))
                  return;
                markDirty();
                const remaining = guests.filter((_, j) => j !== i);
                if (!remaining.some((x) => x.isPrimary) && remaining[0])
                  remaining[0] = { ...remaining[0], isPrimary: true };
                setGuests(remaining);
              }}
            />
          ))}
        </div>
      </section>

      {capabilities.correctionReasonRequired ? (
        <section
          className="rounded-lg border bg-white p-4 shadow-sm"
          style={{ borderColor: `${GOLD}66` }}
        >
          <label className="block text-xs font-medium" style={{ color: NAVY }}>
            Correction reason (required)
            <textarea
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: `${NAVY}33` }}
              rows={2}
              maxLength={300}
              value={correctionReason}
              onChange={(e) => {
                markDirty();
                setCorrectionReason(e.target.value);
              }}
              placeholder="Why is this correction being made?"
            />
          </label>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pb-6">
        <Link
          to="/reservations/$id"
          params={{ id }}
          className="rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium"
          style={{ color: NAVY }}
        >
          Discard changes
        </Link>
        <button
          type="button"
          onClick={submit}
          disabled={saving || blockingIssues}
          className="inline-flex items-center gap-1 rounded-md px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: NAVY }}
        >
          <Save className="h-3.5 w-3.5" aria-hidden />
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
      {ownerCorrection && !capabilities.canChangePrimaryGuest ? (
        <p className="pb-6 text-[11px] text-muted-foreground">
          Primary guest changes after check-in are disabled in Guest Controls.
        </p>
      ) : null}
    </>
  );
}

function formatMy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium" style={{ color: NAVY }}>
        {value}
      </dd>
    </div>
  );
}

function RoomRow({
  room,
  guestCount,
  currency,
  readOnly,
  canRemove,
  onChange,
  onRemove,
}: {
  room: RoomDraftState;
  guestCount: number;
  currency: string;
  readOnly: boolean;
  canRemove: boolean;
  onChange: (r: RoomDraftState) => void;
  onRemove: () => void;
}) {
  const overridden = rateOverrideRequired(room.baseRate, room.agreedRate);
  const over = guestCount > room.maxOccupancy;
  return (
    <li className="rounded-md border p-3 text-xs" style={{ borderColor: `${NAVY}22` }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-words font-semibold" style={{ color: NAVY }}>
            {room.label}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Base {currency} {room.baseRate.toFixed(2)} · Max guests {room.maxOccupancy} · Assigned{" "}
            <span style={over ? { color: ERR, fontWeight: 600 } : undefined}>{guestCount}</span>
          </div>
        </div>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded border border-input px-2 py-1 text-[11px]"
            style={{ color: ERR }}
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            Remove
          </button>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="mb-0.5 block text-muted-foreground">Adults</span>
          <input
            type="number"
            min={1}
            step={1}
            disabled={readOnly}
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
            disabled={readOnly}
            value={room.children}
            onChange={(e) => onChange({ ...room, children: parseInt(e.target.value, 10) || 0 })}
            className="w-full rounded border border-input bg-background px-1 py-0.5 text-right"
          />
        </label>
        <label className="col-span-2 block">
          <span className="mb-0.5 block text-muted-foreground">Agreed rate ({currency})</span>
          <input
            type="number"
            min={0}
            step="0.01"
            disabled={readOnly}
            value={room.agreedRate}
            onChange={(e) => onChange({ ...room, agreedRate: Number(e.target.value) })}
            className="w-full rounded border border-input bg-background px-1 py-0.5 text-right"
          />
        </label>
      </div>
      {!readOnly && overridden ? (
        <label className="mt-2 block">
          <span className="mb-0.5 block text-muted-foreground">Rate override reason</span>
          <input
            value={room.rateOverrideReason}
            onChange={(e) => onChange({ ...room, rateOverrideReason: e.target.value })}
            maxLength={300}
            className="w-full rounded border border-input bg-background px-2 py-1"
          />
        </label>
      ) : null}
      {!readOnly ? (
        <label className="mt-2 block">
          <span className="mb-0.5 block text-muted-foreground">Room remark</span>
          <input
            value={room.remark}
            onChange={(e) => onChange({ ...room, remark: e.target.value })}
            maxLength={ROOM_REMARK_MAX}
            className="w-full rounded border border-input bg-background px-2 py-1"
          />
        </label>
      ) : null}
    </li>
  );
}

function GuestCard({
  guest,
  rooms,
  capabilities,
  contactOnly,
  canRemove,
  onChange,
  onMakePrimary,
  onRemove,
}: {
  guest: GuestDraftState;
  rooms: RoomDraftState[];
  capabilities: ReservationEditCapabilitiesDTO;
  contactOnly: boolean;
  canRemove: boolean;
  onChange: (g: GuestDraftState) => void;
  onMakePrimary: () => void;
  onRemove: () => void;
}) {
  const isNew = guest.reservationGuestId === null;
  const identityEditable = capabilities.canEditGuestIdentity && !contactOnly;
  const detailsEditable = !contactOnly;
  const assignEditable = capabilities.canAssignGuestRooms && !contactOnly;

  return (
    <div className="rounded-md border p-3 text-xs" style={{ borderColor: `${NAVY}22` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="primary-guest"
            checked={guest.isPrimary}
            disabled={!capabilities.canChangePrimaryGuest && !guest.isPrimary}
            onChange={onMakePrimary}
          />
          <span className="font-semibold" style={{ color: NAVY }}>
            Primary guest
          </span>
        </label>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded border border-input px-2 py-1 text-[11px]"
            style={{ color: ERR }}
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            Remove guest
          </button>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Full name">
          <input
            className="w-full rounded border border-input bg-background px-2 py-1"
            value={guest.fullName}
            disabled={!detailsEditable}
            maxLength={120}
            onChange={(e) => onChange({ ...guest, fullName: e.target.value })}
          />
        </Field>
        <Field label="Mobile">
          <input
            className="w-full rounded border border-input bg-background px-2 py-1"
            value={guest.mobile}
            maxLength={30}
            onChange={(e) => onChange({ ...guest, mobile: e.target.value })}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            className="w-full rounded border border-input bg-background px-2 py-1"
            value={guest.email}
            maxLength={255}
            onChange={(e) => onChange({ ...guest, email: e.target.value })}
          />
        </Field>
        <Field label="Nationality">
          <CountryCombobox
            value={guest.nationalityCode}
            onChange={(v) => onChange({ ...guest, nationalityCode: v })}
            disabled={!detailsEditable}
            ariaLabel="Nationality"
          />
        </Field>
        <Field label="Address line 1">
          <input
            className="w-full rounded border border-input bg-background px-2 py-1"
            value={guest.addressLine1}
            disabled={!detailsEditable}
            maxLength={120}
            onChange={(e) => onChange({ ...guest, addressLine1: e.target.value })}
          />
        </Field>
        <Field label="Address line 2">
          <input
            className="w-full rounded border border-input bg-background px-2 py-1"
            value={guest.addressLine2}
            disabled={!detailsEditable}
            maxLength={120}
            onChange={(e) => onChange({ ...guest, addressLine2: e.target.value })}
          />
        </Field>
        <Field label="City">
          <input
            className="w-full rounded border border-input bg-background px-2 py-1"
            value={guest.city}
            disabled={!detailsEditable}
            maxLength={80}
            onChange={(e) => onChange({ ...guest, city: e.target.value })}
          />
        </Field>
        <Field label="Postcode">
          <input
            className="w-full rounded border border-input bg-background px-2 py-1"
            value={guest.postcode}
            disabled={!detailsEditable}
            maxLength={20}
            onChange={(e) => onChange({ ...guest, postcode: e.target.value })}
          />
        </Field>
        <Field label="Country">
          <CountryCombobox
            value={guest.countryCode}
            onChange={(v) =>
              onChange({ ...guest, countryCode: v, stateCode: "", stateProvince: "" })
            }
            disabled={!detailsEditable}
            ariaLabel="Country"
          />
        </Field>
        {guest.countryCode === "MYS" ? (
          <Field label="State">
            <select
              className="w-full rounded border border-input bg-background px-2 py-1"
              value={guest.stateCode}
              disabled={!detailsEditable}
              onChange={(e) => onChange({ ...guest, stateCode: e.target.value })}
            >
              <option value="">Select…</option>
              {MALAYSIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="State / province">
            <input
              className="w-full rounded border border-input bg-background px-2 py-1"
              value={guest.stateProvince}
              disabled={!detailsEditable}
              maxLength={80}
              onChange={(e) => onChange({ ...guest, stateProvince: e.target.value })}
            />
          </Field>
        )}
        <Field label="Guest notes">
          <input
            className="w-full rounded border border-input bg-background px-2 py-1"
            value={guest.notes}
            maxLength={500}
            onChange={(e) => onChange({ ...guest, notes: e.target.value })}
          />
        </Field>
        <Field label="Assigned room">
          <select
            className="w-full rounded border border-input bg-background px-2 py-1"
            value={guest.assignedRoomClientKey}
            disabled={!assignEditable}
            onChange={(e) => onChange({ ...guest, assignedRoomClientKey: e.target.value })}
          >
            <option value="">Select a room…</option>
            {rooms.map((r) => (
              <option key={r.clientKey} value={r.clientKey}>
                {r.label} · max {r.maxOccupancy}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* ----------------------------- Identity ---------------------------- */}
      <div className="mt-3 rounded border p-2" style={{ borderColor: `${TEAL}33` }}>
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: NAVY }}>
          Identity
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {guest.identityMasked
            ? `On file: ${identityTypeLabel(guest.identityTypeExisting) || "ID"} · ${guest.identityMasked}`
            : "No identity on file."}
        </p>
        {identityEditable ? (
          <>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
              {(isNew ? (["replace"] as const) : (["keep", "replace", "clear"] as const)).map(
                (action) => (
                  <label key={action} className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name={`identity-${guest.clientKey}`}
                      checked={guest.identityAction === action}
                      onChange={() => {
                        if (action === "clear" && !window.confirm("Clear the stored identity?"))
                          return;
                        onChange({
                          ...guest,
                          identityAction: action,
                          identityType: "",
                          identityNumber: "",
                          identityRevision: newIdentityRevision(),
                        });
                      }}
                    />
                    <span className="capitalize">
                      {action === "keep"
                        ? "Keep existing"
                        : action === "replace"
                          ? isNew
                            ? "Add identity"
                            : "Replace"
                          : "Clear"}
                    </span>
                  </label>
                ),
              )}
            </div>
            {guest.identityAction === "replace" ? (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Identity type">
                  <select
                    className="w-full rounded border border-input bg-background px-2 py-1"
                    value={guest.identityType}
                    onChange={(e) => onChange({ ...guest, identityType: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {IDENTITY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {identityTypeLabel(t)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Identity number">
                  <input
                    className="w-full rounded border border-input bg-background px-2 py-1"
                    value={guest.identityNumber}
                    autoComplete="off"
                    maxLength={50}
                    placeholder="Enter the new number"
                    onChange={(e) =>
                      onChange({
                        ...guest,
                        identityNumber: e.target.value,
                        identityRevision: newIdentityRevision(),
                      })
                    }
                  />
                </Field>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Identity changes are not available in this mode.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Safe, user-facing text for allow-listed full-update error codes. */
export function editErrorMessage(code: string): string {
  switch (code) {
    case "stale_reservation":
      return "This reservation changed elsewhere. Reload and try again.";
    case "idempotency_conflict":
      return "This save was already submitted with different details. Reload and try again.";
    case "reservation_not_editable":
      return "This reservation can no longer be edited.";
    case "guest_edit_locked":
      return "Guest changes are locked after check-in by your Guest Controls policy.";
    case "correction_reason_required":
      return "A correction reason is required.";
    case "primary_guest_change_not_allowed":
      return "Changing the primary guest after check-in is disabled in Guest Controls.";
    case "room_unavailable":
      return "A selected room is no longer available for these dates.";
    case "room_capacity_exceeded":
      return "A room would exceed its maximum guests.";
    case "rate_override_reason_required":
      return "A rate override reason is required.";
    case "guest_assignment_required":
      return "Every guest must be assigned to a room.";
    case "primary_guest_required":
      return "Choose a primary guest.";
    case "multiple_primary_guests":
      return "Only one guest can be primary.";
    case "invalid_identity_number":
    case "invalid_identity_type":
    case "identity_pair_required":
      return "The identity details entered are not valid.";
    case "unauthenticated":
      return "Your session expired. Relaunch HotelHub from N3.";
    case "forbidden":
      return "You do not have permission to edit this reservation.";
    default:
      return "We couldn’t save your changes. Please try again.";
  }
}
