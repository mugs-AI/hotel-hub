// Shared right-side information sheets.
//
// Guest Contact and Room Information use the SAME Sheet pattern as the
// existing Housekeeping history drawer: they open only on explicit activation
// (click / tap / Enter / Space), never on hover; they use a compact
// label/value layout with an explicit Close; Escape closes them; focus is
// contained while open and returns to the trigger on close (Radix Dialog
// primitives handle containment and focus return).
//
// No sensitive data is placed in the URL, browser storage, logs or toasts —
// the values rendered come from authorised list/detail responses.
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useReservationDetail } from "@/lib/reservations-client";
import { formatMyTimestamp } from "@/lib/malaysia-date";
import { countryName } from "@/lib/iso-countries";
import { malaysianStateName } from "@/lib/malaysia-states";

const NAVY = "#102A43";

export function SheetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-border py-2 text-sm last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-x-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium" style={{ color: NAVY }}>
        {children}
      </dd>
    </div>
  );
}

export type GuestContactInfo = {
  guestName: string | null;
  mobile: string | null;
  bookingReference: string;
  reservationId?: string;
  createdAt?: string;
};

/**
 * Guest Contact sheet — guest name, mobile as a tel: link and the booking
 * reference. When reservation context is supplied, load all guest contacts
 * through the authorised detail API. Identity documents and actor keys stay hidden.
 */
export function GuestContactSheet({
  info,
  onClose,
}: {
  info: GuestContactInfo | null;
  onClose: () => void;
}) {
  const detail = useReservationDetail(info?.reservationId ?? "");
  const reservation = detail.data?.reservation;
  const guests = reservation && reservation.id === info?.reservationId ? reservation.guests : null;
  return (
    <Sheet open={info !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle style={{ color: NAVY }}>Guest contact</SheetTitle>
        </SheetHeader>
        {info ? (
          <div className="mt-4">
            <dl>
              <SheetRow label="Booking">
                <span className="font-mono">{info.bookingReference}</span>
              </SheetRow>
              {info.createdAt ? (
                <SheetRow label="Created">{formatMyTimestamp(info.createdAt)}</SheetRow>
              ) : null}
            </dl>
            {info.reservationId ? (
              detail.isPending ? (
                <p className="mt-4 text-sm text-muted-foreground">Loading guest contacts…</p>
              ) : detail.error || !guests ? (
                <p className="mt-4 text-sm text-destructive">
                  Unable to load guest contacts. Close and reopen to retry.
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  {guests.map((g) => (
                    <section key={g.id} className="rounded-md border p-3">
                      <h3 className="text-base font-semibold">
                        {g.fullName}
                        {g.isPrimary ? (
                          <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                            Primary
                          </span>
                        ) : null}
                      </h3>
                      <dl className="mt-2">
                        <SheetRow label="Mobile">
                          {g.mobile ? (
                            <a className="break-all underline" href={`tel:${g.mobile}`}>
                              {g.mobile}
                            </a>
                          ) : (
                            "—"
                          )}
                        </SheetRow>
                        <SheetRow label="Email">
                          {g.email ? (
                            <a className="break-all underline" href={`mailto:${g.email}`}>
                              {g.email}
                            </a>
                          ) : (
                            "—"
                          )}
                        </SheetRow>
                        <SheetRow label="Address">
                          <span className="break-words">
                            {[
                              g.addressLine1,
                              g.addressLine2,
                              g.addressLine3,
                              [g.postcode, g.city].filter(Boolean).join(" "),
                              g.countryCode === "MYS"
                                ? malaysianStateName(g.stateCode)
                                : g.stateProvince,
                              g.countryCode ? countryName(g.countryCode) : null,
                            ]
                              .filter(Boolean)
                              .join(", ") || "—"}
                          </span>
                        </SheetRow>
                      </dl>
                    </section>
                  ))}
                  {guests.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No guest contacts recorded.</p>
                  ) : null}
                </div>
              )
            ) : (
              <dl className="mt-4">
                <SheetRow label="Guest">{info.guestName || "—"}</SheetRow>
                <SheetRow label="Mobile">
                  {info.mobile ? (
                    <a className="underline underline-offset-2" href={`tel:${info.mobile}`}>
                      {info.mobile}
                    </a>
                  ) : (
                    <span className="font-normal text-muted-foreground">
                      No mobile number recorded
                    </span>
                  )}
                </SheetRow>
              </dl>
            )}
          </div>
        ) : null}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Close
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export type RoomInformation = {
  roomNumber: string;
  n3StockCode: string | null;
  roomName: string | null;
  roomType: string;
  floor: string | null;
  maxGuests: number;
  isActive: boolean;
};

/** Room Information sheet used by the reservation calendar / room view. */
export function RoomInformationSheet({
  room,
  onClose,
}: {
  room: RoomInformation | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={room !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle style={{ color: NAVY }}>Room information</SheetTitle>
        </SheetHeader>
        {room ? (
          <dl className="mt-4">
            <SheetRow label="Room number">
              <span className="font-mono">{room.roomNumber}</span>
            </SheetRow>
            <SheetRow label="N3 stock code">
              <span className="font-mono">{room.n3StockCode || "—"}</span>
            </SheetRow>
            <SheetRow label="Room name">{room.roomName || "—"}</SheetRow>
            <SheetRow label="Room type">{room.roomType}</SheetRow>
            <SheetRow label="Floor">{room.floor || "Unassigned"}</SheetRow>
            <SheetRow label="Max guests">{room.maxGuests}</SheetRow>
            <SheetRow label="Status">{room.isActive ? "Active" : "Inactive"}</SheetRow>
          </dl>
        ) : null}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Close
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Keyboard-accessible activation trigger used for Primary Guest and Room
 * Number cells. It is a real <button>, so Enter and Space activate it and it
 * is reachable in the tab order.
 */
export function SheetTrigger({
  onOpen,
  label,
  className,
  children,
}: {
  onOpen: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className={
        className ??
        "rounded text-left font-medium underline decoration-dotted underline-offset-2 hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      }
      style={{ color: NAVY }}
    >
      {children}
    </button>
  );
}
