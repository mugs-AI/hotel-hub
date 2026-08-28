// HH-GOLIVE-01A — pure, safe projection of the property's financial
// configuration for non-Owner surfaces.
//
// Front desk must know whether the folio can be totalled and what is still
// missing, but must NEVER receive immutable N3 tax-code identifiers, account
// identifiers or rate values. This module returns booleans and human labels
// only.
import type { FinancialSettings } from "./financial-settings";

export type FolioReadiness = {
  serviceTaxRegistered: boolean;
  serviceChargeEnabled: boolean;
  tourismTaxEnabled: boolean;
  localLevyEnabled: boolean;
  localLevyLabel: string | null;
  roundingMode: FinancialSettings["rounding"]["mode"];
  /** Human-readable names of configuration still missing. No values. */
  missing: string[];
  configurationComplete: boolean;
};

const TAXABLE_LABELS: Record<string, string> = {
  accommodation: "Accommodation Service Tax",
  food_and_beverage: "Food & Beverage Service Tax",
  parking: "Parking Service Tax",
  other_taxable_service: "Other taxable service — Service Tax",
};

export function folioReadinessProjection(settings: FinancialSettings): FolioReadiness {
  const missing: string[] = [];

  if (settings.serviceTaxRegistered) {
    for (const [key, mapping] of Object.entries(settings.serviceTax)) {
      if (mapping.rateBp === null) missing.push(`${TAXABLE_LABELS[key] ?? key} rate`);
      if (!mapping.n3TaxCodeId) missing.push(`${TAXABLE_LABELS[key] ?? key} tax code`);
    }
  }
  if (settings.serviceCharge.enabled && settings.serviceCharge.percentBp <= 0) {
    missing.push("Service charge percentage");
  }
  if (settings.tourismTax.enabled && settings.tourismTax.centsPerRoomNight <= 0) {
    missing.push("Tourism Tax amount per room-night");
  }
  if (settings.localLevy.enabled) {
    if (!settings.localLevy.label) missing.push("Local levy name");
    if (settings.localLevy.centsPerRoomNight <= 0) missing.push("Local levy amount per room-night");
  }
  if (settings.rounding.mode !== "none" && !settings.rounding.n3RoundingAccountId) {
    missing.push("Rounding account mapping");
  }

  return {
    serviceTaxRegistered: settings.serviceTaxRegistered,
    serviceChargeEnabled: settings.serviceCharge.enabled,
    tourismTaxEnabled: settings.tourismTax.enabled,
    localLevyEnabled: settings.localLevy.enabled,
    localLevyLabel: settings.localLevy.label,
    roundingMode: settings.rounding.mode,
    missing,
    configurationComplete: missing.length === 0,
  };
}
