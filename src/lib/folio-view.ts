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
  catalogueId: string | null;
  lineType: FolioLineType;
  status: FolioLineStatus;
  taxClass: TaxClass | null;
  description: string;
  /** Applicable Service Tax rate from the authoritative server settings. */
  taxRateBp: number | null;
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
  /** Percentage represented by this tax line; null for fixed-amount levies. */
  taxRateBp: number | null;
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

export type FolioExtraAccent = {
  surface: string;
  border: string;
  text: string;
};

const FOLIO_EXTRA_ACCENTS: readonly FolioExtraAccent[] = [
  { surface: "#ECFDF8", border: "#5BC4B4", text: "#155E54" },
  { surface: "#EFF6FF", border: "#7DA8E8", text: "#294E86" },
  { surface: "#F5F3FF", border: "#A99AE8", text: "#594795" },
  { surface: "#FFF7E8", border: "#E8B968", text: "#76501B" },
  { surface: "#FFF1F2", border: "#E7A0A8", text: "#8A3C49" },
  { surface: "#F0FDF4", border: "#78C58C", text: "#28613A" },
] as const;

/** Stable, accessible colour identity shared by an extra's button and folio row. */
export function folioExtraAccent(catalogueId: string): FolioExtraAccent {
  let hash = 0;
  for (let index = 0; index < catalogueId.length; index += 1) {
    hash = (hash * 31 + catalogueId.charCodeAt(index)) >>> 0;
  }
  return FOLIO_EXTRA_ACCENTS[hash % FOLIO_EXTRA_ACCENTS.length];
}

/** Basis points are hundredths of one percent: 1,000bp displays as 10%, never 0.1%. */
export function formatFolioTaxRate(rateBp: number | null): string {
  if (rateBp === null) return "—";
  const percent = rateBp / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2)}%`;
}

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
  readiness: FolioReadiness & {
    calculationComplete: boolean;
    /** True only when every expected reservation room-night is persisted. */
    roomNightsPrepared: boolean;
    /** Missing persisted nights included read-only so screen and print stay complete. */
    projectedRoomNights: number;
  };
  catalogue: FolioCatalogueOptionDTO[];
  capability: FolioCapabilityDTO;
  /**
   * Hard scope marker: this milestone prepares a folio. Nothing is posted to
   * N3, no CashMemo is created and no deposit is matched.
   */
  preparationOnly: true;
};

export type VisibleFolioTotalRow = {
  key: "charges" | "serviceCharge" | "serviceTax" | "tourismTax" | "localLevy" | "rounding";
  label: string;
  amount: number;
};

/**
 * Screen and print share one visibility rule: core charges always show, while
 * optional charge/tax rows follow the Owner's Settings on/off choices.
 */
export function visibleFolioTotalRows(dto: FolioViewDTO): VisibleFolioTotalRow[] {
  const rows: VisibleFolioTotalRow[] = [
    { key: "charges", label: "Charges", amount: dto.totals.charges },
  ];
  if (dto.readiness.serviceChargeEnabled) {
    rows.push({ key: "serviceCharge", label: "Service charge", amount: dto.totals.serviceCharge });
  }
  if (dto.readiness.serviceTaxRegistered) {
    rows.push({ key: "serviceTax", label: "Service Tax", amount: dto.totals.serviceTax });
  }
  if (dto.readiness.tourismTaxEnabled) {
    rows.push({ key: "tourismTax", label: "Tourism Tax", amount: dto.totals.tourismTax });
  }
  if (dto.readiness.localLevyEnabled) {
    rows.push({
      key: "localLevy",
      label: dto.readiness.localLevyLabel ?? "Local levy",
      amount: dto.totals.localLevy,
    });
  }
  if (dto.readiness.roundingMode !== "none") {
    rows.push({ key: "rounding", label: "Rounding", amount: dto.totals.rounding });
  }
  return rows;
}

// ------------------------------------------------------------- guest folio

export type GuestFolioRow = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type GuestFacingFolioRow =
  | { kind: "line"; key: string; line: FolioLineDTO }
  | { kind: "derived"; key: string; line: FolioDerivedLineDTO };

/**
 * Guest statements show only live commercial activity. Reversed originals
 * and their immutable negative audit records are both hidden, while the raw
 * DTO remains untouched for the reservation timeline/audit trail. Discounts
 * are deliberately placed after derived taxes and levies as the final detail
 * rows before totals.
 */
export function guestFacingFolioRows(dto: FolioViewDTO): GuestFacingFolioRow[] {
  const reversedTargetIds = new Set(
    dto.lines.flatMap((line) => (line.reversesLineId ? [line.reversesLineId] : [])),
  );
  const visible = dto.lines.filter(
    (line) =>
      line.lineType !== "reversal" && line.status !== "reversed" && !reversedTargetIds.has(line.id),
  );
  const discounts = visible.filter((line) => line.lineType === "discount");
  const charges = visible.filter((line) => line.lineType !== "discount");

  return [
    ...charges.map((line) => ({ kind: "line" as const, key: `line:${line.id}`, line })),
    ...dto.derived.map((line) => ({ kind: "derived" as const, key: `derived:${line.key}`, line })),
    ...discounts.map((line) => ({ kind: "line" as const, key: `line:${line.id}`, line })),
  ];
}

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
 * no reversed lines. Both sides of a reversal pair remain in audit history but
 * are omitted from the guest document.
 */
export function toGuestFolioDocument(dto: FolioViewDTO): GuestFolioDocument {
  const rows: GuestFolioRow[] = guestFacingFolioRows(dto).map((row) => {
    if (row.kind === "derived") {
      return {
        description: row.line.description,
        quantity: row.line.quantity,
        unitPrice: row.line.unitPrice,
        amount: row.line.amount,
      };
    }
    const line = row.line;
    return {
      description: line.roomLabel
        ? `${line.description} — ${line.roomLabel}${line.stayDate ? ` (${line.stayDate})` : ""}`
        : line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
    };
  });
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
