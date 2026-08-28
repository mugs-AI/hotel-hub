// HH-GOLIVE-01A — pure DTO shapes shared by the folio API, the browser and
// the guest-facing print view. No I/O, no server imports.
//
// Every money value in a DTO is a display number derived server-side from
// integer cents. The browser NEVER computes a financial value.
import type { FolioBlocker, FolioLineType, FolioLineStatus, GuestTaxClass } from "./folio";
import type { TaxClass } from "./charges-catalogue";
import type { FolioReadiness } from "./folio-readiness";

export type FolioLineDTO = {
  id: string;
  lineType: FolioLineType;
  status: FolioLineStatus;
  taxClass: TaxClass | null;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  stayDate: string | null;
  roomLabel: string | null;
  reason: string | null;
  reversesLineId: string | null;
  actorLabel: string | null;
  createdAt: string;
  /** Only draft, non-derived lines may still be edited. */
  canEditQuantity: boolean;
  canReverse: boolean;
};

export type FolioDerivedLineDTO = {
  key: string;
  lineType: FolioLineType;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type FolioTotalsDTO = {
  charges: number;
  serviceCharge: number;
  serviceTax: number;
  tourismTax: number;
  localLevy: number;
  rounding: number;
  grandTotal: number;
};

export type TourismTaxEvidenceDTO = {
  id: string;
  sourceLabel: string;
  reference: string | null;
  collectedOn: string | null;
  amount: number;
  note: string | null;
  createdAt: string;
};

export type FolioCatalogueOptionDTO = {
  id: string;
  displayName: string;
  category: string;
  taxClass: TaxClass;
  defaultUnitPrice: number;
};

export type FolioCapabilityDTO = {
  canView: boolean;
  canAddItem: boolean;
  canAdjust: boolean;
  canSetTaxClass: boolean;
  canManageCharges: boolean;
};

export type FolioViewDTO = {
  reservation: {
    id: string;
    bookingReference: string;
    arrivalDate: string;
    departureDate: string;
    currency: string;
    primaryGuestName: string | null;
    roomLabels: string[];
  };
  propertyDate: string;
  guestTaxClass: GuestTaxClass;
  evidenceNote: string | null;
  tourismTaxEvidence: TourismTaxEvidenceDTO[];
  occupiedRoomNights: number;
  lines: FolioLineDTO[];
  derived: FolioDerivedLineDTO[];
  totals: FolioTotalsDTO;
  blockers: FolioBlocker[];
  readiness: FolioReadiness & { calculationComplete: boolean };
  catalogue: FolioCatalogueOptionDTO[];
  capability: FolioCapabilityDTO;
  /**
   * Hard scope marker: this milestone prepares a folio. Nothing is posted to
   * N3, no CashMemo is created and no deposit is matched.
   */
  preparationOnly: true;
};

// ------------------------------------------------------------- guest folio

export type GuestFolioRow = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type GuestFolioDocument = {
  bookingReference: string;
  guestName: string | null;
  arrivalDate: string;
  departureDate: string;
  currency: string;
  issuedOn: string;
  rows: GuestFolioRow[];
  totals: FolioTotalsDTO;
  /** Always true — this document is a preparation preview, not a tax invoice. */
  provisional: true;
};

/**
 * Strip every internal artefact from the folio before showing it to a guest:
 * no row ids, no statuses, no blockers, no actor names, no reversal links and
 * no reversed lines. Reversals themselves stay visible as negative rows so the
 * printed total always reconciles with the server total.
 */
export function toGuestFolioDocument(dto: FolioViewDTO): GuestFolioDocument {
  const rows: GuestFolioRow[] = [];
  for (const line of dto.lines) {
    if (line.status === "reversed") continue;
    rows.push({
      description: line.roomLabel
        ? `${line.description} — ${line.roomLabel}${line.stayDate ? ` (${line.stayDate})` : ""}`
        : line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
    });
  }
  for (const d of dto.derived) {
    rows.push({
      description: d.description,
      quantity: d.quantity,
      unitPrice: d.unitPrice,
      amount: d.amount,
    });
  }
  return {
    bookingReference: dto.reservation.bookingReference,
    guestName: dto.reservation.primaryGuestName,
    arrivalDate: dto.reservation.arrivalDate,
    departureDate: dto.reservation.departureDate,
    currency: dto.reservation.currency,
    issuedOn: dto.propertyDate,
    rows,
    totals: dto.totals,
    provisional: true,
  };
}

/** Display formatting only — never an arithmetic input. */
export function formatFolioMoney(amount: number, currency: string): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${currency} ${Math.abs(amount).toFixed(2)}`;
}
