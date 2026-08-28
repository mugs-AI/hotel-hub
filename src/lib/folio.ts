// HH-GOLIVE-01A — the authoritative folio: pure derivation, no I/O.
//
// Truth rules encoded here:
//   * Nightly room charges are per reservation-room per stay date. A
//     persisted night is a SNAPSHOT: later rate changes never rewrite it.
//   * Room moves / extensions ADD nights; they never duplicate an existing
//     (reservationRoom, stayDate) pair.
//   * Nothing is deleted. A mistake is corrected with a reversal line that
//     carries a reason and points at the line it reverses.
//   * Tourism Tax is per OCCUPIED room-night for non-exempt guests, is
//     effective dated, is never triggered by a deposit alone, and is
//     credited (not double charged) when an OTA already collected it.
//   * Any unknown — unmapped tax, unknown guest class, missing rounding
//     account — is a readiness BLOCKER, never a silent assumption.

import {
  applyBasisPoints,
  isCents,
  multiplyCents,
  roundingAdjustmentCents,
  sumCents,
} from "./folio-money";
import { isTaxableClass, type TaxClass } from "./charges-catalogue";
import { isEffectiveOn, resolveServiceTaxRate, type FinancialSettings } from "./financial-settings";

export type FolioLineType =
  | "room_night"
  | "add_on"
  | "service_charge"
  | "service_tax"
  | "tourism_tax"
  | "local_levy"
  | "discount"
  | "manual_adjustment"
  | "reversal";

export type FolioLineStatus = "draft" | "committed" | "reversed";

export type GuestTaxClass =
  | "malaysian_citizen"
  | "malaysian_pr"
  | "foreign_tourist"
  | "other_exemption"
  | "unknown";

export const GUEST_TAX_CLASSES: readonly GuestTaxClass[] = [
  "malaysian_citizen",
  "malaysian_pr",
  "foreign_tourist",
  "other_exemption",
  "unknown",
] as const;

export const GUEST_TAX_CLASS_LABELS: Record<GuestTaxClass, string> = {
  malaysian_citizen: "Malaysian citizen",
  malaysian_pr: "Malaysian permanent resident",
  foreign_tourist: "Foreign tourist",
  other_exemption: "Other exemption",
  unknown: "Not yet confirmed",
};

export function isGuestTaxClass(v: unknown): v is GuestTaxClass {
  return typeof v === "string" && (GUEST_TAX_CLASSES as readonly string[]).includes(v);
}

/** Citizens and PRs are exempt from Tourism Tax. */
export function isTourismTaxExempt(cls: GuestTaxClass): boolean {
  return cls === "malaysian_citizen" || cls === "malaysian_pr" || cls === "other_exemption";
}

/** A persisted folio line as stored (signed cents; reversals are negative). */
export type StoredFolioLine = {
  id: string;
  lineType: FolioLineType;
  status: FolioLineStatus;
  taxClass: TaxClass | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  reversesLineId: string | null;
  reason: string | null;
  stayDate: string | null;
  reservationRoomId: string | null;
  roomLabel: string | null;
  actorLabel: string | null;
  createdAt: string;
};

export type DerivedLine = {
  key: string;
  lineType: FolioLineType;
  taxClass: TaxClass | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
};

export type FolioBlocker = {
  code: string;
  severity: "blocking" | "advisory";
  message: string;
};

export type FolioTotals = {
  chargesCents: number;
  serviceChargeCents: number;
  serviceTaxCents: number;
  tourismTaxCents: number;
  localLevyCents: number;
  roundingCents: number;
  grandTotalCents: number;
};

export type RoomNightPlanRoom = {
  reservationRoomId: string;
  hotelRoomId: string;
  roomLabel: string;
  arrivalDate: string;
  departureDate: string;
  nightlyRateCents: number;
};

export type PlannedRoomNight = {
  reservationRoomId: string;
  hotelRoomId: string;
  roomLabel: string;
  stayDate: string;
  unitPriceCents: number;
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Stay dates for one room: arrival inclusive, departure exclusive. */
export function stayDates(arrivalDate: string, departureDate: string): string[] {
  const out: string[] = [];
  if (!(arrivalDate < departureDate)) return out;
  let cur = arrivalDate;
  // Bound the loop defensively; a stay longer than a year is not derived.
  for (let i = 0; i < 366 && cur < departureDate; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * Nights that SHOULD exist, minus the ones already snapshotted. Existing
 * nights are returned untouched by the caller: a rate change after the fact
 * never rewrites history.
 */
export function planMissingRoomNights(
  rooms: readonly RoomNightPlanRoom[],
  existing: readonly { reservationRoomId: string | null; stayDate: string | null }[],
): PlannedRoomNight[] {
  const seen = new Set(
    existing
      .filter((e) => e.reservationRoomId && e.stayDate)
      .map((e) => `${e.reservationRoomId}|${e.stayDate}`),
  );
  const out: PlannedRoomNight[] = [];
  for (const room of rooms) {
    for (const stayDate of stayDates(room.arrivalDate, room.departureDate)) {
      const key = `${room.reservationRoomId}|${stayDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        reservationRoomId: room.reservationRoomId,
        hotelRoomId: room.hotelRoomId,
        roomLabel: room.roomLabel,
        stayDate,
        unitPriceCents: room.nightlyRateCents,
      });
    }
  }
  return out;
}

/** A line still counts towards totals unless it has been reversed. */
export function isEffectiveLine(line: StoredFolioLine): boolean {
  return line.status !== "reversed";
}

/** Net signed subtotal per tax class across all effective stored lines. */
export function netByTaxClass(lines: readonly StoredFolioLine[]): Map<TaxClass, number> {
  const map = new Map<TaxClass, number>();
  for (const l of lines) {
    if (!isEffectiveLine(l)) continue;
    const cls = l.taxClass;
    if (!cls) continue;
    map.set(cls, (map.get(cls) ?? 0) + l.subtotalCents);
  }
  return map;
}

export type TourismTaxAssessment = {
  applicable: boolean;
  nights: number;
  perNightCents: number;
  grossCents: number;
  creditedCents: number;
  chargeCents: number;
  blockers: FolioBlocker[];
};

export type TourismTaxInput = {
  settings: FinancialSettings;
  guestTaxClass: GuestTaxClass;
  /** Room-nights actually occupied. A deposit-only reservation has 0. */
  occupiedRoomNights: number;
  /** Already collected by an OTA/DPSP, evidenced on the reservation. */
  alreadyCollectedCents: number;
  /** Property business date used for effective dating. */
  propertyDate: string;
};

export function assessTourismTax(input: TourismTaxInput): TourismTaxAssessment {
  const { settings, guestTaxClass, occupiedRoomNights, alreadyCollectedCents, propertyDate } =
    input;
  const blockers: FolioBlocker[] = [];
  const cfg = settings.tourismTax;
  const empty = (): TourismTaxAssessment => ({
    applicable: false,
    nights: Math.max(0, occupiedRoomNights),
    perNightCents: cfg.centsPerRoomNight,
    grossCents: 0,
    creditedCents: 0,
    chargeCents: 0,
    blockers,
  });

  if (!cfg.enabled) return empty();
  if (!isEffectiveOn(cfg, propertyDate)) return empty();
  if (occupiedRoomNights <= 0) return empty(); // deposit alone never triggers it

  if (guestTaxClass === "unknown") {
    blockers.push({
      code: "tourism_tax_guest_class_unknown",
      severity: "blocking",
      message:
        "Confirm whether the guest is a Malaysian citizen or permanent resident before checkout. Tourism Tax cannot be decided while this is unknown.",
    });
    return empty();
  }
  if (isTourismTaxExempt(guestTaxClass)) return empty();

  const gross = multiplyCents(cfg.centsPerRoomNight, occupiedRoomNights);
  if (gross === null) {
    blockers.push({
      code: "tourism_tax_amount_invalid",
      severity: "blocking",
      message:
        "Tourism Tax amount could not be calculated. Check the configured amount per room-night.",
    });
    return empty();
  }
  const credited = Math.min(Math.max(0, alreadyCollectedCents), gross);
  const charge = gross - credited;
  if (credited > 0 && charge === 0) {
    blockers.push({
      code: "tourism_tax_collected_by_platform",
      severity: "advisory",
      message:
        "Tourism Tax was already collected by the booking platform, so it is not charged again here.",
    });
  }
  return {
    applicable: true,
    nights: occupiedRoomNights,
    perNightCents: cfg.centsPerRoomNight,
    grossCents: gross,
    creditedCents: credited,
    chargeCents: charge,
    blockers,
  };
}

export type FolioComputationInput = {
  currency: string;
  settings: FinancialSettings;
  lines: readonly StoredFolioLine[];
  guestTaxClass: GuestTaxClass;
  occupiedRoomNights: number;
  tourismTaxCollectedCents: number;
  propertyDate: string;
  /** Reservation rooms with no mapped N3 stock — blocks later posting. */
  unmappedRoomLabels?: readonly string[];
  /** Catalogue items used on this folio that are not fully mapped. */
  unmappedAddonNames?: readonly string[];
};

export type FolioComputation = {
  derived: DerivedLine[];
  totals: FolioTotals;
  blockers: FolioBlocker[];
  tourismTax: TourismTaxAssessment;
  calculationComplete: boolean;
};

const zeroTotals = (): FolioTotals => ({
  chargesCents: 0,
  serviceChargeCents: 0,
  serviceTaxCents: 0,
  tourismTaxCents: 0,
  localLevyCents: 0,
  roundingCents: 0,
  grandTotalCents: 0,
});

/**
 * Deterministic, side-effect free folio computation. Every derived amount is
 * reproducible from the stored lines plus the frozen configuration.
 */
export function computeFolio(input: FolioComputationInput): FolioComputation {
  const blockers: FolioBlocker[] = [];
  const derived: DerivedLine[] = [];
  const { settings } = input;

  const charges = sumCents(input.lines.filter(isEffectiveLine).map((l) => l.subtotalCents));
  if (charges === null) {
    return {
      derived,
      totals: zeroTotals(),
      blockers: [
        {
          code: "folio_amounts_invalid",
          severity: "blocking",
          message: "One or more folio amounts are out of range. The folio cannot be totalled.",
        },
      ],
      tourismTax: assessTourismTax({
        settings,
        guestTaxClass: input.guestTaxClass,
        occupiedRoomNights: input.occupiedRoomNights,
        alreadyCollectedCents: input.tourismTaxCollectedCents,
        propertyDate: input.propertyDate,
      }),
      calculationComplete: false,
    };
  }

  const net = netByTaxClass(input.lines);

  // --- commercial service charge (not a government tax) -------------------
  let serviceCharge = 0;
  if (settings.serviceCharge.enabled && settings.serviceCharge.percentBp > 0) {
    const base = sumCents(
      [...net.entries()].filter(([cls]) => isTaxableClass(cls)).map(([, v]) => v),
    );
    const amount =
      base === null ? null : applyBasisPoints(Math.max(0, base), settings.serviceCharge.percentBp);
    if (amount === null) {
      blockers.push({
        code: "service_charge_invalid",
        severity: "blocking",
        message: "The service charge could not be calculated. Check the configured percentage.",
      });
    } else if (amount !== 0) {
      serviceCharge = amount;
      derived.push({
        key: "service_charge",
        lineType: "service_charge",
        taxClass: "service_charge",
        description: `Service charge ${(settings.serviceCharge.percentBp / 100).toFixed(2)}%`,
        quantity: 1,
        unitPriceCents: amount,
        amountCents: amount,
      });
    }
  }

  // --- service tax per tax class -----------------------------------------
  let serviceTax = 0;
  if (settings.serviceTaxRegistered) {
    const taxBases: [TaxClass, number][] = [...net.entries()].filter(
      ([cls, amount]) => isTaxableClass(cls) && amount > 0,
    );
    if (serviceCharge > 0 && settings.serviceCharge.serviceTaxApplies) {
      taxBases.push(["service_charge", serviceCharge]);
    }
    for (const [cls, base] of taxBases) {
      const rate = resolveServiceTaxRate(settings, cls);
      if (!rate.ok) {
        blockers.push({
          code: `${rate.code}:${cls}`,
          severity: "blocking",
          message:
            rate.code === "service_tax_rate_unmapped"
              ? `Set the Service Tax rate for ${cls.replace(/_/g, " ")} in Settings before charging it.`
              : `Map the N3 tax code for ${cls.replace(/_/g, " ")} in Settings before charging Service Tax.`,
        });
        continue;
      }
      if (rate.rateBp === 0) continue;
      const amount = applyBasisPoints(base, rate.rateBp);
      if (amount === null) {
        blockers.push({
          code: `service_tax_invalid:${cls}`,
          severity: "blocking",
          message: `Service Tax for ${cls.replace(/_/g, " ")} could not be calculated.`,
        });
        continue;
      }
      if (amount === 0) continue;
      serviceTax += amount;
      derived.push({
        key: `service_tax:${cls}`,
        lineType: "service_tax",
        taxClass: cls,
        description: `Service Tax ${(rate.rateBp / 100).toFixed(2)}% — ${cls.replace(/_/g, " ")}`,
        quantity: 1,
        unitPriceCents: amount,
        amountCents: amount,
      });
    }
  }

  // --- tourism tax --------------------------------------------------------
  const tourism = assessTourismTax({
    settings,
    guestTaxClass: input.guestTaxClass,
    occupiedRoomNights: input.occupiedRoomNights,
    alreadyCollectedCents: input.tourismTaxCollectedCents,
    propertyDate: input.propertyDate,
  });
  blockers.push(...tourism.blockers);
  if (tourism.chargeCents > 0) {
    derived.push({
      key: "tourism_tax",
      lineType: "tourism_tax",
      taxClass: "non_taxable",
      description: `Tourism Tax — ${tourism.nights} room-night(s)`,
      quantity: tourism.nights,
      unitPriceCents: tourism.perNightCents,
      amountCents: tourism.chargeCents,
    });
  }

  // --- state / local levy -------------------------------------------------
  let localLevy = 0;
  const levy = settings.localLevy;
  if (
    levy.enabled &&
    levy.centsPerRoomNight > 0 &&
    input.occupiedRoomNights > 0 &&
    isEffectiveOn(levy, input.propertyDate)
  ) {
    const amount = multiplyCents(levy.centsPerRoomNight, input.occupiedRoomNights);
    if (amount === null) {
      blockers.push({
        code: "local_levy_invalid",
        severity: "blocking",
        message:
          "The local levy could not be calculated. Check the configured amount per room-night.",
      });
    } else {
      localLevy = amount;
      derived.push({
        key: "local_levy",
        lineType: "local_levy",
        taxClass: "non_taxable",
        description: `${levy.label ?? "Local levy"} — ${input.occupiedRoomNights} room-night(s)`,
        quantity: input.occupiedRoomNights,
        unitPriceCents: levy.centsPerRoomNight,
        amountCents: amount,
      });
    }
  }

  // --- rounding -----------------------------------------------------------
  const preRounding = sumCents([
    charges,
    serviceCharge,
    serviceTax,
    tourism.chargeCents,
    localLevy,
  ]);
  let rounding = 0;
  if (preRounding !== null && settings.rounding.mode !== "none") {
    const delta = roundingAdjustmentCents(preRounding, settings.rounding.mode);
    if (delta === null) {
      blockers.push({
        code: "rounding_invalid",
        severity: "blocking",
        message: "The rounding adjustment could not be calculated.",
      });
    } else {
      rounding = delta;
      if (delta !== 0) {
        derived.push({
          key: "rounding",
          lineType: "manual_adjustment",
          taxClass: "non_taxable",
          description: "Rounding adjustment",
          quantity: 1,
          unitPriceCents: delta,
          amountCents: delta,
        });
      }
      if (delta !== 0 && !settings.rounding.n3RoundingAccountId) {
        blockers.push({
          code: "rounding_account_unmapped",
          severity: "blocking",
          message: "Map the N3 rounding account in Settings before rounding can be posted.",
        });
      }
    }
  }

  const grand = sumCents([preRounding ?? 0, rounding]);
  if (preRounding === null || grand === null || !isCents(grand)) {
    blockers.push({
      code: "folio_total_invalid",
      severity: "blocking",
      message: "The folio total is out of range and cannot be shown.",
    });
  }

  for (const label of input.unmappedRoomLabels ?? []) {
    blockers.push({
      code: "room_stock_unmapped",
      severity: "blocking",
      message: `Room ${label} is not mapped to an N3 stock item. Map it in Rooms & Rates.`,
    });
  }
  for (const name of input.unmappedAddonNames ?? []) {
    blockers.push({
      code: "addon_mapping_incomplete",
      severity: "blocking",
      message: `Charge "${name}" is missing its N3 stock, unit or tax code mapping.`,
    });
  }

  const totals: FolioTotals = {
    chargesCents: charges,
    serviceChargeCents: serviceCharge,
    serviceTaxCents: serviceTax,
    tourismTaxCents: tourism.chargeCents,
    localLevyCents: localLevy,
    roundingCents: rounding,
    grandTotalCents: grand ?? 0,
  };

  return {
    derived,
    totals,
    blockers,
    tourismTax: tourism,
    calculationComplete: !blockers.some((b) => b.severity === "blocking"),
  };
}

/** Reversal request validation: a reason is always required. */
export type ReversalCheck = { ok: true } | { ok: false; code: string };

export function canReverseLine(
  line: Pick<StoredFolioLine, "status" | "lineType"> | null,
  reason: string,
  alreadyReversed: boolean,
): ReversalCheck {
  if (!line) return { ok: false, code: "line_not_found" };
  if (line.lineType === "room_night") return { ok: false, code: "room_night_not_reversible" };
  if (line.status === "reversed" || alreadyReversed) return { ok: false, code: "already_reversed" };
  const r = reason.trim();
  if (r.length < 3 || r.length > 240) return { ok: false, code: "reason_required" };
  return { ok: true };
}
