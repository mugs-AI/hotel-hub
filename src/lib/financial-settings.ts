// HH-GOLIVE-01A — property financial / Malaysia tax configuration.
//
// Rule model (pure, no I/O):
//   * SST is the umbrella; HotelHub deals with SERVICE TAX only.
//   * There is NO universal hotel tax rate. Rates are per tax class and are
//     null until the Owner configures them (or an N3 tax-code snapshot
//     supplies them). A missing rate is a readiness blocker, never a guess.
//   * Whether the property is liable is an explicit Owner setting. Room count
//     never decides it.
//   * The hotel service charge is a COMMERCIAL charge, not a government tax.
//   * Tourism Tax and any state/local levy are tenant configurable and
//     effective dated. Nothing here is hard-coded per jurisdiction.

import { isRoundingMode, type RoundingMode } from "./folio-money";
import { isTaxClass, type TaxClass } from "./charges-catalogue";
import { isRealCalendarDate } from "./malaysia-date";
import {
  applyPostingMappingsPatch,
  defaultPostingMappings,
  validatePostingMappingsPatch,
  type PostingMappings,
  type PostingMappingsPatch,
} from "./posting-mappings";

/** Non-binding UI suggestions only. Never applied automatically. */
export const SUGGESTED_ACCOMMODATION_RATE_BP = 800; // presently 8%
export const SUGGESTED_FNB_RATE_BP = 600; // presently 6%
export const SUGGESTED_PARKING_RATE_BP = 600; // presently 6%
export const SUGGESTED_TOURISM_TAX_CENTS = 1000; // RM10 per occupied room-night

export type TaxMapping = {
  /** Basis points. `null` = not configured; must never be assumed. */
  rateBp: number | null;
  /** Immutable N3 tax code identifier. */
  n3TaxCodeId: string | null;
  /** Display-only snapshot; never used for a decision. */
  n3TaxCodeSnapshot: string | null;
};

export type TaxableClass =
  | "accommodation"
  | "food_and_beverage"
  | "parking"
  | "other_taxable_service";

export type FinancialSettings = {
  tenantId: string;
  serviceTaxRegistered: boolean;
  serviceTax: Record<TaxableClass, TaxMapping>;
  exempt: { n3TaxCodeId: string | null; n3TaxCodeSnapshot: string | null };
  serviceCharge: {
    enabled: boolean;
    percentBp: number;
    /** Whether mapped Service Tax applies to the commercial service charge. */
    serviceTaxApplies: boolean;
  };
  tourismTax: {
    enabled: boolean;
    centsPerRoomNight: number;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  };
  localLevy: {
    enabled: boolean;
    label: string | null;
    centsPerRoomNight: number;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  };
  rounding: {
    mode: RoundingMode;
    /** Readiness only — nothing is posted to N3 in this slice. */
    n3RoundingAccountId: string | null;
    n3RoundingAccountSnapshot: string | null;
  };
  /**
   * HH-GOLIVE-01A UAT correction — future-posting accounting mappings.
   * Preparation only: nothing here posts to N3 in this milestone.
   */
  postingMappings: PostingMappings;
  updatedAt: string | null;
};

const emptyMapping = (): TaxMapping => ({
  rateBp: null,
  n3TaxCodeId: null,
  n3TaxCodeSnapshot: null,
});

/** Safe defaults: nothing enabled, nothing assumed. */
export function defaultFinancialSettings(tenantId: string): FinancialSettings {
  return {
    tenantId,
    serviceTaxRegistered: false,
    serviceTax: {
      accommodation: emptyMapping(),
      food_and_beverage: emptyMapping(),
      parking: emptyMapping(),
      other_taxable_service: emptyMapping(),
    },
    exempt: { n3TaxCodeId: null, n3TaxCodeSnapshot: null },
    serviceCharge: { enabled: false, percentBp: 0, serviceTaxApplies: false },
    tourismTax: {
      enabled: false,
      centsPerRoomNight: 0,
      effectiveFrom: null,
      effectiveTo: null,
    },
    localLevy: {
      enabled: false,
      label: null,
      centsPerRoomNight: 0,
      effectiveFrom: null,
      effectiveTo: null,
    },
    rounding: { mode: "none", n3RoundingAccountId: null, n3RoundingAccountSnapshot: null },
    postingMappings: defaultPostingMappings(),
    updatedAt: null,
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  // Strict real-calendar check: 2026-02-30 and 2027-02-29 are rejected.
  return isRealCalendarDate(y, m, d);
}

/**
 * Post-merge effective-window check. Patch-level validation only sees the
 * fields in one request, so a request that moves only `effectiveTo` earlier
 * than a previously stored `effectiveFrom` must still be refused.
 */
export function settingsWindowError(s: FinancialSettings): string | null {
  for (const [key, w] of [
    ["tourismTax", s.tourismTax],
    ["localLevy", s.localLevy],
  ] as const) {
    if (w.effectiveFrom !== null && !isIsoDate(w.effectiveFrom))
      return `invalid_${key}_effective_date`;
    if (w.effectiveTo !== null && !isIsoDate(w.effectiveTo)) return `invalid_${key}_effective_date`;
    if (w.effectiveFrom && w.effectiveTo && w.effectiveTo < w.effectiveFrom) {
      return `invalid_${key}_effective_date`;
    }
  }
  return null;
}

/** Inclusive-from, inclusive-to window test. Null bounds are open. */
export function isEffectiveOn(
  window: { effectiveFrom: string | null; effectiveTo: string | null },
  isoDate: string,
): boolean {
  if (!isIsoDate(isoDate)) return false;
  if (window.effectiveFrom && isoDate < window.effectiveFrom) return false;
  if (window.effectiveTo && isoDate > window.effectiveTo) return false;
  return true;
}

export type RateResolution =
  | { ok: true; rateBp: number; source: "configured" | "not_registered" }
  | { ok: false; code: "service_tax_rate_unmapped" | "service_tax_code_unmapped" };

/**
 * Authoritative Service Tax rate for a tax class. Never guesses:
 *   * not registered            → 0% with an explicit `not_registered` source
 *   * registered, rate missing  → failure (surfaced as a readiness blocker)
 *   * registered, code missing  → failure (mapping is required to post later)
 */
export function resolveServiceTaxRate(
  settings: FinancialSettings,
  taxClass: TaxClass,
): RateResolution {
  if (!settings.serviceTaxRegistered) return { ok: true, rateBp: 0, source: "not_registered" };
  const key = serviceTaxKeyFor(taxClass);
  if (!key) return { ok: true, rateBp: 0, source: "not_registered" };
  const mapping = settings.serviceTax[key];
  if (mapping.rateBp === null) return { ok: false, code: "service_tax_rate_unmapped" };
  if (!mapping.n3TaxCodeId) return { ok: false, code: "service_tax_code_unmapped" };
  return { ok: true, rateBp: mapping.rateBp, source: "configured" };
}

/** Which configured mapping governs a tax class (null = never taxed here). */
export function serviceTaxKeyFor(taxClass: TaxClass): TaxableClass | null {
  switch (taxClass) {
    case "accommodation":
      return "accommodation";
    case "food_and_beverage":
      return "food_and_beverage";
    case "parking":
      return "parking";
    case "other_taxable_service":
      return "other_taxable_service";
    // A commercial service charge is taxed as a general taxable service when
    // the Owner has configured that it is taxable; the caller decides.
    case "service_charge":
      return "accommodation";
    default:
      return null;
  }
}

export type SettingsPatch = Partial<{
  serviceTaxRegistered: boolean;
  serviceTax: Partial<Record<TaxableClass, Partial<TaxMapping>>>;
  exempt: Partial<{ n3TaxCodeId: string | null; n3TaxCodeSnapshot: string | null }>;
  serviceCharge: Partial<FinancialSettings["serviceCharge"]>;
  tourismTax: Partial<FinancialSettings["tourismTax"]>;
  localLevy: Partial<FinancialSettings["localLevy"]>;
  rounding: Partial<FinancialSettings["rounding"]>;
  postingMappings: PostingMappingsPatch;
}>;

export type PatchValidation = { ok: true; patch: SettingsPatch } | { ok: false; code: string };

function bp(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > 10_000) return undefined;
  return v;
}

function cents(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > 100_000) return undefined;
  return v;
}

function idOrNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return null;
  return t.length <= 120 ? t : undefined;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate an Owner settings patch. Deny-by-default on unknown shapes. */
export function validateSettingsPatch(input: unknown): PatchValidation {
  if (!isObj(input)) return { ok: false, code: "invalid_body" };
  const patch: SettingsPatch = {};

  if ("serviceTaxRegistered" in input) {
    if (typeof input.serviceTaxRegistered !== "boolean") {
      return { ok: false, code: "invalid_service_tax_registered" };
    }
    patch.serviceTaxRegistered = input.serviceTaxRegistered;
  }

  if ("serviceTax" in input) {
    if (!isObj(input.serviceTax)) return { ok: false, code: "invalid_service_tax" };
    const out: Partial<Record<TaxableClass, Partial<TaxMapping>>> = {};
    for (const [k, raw] of Object.entries(input.serviceTax)) {
      if (!isTaxClass(k) || !serviceTaxKeyFor(k) || k === "service_charge") {
        return { ok: false, code: "invalid_service_tax_class" };
      }
      if (!isObj(raw)) return { ok: false, code: "invalid_service_tax" };
      const mapping: Partial<TaxMapping> = {};
      if ("rateBp" in raw) {
        const v = bp(raw.rateBp);
        if (v === undefined) return { ok: false, code: "invalid_tax_rate" };
        mapping.rateBp = v;
      }
      if ("n3TaxCodeId" in raw) {
        const v = idOrNull(raw.n3TaxCodeId);
        if (v === undefined) return { ok: false, code: "invalid_tax_code" };
        mapping.n3TaxCodeId = v;
      }
      if ("n3TaxCodeSnapshot" in raw) {
        const v = idOrNull(raw.n3TaxCodeSnapshot);
        if (v === undefined) return { ok: false, code: "invalid_tax_code" };
        mapping.n3TaxCodeSnapshot = v;
      }
      out[k as TaxableClass] = mapping;
    }
    patch.serviceTax = out;
  }

  if ("exempt" in input) {
    if (!isObj(input.exempt)) return { ok: false, code: "invalid_exempt_mapping" };
    const id = idOrNull(input.exempt.n3TaxCodeId);
    const snap = idOrNull(input.exempt.n3TaxCodeSnapshot);
    if (id === undefined || snap === undefined)
      return { ok: false, code: "invalid_exempt_mapping" };
    patch.exempt = { n3TaxCodeId: id, n3TaxCodeSnapshot: snap };
  }

  if ("serviceCharge" in input) {
    if (!isObj(input.serviceCharge)) return { ok: false, code: "invalid_service_charge" };
    const sc: Partial<FinancialSettings["serviceCharge"]> = {};
    if ("enabled" in input.serviceCharge) {
      if (typeof input.serviceCharge.enabled !== "boolean") {
        return { ok: false, code: "invalid_service_charge" };
      }
      sc.enabled = input.serviceCharge.enabled;
    }
    if ("percentBp" in input.serviceCharge) {
      const v = bp(input.serviceCharge.percentBp);
      if (v === undefined || v === null) return { ok: false, code: "invalid_service_charge_rate" };
      sc.percentBp = v;
    }
    if ("serviceTaxApplies" in input.serviceCharge) {
      if (typeof input.serviceCharge.serviceTaxApplies !== "boolean") {
        return { ok: false, code: "invalid_service_charge" };
      }
      sc.serviceTaxApplies = input.serviceCharge.serviceTaxApplies;
    }
    if (sc.enabled === true && sc.percentBp === 0) {
      return { ok: false, code: "service_charge_rate_required" };
    }
    patch.serviceCharge = sc;
  }

  const levyLike = (
    key: "tourismTax" | "localLevy",
  ): { ok: false; code: string } | { ok: true } => {
    if (!(key in input)) return { ok: true };
    const raw = (input as Record<string, unknown>)[key];
    if (!isObj(raw)) return { ok: false, code: `invalid_${key}` };
    const out: Record<string, unknown> = {};
    if ("enabled" in raw) {
      if (typeof raw.enabled !== "boolean") return { ok: false, code: `invalid_${key}` };
      out.enabled = raw.enabled;
    }
    if ("centsPerRoomNight" in raw) {
      const v = cents(raw.centsPerRoomNight);
      if (v === undefined) return { ok: false, code: `invalid_${key}_amount` };
      out.centsPerRoomNight = v;
    }
    for (const f of ["effectiveFrom", "effectiveTo"] as const) {
      if (f in raw) {
        const v = raw[f];
        if (v === null) out[f] = null;
        else if (isIsoDate(v)) out[f] = v;
        else return { ok: false, code: `invalid_${key}_effective_date` };
      }
    }
    if (key === "localLevy" && "label" in raw) {
      const v = idOrNull(raw.label);
      if (v === undefined) return { ok: false, code: "invalid_local_levy_label" };
      out.label = v;
    }
    if (
      out.enabled === true &&
      typeof out.centsPerRoomNight === "number" &&
      out.centsPerRoomNight === 0
    ) {
      return {
        ok: false,
        code: `${key === "tourismTax" ? "tourism_tax" : "local_levy"}_amount_required`,
      };
    }
    const from = out.effectiveFrom as string | null | undefined;
    const to = out.effectiveTo as string | null | undefined;
    if (typeof from === "string" && typeof to === "string" && to < from) {
      return { ok: false, code: `invalid_${key}_effective_date` };
    }
    (patch as Record<string, unknown>)[key] = out;
    return { ok: true };
  };

  for (const key of ["tourismTax", "localLevy"] as const) {
    const r = levyLike(key);
    if (!r.ok) return r;
  }

  if ("rounding" in input) {
    if (!isObj(input.rounding)) return { ok: false, code: "invalid_rounding" };
    const out: Partial<FinancialSettings["rounding"]> = {};
    if ("mode" in input.rounding) {
      if (!isRoundingMode(input.rounding.mode)) return { ok: false, code: "invalid_rounding_mode" };
      out.mode = input.rounding.mode;
    }
    if ("n3RoundingAccountId" in input.rounding) {
      const v = idOrNull(input.rounding.n3RoundingAccountId);
      if (v === undefined) return { ok: false, code: "invalid_rounding_account" };
      out.n3RoundingAccountId = v;
    }
    if ("n3RoundingAccountSnapshot" in input.rounding) {
      const v = idOrNull(input.rounding.n3RoundingAccountSnapshot);
      if (v === undefined) return { ok: false, code: "invalid_rounding_account" };
      out.n3RoundingAccountSnapshot = v;
    }
    patch.rounding = out;
  }

  if ("postingMappings" in input) {
    const v = validatePostingMappingsPatch(input.postingMappings);
    if (!v.ok) return { ok: false, code: v.code };
    patch.postingMappings = v.patch;
  }

  if (Object.keys(patch).length === 0) return { ok: false, code: "no_valid_fields" };
  return { ok: true, patch };
}

/** Apply a validated patch immutably. */
export function applySettingsPatch(
  current: FinancialSettings,
  patch: SettingsPatch,
): FinancialSettings {
  const next: FinancialSettings = {
    ...current,
    serviceTax: { ...current.serviceTax },
    exempt: { ...current.exempt },
    serviceCharge: { ...current.serviceCharge },
    tourismTax: { ...current.tourismTax },
    localLevy: { ...current.localLevy },
    rounding: { ...current.rounding },
    postingMappings: { ...current.postingMappings },
  };
  if (patch.serviceTaxRegistered !== undefined) {
    next.serviceTaxRegistered = patch.serviceTaxRegistered;
  }
  if (patch.serviceTax) {
    for (const [k, v] of Object.entries(patch.serviceTax)) {
      const key = k as TaxableClass;
      next.serviceTax[key] = { ...next.serviceTax[key], ...v };
    }
  }
  if (patch.exempt) next.exempt = { ...next.exempt, ...patch.exempt };
  if (patch.serviceCharge) next.serviceCharge = { ...next.serviceCharge, ...patch.serviceCharge };
  if (patch.tourismTax) next.tourismTax = { ...next.tourismTax, ...patch.tourismTax };
  if (patch.localLevy) next.localLevy = { ...next.localLevy, ...patch.localLevy };
  if (patch.rounding) next.rounding = { ...next.rounding, ...patch.rounding };
  if (patch.postingMappings) {
    next.postingMappings = applyPostingMappingsPatch(next.postingMappings, patch.postingMappings);
  }
  return next;
}
