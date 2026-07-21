import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import {
  BOOKING_SOURCE_LABELS,
  BOOKING_SOURCE_VALUES,
  EMPTY_FILTERS,
  bookingSourceLabel,
  formatCreatedAt,
  formatIsoDate,
  friendlyError,
  type ListFilters,
} from "@/lib/reservations-ui";
import { useReservationList } from "@/lib/reservations-client";
import { CalendarClock, Filter, Plus, RefreshCw, Search, X } from "lucide-react";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const SOFT_BG = "#F4F8FC";

type ListSearch = {
  bookingReference: string;
  guestName: string;
  bookingSource: string;
  status: string;
  arrivalFrom: string;
  arrivalTo: string;
  limit: number;
  offset: number;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function int(v: unknown, def: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : def;
}

export const Route = createFileRoute("/reservations/")({
  validateSearch: (raw: Record<string, unknown>): ListSearch => ({
    bookingReference: str(raw.bookingReference),
    guestName: str(raw.guestName),
    bookingSource: str(raw.bookingSource),
    status: str(raw.status),
    arrivalFrom: str(raw.arrivalFrom),
    arrivalTo: str(raw.arrivalTo),
    limit: int(raw.limit, 25),
    offset: int(raw.offset, 0),
  }),
  head: () => ({
    meta: [
      { title: "Reservations — HotelHub" },
      {
        name: "description",
        content: "Search, review and create hotel reservations for your property.",
      },
    ],
  }),
  component: ReservationsListPage,
});

function ReservationsListPage() {
  const session = useSessionMe();
  const data = session.data;
  const role = data && data.authenticated === true ? data.role : null;
  const isAuthed = data?.authenticated === true;
  const canView = hasPermission(role, "hotel:reservations:view");
  const canCreate = hasPermission(role, "hotel:reservations:create");

  return (
    <AppShell>
      <div className="space-y-6" style={{ backgroundColor: SOFT_BG }}>
        <Header canCreate={canCreate} />
        {!isAuthed ? null : !canView ? <NoAccess /> : <ListInner canCreate={canCreate} />}
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: GOLD, color: NAVY }}
          >
            Front Desk
          </span>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Reservations</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/85">
            Search, review and create hotel reservations. Filtering and pagination happen on the
            server so you always see complete results.
          </p>
        </div>
        {canCreate ? (
          <Link
            to="/reservations/new"
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium shadow-sm"
            style={{ backgroundColor: GOLD, color: NAVY }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            <span>New Reservation</span>
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
      style={{ borderColor: "#C2413B33", backgroundColor: "#C2413B1A" }}
    >
      <p className="font-semibold" style={{ color: "#C2413B" }}>
        Access denied
      </p>
      <p className="mt-1 text-muted-foreground">
        Reservations are restricted to Owner and Front Desk roles.
      </p>
    </div>
  );
}

function ListInner({ canCreate }: { canCreate: boolean }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const filters: ListFilters = {
    bookingReference: search.bookingReference,
    guestName: search.guestName,
    bookingSource: search.bookingSource,
    status: search.status,
    arrivalFrom: search.arrivalFrom,
    arrivalTo: search.arrivalTo,
  };
  const limit = Math.min(100, Math.max(1, search.limit));
  const offset = Math.max(0, search.offset);

  // Local, uncommitted edits — applied on "Apply filters"
  const [draft, setDraft] = useState<ListFilters>(filters);
  useEffect(() => {
    setDraft(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.bookingReference,
    filters.guestName,
    filters.bookingSource,
    filters.status,
    filters.arrivalFrom,
    filters.arrivalTo,
  ]);

  const query = useReservationList(filters, { limit, offset });
  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  function apply(next: Partial<ListSearch>) {
    navigate({ search: (prev: ListSearch) => ({ ...prev, ...next, offset: 0 }) });
  }
  function setPage(page: number) {
    const clamped = Math.min(totalPages, Math.max(1, page));
    navigate({ search: (prev: ListSearch) => ({ ...prev, offset: (clamped - 1) * limit }) });
  }
  function setLimit(l: number) {
    navigate({ search: (prev: ListSearch) => ({ ...prev, limit: l, offset: 0 }) });
  }

  return (
    <>
      <FiltersCard
        draft={draft}
        onChange={setDraft}
        onApply={() => apply(draft)}
        onClear={() => {
          setDraft(EMPTY_FILTERS);
          apply(EMPTY_FILTERS);
        }}
      />
      <ResultsCard
        loading={query.isPending}
        refreshing={query.isFetching && !query.isPending}
        error={query.error?.code ?? null}
        rows={rows}
        total={total}
        currentPage={currentPage}
        totalPages={totalPages}
        limit={limit}
        onLimit={setLimit}
        onPage={setPage}
        onRetry={() => query.refetch()}
        canCreate={canCreate}
      />
    </>
  );
}

function FiltersCard({
  draft,
  onChange,
  onApply,
  onClear,
}: {
  draft: ListFilters;
  onChange: (f: ListFilters) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  return (
    <section
      className="rounded-lg border bg-white p-5 shadow-sm"
      style={{ borderColor: `${NAVY}22`, borderLeft: `4px solid ${NAVY}` }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Filter className="h-4 w-4" style={{ color: NAVY }} aria-hidden />
        <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
          Filters
        </h2>
      </div>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          onApply();
        }}
      >
        <Field label="Booking reference">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={draft.bookingReference}
            onChange={(e) => onChange({ ...draft, bookingReference: e.target.value })}
          />
        </Field>
        <Field label="Guest name">
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={draft.guestName}
            onChange={(e) => onChange({ ...draft, guestName: e.target.value })}
          />
        </Field>
        <Field label="Booking source">
          <select
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={draft.bookingSource}
            onChange={(e) => onChange({ ...draft, bookingSource: e.target.value })}
          >
            <option value="">All sources</option>
            {BOOKING_SOURCE_VALUES.map((v) => (
              <option key={v} value={v}>
                {BOOKING_SOURCE_LABELS[v]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={draft.status}
            onChange={(e) => onChange({ ...draft, status: e.target.value })}
          >
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </Field>
        <Field label="Arrival from">
          <input
            type="date"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={draft.arrivalFrom}
            onChange={(e) => onChange({ ...draft, arrivalFrom: e.target.value })}
          />
        </Field>
        <Field label="Arrival to">
          <input
            type="date"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={draft.arrivalTo}
            onChange={(e) => onChange({ ...draft, arrivalTo: e.target.value })}
          />
        </Field>
        <div className="col-span-full flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear filters
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white"
            style={{ backgroundColor: NAVY }}
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            Apply filters
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium" style={{ color: NAVY }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function ResultsCard(props: {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  rows: Array<{
    id: string;
    bookingReference: string;
    primaryGuestName: string | null;
    bookingSource: string;
    status: string;
    arrivalDate: string;
    departureDate: string;
    roomCount: number;
    guestCount: number;
    createdAt: string;
  }>;
  total: number;
  currentPage: number;
  totalPages: number;
  limit: number;
  onLimit: (n: number) => void;
  onPage: (n: number) => void;
  onRetry: () => void;
  canCreate: boolean;
}) {
  const {
    loading,
    refreshing,
    error,
    rows,
    total,
    currentPage,
    totalPages,
    limit,
    onLimit,
    onPage,
    onRetry,
    canCreate,
  } = props;

  const from = total === 0 ? 0 : (currentPage - 1) * limit + 1;
  const to = Math.min(total, currentPage * limit);

  return (
    <section
      className="rounded-lg border bg-white p-5 shadow-sm"
      style={{ borderColor: `${TEAL}33`, borderLeft: `4px solid ${TEAL}` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: NAVY }}>
            Reservations
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {loading ? "Loading…" : total === 0 ? "No reservations found." : `Showing ${from}–${to} of ${total}`}
            {refreshing ? " · refreshing…" : ""}
          </p>
        </div>
        <label className="text-xs">
          <span className="mr-2 text-muted-foreground">Rows per page</span>
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            value={limit}
            onChange={(e) => onLimit(Number(e.target.value))}
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm"
          style={{ borderColor: "#C2413B33", backgroundColor: "#C2413B12", color: "#C2413B" }}
        >
          <span>{friendlyError(error, "Unable to load reservations right now.")}</span>
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-white px-2 py-1 text-xs font-medium"
            style={{ color: NAVY }}
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            Retry
          </button>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase" style={{ color: NAVY }}>
              <th className="py-2 pr-4">Booking</th>
              <th className="py-2 pr-4">Primary guest</th>
              <th className="py-2 pr-4">Arrival</th>
              <th className="py-2 pr-4">Departure</th>
              <th className="py-2 pr-4">Rooms</th>
              <th className="py-2 pr-4">Guests</th>
              <th className="py-2 pr-4">Source</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td colSpan={10} className="py-3">
                    <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 && !error ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-muted-foreground">
                  <CalendarClock className="mx-auto mb-2 h-5 w-5" aria-hidden />
                  <p>No reservations match your filters.</p>
                  {canCreate ? (
                    <p className="mt-1 text-xs">
                      <Link to="/reservations/new" className="underline" style={{ color: NAVY }}>
                        Create the first reservation
                      </Link>
                    </p>
                  ) : null}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30">
                  <td className="py-2 pr-4 font-mono text-xs">
                    <Link
                      to="/reservations/$id"
                      params={{ id: r.id }}
                      className="underline"
                      style={{ color: NAVY }}
                    >
                      {r.bookingReference}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{r.primaryGuestName ?? "—"}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatIsoDate(r.arrivalDate)}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatIsoDate(r.departureDate)}</td>
                  <td className="py-2 pr-4 text-center">{r.roomCount}</td>
                  <td className="py-2 pr-4 text-center">{r.guestCount}</td>
                  <td className="py-2 pr-4">{bookingSourceLabel(r.bookingSource)}</td>
                  <td className="py-2 pr-4">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ backgroundColor: `${TEAL}22`, color: TEAL }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                    {formatCreatedAt(r.createdAt)}
                  </td>
                  <td className="py-2 pr-4">
                    <Link
                      to="/reservations/$id"
                      params={{ id: r.id }}
                      className="text-xs font-medium underline"
                      style={{ color: TEAL }}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="rounded-md border border-input bg-white px-2 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => onPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="rounded-md border border-input bg-white px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
