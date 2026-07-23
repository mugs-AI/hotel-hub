import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import {
  useReservationDetail,
  type ReservationDetailDTO,
  type ReservationDetailGuestDTO,
} from "@/lib/reservations-client";
import {
  bookingSourceLabel,
  formatCreatedAt,
  formatIsoDate,
  friendlyError,
} from "@/lib/reservations-ui";
import { countryName } from "@/lib/iso-countries";
import { malaysianStateName } from "@/lib/malaysia-states";
import { identityTypeLabel } from "@/lib/guest-identity";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";


const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const SOFT_BG = "#F4F8FC";
const ERR = "#C2413B";

export const Route = createFileRoute("/reservations/$id")({
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
  const session = useSessionMe();
  const data = session.data;
  const role = data && data.authenticated === true ? data.role : null;
  const canView = hasPermission(role, "hotel:reservations:view");
  const canCreate = hasPermission(role, "hotel:reservations:create");
  const isAuthed = data?.authenticated === true;
  const query = useReservationDetail(id);

  return (
    <AppShell>
      <div className="space-y-6" style={{ backgroundColor: SOFT_BG }}>
        <Header canCreate={canCreate} />
        {!isAuthed ? null : !canView ? (
          <NoAccess />
        ) : query.isPending ? (
          <p className="text-sm text-muted-foreground">Loading reservation…</p>
        ) : query.error ? (
          <ErrorState code={query.error.code} onRetry={() => query.refetch()} />
        ) : query.data ? (
          <Detail data={query.data.reservation} />
        ) : null}
      </div>
    </AppShell>
  );
}

function Header({ canCreate }: { canCreate: boolean }) {
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
}: {
  data: {
    id: string;
    bookingReference: string;
    bookingSource: string;
    status: string;
    arrivalDate: string;
    departureDate: string;
    currency: string;
    notes: string | null;
    createdAt: string;
    createdByN3UserKey: string;
    rooms: Array<{
      id: string;
      roomNumber: string;
      baseRateSnapshot: number;
      agreedRate: number;
      adults: number;
      children: number;
      allocationStatus: string;
      rateOverrideReason: string | null;
    }>;
    guests: Array<{
      id: string;
      fullName: string;
      mobile: string | null;
      email: string | null;
      nationality: string | null;
      isPrimary: boolean;
    }>;
  };
}) {
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
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
            style={{ backgroundColor: `${TEAL}22`, color: TEAL }}
          >
            {data.status}
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Source</dt>
          <dd>{bookingSourceLabel(data.bookingSource)}</dd>
          <dt className="text-muted-foreground">Arrival</dt>
          <dd className="tabular-nums">{formatIsoDate(data.arrivalDate)}</dd>
          <dt className="text-muted-foreground">Departure</dt>
          <dd className="tabular-nums">{formatIsoDate(data.departureDate)}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{formatCreatedAt(data.createdAt)}</dd>
          <dt className="text-muted-foreground">Created by</dt>
          <dd className="font-mono break-all">{data.createdByN3UserKey}</dd>
          <dt className="text-muted-foreground">Notes</dt>
          <dd>{data.notes || "—"}</dd>
        </dl>
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
                <th className="py-2 pr-4">Room #</th>
                <th className="py-2 pr-4">Base rate</th>
                <th className="py-2 pr-4">Agreed rate</th>
                <th className="py-2 pr-4">Adults</th>
                <th className="py-2 pr-4">Children</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Override reason</th>
              </tr>
            </thead>
            <tbody>
              {data.rooms.map((r) => (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="py-2 pr-4 font-mono text-xs">{r.roomNumber}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="rounded-lg border bg-white p-5 shadow-sm"
        style={{ borderColor: `${GOLD}33`, borderLeft: `4px solid ${GOLD}` }}
      >
        <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
          Guests ({data.guests.length})
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {data.guests.map((g) => (
            <li key={g.id} className="rounded-md border p-3" style={{ borderColor: `${NAVY}22` }}>
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
              <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
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
                  <dd>{g.nationality ?? "—"}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
