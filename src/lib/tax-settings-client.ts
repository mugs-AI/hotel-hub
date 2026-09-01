import type { SettingsPatch, TaxableClass } from "./financial-settings";

const TAXABLE_CLASSES: readonly TaxableClass[] = [
  "accommodation",
  "food_and_beverage",
  "parking",
  "other_taxable_service",
];

export type TaxCodeDraft = Record<TaxableClass, { id: string | null; text: string | null }>;

/**
 * Build the only browser-owned part of a Service Tax save: immutable N3 ids.
 * Display snapshots and rates are intentionally absent; the write route
 * re-reads and supplies both from N3 before persisting anything.
 */
export function buildN3TaxSelectionPatch(
  codes: TaxCodeDraft,
  exemptId: string | null,
): Pick<SettingsPatch, "serviceTax" | "exempt"> {
  const serviceTax: NonNullable<SettingsPatch["serviceTax"]> = {};
  for (const taxClass of TAXABLE_CLASSES) {
    serviceTax[taxClass] = { n3TaxCodeId: codes[taxClass].id };
  }
  return { serviceTax, exempt: { n3TaxCodeId: exemptId } };
}
