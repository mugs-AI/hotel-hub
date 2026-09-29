import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSessionMe } from "@/lib/session-client";
import { hasPermission } from "@/lib/rbac";
import { usePrintableDepositReceipt } from "@/lib/deposits-client";
import { hotelJson, type HotelSettingsDTO } from "@/lib/hotel-settings-client";

function malaysiaTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export const Route = createFileRoute("/reservations/$id_/deposits/$depositId/receipt-print")({
  head: () => ({
    meta: [{ title: "Print N3 Receipt — HotelHub" }, { name: "robots", content: "noindex" }],
  }),
  component: DepositReceiptPrintPage,
});

function DepositReceiptPrintPage() {
  const { id, depositId } = Route.useParams();
  const session = useSessionMe();
  const data = session.data;
  const role = data?.authenticated === true ? data.role : null;
  const canView = hasPermission(role, "hotel:deposits:view");
  const receipt = usePrintableDepositReceipt(id, depositId, canView);
  const settings = useQuery({
    queryKey: ["folio-print-settings", data?.authenticated === true ? data.tenant.tenantId : null],
    queryFn: () => hotelJson<{ settings: HotelSettingsDTO }>("/api/hotel/settings"),
    enabled: canView,
    retry: false,
  });
  const printed = useRef(false);
  useEffect(() => {
    if (!receipt.data || !settings.data || printed.current) return;
    printed.current = true;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => window.print());
    });
    return () => cancelAnimationFrame(frame);
  }, [receipt.data, settings.data]);

  if (data?.authenticated !== true) return null;
  if (!canView) return <main className="p-8">You cannot view this receipt.</main>;
  if (receipt.isPending || settings.isPending)
    return <main className="p-8 text-sm">Checking this receipt in N3…</main>;
  if (receipt.error || !receipt.data)
    return (
      <main className="p-8 text-sm">
        N3 receipt could not be verified. Do not print it as confirmed. Reload to check again.
      </main>
    );
  if (settings.error || !settings.data)
    return <main className="p-8 text-sm">Unable to load print settings. Reload to try again.</main>;

  const r = receipt.data.receipt;
  const company = data.tenant.companyName ?? "HotelHub";
  return (
    <main className="min-h-screen bg-slate-100 p-5 text-[#102A43] print:bg-white print:p-0">
      <style>{`@page { size: A4 portrait; margin: 16mm; }`}</style>
      <div className="mx-auto mb-3 flex max-w-[178mm] items-center justify-between text-sm print:hidden">
        <Link to="/reservations/$id" params={{ id }} className="underline">
          ← Reservation
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded border bg-white px-3 py-1.5"
        >
          Print again
        </button>
      </div>
      <article className="mx-auto min-h-[265mm] max-w-[178mm] bg-white p-8 shadow print:min-h-0 print:p-0 print:shadow-none">
        <header className="border-b-2 border-[#102A43] pb-4">
          <p className="text-xl font-bold">{company}</p>
          {settings.data.settings.folioContactAddress ? (
            <p className="whitespace-pre-line text-xs">
              {settings.data.settings.folioContactAddress}
            </p>
          ) : null}
          <p className="text-xs">
            {[settings.data.settings.folioContactPhone, settings.data.settings.folioContactEmail]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <h1 className="mt-5 text-lg font-bold">Payment Receipt</h1>
          <p className="text-sm">N3 Receive Payment · {r.n3DocCode}</p>
        </header>
        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-slate-600">Booking</dt>
            <dd className="font-semibold">{r.bookingReference}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Recorded</dt>
            <dd className="font-semibold">{malaysiaTimestamp(r.recordedAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Customer</dt>
            <dd className="font-semibold">{r.customerLabel ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Payment account</dt>
            <dd className="font-semibold">{r.accountLabel ?? "—"}</dd>
          </div>
        </dl>
        <section className="mt-8 border-y border-[#102A43] py-4 text-right">
          <p className="text-sm text-slate-600">Amount received</p>
          <p className="text-2xl font-bold tabular-nums">
            {r.currency} {r.amount.toFixed(2)}
          </p>
        </section>
        <p className="mt-8 text-xs text-slate-600">
          Confirmed against N3 at {malaysiaTimestamp(r.verifiedAt)}. This receipt records a payment;
          the booking balance is shown separately on the folio.
        </p>
      </article>
    </main>
  );
}
