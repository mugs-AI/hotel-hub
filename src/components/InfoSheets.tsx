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
// the values rendered come from the already-authorised list responses.
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const NAVY = "#102A43";

export function SheetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1 border-b border-border py-2 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium" style={{ color: NAVY }}>
        {children}
      </dd>
    </div>
  );
}

export type GuestContactInfo = {
  guestName: string | null;
  mobile: string | null;
  bookingReference: string;
};

/**
 * Guest Contact sheet — guest name, mobile as a tel: link and the booking
 * reference ONLY. No identity document, email, address, notes, tenant id or
 * actor key is displayed here.
 */
export function GuestContactSheet({
  info,
  onClose,
}: {
  info: GuestContactInfo | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={info !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle style={{ color: NAVY }}>Guest contact</SheetTitle>
        </SheetHeader>
        {info ? (
          <dl className="mt-4">
            <SheetRow label="Guest">{info.guestName || "—"}</SheetRow>
            <SheetRow label="Mobile">
              {info.mobile ? (
                <a className="underline underline-offset-2" href={`tel:${info.mobile}`}>
                  {info.mobile}
                </a>
              ) : (
                <span className="font-normal text-muted-foreground">No mobile number recorded</span>
              )}
            </SheetRow>
            <SheetRow label="Booking">
              <span className="font-mono">{info.bookingReference}</span>
            </SheetRow>
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

export type RoomInformation = {
  roomNumber: string;
  n3StockCode: string | null;
  roomName: string | null;
  roomType: string;
  floor: string | null;
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
