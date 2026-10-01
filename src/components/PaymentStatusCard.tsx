import { CardHeading } from "@/components/CardInfoPopover";

/** Honest release capability notice: never infers a reservation's N3 balance. */
export function PaymentStatusCard() {
  return (
    <section
      aria-label="Payment availability"
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm"
    >
      <CardHeading title="Payment">
        <p>
          A confirmed reservation can receive a deposit before its final bill. The N3 Receive
          Payment stays unapplied until a bill exists.
        </p>
        <p className="mt-2">
          Final settlement: post the bill as an N3 Cash Memo (Cash Sale posted to AR), verify it,
          apply eligible deposits, then collect and match the remaining balance. Complete checkout
          only after N3 confirms settlement.
        </p>
        <p className="mt-2">
          This flow is not yet enabled in HotelHub. Saving a reservation or preparing a folio does
          not post a bill or match money.
        </p>
      </CardHeading>
      <p className="mt-2 text-sm text-amber-900">
        Final bill posting and balance payment are not available yet.
      </p>
    </section>
  );
}
