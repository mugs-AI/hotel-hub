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
import { isoToMyDate, formatMyTimestamp } from "@/lib/malaysia-date";
import { hotelJson, type HotelSettingsDTO } from "@/lib/hotel-settings-client";
import { folioLineTitle } from "@/lib/folio-presentation";
import { useFolioBillTo } from "@/lib/folio-bill-to-client";

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
  const billTo = useFolioBillTo(id, canView);
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
      !query.data.recordedDeposits ||
      !printSettings.data ||
      !billTo.data ||
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
  }, [query.data, printSettings.data, billTo.data]);

  if (data?.authenticated !== true) return null;
  if (!canView) {
    return (
      <main className="mx-auto max-w-xl p-8 text-sm">
        You don’t have permission to view this folio.
      </main>
    );
  }
  if (query.isPending || printSettings.isPending || billTo.isPending)
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
  if (billTo.error || !billTo.data)
    return (
      <main className="p-8 text-sm">
        Unable to load guest billing details. Reload to try again.
      </main>
    );

  const dto = query.data;
  if (!dto.recordedDeposits)
    return (
      <main className="p-8 text-sm">Unable to load recorded deposits. Reload to try again.</main>
    );
  const recorded = dto.recordedDeposits;
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
          "--folio-note-pt": `calc(${printSettings.data.settings.folioNotePt}pt + 1pt)`,
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
        .letterhead { border-bottom: 2px solid #102A43; padding-bottom: 3mm; margin-bottom: 4mm; }
        .letterhead .company { font-size: 14pt; font-weight: 800; color: #102A43; margin: 0 0 1mm; }
        .letterhead h1 { font-size: 13pt; font-weight: 700; margin: 4mm 0 1mm; }
        .letterhead p { margin: 1mm 0 0; color: #4a5568; }
        .letterhead .contact { white-space: pre-line; font-size: 7.5pt; }
        .folio-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 6mm; margin: 0 0 5mm; }
        .folio-meta > div { background: #f4f6f8; padding: 2mm; min-height: 14mm; }
        .folio-meta dt { color: #4a5568; }
        .folio-meta dd { margin: 0; font-weight: 600; }
        h2.section { font-size: 9pt; font-weight: 700; text-transform: uppercase;
                     color: #102A43; margin: 0 0 2mm; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th { text-align: left; font-size: 7.5pt; text-transform: uppercase; color: #102A43;
             border-top: 1px solid #102A43; border-bottom: 1px solid #102A43; background: #eef1f4; padding: 1.5mm 1mm; }
        td { padding: 1.5mm 1mm; border-bottom: 1px solid #E2E8F0; vertical-align: top; overflow-wrap: anywhere; }
        tr.extra-row { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        tr.extra-row td:first-child { padding-left: 2mm; }
        td.num, th.num { text-align: right; }
        .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .stay-date { display: inline-block; font-weight: 700; border: 1px solid #a9b8c5; border-radius: 1mm; padding: .4mm 1mm; margin-right: 2mm; white-space: nowrap; }
        .totals { margin-top: 3mm; margin-left: auto; width: 75mm; }
        .totals dl { display: grid; grid-template-columns: 1fr auto; gap: 1mm 4mm; margin: 0; }
        .totals dt { color: #4a5568; }
        .totals dd { margin: 0; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .prepared-total { font-weight: 700; font-size: calc(var(--folio-body-pt) + 1pt); border-top: 1px solid #102A43; padding-top: 2mm; }
        .grand { font-weight: 800; font-size: calc(var(--folio-body-pt) + 1.5pt); color: #102A43; border-top: 2px solid #102A43; padding-top: 2mm; }
        .deposit-list { margin-top: 4mm; }
        .signature-block { display: grid; grid-template-columns: 1fr 1fr; gap: 16mm; margin-top: 12mm; }
        .signature { border-top: 1px solid #102A43; padding-top: 1.5mm; }
        .guest-name { margin-top: 5mm; }
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
          <h1>Guest Folio · Prepared Statement</h1>
          <p>
            Booking {dto.reservation.bookingReference} · {isoToMyDate(dto.propertyDate)}
          </p>
        </header>

        <dl className="folio-meta">
          <div>
            <dt>Bill to</dt>
            {billTo.data.billTo.company ? <dd>{billTo.data.billTo.company}</dd> : null}
            <dd>{billTo.data.billTo.name || dto.reservation.primaryGuestName || "—"}</dd>
            {billTo.data.billTo.address ? (
              <dd className="whitespace-pre-line" style={{ fontWeight: 400 }}>
                {billTo.data.billTo.address}
              </dd>
            ) : null}
            {billTo.data.billTo.phone ? (
              <dd style={{ fontWeight: 400 }}>{billTo.data.billTo.phone}</dd>
            ) : null}
            {billTo.data.billTo.email ? (
              <dd style={{ fontWeight: 400 }}>{billTo.data.billTo.email}</dd>
            ) : null}
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
                      {l.stayDate ? (
                        <span className="stay-date">{isoToMyDate(l.stayDate)}</span>
                      ) : null}
                      {folioLineTitle(l)}
                    </span>
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

        <section className="deposit-list">
          <h2 className="section">Deposits ({currency})</h2>
          {recorded.items.length ? (
            <table>
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Date</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recorded.items.map((item, index) => (
                  <tr key={index}>
                    <td>{item.n3DocCode ?? "—"}</td>
                    <td>{formatMyTimestamp(item.createdAt).slice(0, 10)}</td>
                    <td className="num">{paperNumber(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No posted deposits.</p>
          )}
          {recorded.hasUnconfirmed ? (
            <p>Unconfirmed deposits are excluded. Check N3 before final settlement.</p>
          ) : null}
        </section>
        <div className="totals">
          <dl>
            {visibleFolioTotalRows(dto).map((row) => (
              <div key={row.key} className="contents">
                <dt>{row.label}</dt>
                <dd>{paperNumber(row.amount)}</dd>
              </div>
            ))}
            <dt className="prepared-total">Prepared total</dt>
            <dd className="prepared-total">{formatFolioMoney(dto.totals.grandTotal, currency)}</dd>
            <dt>Less deposits</dt>
            <dd>{formatFolioMoney(recorded.total, currency)}</dd>
            <dt className="grand">Net figure</dt>
            <dd className="grand">{formatFolioMoney(recorded.netFigure, currency)}</dd>
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
          <div className="signature">Hotel representative signature</div>
          <div className="signature">
            Guest signature<div className="guest-name">Guest name: __________________________</div>
          </div>
        </div>

        <p className="note">
          Prepared folio. Deposits deducted; balance subject to final settlement. Not a tax invoice
          or receipt.
        </p>
      </section>
    </div>
  );
}
