// HH-GOLIVE-01A — printable guest folio (A4 portrait), preparation only.
//
// Every money value is rendered from the server-derived DTO. The browser does
// not compute a single financial figure here. Nothing is posted to accounting:
// this is a guest-facing statement of the prepared folio, not an invoice.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import { folioErrorMessage, useReservationFolio } from "@/lib/folio-client";
import {
  folioExtraAccent,
  folioExtraAccentMap,
  formatFolioMoney,
  formatFolioTaxRate,
  guestFacingFolioRows,
  visibleFolioTotalRows,
} from "@/lib/folio-view";
import { useCheckoutPreview } from "@/lib/checkout-client";
import { isoToMyDate } from "@/lib/malaysia-date";
import { hotelJson, type HotelSettingsDTO } from "@/lib/hotel-settings-client";

function paperNumber(value: number): string {
  return `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
}

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
  const [includeVerifiedSettlement, setIncludeVerifiedSettlement] = useState(false);
  const hasAutoPrinted = useRef(false);
  const session = useSessionMe();
  const data = session.data;
  const role = data && data.authenticated === true ? data.role : null;
  const canView = hasPermission(role, "hotel:folio:view");
  const companyName =
    data?.authenticated === true ? (data.tenant.companyName ?? data.tenant.tenantCode ?? "") : "";
  const query = useReservationFolio(id, canView);
  const printSettings = useQuery({
    queryKey: ["folio-print-settings", data?.authenticated === true ? data.tenant.tenantId : null],
    queryFn: () => hotelJson<{ settings: HotelSettingsDTO }>("/api/hotel/settings"),
    enabled: canView,
    retry: false,
  });
  // The default guest-folio print must stay independent of live N3 receipt
  // verification. A reservation can have up to 20 deposits and each N3 read
  // has a 20-second timeout, so starting that work while Chrome is building
  // its print preview can hold "Preparing Preview" open for 90–120 seconds.
  // Staff may explicitly load the verified settlement after the fast initial
  // print; its money values still come only from the authoritative server DTO.
  const preview = useCheckoutPreview(includeVerifiedSettlement && canView ? id : undefined);

  useEffect(() => {
    if (
      !query.data ||
      !printSettings.data ||
      typeof window === "undefined" ||
      hasAutoPrinted.current
    )
      return;
    hasAutoPrinted.current = true;

    // Two animation frames allow the committed A4 layout to paint without a
    // fixed delay. No N3 request is running on this default path.
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => window.print());
    });
    return () => window.cancelAnimationFrame(frame);
  }, [query.data, printSettings.data]);

  if (data?.authenticated !== true) return null;
  if (!canView) {
    return (
      <main className="mx-auto max-w-xl p-8 text-sm">
        You don’t have permission to view this folio.
      </main>
    );
  }
  if (query.isPending || printSettings.isPending)
    return <main className="p-8 text-sm">Loading folio…</main>;
  if (query.error || !query.data) {
    return (
      <main className="p-8 text-sm">{folioErrorMessage(query.error, "Unable to load folio.")}</main>
    );
  }
  if (printSettings.error || !printSettings.data) {
    return (
      <main className="p-8 text-sm">Unable to load folio print settings. Reload to try again.</main>
    );
  }

  const dto = query.data;
  const currency = dto.reservation.currency;
  const settlement = includeVerifiedSettlement ? (preview.data ?? null) : null;
  const guestRows = guestFacingFolioRows(dto);
  const extraAccents = folioExtraAccentMap([
    ...dto.catalogue.map((item) => item.id),
    ...dto.lines.map((line) => line.catalogueId),
  ]);

  return (
    <div
      className="print-root"
      style={
        {
          "--folio-body-pt": `${printSettings.data.settings.folioBodyPt}pt`,
          "--folio-note-pt": `${printSettings.data.settings.folioNotePt}pt`,
        } as CSSProperties
      }
    >
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        .print-root { background: #f3f4f6; padding: 24px; min-height: 100vh; }
        .a4-page { background: white; width: 210mm; min-height: 297mm; padding: 16mm;
                   box-sizing: border-box; margin: 0 auto; box-shadow: 0 1px 3px rgba(0,0,0,0.15);
                   font-family: Arial, Helvetica, sans-serif; color: #102A43;
                   font-size: var(--folio-body-pt); line-height: 1.25; }
        @media screen {
          .a4-page { overflow: hidden; }
        }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          .print-root { padding: 0; min-height: 0; background: white; }
          .no-print { display: none !important; }
          .a4-page { margin: 0; min-height: 0; box-shadow: none; overflow: visible; }
          thead { display: table-header-group; }
          tr, .totals, .signature-block { break-inside: avoid; page-break-inside: avoid; }
        }
        .letterhead { border-bottom: 1px solid #102A43; padding-bottom: 3mm; margin-bottom: 4mm; }
        .letterhead .company { font-size: 10pt; font-weight: 700; color: #0F9D8A; margin: 0 0 1mm; }
        .letterhead h1 { font-size: 12pt; font-weight: 700; margin: 0; }
        .letterhead p { margin: 1mm 0 0; color: #4a5568; }
        .letterhead .contact { white-space: pre-line; font-size: 7.5pt; }
        .folio-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 6mm; margin: 0 0 4mm; }
        .folio-meta dt { color: #4a5568; }
        .folio-meta dd { margin: 0; font-weight: 600; }
        h2.section { font-size: 9pt; font-weight: 700; text-transform: uppercase;
                     color: #0F9D8A; margin: 0 0 2mm; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th { text-align: left; font-size: 7.5pt; text-transform: uppercase; color: #4a5568;
             border-top: 1px solid #102A43; border-bottom: 1px solid #102A43; padding: 1.5mm 1mm; }
        td { padding: 1.5mm 1mm; border-bottom: 1px solid #E2E8F0; vertical-align: top; overflow-wrap: anywhere; }
        tr.extra-row { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        tr.extra-row td:first-child { padding-left: 2mm; }
        td.num, th.num { text-align: right; }
        .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .line-meta { display: block; margin-top: .5mm; color: #4a5568; font-size: 7pt; }
        .totals { margin-top: 3mm; margin-left: auto; width: 75mm; }
        .totals dl { display: grid; grid-template-columns: 1fr auto; gap: 1mm 4mm; margin: 0; }
        .totals dt { color: #4a5568; }
        .totals dd { margin: 0; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .grand { font-weight: 700; font-size: 9pt; border-top: 1px solid #102A43; padding-top: 1.5mm; }
        .signature-block { display: grid; grid-template-columns: 1fr 1fr; gap: 16mm; margin-top: 12mm; }
        .signature { border-top: 1px solid #102A43; padding-top: 1.5mm; }
        .note { margin-top: 6mm; font-size: var(--folio-note-pt); line-height: 1.25; color: #4a5568; }
      `}</style>

      <div className="no-print mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-3 text-sm">
        <Link to="/reservations/$id" params={{ id }} className="text-blue-700 underline">
          ← Back to reservation
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!includeVerifiedSettlement ? (
            <button
              type="button"
              onClick={() => setIncludeVerifiedSettlement(true)}
              className="rounded-md border bg-white px-3 py-1.5 text-xs font-medium"
            >
              Load verified deposit balance
            </button>
          ) : preview.isPending ? (
            <span className="text-xs text-slate-600">Verifying deposits in N3…</span>
          ) : null}
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border bg-white px-3 py-1.5 text-xs font-medium"
          >
            Print again
          </button>
        </div>
      </div>
      <p className="no-print mx-auto mb-3 max-w-3xl text-xs text-slate-600">
        A4 preview at actual paper size. In the browser printer dialog choose 100% scale and turn
        off browser headers and footers; 150% enlarges and reflows the page.
      </p>

      <section className="a4-page">
        <header className="letterhead">
          {companyName ? <p className="company">{companyName}</p> : null}
          {printSettings.data.settings.folioContactAddress ? (
            <p className="contact">{printSettings.data.settings.folioContactAddress}</p>
          ) : null}
          {printSettings.data.settings.folioContactPhone ||
          printSettings.data.settings.folioContactEmail ? (
            <p className="contact">
              {[
                printSettings.data.settings.folioContactPhone,
                printSettings.data.settings.folioContactEmail,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          <h1>Guest Folio — Prepared Statement</h1>
          <p>
            Booking {dto.reservation.bookingReference} · {isoToMyDate(dto.propertyDate)}
          </p>
        </header>

        <dl className="folio-meta">
          <div>
            <dt>Guest</dt>
            <dd>{dto.reservation.primaryGuestName || "—"}</dd>
          </div>
          <div>
            <dt>Stay</dt>
            <dd>
              {isoToMyDate(dto.reservation.arrivalDate)} –{" "}
              {isoToMyDate(dto.reservation.departureDate)}
            </dd>
          </div>
        </dl>

        <h2 className="section">Itemized charges ({currency})</h2>
        <table>
          <colgroup>
            <col style={{ width: "55%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "15%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Description</th>
              <th className="num">Tax %</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {guestRows.map((row) => {
              if (row.kind === "derived") {
                const d = row.line;
                return (
                  <tr key={row.key}>
                    <td>{d.description}</td>
                    <td className="num">{formatFolioTaxRate(d.taxRateBp)}</td>
                    <td className="num">{d.quantity}</td>
                    <td className="num">{paperNumber(d.unitPrice)}</td>
                    <td className="num">{paperNumber(d.amount)}</td>
                  </tr>
                );
              }
              const l = row.line;
              const accent =
                l.lineType === "add_on" && l.catalogueId
                  ? (extraAccents.get(l.catalogueId) ?? folioExtraAccent(l.catalogueId))
                  : null;
              return (
                <tr
                  key={row.key}
                  className={accent ? "extra-row" : undefined}
                  style={accent ? { backgroundColor: accent.surface } : undefined}
                >
                  <td>
                    <span
                      style={
                        accent
                          ? { borderLeft: `3px solid ${accent.border}`, paddingLeft: 5 }
                          : undefined
                      }
                    >
                      {l.lineType === "room_night" && l.roomLabel
                        ? `Room charge — ${l.roomLabel}`
                        : l.description}
                    </span>
                    {l.stayDate ? (
                      <span className="line-meta">{isoToMyDate(l.stayDate)}</span>
                    ) : null}
                  </td>
                  <td className="num">{formatFolioTaxRate(l.taxRateBp)}</td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{paperNumber(l.unitPrice)}</td>
                  <td className="num">{paperNumber(l.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="totals">
          <dl>
            {visibleFolioTotalRows(dto).map((row) => (
              <div key={row.key} className="contents">
                <dt>{row.label}</dt>
                <dd>{paperNumber(row.amount)}</dd>
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

        <div className="signature-block" aria-label="Signatures">
          <div className="signature">Guest signature</div>
          <div className="signature">Hotel representative signature</div>
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
