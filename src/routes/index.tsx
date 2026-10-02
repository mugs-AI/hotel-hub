import { createFileRoute, Link } from "@tanstack/react-router";
import { CardInfoPopover } from "@/components/CardInfoPopover";
import { AppShell } from "@/components/AppShell";
import { useSessionMe } from "@/lib/session-client";
import { ReceiptApprovalQueue } from "@/components/ReceiptApprovalQueue";
import { FinancialDashboard } from "@/components/FinancialDashboard";
import { hasPermission } from "@/lib/rbac";
import { housekeepingAuthority } from "@/lib/housekeeping";
import { useDepartures, checkoutErrorMessage } from "@/lib/checkout-client";
import { useHousekeepingBoard, housekeepingMessage } from "@/lib/housekeeping-client";
import { useReservationList } from "@/lib/reservations-client";
import { EMPTY_FILTERS } from "@/lib/reservations-ui";
import { isoToMyDate } from "@/lib/malaysia-date";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — HotelHub" },
      { name: "description", content: "Property operations for the current hotel day." },
    ],
  }),
  component: Dashboard,
});

const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";

function Dashboard() {
  const session = useSessionMe();
  const role = session.data?.authenticated === true ? session.data.role : null;
  const canReservations = hasPermission(role, "hotel:reservations:view");
  const canDepartures = hasPermission(role, "hotel:checkout:view");
  const canHousekeeping =
    hasPermission(role, "hotel:housekeeping:view") &&
    housekeepingAuthority(
      session.data?.authenticated === true ? (session.data.housekeepingMode ?? "simple") : "simple",
      role,
    ).canViewBoard;
  const departures = useDepartures({ bucket: "today", limit: 5 }, canDepartures);
  const housekeeping = useHousekeepingBoard(canHousekeeping);
  // The property date is server-derived. The browser clock may be in another timezone.
  const propertyDate = departures.data?.propertyDate ?? housekeeping.data?.propertyDate;
  const arrivals = useReservationList(
    {
      ...EMPTY_FILTERS,
      status: "confirmed",
      arrivalFrom: propertyDate ?? "",
      arrivalTo: propertyDate ?? "",
    },
    { limit: 5, offset: 0 },
    { enabled: canReservations && Boolean(propertyDate), sort: { key: "arrivalDate", dir: "asc" } },
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-[#102A43]">Dashboard</h1>
              <CardInfoPopover label="About Dashboard">
                Today’s property operations. Figures use the server’s property date and respect your
                access permissions.
              </CardInfoPopover>
            </div>
          </div>
          {propertyDate ? (
            <span className="rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-800">
              {isoToMyDate(propertyDate)}
            </span>
          ) : null}
        </div>

        <ReceiptApprovalQueue enabled={hasPermission(role, "hotel:receipt_controls:approve")} />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {canReservations ? (
            <Metric
              label="Confirmed arrivals"
              value={arrivals.data?.total}
              to="/reservations"
              tone="teal"
            />
          ) : null}
          {canDepartures ? (
            <>
              <Metric
                tone="blue"
                label="Departures today"
                value={departures.data?.counts.today}
                to="/departures"
              />
              <Metric
                label="Overdue occupied"
                value={departures.data?.counts.overdue}
                to="/departures"
                departureBucket="overdue"
                tone="alert"
              />
            </>
          ) : null}
          {canHousekeeping ? (
            <Metric
              label="Rooms needing attention"
              value={housekeeping.data?.counts.needs_attention}
              to="/housekeeping"
              tone="amber"
            />
          ) : null}
        </div>

        {canDepartures && departures.error ? (
          <ErrorCard label={checkoutErrorMessage(departures.error)} />
        ) : null}
        {canHousekeeping && housekeeping.error ? (
          <ErrorCard label={housekeepingMessage((housekeeping.error as Error).message)} />
        ) : null}
        {canReservations && arrivals.error ? (
          <ErrorCard label="Confirmed arrivals could not be loaded. Please refresh." />
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          {canReservations ? (
            <section className={card}>
              <SectionTitle title="Confirmed arrivals" to="/reservations" />
              {!propertyDate || arrivals.isPending ? (
                <Placeholder text="Loading arrivals…" />
              ) : null}
              {arrivals.data && arrivals.data.items.length === 0 ? (
                <Placeholder text="No confirmed arrivals today." />
              ) : null}
              <ul className="mt-3 divide-y divide-slate-100">
                {arrivals.data?.items.map((item) => (
                  <li key={item.id} className="py-3">
                    <Link
                      to="/reservations/$id"
                      params={{ id: item.id }}
                      className="font-medium text-teal-800 hover:underline"
                    >
                      {item.bookingReference}
                    </Link>
                    <p className="text-xs text-slate-600">
                      {item.primaryGuestName || "Guest pending"} ·{" "}
                      {item.roomLabels.join(", ") || `${item.roomCount} room(s)`}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {canDepartures ? (
            <section className={card}>
              <SectionTitle title="Departing today" to="/departures" />
              {departures.isPending ? <Placeholder text="Loading departures…" /> : null}
              {departures.data && departures.data.items.length === 0 ? (
                <Placeholder text="No departures today." />
              ) : null}
              <ul className="mt-3 divide-y divide-slate-100">
                {departures.data?.items.map((item) => (
                  <li key={item.reservationId} className="py-3">
                    <Link
                      to="/reservations/$id"
                      params={{ id: item.reservationId }}
                      className="font-medium text-teal-800 hover:underline"
                    >
                      {item.bookingReference}
                    </Link>
                    <p className="text-xs text-slate-600">
                      {item.primaryGuestName || "Guest pending"} ·{" "}
                      {item.roomLabels.join(", ") || "Room pending"}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {canHousekeeping ? (
            <section className={card}>
              <SectionTitle title="Room readiness" to="/housekeeping" />
              {housekeeping.isPending ? <Placeholder text="Loading room status…" /> : null}
              {housekeeping.data ? (
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <Status label="Ready" value={housekeeping.data.counts.ready} />
                  <Status label="In progress" value={housekeeping.data.counts.in_progress} />
                  <Status
                    label="Needs attention"
                    value={housekeeping.data.counts.needs_attention}
                  />
                  <Status label="Do Not Disturb" value={housekeeping.data.counts.dnd} />
                  <Status label="Not set up" value={housekeeping.data.counts.not_set_up} />
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
        <FinancialDashboard enabled={hasPermission(role, "hotel:financial_reports:view")} />
      </div>
    </AppShell>
  );
}

type DashboardPath = "/reservations" | "/departures" | "/housekeeping";

function Metric({
  label,
  value,
  to,
  tone,
  departureBucket,
}: {
  label: string;
  value: number | undefined;
  to: DashboardPath;
  tone?: "alert" | "teal" | "blue" | "amber";
  departureBucket?: "overdue";
}) {
  const tones = {
    teal: "border-teal-200 bg-teal-50 text-teal-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    alert: value
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : "border-slate-200 bg-slate-50 text-slate-800",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
  };
  return (
    <Link
      to={to}
      search={to === "/departures" ? { bucket: departureBucket ?? "today" } : undefined}
      className={`block rounded-xl border p-4 shadow-sm transition-shadow hover:shadow-md ${tones[tone ?? "teal"]}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value ?? "—"}</p>
    </Link>
  );
}

function SectionTitle({ title, to }: { title: string; to: DashboardPath }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-semibold text-[#102A43]">{title}</h2>
      <Link to={to} className="text-xs font-medium text-teal-800 hover:underline">
        View all →
      </Link>
    </div>
  );
}

function Status({ label, value }: { label: string; value: number }) {
  return (
    <div
      className={`rounded-lg p-3 ${label === "Ready" ? "bg-emerald-50" : label === "In progress" ? "bg-blue-50" : label === "Do Not Disturb" ? "bg-violet-50" : "bg-amber-50"}`}
    >
      <span className="text-slate-600">{label}</span>
      <strong className="mt-1 block text-xl text-[#102A43]">{value}</strong>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <p className="mt-4 text-sm text-slate-500">{text}</p>;
}

function ErrorCard({ label }: { label: string }) {
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {label}
    </p>
  );
}
