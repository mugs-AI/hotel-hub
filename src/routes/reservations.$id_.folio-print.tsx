// HH-GOLIVE-01A — printable guest folio (A4 portrait), preparation only.
//
// Every money value is rendered from the server-derived DTO. The browser does
// not compute a single financial figure here. Nothing is posted to accounting:
// this is a guest-facing statement of the prepared folio, not an invoice.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import { folioErrorMessage, useReservationFolio } from "@/lib/folio-client";
import { formatFolioMoney, visibleFolioTotalRows } from "@/lib/folio-view";
import { useCheckoutPreview } from "@/lib/checkout-client";
import { isoToMyDate } from "@/lib/malaysia-date";

export const Route = createFileRoute("/reservations/$id_/folio-print")({
  head: () => ({
    meta: [
      { title: "Print Folio — HotelHub" },
      { name: "description", content: "Printable prepared guest folio for this reservation." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FolioPrintPage,
});

function FolioPrintPage() {
  const { id } = Route.useParams();
  const session = useSessionMe();
  const data = session.data;
  const role = data && data.authenticated === true ? data.role : null;
  const canView = hasPermission(role, "hotel:folio:view");
  const companyName =
    data?.authenticated === true ? (data.tenant.companyName ?? data.tenant.tenantCode ?? "") : "";
  const query = useReservationFolio(id, canView);
  // Deposits and the settlement balance are NEVER computed here: they come
  // from the server checkout preview, which verifies each deposit in N3.
  const preview = useCheckoutPreview(canView ? id : undefined);

  useEffect(() => {
    if (preview.isPending) return;
    if (query.data && typeof window !== "undefined") {
      const t = window.setTimeout(() => window.print(), 300);
      return () => window.clearTimeout(t);
    }
  }, [query.data, preview.isPending]);

  if (data?.authenticated !== true) return null;
  if (!canView) {
    return (
      <main className="mx-auto max-w-xl p-8 text-sm">
        You don’t have permission to view this folio.
      </main>
    );
  }
  if (query.isPending) return <main className="p-8 text-sm">Loading folio…</main>;
  if (query.error || !query.data) {
    return (
      <main className="p-8 text-sm">{folioErrorMessage(query.error, "Unable to load folio.")}</main>
    );
  }

  const dto = query.data;
  const currency = dto.reservation.currency;
  const settlement = preview.data ?? null;

  return (
    <div className="print-root">
      <style>{`
        @page { size: A4 portrait; margin: 16mm; }
        @media screen {
          .print-root { background: #f3f4f6; padding: 24px; min-height: 100vh; }
          .a4-page { background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.15); margin: 0 auto;
                     width: 210mm; min-height: 297mm; padding: 16mm; box-sizing: border-box; }
        }
        @media print {
          body { background: white; }
          .no-print { display: none !important; }
          .a4-page { padding: 0; margin: 0; width: auto; min-height: auto; box-shadow: none; }
        }
        .a4-page { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                   color: #102A43; font-size: 12px; line-height: 1.4; }
        .letterhead { border-bottom: 1.5px solid #102A43; padding-bottom: 8px; margin-bottom: 12px; }
        .letterhead .company { font-size: 13px; font-weight: 700; color: #0F9D8A; margin: 0 0 2px; }
        .letterhead h1 { font-size: 17px; font-weight: 700; margin: 0; }
        .letterhead p { margin: 2px 0 0; font-size: 11px; color: #4a5568; }
        h2.section { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;
                     color: #0F9D8A; margin: 14px 0 6px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 11px; text-transform: uppercase; color: #4a5568;
             border-bottom: 1px solid #102A43; padding: 4px 0; }
        td { padding: 4px 0; border-bottom: 1px solid #E2E8F0; vertical-align: top; }
        td.num, th.num { text-align: right; }
        .totals { margin-top: 10px; margin-left: auto; width: 70mm; }
        .totals dl { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; margin: 0; }
        .totals dt { color: #4a5568; }
        .totals dd { margin: 0; text-align: right; }
        .grand { font-weight: 700; font-size: 13px; border-top: 1px solid #102A43; padding-top: 4px; }
        .note { margin-top: 14px; font-size: 11px; color: #4a5568; }
      `}</style>

      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between text-sm">
        <Link to="/reservations/$id" params={{ id }} className="text-blue-700 underline">
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

      <section className="a4-page">
        <header className="letterhead">
          {companyName ? <p className="company">{companyName}</p> : null}
          <h1>Guest Folio — Prepared Statement</h1>
          <p>
            Booking {dto.reservation.bookingReference}
            {dto.reservation.primaryGuestName ? ` · ${dto.reservation.primaryGuestName}` : ""}
            {" · "}
            {isoToMyDate(dto.reservation.arrivalDate)} →{" "}
            {isoToMyDate(dto.reservation.departureDate)}
          </p>
        </header>

        <h2 className="section">Charges</h2>
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th className="num">Qty</th>
              <th className="num">Unit</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {dto.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <span style={l.status === "reversed" ? { textDecoration: "line-through" } : {}}>
                    {l.description}
                  </span>
                  {l.roomLabel ? (
                    <span style={{ display: "block", color: "#4a5568" }}>
                      {l.roomLabel}
                      {l.stayDate ? ` · ${isoToMyDate(l.stayDate)}` : ""}
                    </span>
                  ) : null}
                </td>
                <td className="num">{l.quantity}</td>
                <td className="num">{formatFolioMoney(l.unitPrice, currency)}</td>
                <td className="num">{formatFolioMoney(l.amount, currency)}</td>
              </tr>
            ))}
            {dto.derived.map((d) => (
              <tr key={d.key}>
                <td>{d.description}</td>
                <td className="num">{d.quantity}</td>
                <td className="num">{formatFolioMoney(d.unitPrice, currency)}</td>
                <td className="num">{formatFolioMoney(d.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="totals">
          <dl>
            {visibleFolioTotalRows(dto).map((row) => (
              <div key={row.key} className="contents">
                <dt>{row.label}</dt>
                <dd>{formatFolioMoney(row.amount, currency)}</dd>
              </div>
            ))}
            <dt className="grand">Prepared total</dt>
            <dd className="grand">{formatFolioMoney(dto.totals.grandTotal, currency)}</dd>
            {settlement ? (
              <>
                <dt>Verified deposits / credits</dt>
                <dd>
                  {settlement.deposits.verifiedTotal === null
                    ? "—"
                    : formatFolioMoney(settlement.deposits.verifiedTotal, currency)}
                </dd>
                <dt className="grand">Current balance</dt>
                <dd className="grand">
                  {settlement.summary.estimatedBalance === null
                    ? "—"
                    : formatFolioMoney(settlement.summary.estimatedBalance, currency)}
                </dd>
                {settlement.summary.excessDeposit !== null &&
                settlement.summary.excessDeposit > 0 ? (
                  <>
                    <dt>Credit to review</dt>
                    <dd>{formatFolioMoney(settlement.summary.excessDeposit, currency)}</dd>
                  </>
                ) : null}
              </>
            ) : null}
          </dl>
        </div>

        <p className="note">
          This is a prepared statement for guest review only. It is not a tax invoice or a receipt:
          nothing here has been posted to accounting, no deposit has been matched and no refund has
          been issued.
        </p>
      </section>
    </div>
  );
}
