// Half-A4 (A5 portrait) print-preview: one registration form per room.
// - Owner + Front Desk only (relies on the same session/RBAC as detail).
// - Auto-opens the browser print dialog on mount.
// - Uses `hotel_reservation_rooms.remark`, masked guest identity, and
//   guest notes. Raw identity numbers never leave the server.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import { useReservationDetail } from "@/lib/reservations-client";
import { formatIsoDate, roomLabel } from "@/lib/reservations-ui";
import { identityTypeLabel } from "@/lib/guest-identity";
import { countryName } from "@/lib/iso-countries";
import { malaysianStateName } from "@/lib/malaysia-states";

export const Route = createFileRoute("/reservations/$id_/print")({
  head: () => ({
    meta: [
      { title: "Print Registration Forms — HotelHub" },
      { name: "description", content: "Half-A4 room registration forms for printing." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintPage,
});

function PrintPage() {
  const { id } = Route.useParams();
  const session = useSessionMe();
  const data = session.data;
  const role = data && data.authenticated === true ? data.role : null;
  const canView = hasPermission(role, "hotel:reservations:view");
  const companyName =
    data?.authenticated === true ? (data.tenant.companyName ?? data.tenant.tenantCode ?? "") : "";
  const query = useReservationDetail(id);

  useEffect(() => {
    if (query.data && typeof window !== "undefined") {
      const t = window.setTimeout(() => window.print(), 300);
      return () => window.clearTimeout(t);
    }
  }, [query.data]);

  if (data?.authenticated !== true) return null;
  if (!canView) {
    return (
      <main className="mx-auto max-w-xl p-8 text-sm">
        You don’t have permission to view this reservation.
      </main>
    );
  }
  if (query.isPending) {
    return <main className="p-8 text-sm">Loading reservation…</main>;
  }
  if (query.error || !query.data) {
    return <main className="p-8 text-sm">Unable to load reservation for printing.</main>;
  }

  const r = query.data.reservation;
  const primary = r.guests.find((g) => g.isPrimary) ?? r.guests[0] ?? null;

  return (
    <div className="print-root">
      <style>{`
        @page { size: A5 portrait; margin: 12mm; }
        @media screen {
          .print-root { background: #f3f4f6; padding: 24px; min-height: 100vh; }
          .a5-page { background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.15); margin: 0 auto 16px;
                     width: 148mm; min-height: 210mm; padding: 12mm; box-sizing: border-box; }
        }
        @media print {
          body { background: white; }
          .no-print { display: none !important; }
          .a5-page { page-break-after: always; padding: 0; margin: 0; width: auto; min-height: auto; }
          .a5-page:last-child { page-break-after: auto; }
        }
        .a5-page { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                   color: #102A43; font-size: 11px; line-height: 1.35; }
        .letterhead { border-bottom: 1.5px solid #102A43; padding-bottom: 6px; margin-bottom: 10px; }
        .letterhead h1 { font-size: 15px; font-weight: 700; margin: 0; }
        .letterhead p { margin: 2px 0 0; font-size: 10px; color: #4a5568; }
        .letterhead .company { font-size: 12px; font-weight: 700; color: #0F9D8A; margin: 0 0 2px; letter-spacing: 0.02em; }
        h2.section { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
                     color: #0F9D8A; margin: 10px 0 4px; }
        .kv { display: grid; grid-template-columns: 34mm 1fr; gap: 2px 8px; }
        .kv dt { color: #4a5568; }
        .kv dd { margin: 0; }
        .sig { margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; }
        .sig div { border-top: 1px solid #102A43; padding-top: 4px; font-size: 10px; color: #4a5568; }
        .field-line { border-bottom: 1px solid #102A43; min-height: 14px; padding: 1px 2px; }
      `}</style>

      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between text-sm">
        <Link to="/reservations/$id" params={{ id: r.id }} className="text-blue-700 underline">
          ← Back to reservation
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md border bg-white px-3 py-1.5 text-xs font-medium"
        >
          Print again
        </button>
      </div>

      {r.rooms.map((room, idx) => (
        <section key={room.id} className="a5-page">
          <header className="letterhead">
            {companyName ? <p className="company">{companyName}</p> : null}
            <h1>Guest Registration Form</h1>
            <p>
              Booking {r.bookingReference}
              {r.externalBookingReference ? ` · Ref ${r.externalBookingReference}` : ""}
              {" · "}Form {idx + 1} of {r.rooms.length}
            </p>
          </header>

          <h2 className="section">Stay</h2>
          <dl className="kv">
            <dt>Room</dt>
            <dd>
              <strong>{roomLabel(room.displayName, room.n3StockName, room.roomNumber)}</strong>
              <span style={{ color: "#4a5568" }}> · {room.roomNumber}</span>
            </dd>
            <dt>Arrival</dt>
            <dd>{formatIsoDate(r.arrivalDate)}</dd>
            <dt>Departure</dt>
            <dd>{formatIsoDate(r.departureDate)}</dd>
            <dt>Occupancy</dt>
            <dd>
              {room.adults} adult{room.adults === 1 ? "" : "s"}, {room.children} child
              {room.children === 1 ? "" : "ren"}
            </dd>
            <dt>Rate</dt>
            <dd>
              {r.currency} {Number(room.agreedRate).toFixed(2)} / night
            </dd>
            {room.remark ? (
              <>
                <dt>Room remark</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{room.remark}</dd>
              </>
            ) : null}
          </dl>

          <h2 className="section">Primary Guest</h2>
          {primary ? (
            <dl className="kv">
              <dt>Full name</dt>
              <dd>{primary.fullName || <span className="field-line" />}</dd>
              <dt>Mobile</dt>
              <dd>{primary.mobile || <span className="field-line" />}</dd>
              <dt>Email</dt>
              <dd>{primary.email || <span className="field-line" />}</dd>
              <dt>Nationality</dt>
              <dd>
                {primary.nationalityCode
                  ? countryName(primary.nationalityCode) || primary.nationalityCode
                  : primary.nationality || <span className="field-line" />}
              </dd>
              <dt>Identity</dt>
              <dd>
                {primary.identityType ? identityTypeLabel(primary.identityType) : "—"}{" "}
                <span style={{ fontFamily: "ui-monospace, monospace" }}>
                  {primary.identityNumberMasked ?? ""}
                </span>
              </dd>
              <dt>Address</dt>
              <dd>
                {[
                  primary.addressLine1,
                  primary.addressLine2,
                  primary.addressLine3,
                  [primary.postcode, primary.city].filter(Boolean).join(" "),
                  primary.countryCode === "MYS"
                    ? malaysianStateName(primary.stateCode)
                    : primary.stateProvince,
                  primary.countryCode ? countryName(primary.countryCode) : "",
                ]
                  .map((s) => (s ?? "").trim())
                  .filter(Boolean)
                  .join(", ") || <span className="field-line" />}
              </dd>
              {primary.notes ? (
                <>
                  <dt>Guest notes</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{primary.notes}</dd>
                </>
              ) : null}
            </dl>
          ) : (
            <p style={{ color: "#4a5568" }}>No primary guest recorded.</p>
          )}

          {r.guests.filter((g) => !g.isPrimary).length > 0 ? (
            <>
              <h2 className="section">Additional Guests (assignment pending)</h2>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {r.guests
                  .filter((g) => !g.isPrimary)
                  .map((g) => (
                    <li key={g.id}>
                      {g.fullName}
                      {g.identityType && g.identityNumberMasked
                        ? ` · ${identityTypeLabel(g.identityType)} ${g.identityNumberMasked}`
                        : ""}
                    </li>
                  ))}
              </ul>
            </>
          ) : null}

          <div className="sig">
            <div>Guest signature &amp; date</div>
            <div>Received by (staff)</div>
          </div>
        </section>
      ))}
    </div>
  );
}
