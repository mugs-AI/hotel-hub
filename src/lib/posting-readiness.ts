// HH-GOLIVE-01A UAT correction — fail-closed future-posting readiness and the
// Owner-facing Accounting Mapping Summary.
//
// PREPARATION ONLY: readiness here means "the later posting milestone would
// have a complete, verified contract". It never means anything was posted.
//
// Fail-closed by construction: anything incomplete, inactive, changed,
// unavailable or unverifiable blocks readiness. There is no partial credit and
// no typed-account fallback.
//
// PURE module: no I/O, no secrets.
import {
  POSTING_COMPONENTS,
  POSTING_COMPONENT_LABELS,
  type PostingComponent,
  type PostingMapping,
  type PostingMappings,
} from "./posting-mappings";
import { N3_SELECTOR_CONTRACTS, N3_SELECTOR_KINDS, type N3SelectorKind } from "./n3-selectors";
import type { FinancialSettings, TaxableClass } from "./financial-settings";

export const UNVERIFIED_ACCOUNT_TEXT = "Unable to verify accounting destination";
export const NOT_POSTED_NOTICE = "Prepared folio only — nothing is posted to N3 in this milestone.";

export type MappingRowStatus = "ready" | "incomplete" | "unverified" | "changed" | "not_used";

export const MAPPING_ROW_STATUS_LABELS: Record<MappingRowStatus, string> = {
  ready: "Ready for future posting",
  incomplete: "Missing information",
  unverified: "Not yet verified",
  changed: "Changed in N3 — recheck",
  not_used: "Not used",
};

/** One line of the Accounting Mapping Summary table. Human labels only. */
export type MappingSummaryRow = {
  key: string;
  /** "Charge" column. */
  charge: string;
  /** "N3 Stock" column — code/name, never an identifier. */
  stock: string;
  /** "Tax Code" column — code/name, never an identifier. */
  taxCode: string;
  /** "Resolved account" column, or the explicit unable-to-verify text. */
  resolvedAccount: string;
  status: MappingRowStatus;
  /** Plain-English reasons this row is not ready. */
  blockers: string[];
};

export type PostingReadiness = {
  /** True only when every enabled component and rounding is fully verified. */
  readyForFuturePosting: boolean;
  rows: MappingSummaryRow[];
  /** Plain-English blockers across the whole configuration. */
  blockers: string[];
  /** Selector kinds whose read-only N3 contract is not proven yet. */
  blockedContracts: { kind: N3SelectorKind; label: string; missingEvidence: string }[];
  notice: string;
};

function human(snapshot: { code: string | null; name: string | null }): string | null {
  if (!snapshot.code && !snapshot.name) return null;
  if (snapshot.code && snapshot.name) return `${snapshot.code} — ${snapshot.name}`;
  return snapshot.code ?? snapshot.name;
}

function componentRow(mapping: PostingMapping): MappingSummaryRow {
  const charge = POSTING_COMPONENT_LABELS[mapping.component];
  const stock = human(mapping.stock);
  const taxCode = human(mapping.taxCode);
  const account = human(mapping.resolvedAccount);
  const uom = human(mapping.uom);

  if (!mapping.enabled) {
    return {
      key: mapping.component,
      charge,
      stock: stock ?? "—",
      taxCode: taxCode ?? "—",
      resolvedAccount: account ?? "—",
      status: "not_used",
      blockers: [],
    };
  }

  const blockers: string[] = [];
  if (!mapping.stock.id) blockers.push(`${charge}: choose the N3 stock or service item.`);
  if (!uom) blockers.push(`${charge}: choose the N3 unit of measure.`);
  if (!mapping.taxCode.id) blockers.push(`${charge}: choose the N3 tax code.`);
  if (!mapping.resolvedAccount.id) blockers.push(`${charge}: ${UNVERIFIED_ACCOUNT_TEXT}.`);

  let status: MappingRowStatus;
  if (blockers.length > 0) {
    status = "incomplete";
  } else if (mapping.verification === "drifted") {
    status = "changed";
    blockers.push(`${charge}: the mapped N3 records changed — check them again.`);
  } else if (mapping.verification !== "verified") {
    status = "unverified";
    blockers.push(`${charge}: the mapped N3 records have not been confirmed yet.`);
  } else {
    status = "ready";
  }

  return {
    key: mapping.component,
    charge,
    stock: stock ?? "—",
    taxCode: taxCode ?? "—",
    resolvedAccount: account ?? UNVERIFIED_ACCOUNT_TEXT,
    status,
    blockers,
  };
}

const TAXABLE_CLASS_LABELS: Record<TaxableClass, string> = {
  accommodation: "Accommodation",
  food_and_beverage: "Food & beverage",
  parking: "Parking",
  other_taxable_service: "Other taxable service",
};

/**
 * Fail-closed readiness for the future posting milestone.
 *
 * Room and add-on revenue follows the mapped N3 Stock on each catalogue item
 * (checked by the catalogue's own mapping status); this function covers the
 * property-level components and rounding.
 */
export function postingReadiness(
  settings: FinancialSettings,
  mappings: PostingMappings,
): PostingReadiness {
  const rows: MappingSummaryRow[] = [];
  const blockers: string[] = [];

  // Service Tax per taxable class — a taxable class must carry a tax code.
  if (settings.serviceTaxRegistered) {
    for (const key of Object.keys(TAXABLE_CLASS_LABELS) as TaxableClass[]) {
      const mapping = settings.serviceTax[key];
      const label = `${TAXABLE_CLASS_LABELS[key]} Service Tax`;
      const rowBlockers: string[] = [];
      if (mapping.rateBp === null) rowBlockers.push(`${label}: set the rate.`);
      if (!mapping.n3TaxCodeId) rowBlockers.push(`${label}: choose the N3 tax code.`);
      rows.push({
        key: `service_tax_${key}`,
        charge: label,
        stock: "Follows the charged item",
        taxCode: mapping.n3TaxCodeSnapshot ?? "—",
        resolvedAccount: mapping.n3TaxCodeId ? "Follows the N3 tax code" : UNVERIFIED_ACCOUNT_TEXT,
        status: rowBlockers.length ? "incomplete" : "ready",
        blockers: rowBlockers,
      });
      blockers.push(...rowBlockers);
    }
  }

  // Component mappings.
  for (const component of POSTING_COMPONENTS) {
    const mapping = mappings[component] ?? null;
    if (!mapping) continue;
    const enabled = componentEnabled(settings, component, mapping);
    const row = componentRow({ ...mapping, enabled });
    rows.push(row);
    blockers.push(...row.blockers);
  }

  // Rounding uses a separately eligible posting account.
  if (settings.rounding.mode !== "none") {
    const ok = Boolean(settings.rounding.n3RoundingAccountId);
    const rowBlockers = ok ? [] : ["Rounding: choose an eligible N3 posting account."];
    rows.push({
      key: "rounding",
      charge: "Rounding",
      stock: "—",
      taxCode: "—",
      resolvedAccount: ok
        ? (settings.rounding.n3RoundingAccountSnapshot ?? UNVERIFIED_ACCOUNT_TEXT)
        : UNVERIFIED_ACCOUNT_TEXT,
      status: ok ? "ready" : "incomplete",
      blockers: rowBlockers,
    });
    blockers.push(...rowBlockers);
  }

  const blockedContracts = N3_SELECTOR_KINDS.filter((k) => !N3_SELECTOR_CONTRACTS[k].proven).map(
    (k) => ({
      kind: k,
      label: N3_SELECTOR_CONTRACTS[k].label,
      missingEvidence: N3_SELECTOR_CONTRACTS[k].missingEvidence ?? "",
    }),
  );
  for (const c of blockedContracts) {
    blockers.push(`${c.label}: N3 contract not yet verified, so it cannot be selected yet.`);
  }

  return {
    readyForFuturePosting: blockers.length === 0,
    rows,
    blockers,
    blockedContracts,
    notice: NOT_POSTED_NOTICE,
  };
}

/**
 * A component is only "in use" when the Owner switched the underlying charge
 * on. Discounts and adjustments are always available to supervisors, so their
 * mappings are always required.
 */
export function componentEnabled(
  settings: FinancialSettings,
  component: PostingComponent,
  mapping: PostingMapping,
): boolean {
  switch (component) {
    case "service_charge":
      return settings.serviceCharge.enabled;
    case "tourism_tax":
      return settings.tourismTax.enabled;
    case "local_levy":
      return settings.localLevy.enabled;
    default:
      return mapping.enabled;
  }
}

/**
 * Catalogue charging gate: an add-on may only be charged once its Stock, UOM
 * and Tax Code are all mapped AND verified.
 */
export function catalogueItemChargeable(item: {
  n3StockId: string | null;
  n3UomId: string | null;
  n3TaxCodeId: string | null;
  mappingStatus: string;
}): boolean {
  return Boolean(
    item.n3StockId && item.n3UomId && item.n3TaxCodeId && item.mappingStatus === "mapped",
  );
}
