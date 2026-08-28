import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { FolioCard } from "@/components/FolioCard";
import { useCheckoutPreview, checkoutErrorMessage, formatMoney } from "@/lib/checkout-client";

export const Route = createFileRoute("/reservations/$id_/checkout")({
  head: () => ({
    meta: [
      { title: "Prepare Checkout — HotelHub" },
      {
        name: "description",
        content: "Read-only room folio preview, verified deposits and remaining checkout blockers.",
      },
      { property: "og:title", content: "Prepare Checkout — HotelHub" },
      {
        property: "og:description",
        content: "Read-only room folio preview, verified deposits and remaining checkout blockers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CheckoutPreviewPage,
});

function CheckoutPreviewPage() {
  const { id } = useParams({ from: "/reservations/$id_/checkout" });
  const q = useCheckoutPreview(id);
  const d = q.data;

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Prepare Checkout</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only preview. Nothing is posted to accounting, and the reservation and rooms are
              not changed.
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <Link
              to="/departures"
              className="rounded-md border border-input bg-background px-3 py-1.5 font-medium hover:bg-accent"
            >
              Back to Departures
            </Link>
            <Link
              to="/reservations/$id"
              params={{ id }}
              className="rounded-md border border-input bg-background px-3 py-1.5 font-medium hover:bg-accent"
            >
              Reservation
            </Link>
          </div>
        </div>

        {q.isLoading ? <p className="text-sm text-muted-foreground">Preparing preview…</p> : null}
        {q.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {checkoutErrorMessage(q.error)}
          </p>
        ) : null}

        {d ? (
          <>
            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-base font-semibold">
                {d.reservation.bookingReference} · {d.reservation.primaryGuestName ?? "Guest"}
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <dt className="text-muted-foreground">Arrival</dt>
                <dd>{d.reservation.arrivalDate}</dd>
                <dt className="text-muted-foreground">Departure</dt>
                <dd>{d.reservation.departureDate}</dd>
                <dt className="text-muted-foreground">Rooms</dt>
                <dd>{d.reservation.roomLabels.join(", ") || "—"}</dd>
                <dt className="text-muted-foreground">Property date</dt>
                <dd>{d.propertyDate}</dd>
              </dl>
            </section>

            <section className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Room folio (room charges only)</h2>
                <span className="text-sm text-muted-foreground">
                  {d.folio.calculationStatus === "calculated" ? "Calculated" : "Blocked"}
                </span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-sm uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-2">Room</th>
                      <th className="py-2">Stock code</th>
                      <th className="py-2">Service period</th>
                      <th className="py-2 text-right">Nights</th>
                      <th className="py-2 text-right">Rate</th>
                      <th className="py-2 text-right">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.folio.lines.map((l) => (
                      <tr key={l.reservationRoomId} className="border-t border-border">
                        <td className="py-2">{l.roomLabel}</td>
                        <td className="py-2 font-mono text-sm">{l.n3StockCode ?? "unmapped"}</td>
                        <td className="py-2">
                          {l.servicePeriodStart} → {l.servicePeriodEnd}
                        </td>
                        <td className="py-2 text-right">{l.nights}</td>
                        <td className="py-2 text-right">{formatMoney(l.unitRate, l.currency)}</td>
                        <td className="py-2 text-right">{formatMoney(l.lineTotal, l.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-right text-base font-semibold">
                Room charge total: {formatMoney(d.folio.roomChargeTotal, d.reservation.currency)}
              </p>
            </section>

            {/* Authoritative prepared folio: extras, Malaysian taxes and levies.
                The room-charge table above stays as the N3 posting projection. */}
            <FolioCard reservationId={id} canView />

            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-base font-semibold">Verified deposits (N3, read-only)</h2>
              {d.deposits.rows.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No deposits recorded for this reservation.
                </p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {d.deposits.rows.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2"
                    >
                      <span className="font-mono text-sm">{r.n3DocCode ?? "—"}</span>
                      <span>{r.customerLabel ?? "—"}</span>
                      <span>{formatMoney(r.amount, r.currency)}</span>
                      <span
                        className="rounded px-2 py-0.5 text-sm font-medium"
                        style={{
                          backgroundColor: r.verification === "verified" ? "#E7F6F3" : "#FDF3E7",
                          color: "#102A43",
                        }}
                        title={r.reason ?? undefined}
                      >
                        {r.verification}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-right text-base font-semibold">
                Verified deposit total:{" "}
                {formatMoney(d.deposits.verifiedTotal, d.reservation.currency)}
              </p>
            </section>

            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-base font-semibold">Estimated settlement</h2>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Estimated balance due</dt>
                <dd className="text-right text-base font-semibold">
                  {formatMoney(d.summary.estimatedBalance, d.reservation.currency)}
                </dd>
                <dt className="text-muted-foreground">Excess deposit / credit requiring review</dt>

                <dd className="text-right">
                  {formatMoney(d.summary.excessDeposit, d.reservation.currency)}
                </dd>
                <dt className="text-muted-foreground">N3 outstanding</dt>
                <dd className="text-right">Not available in this milestone</dd>
              </dl>
            </section>

            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-base font-semibold">
                Checkout readiness — {d.readiness.calculationComplete ? "calculated" : "blocked"}
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                {d.readiness.blockers.map((b) => (
                  <li
                    key={b.code}
                    className="rounded-md border p-3"
                    style={{
                      borderColor: b.severity === "blocking" ? "#F3C7C3" : "#E2E8F0",
                      backgroundColor: b.severity === "blocking" ? "#FDECEC" : "#F8FAFC",
                    }}
                  >
                    <span className="text-sm font-semibold uppercase tracking-wide">
                      {b.severity}
                    </span>
                    <p className="mt-1">{b.message}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-muted-foreground">
                Financial posting is disabled in this milestone: no CashMemo, no deposit matching,
                no refund and no room-status change.
              </p>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
