// Read-only Reservation Calendar / Room View.
// Uses existing rooms + reservations. No mutations, no drag/drop.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import { useQuery } from "@tanstack/react-query";
import { MalaysianDateInput } from "@/components/malaysia-date-input";
import { formatMyDate } from "@/lib/malaysia-date";
import { ViewSwitcher } from "@/routes/reservations.index";
import { groupRoomsByFloor, naturalCompare, roomLabel, UNASSIGNED_FLOOR } from "@/lib/reservations-ui";
import { ChevronLeft, ChevronRight, CalendarDays, ChevronDown } from "lucide-react";

const NAVY = "#102A43";
const TEAL = "#0F9D8A";
const GOLD = "#E5A93D";
const SOFT_BG = "#F4F8FC";

type Search = { startDate: string; days: number };

function todayKlIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/reservations/calendar")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const s = typeof raw.startDate === "string" && ISO_RE.test(raw.startDate) ? raw.startDate : "";
    const dRaw = typeof raw.days === "number" ? raw.days : Number(raw.days);
    const d = dRaw === 7 || dRaw === 14 || dRaw === 30 ? dRaw : 14;
    return { startDate: s, days: d };
  },
  head: () => ({
    meta: [
      { title: "Reservation Calendar — HotelHub" },
      {
        name: "description",
        content: "Read-only room-planning calendar for reservations across the selected date range.",
      },
    ],
  }),
  component: CalendarPage,
});

type CalendarRoom = {
  hotelRoomId: string;
  roomNumber: string;
  displayName: string | null;
  n3StockName: string | null;
  roomType: string;
  floor: string | null;
  isActive: boolean;
};
type CalendarAllocation = {
  reservationId: string;
  bookingReference: string;
  hotelRoomId: string;
  primaryGuestName: string | null;
  arrivalDate: string;
  departureDate: string;
  reservationStatus: string;
  allocationStatus: string;
};
type CalendarResponse = {
  rangeStart: string;
  rangeEndExclusive: string;
  rooms: CalendarRoom[];
  allocations: CalendarAllocation[];
};

function CalendarPage() {
  const session = useSessionMe();
  const data = session.data;
  const role = data && data.authenticated === true ? data.role : null;
  const canView = hasPermission(role, "hotel:reservations:view");

  return (
    <AppShell>
      <div className="space-y-6" style={{ backgroundColor: SOFT_BG }}>
        <Header />
        <ViewSwitcher active="calendar" />
        {data?.authenticated !== true ? null : !canView ? <NoAccess /> : <Grid />}
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
      <span
        className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{ backgroundColor: GOLD, color: NAVY }}
      >
        Planning
      </span>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Reservation Calendar / Room View</h1>
      <p className="mt-1 max-w-2xl text-sm text-white/85">
        Read-only view of room allocations across the selected date range. Click a reservation
        block to open its full detail.
      </p>
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
        The reservation calendar is restricted to Owner and Front Desk roles.
      </p>
    </div>
  );
}

function Grid() {
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const start = search.startDate || todayKlIso();
  const days = search.days;

  const q = useQuery<CalendarResponse, Error>({
    queryKey: ["reservation-calendar", start, days],
    queryFn: async () => {
      const res = await fetch(
        `/api/hotel/reservation-calendar?startDate=${encodeURIComponent(start)}&days=${days}`,
        { credentials: "same-origin", headers: { accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`http_${res.status}`);
      return (await res.json()) as CalendarResponse;
    },
    staleTime: 15_000,
  });

  const dates = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < days; i++) out.push(addDays(start, i));
    return out;
  }, [start, days]);

  const today = todayKlIso();

  function move(delta: number) {
    navigate({ search: (prev: Search) => ({ ...prev, startDate: addDays(prev.startDate || today, delta) }) });
  }

  return (
    <section
      className="rounded-lg border bg-white p-4 shadow-sm"
      style={{ borderColor: `${NAVY}22`, borderLeft: `4px solid ${NAVY}` }}
    >
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <label className="mb-1 block text-xs font-medium" style={{ color: NAVY }}>
            Start date
          </label>
          <MalaysianDateInput
            value={start}
            onChange={(iso) =>
              navigate({ search: (prev: Search) => ({ ...prev, startDate: iso || today }) })
            }
            pickerLabel="Choose start date"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: NAVY }}>
            Range
          </label>
          <div role="radiogroup" aria-label="Range" className="inline-flex rounded-md border border-input bg-white p-0.5 text-xs">
            {[7, 14, 30].map((d) => {
              const active = d === days;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => navigate({ search: (prev: Search) => ({ ...prev, days: d }) })}
                  className="rounded px-2 py-1 font-medium"
                  style={{ backgroundColor: active ? NAVY : "transparent", color: active ? "white" : NAVY }}
                >
                  {d} days
                </button>
              );
            })}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => move(-days)}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            aria-label="Previous range"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Prev
          </button>
          <button
            type="button"
            onClick={() => navigate({ search: (prev: Search) => ({ ...prev, startDate: today }) })}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Today
          </button>
          <button
            type="button"
            onClick={() => move(days)}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            aria-label="Next range"
          >
            Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <Legend />

      {q.isPending ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading calendar…</p>
      ) : q.error ? (
        <p className="py-8 text-center text-sm text-destructive">
          Failed to load calendar. <button onClick={() => q.refetch()} className="underline">Retry</button>
        </p>
      ) : !q.data || q.data.rooms.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No rooms to show for the selected range.
        </p>
      ) : (
        <FloorGrid
          rooms={q.data.rooms}
          allocations={q.data.allocations}
          rangeStart={q.data.rangeStart}
          rangeEndExclusive={q.data.rangeEndExclusive}
          dates={dates}
          days={days}
          today={today}
        />
      )}
    </section>
  );
}

// Column geometry: single source of truth so header, row, and overlay
// stay perfectly aligned even under overflow-x scroll.
const LABEL_COL_PX = 200;
const DAY_COL_PX = 72;
const ROW_HEIGHT_PX = 42;

function FloorGrid({
  rooms,
  allocations,
  rangeStart,
  rangeEndExclusive,
  dates,
  days,
  today,
}: {
  rooms: CalendarRoom[];
  allocations: CalendarAllocation[];
  rangeStart: string;
  rangeEndExclusive: string;
  dates: string[];
  days: number;
  today: string;
}) {
  const grouped = useMemo(() => groupRoomsByFloor(rooms), [rooms]);
  const [activeFloor, setActiveFloor] = useState<string>("__all__");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const visibleFloors =
    activeFloor === "__all__"
      ? grouped.floors
      : grouped.floors.filter((f) => f === activeFloor);

  const sortedByFloor = new Map(
    grouped.floors.map((f) => [
      f,
      [...(grouped.byFloor.get(f) ?? [])].sort((a, b) =>
        naturalCompare(
          roomLabel(a.displayName, a.n3StockName, a.roomNumber),
          roomLabel(b.displayName, b.n3StockName, b.roomNumber),
        ),
      ),
    ]),
  );

  function toggle(f: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  const rowWidth = LABEL_COL_PX + days * DAY_COL_PX;
  const rowTemplate = `${LABEL_COL_PX}px repeat(${days}, ${DAY_COL_PX}px)`;

  return (
    <div className="space-y-3">
      <FloorChips
        floors={grouped.floors}
        counts={new Map(grouped.floors.map((f) => [f, grouped.byFloor.get(f)?.length ?? 0]))}
        active={activeFloor}
        onChange={setActiveFloor}
        total={rooms.length}
      />
      <div className="overflow-auto rounded-md border" style={{ borderColor: `${NAVY}22` }}>
        <div style={{ width: rowWidth, minWidth: rowWidth }}>
          {/* Header row — sticky at top */}
          <div
            className="sticky top-0 z-20"
            style={{
              display: "grid",
              gridTemplateColumns: rowTemplate,
              backgroundColor: "white",
              boxShadow: `inset 0 -1px 0 ${NAVY}22`,
            }}
          >
            <div
              className="sticky left-0 z-30 p-2 text-xs font-semibold"
              style={{ color: NAVY, backgroundColor: "white" }}
            >
              Room
            </div>
            {dates.map((d) => {
              const dow = dayOfWeek(d);
              const weekend = dow === 0 || dow === 6;
              const isToday = d === today;
              return (
                <div
                  key={d}
                  className="border-l p-1 text-center text-xs"
                  style={{
                    borderColor: `${NAVY}11`,
                    backgroundColor: isToday ? `${GOLD}22` : weekend ? `${NAVY}08` : "white",
                    color: NAVY,
                  }}
                >
                  <div className="font-semibold">{formatMyDate(d).slice(0, 5)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow]}
                  </div>
                </div>
              );
            })}
          </div>

          {visibleFloors.map((floorKey, floorIdx) => {
            const label = floorKey === UNASSIGNED_FLOOR ? "Unassigned" : `Floor ${floorKey}`;
            const list = sortedByFloor.get(floorKey) ?? [];
            const isCollapsed = collapsed.has(floorKey);
            const zebra = floorIdx % 2 === 1;
            return (
              <div key={floorKey}>
                <button
                  type="button"
                  onClick={() => toggle(floorKey)}
                  className="flex w-full items-center gap-2 border-b border-t px-2 py-1.5 text-left text-xs font-semibold"
                  style={{
                    color: NAVY,
                    borderColor: `${NAVY}22`,
                    backgroundColor: zebra ? `${NAVY}05` : `${NAVY}0A`,
                    width: rowWidth,
                  }}
                  aria-expanded={!isCollapsed}
                >
                  <ChevronDown
                    className="h-3.5 w-3.5 transition-transform"
                    aria-hidden
                    style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
                  />
                  <span>{label}</span>
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    ({list.length})
                  </span>
                </button>
                {isCollapsed
                  ? null
                  : list.map((room) => (
                      <RoomRow
                        key={room.hotelRoomId}
                        room={room}
                        dates={dates}
                        days={days}
                        today={today}
                        allocations={allocations.filter(
                          (a) => a.hotelRoomId === room.hotelRoomId,
                        )}
                        rangeStart={rangeStart}
                        rangeEndExclusive={rangeEndExclusive}
                        template={rowTemplate}
                        rowWidth={rowWidth}
                      />
                    ))}
              </div>
            );
          })}
        </div>
      </div>
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
        className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium"
        style={{
          borderColor: isActive ? NAVY : `${NAVY}22`,
          backgroundColor: isActive ? NAVY : "white",
          color: isActive ? "white" : NAVY,
        }}
      >
        {label}
        <span
          className="rounded-full px-1.5 text-[10px]"
          style={{ backgroundColor: isActive ? "rgba(255,255,255,0.2)" : `${NAVY}0F` }}
        >
          {count}
        </span>
      </button>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by floor">
      {chip("__all__", "All floors", total)}
      {floors.map((f) =>
        chip(f, f === UNASSIGNED_FLOOR ? "Unassigned" : `Floor ${f}`, counts.get(f) ?? 0),
      )}
    </div>
  );
}

function Legend() {
  const items: Array<{ label: string; color: string }> = [
    { label: "Reserved", color: TEAL },
    { label: "Occupied", color: NAVY },
    { label: "Checked-out", color: "#9AA5B1" },
  ];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function statusColor(status: string): string {
  if (status === "occupied") return NAVY;
  if (status === "checked_out") return "#9AA5B1";
  return TEAL;
}

function RoomRow({
  room,
  dates,
  days,
  today,
  allocations,
  rangeStart,
  rangeEndExclusive,
  template,
  rowWidth,
}: {
  room: CalendarRoom;
  dates: string[];
  days: number;
  today: string;
  allocations: CalendarAllocation[];
  rangeStart: string;
  rangeEndExclusive: string;
  template: string;
  rowWidth: number;
}) {
  return (
    <div
      className="relative border-t"
      style={{
        borderColor: `${NAVY}11`,
        width: rowWidth,
        height: ROW_HEIGHT_PX,
      }}
    >
      {/* Cell layer — grid with the shared column template. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: template,
          height: "100%",
        }}
      >
        <div
          className="sticky left-0 z-10 bg-white p-1.5"
          style={{ borderRight: `1px solid ${NAVY}11` }}
        >
          <div className="truncate text-xs font-semibold" style={{ color: NAVY }}>
            {roomLabel(room.displayName, room.n3StockName, room.roomNumber)}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            <span className="font-mono">{room.roomNumber}</span>
            {" · "}
            {room.roomType}
            {room.floor ? ` · Fl ${room.floor}` : ""}
            {!room.isActive ? " · inactive" : ""}
          </div>
        </div>
        {dates.map((d) => {
          const dow = dayOfWeek(d);
          const weekend = dow === 0 || dow === 6;
          const isToday = d === today;
          return (
            <div
              key={d}
              className="border-l"
              style={{
                borderColor: `${NAVY}11`,
                backgroundColor: isToday ? `${GOLD}14` : weekend ? `${NAVY}06` : "white",
              }}
            />
          );
        })}
      </div>

      {/* Reservation overlay — absolutely positioned in pixel units against
          the row (0 = start of label column). Blocks sit on top of the day
          cells and share the exact 72px column width. */}
      {allocations.map((a) => {
        const startClip = a.arrivalDate < rangeStart ? rangeStart : a.arrivalDate;
        const clipEnd = a.departureDate > rangeEndExclusive ? rangeEndExclusive : a.departureDate;
        const startIdx = dates.indexOf(startClip);
        const endIdx = dates.indexOf(addDays(clipEnd, -1));
        if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return null;
        const span = endIdx - startIdx + 1;
        const left = LABEL_COL_PX + startIdx * DAY_COL_PX + 2;
        const width = span * DAY_COL_PX - 4;
        // Guard against overflow past the row's right edge.
        const clampedWidth = Math.max(0, Math.min(width, rowWidth - left - 2));
        return (
          <Link
            key={a.reservationId + a.hotelRoomId}
            to="/reservations/$id"
            params={{ id: a.reservationId }}
            className="absolute flex items-center overflow-hidden rounded px-2 text-[11px] font-medium text-white shadow-sm hover:opacity-90"
            style={{
              left,
              width: clampedWidth,
              top: 6,
              height: 30,
              backgroundColor: statusColor(a.allocationStatus),
            }}
            title={`${a.bookingReference} · ${a.primaryGuestName ?? ""}`}
          >
            <span className="truncate">
              {a.bookingReference}
              {a.primaryGuestName ? ` · ${a.primaryGuestName}` : ""}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
