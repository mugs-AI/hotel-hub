import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useReservationList } from "@/lib/reservations-client";
import { EMPTY_FILTERS } from "@/lib/reservations-ui";
import { fetchSavedDocumentSelection, checkSavedDocumentsClient } from "@/lib/settlement-client";
import { SESSION_QUERY_KEY } from "@/lib/session-client";
import { formatMyTimestamp } from "@/lib/malaysia-date";
import { recoveryMessage } from "@/lib/settlement-recovery-messages";
import type { SavedDocumentCheck } from "@/lib/saved-documents-check";

export function SavedDocumentCheckResults({
  result,
  bookingReference,
  currency,
}: {
  result: SavedDocumentCheck;
  bookingReference: string;
  currency: string;
}) {
  const confirmed = result.status === "confirmed";
  const labels = {
    identity: "Document identity and ownership",
    status: "Document status",
    money: "Document and line amounts",
    journal: "Observed debit/credit consistency",
    relationships: "Bank, customer, sales and tax relationships",
    completeness: "Evidence completeness",
  };
  return (
    <div className="space-y-2 text-sm" role="status">
      <p className="font-semibold">
        {confirmed
          ? "Saved document observations confirmed"
          : result.status === "waiting"
            ? "Waiting for verification"
            : result.status === "unauthorized"
              ? "Session expired"
              : "Needs review"}
      </p>
      <p>
        {confirmed
          ? "This checks the observed documents and journal. A balanced journal does not prove persistence, authorize matching, or confirm checkout."
          : recoveryMessage(result.code, "after_dispatch", {
              bookingReference,
              documents: result.documents,
            })}
      </p>
      <p className="text-xs text-muted-foreground">
        {result.observations} observation(s) · {formatMyTimestamp(result.checkedAt)} ·{" "}
        {bookingReference}
      </p>
      {result.documents.length > 0 ? (
        <ul className="list-inside list-disc">
          {result.documents.map((d) => (
            <li key={d.id}>
              {d.kind === "bill" ? "Bill" : "Receipt"}: {d.code}
            </li>
          ))}
        </ul>
      ) : null}
      {confirmed && result.billOutstandingCents !== null ? (
        <p>
          Observed bill outstanding: {currency} {(result.billOutstandingCents / 100).toFixed(2)}
        </p>
      ) : null}
      <ul className="space-y-1">
        {result.checks.map((c) => (
          <li key={c.name}>
            {labels[c.name]}: {confirmed && c.status === "observed" ? "observed" : "unavailable"}
          </li>
        ))}
      </ul>
      {result.responses.length > 0 ? (
        <details>
          <summary>Safe N3 response codes</summary>
          <ul>
            {result.responses.map((r, i) => (
              <li key={i}>
                {r.operation}: HTTP {r.httpStatus ?? "unavailable"} ·{" "}
                {r.businessCode ?? "code unavailable"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {result.attempts.length > 0 ? (
        <details>
          <summary>Saved attempt references</summary>
          <ul>
            {result.attempts.map((a) => (
              <li key={a.attemptId}>
                {a.operation} · {a.attemptId} · {a.code}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
export function SavedDocumentsCheckPanel({ identityKey }: { identityKey: string }) {
  const [search, setSearch] = useState(""),
    [reservationId, setReservationId] = useState("");
  const [result, setResult] = useState<SavedDocumentCheck | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    controller = useRef<AbortController | null>(null),
    alive = useRef(true);
  const qc = useQueryClient();
  const list = useReservationList(
    { ...EMPTY_FILTERS, bookingReference: search.trim() },
    { limit: 20, offset: 0 },
  );
  const settlement = useQuery({
    queryKey: ["saved-document-selection", identityKey, reservationId],
    enabled: Boolean(reservationId),
    retry: false,
    queryFn: ({ signal }) => fetchSavedDocumentSelection(reservationId, signal),
  });
  const booking = list.data?.items.find((r) => r.id === reservationId);
  const clear = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setResult(null);
    setError("");
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, [identityKey]);
  const recoverError = useCallback(
    (e: unknown) => {
      if (e instanceof Error && "status" in e && e.status === 401) {
        void qc.cancelQueries({ queryKey: ["settlement"] });
        qc.removeQueries({ queryKey: ["settlement"] });
        void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
        return "Your session expired. Reopen HotelHub through N3 and check the same saved attempt; do not collect again.";
      }
      return "Saved booking information could not be loaded. Review the existing N3 documents; do not collect again.";
    },
    [qc],
  );
  useEffect(() => {
    const failed = settlement.error || list.error;
    if (failed) {
      clear();
      setError(recoverError(failed));
    }
  }, [settlement.error, list.error, clear, recoverError]);
  async function check() {
    if (busy || !settlement.data?.intentId || !booking) return;
    clear();
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    const intentId = settlement.data.intentId;
    try {
      const next = await checkSavedDocumentsClient(reservationId, intentId, c.signal);
      if (alive.current && !c.signal.aborted && controller.current === c) setResult(next);
    } catch (e) {
      if (!alive.current || c.signal.aborted || controller.current !== c) return;
      setResult(null);
      setError(recoverError(e));
    } finally {
      if (alive.current && controller.current === c) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  return (
    <section
      className="space-y-4 rounded-xl border bg-white p-5 shadow-sm"
      aria-label="Check saved documents"
    >
      <div>
        <h2 className="font-semibold">Check saved documents</h2>
        <p className="text-sm text-muted-foreground">
          Select an existing booking. This reads its saved bill and receipts; it does not change N3
          or an accountant case.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="saved-booking-search">Booking reference</Label>
          <Input
            id="saved-booking-search"
            value={search}
            placeholder="Search booking reference"
            onChange={(e) => {
              clear();
              setReservationId("");
              setSearch(e.target.value);
            }}
          />
        </div>
        <div>
          <Label htmlFor="saved-booking">Existing booking</Label>
          <select
            id="saved-booking"
            className="h-10 w-full rounded-md border bg-white px-3 text-sm"
            value={reservationId}
            onChange={(e) => {
              clear();
              setReservationId(e.target.value);
            }}
          >
            <option value="">Select booking</option>
            {!list.error
              ? list.data?.items.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.bookingReference}
                  </option>
                ))
              : null}
          </select>
        </div>
      </div>
      {list.data && list.data.total > 20 ? (
        <p className="text-xs text-muted-foreground">
          Showing up to 20 bookings. Enter the booking reference to narrow the list.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={
            busy ||
            !booking ||
            !settlement.data?.intentId ||
            Boolean(settlement.error) ||
            Boolean(list.error)
          }
          onClick={check}
        >
          {busy ? "Checking saved documents…" : "Check saved documents"}
        </Button>
        {busy ? (
          <Button variant="outline" type="button" onClick={clear}>
            Cancel check
          </Button>
        ) : null}
      </div>
      {reservationId &&
      settlement.isSuccess &&
      !list.error &&
      settlement.data?.intentId === null ? (
        <p className="text-sm">
          No saved settlement intent is available. Review this booking's existing documents; do not
          create a replacement to run this check.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {result &&
      booking &&
      result.intentId === settlement.data?.intentId &&
      result.tenantId === settlement.data?.tenantId &&
      !settlement.error &&
      !list.error ? (
        <SavedDocumentCheckResults
          result={result}
          bookingReference={booking.bookingReference}
          currency={settlement.data?.currency ?? ""}
        />
      ) : null}
    </section>
  );
}
