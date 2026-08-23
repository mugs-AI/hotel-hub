import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { AppShell } from "@/components/AppShell";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import {
  tenantSourceLabel,
  useBookingSources,
  useReservationDetail,
  type ReservationEditCapabilitiesDTO,
  type ReservationDetailDTO,
  type ReservationDetailGuestDTO,
} from "@/lib/reservations-client";
import { formatCreatedAt, formatIsoDate, friendlyError, roomLabel } from "@/lib/reservations-ui";
import { countryName } from "@/lib/iso-countries";
import { malaysianStateName } from "@/lib/malaysia-states";
import { identityTypeLabel } from "@/lib/guest-identity";
import { DepositsCard } from "@/components/DepositsCard";
import {
  PendingApprovalsCard,
  ReservationActionsCard,
  ReservationTimelineCard,
} from "@/components/ReservationOperations";
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { GuestRoomAssignmentCard } from "@/components/GuestRoomAssignmentCard";
import {
  ArrowLeft,
  CalendarDays,
  History,
  ListOrdered,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
} from "lucide-react";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const SOFT_BG = "#F4F8FC";
const ERR = "#C2413B";

const detailSearchSchema = z.object({
  from: z.enum(["list", "calendar"]).optional(),
  calStart: z.string().optional(),
  calDays: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional(),
  calFloor: z.string().optional(),
});
type DetailSearch = z.infer<typeof detailSearchSchema>;

export const Route = createFileRoute("/reservations/$id")({
  validateSearch: (raw: Record<string, unknown>): DetailSearch => {
    const parsed = detailSearchSchema.safeParse({
      from: typeof raw.from === "string" ? raw.from : undefined,
      calStart: typeof raw.calStart === "string" ? raw.calStart : undefined,
      calDays:
        typeof raw.calDays === "number"
          ? raw.calDays
          : typeof raw.calDays === "string"
            ? Number(raw.calDays)
            : undefined,
      calFloor: typeof raw.calFloor === "string" ? raw.calFloor : undefined,
    });
    return parsed.success ? parsed.data : {};
  },
  head: () => ({
    meta: [
      { title: "Reservation — HotelHub" },
      { name: "description", content: "Reservation detail: rooms, guests, and status." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReservationDetailPage,
});

function ReservationDetailPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const session = useSessionMe();
  const data = session.data;
  const role = data && data.authenticated === true ? data.role : null;
  const canView = hasPermission(role, "hotel:reservations:view");
  const canEdit = hasPermission(role, "hotel:reservations:edit");
  const canCreate = hasPermission(role, "hotel:reservations:create");
  const isAuthed = data?.authenticated === true;
  const query = useReservationDetail(id);

  return (
    <AppShell>
      <div className="space-y-6" style={{ backgroundColor: SOFT_BG }}>
        <Header canCreate={canCreate} from={search.from} search={search} />
        {!isAuthed ? null : !canView ? (
          <NoAccess />
        ) : query.isPending ? (
          <p className="text-sm text-muted-foreground">Loading reservation…</p>
        ) : query.error ? (
          <ErrorState code={query.error.code} onRetry={() => query.refetch()} />
        ) : query.data ? (
          <Detail
            data={query.data.reservation}
            capabilities={query.data.editCapabilities}
            canEdit={canEdit}
            role={role}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

function Header({
  canCreate,
  from,
  search,
}: {
  canCreate: boolean;
  from: DetailSearch["from"];
  search: DetailSearch;
}) {
  return (
    <section
      className="rounded-lg p-6 text-white shadow-sm"
      style={{ background: `linear-gradient(135deg, ${NAVY}, ${TEAL})` }}
    >
      <div className="flex flex-wrap items-center gap-3 text-xs text-white/80">
        <Link
          to="/reservations"
          search={{
            bookingReference: "",
            guestName: "",
            guestMobile: "",
            bookingSource: "",
            status: "",
            arrivalFrom: "",
            arrivalTo: "",
            limit: 25,
            offset: 0,
          }}
          className="inline-flex items-center gap-1 underline underline-offset-2"
        >
          <ListOrdered className="h-3 w-3" aria-hidden />
          Back to List
        </Link>
        <Link
          to="/reservations/calendar"
          search={{
            startDate: search.calStart ?? "",
            days: (search.calDays ?? 14) as 7 | 14 | 30,
          }}
          className="inline-flex items-center gap-1 underline underline-offset-2"
        >
          <CalendarDays className="h-3 w-3" aria-hidden />
          Back to Calendar
        </Link>
        {from ? (
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wide">
            Opened from {from}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" aria-hidden />
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: GOLD, color: NAVY }}
          >
            Front Desk
          </span>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Reservation</h1>
        </div>
        {canCreate ? (
          <Link
            to="/reservations/new"
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium shadow-sm"
            style={{ backgroundColor: GOLD, color: NAVY }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            New Reservation
          </Link>
        ) : null}
      </div>
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
      <p className="mt-1 text-muted-foreground">Reservation detail is restricted.</p>
    </div>
  );
}

function ErrorState({ code, onRetry }: { code: string; onRetry: () => void }) {
  if (code === "not_found") {
    return (
      <div className="rounded-md border bg-white p-6 text-sm">
        <h2 className="font-semibold" style={{ color: NAVY }}>
          Reservation not found
        </h2>
        <p className="mt-1 text-muted-foreground">
          This reservation may have been removed or belongs to another property.
        </p>
      </div>
    );
  }
  if (code === "invalid_id") {
    return (
      <div className="rounded-md border bg-white p-6 text-sm">
        <h2 className="font-semibold" style={{ color: NAVY }}>
          Invalid link
        </h2>
        <p className="mt-1 text-muted-foreground">The reservation link is not valid.</p>
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm"
      style={{ borderColor: `${ERR}33`, backgroundColor: `${ERR}12`, color: ERR }}
    >
      <span>{friendlyError(code, "Unable to load this reservation.")}</span>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1 rounded-md border border-input bg-white px-2 py-1 text-xs font-medium"
        style={{ color: NAVY }}
      >
        <RefreshCw className="h-3 w-3" aria-hidden />
        Retry
      </button>
    </div>
  );
}

function Detail({
  data,
  capabilities,
  canEdit,
  role,
}: {
  data: ReservationDetailDTO;
  capabilities: ReservationEditCapabilitiesDTO;
  canEdit: boolean;
  role: Parameters<typeof hasPermission>[0];
}) {
  const canViewDeposits = hasPermission(role, "hotel:deposits:view");
  const canCreateDeposits = hasPermission(role, "hotel:deposits:create");
  const sourcesQ = useBookingSources({ activeOnly: false });
  const sources = sourcesQ.data?.sources ?? [];
  const editable =
    data.status === "confirmed" && data.rooms.every((r) => r.allocationStatus === "reserved");
  return (
    <div className="space-y-6">
      <section
        className="rounded-lg border bg-white p-5 shadow-sm"
        style={{ borderColor: `${NAVY}22`, borderLeft: `4px solid ${NAVY}` }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Booking reference</p>
            <p className="text-xl font-semibold font-mono" style={{ color: NAVY }}>
              {data.bookingReference}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
              style={{ backgroundColor: `${TEAL}22`, color: TEAL }}
            >
              {data.status}
            </span>
            {canEdit && editable ? (
              <Link
                to="/reservations/$id/edit"
                params={{ id: data.id }}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white"
                style={{ backgroundColor: NAVY }}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Edit reservation
              </Link>
            ) : null}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-xs lg:grid-cols-[max-content_1fr_max-content_1fr]">
          <dt className="text-muted-foreground">Source</dt>
          <dd>{tenantSourceLabel(sources, data.bookingSource)}</dd>
          <dt className="text-muted-foreground">External reference</dt>
          <dd>{data.externalBookingReference ?? "—"}</dd>
          <dt className="text-muted-foreground">Arrival</dt>
          <dd className="tabular-nums">{formatIsoDate(data.arrivalDate)}</dd>
          <dt className="text-muted-foreground">Departure</dt>
          <dd className="tabular-nums">{formatIsoDate(data.departureDate)}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{formatCreatedAt(data.createdAt)}</dd>
          <dt className="text-muted-foreground">Last updated</dt>
          <dd>{formatCreatedAt(data.updatedAt)}</dd>
          <dt className="text-muted-foreground">Created by</dt>
          <dd>{data.createdByLabel ?? "System"}</dd>
          <dt className="text-muted-foreground">Checked in</dt>
          <dd>
            {data.checkedInAt
              ? `${formatCreatedAt(data.checkedInAt)}${data.checkedInByLabel ? ` · ${data.checkedInByLabel}` : ""}`
              : "—"}
          </dd>
        </dl>
        <div className="mt-4 border-t border-border/60 pt-3 text-xs">
          <p className="text-muted-foreground">Notes</p>
          <p className="mt-1 whitespace-pre-wrap">{data.notes || "—"}</p>
        </div>
      </section>

      <section
        className="rounded-lg border bg-white p-5 shadow-sm"
        style={{ borderColor: `${TEAL}33`, borderLeft: `4px solid ${TEAL}` }}
      >
        <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
          Rooms ({data.rooms.length})
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase" style={{ color: NAVY }}>
                <th className="py-2 pr-4">Room</th>
                <th className="py-2 pr-4">Base rate</th>
                <th className="py-2 pr-4">Agreed rate</th>
                <th className="py-2 pr-4">Adults</th>
                <th className="py-2 pr-4">Children</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Override reason</th>
                <th className="py-2 pr-4">Remark</th>
              </tr>
            </thead>
            <tbody>
              {data.rooms.map((r) => (
                <tr key={r.id} className="border-t border-border/60 align-top">
                  <td className="py-2 pr-4 text-xs">
                    <span className="font-semibold" style={{ color: NAVY }}>
                      {roomLabel(r.displayName, r.n3StockName, r.roomNumber)}
                    </span>
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                      {r.roomNumber}
                    </span>
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {data.currency} {Number(r.baseRateSnapshot).toFixed(2)}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {data.currency} {Number(r.agreedRate).toFixed(2)}
                  </td>
                  <td className="py-2 pr-4 text-center">{r.adults}</td>
                  <td className="py-2 pr-4 text-center">{r.children}</td>
                  <td className="py-2 pr-4">{r.allocationStatus}</td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                    {r.rateOverrideReason ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-xs whitespace-pre-wrap">{r.remark ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <a
            href={`/reservations/${data.id}/print`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium"
            style={{ color: NAVY }}
          >
            <Printer className="h-3.5 w-3.5" aria-hidden />
            Print registration forms
          </a>
        </div>
      </section>

      <DepositsCard
        reservationId={data.id}
        canView={canViewDeposits}
        canCreate={canCreateDeposits}
        eligible={data.status === "confirmed"}
      />

      <ReservationActionsCard
        reservationId={data.id}
        updatedAt={data.updatedAt}
        status={data.status}
        checkedInAt={data.checkedInAt ?? null}
        canCheckIn={hasPermission(role, "hotel:reservations:check_in")}
        canRequest={hasPermission(role, "hotel:operations:request")}
        rooms={data.rooms.map((r) => ({
          id: r.id,
          hotelRoomId: r.hotelRoomId,
          label: roomLabel(r.displayName, r.n3StockName, r.roomNumber),
          agreedRate: r.agreedRate,
        }))}
      />

      <PendingApprovalsCard
        reservationId={data.id}
        canView={hasPermission(role, "hotel:operations:view")}
        canApprove={hasPermission(role, "hotel:operations:approve")}
      />

      <ReservationTimelineDrawer
        reservationId={data.id}
        bookingReference={data.bookingReference}
        canView={hasPermission(role, "hotel:operations:view")}
      />

      <section
        className="rounded-lg border bg-white p-5 shadow-sm"
        style={{ borderColor: `${GOLD}33`, borderLeft: `4px solid ${GOLD}` }}
      >
        <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
          Guests ({data.guests.length})
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {data.guests.map((g) => (
            <GuestBlock key={g.id} g={g} />
          ))}
        </ul>
      </section>

      <GuestRoomAssignmentCard reservationId={data.id} data={data} capabilities={capabilities} />
    </div>
  );
}

/**
 * Read-only right-side drawer for the reservation timeline. Replaces the
 * large permanent timeline card in the main vertical flow with a compact
 * trigger button; the drawer content is exactly the existing
 * `ReservationTimelineCard` (no extra guest data, no write actions).
 */
export function timelineDrawerTitle(bookingReference: string): string {
  return `Timeline · ${bookingReference}`;
}

function ReservationTimelineDrawer({
  reservationId,
  bookingReference,
  canView,
}: {
  reservationId: string;
  bookingReference: string;
  canView: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!canView) return null;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium shadow-sm"
          style={{ color: NAVY }}
        >
          <History className="h-3.5 w-3.5" aria-hidden />
          Show timeline
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{timelineDrawerTitle(bookingReference)}</SheetTitle>
          <SheetDescription>
            Read-only history for this reservation. Close to return to the reservation.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <ReservationTimelineCard reservationId={reservationId} canView={canView} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function nationalityDisplay(g: ReservationDetailGuestDTO): string {
  if (g.nationalityCode) return countryName(g.nationalityCode) || g.nationalityCode;
  if (g.nationality) return g.nationality;
  return "—";
}

function addressDisplay(g: ReservationDetailGuestDTO): string {
  const state = g.countryCode === "MYS" ? malaysianStateName(g.stateCode) : (g.stateProvince ?? "");
  const country = g.countryCode ? countryName(g.countryCode) : "";
  return (
    [
      g.addressLine1,
      g.addressLine2,
      g.addressLine3,
      [g.postcode, g.city].filter(Boolean).join(" "),
      state,
      country,
    ]
      .map((s) => (s ?? "").trim())
      .filter(Boolean)
      .join(", ") || "—"
  );
}

function GuestBlock({ g }: { g: ReservationDetailGuestDTO }) {
  return (
    <li className="rounded-md border p-3" style={{ borderColor: `${NAVY}22` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold" style={{ color: NAVY }}>
          {g.fullName}
        </span>
        {g.isPrimary ? (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: `${GOLD}22`, color: GOLD }}
          >
            Primary
          </span>
        ) : null}
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Mobile</dt>
          <dd>{g.mobile ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{g.email ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Nationality</dt>
          <dd>{nationalityDisplay(g)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Identity</dt>
          <dd>
            {g.identityType ? identityTypeLabel(g.identityType) : "—"}
            {g.identityNumberMasked ? (
              <span className="ml-1 font-mono">{g.identityNumberMasked}</span>
            ) : null}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Address</dt>
          <dd>{addressDisplay(g)}</dd>
        </div>
        <div className="sm:col-span-3">
          <dt className="text-muted-foreground">Guest notes</dt>
          <dd className="whitespace-pre-wrap">{g.notes ?? "—"}</dd>
        </div>
      </dl>
    </li>
  );
}
