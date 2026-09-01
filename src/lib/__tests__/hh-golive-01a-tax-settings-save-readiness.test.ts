import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildN3TaxSelectionPatch } from "../tax-settings-client";
import { FolioApiError, folioErrorMessage } from "../folio-client";
import {
  applySettingsPatch,
  defaultFinancialSettings,
  validateSettingsPatch,
  type TaxableClass,
} from "../financial-settings";
import { folioReadinessProjection } from "../folio-readiness";
import { canonicalizeSettingsPatch } from "../n3-canonicalize.server";
import type { N3SelectorLoad } from "../n3-selectors";

const TAX_CLASSES: readonly TaxableClass[] = [
  "accommodation",
  "food_and_beverage",
  "parking",
  "other_taxable_service",
];

function emptyCodes() {
  return Object.fromEntries(
    TAX_CLASSES.map((taxClass) => [taxClass, { id: null, text: null }]),
  ) as Record<TaxableClass, { id: string | null; text: string | null }>;
}

const N3_SVT_8: N3SelectorLoad = {
  status: "ok",
  kind: "tax_code",
  items: [
    {
      id: "n3-svt-8",
      code: "SVT-8%",
      name: "Service Tax (SST) Effective from 1/3/2024",
      rateBp: 800,
    },
  ],
  total: 1,
};

describe("HH-GOLIVE-01A tax settings save and readiness correction", () => {
  it("submits the chosen immutable N3 id without browser rate or snapshot fields", () => {
    const codes = emptyCodes();
    codes.accommodation = {
      id: "n3-svt-8",
      text: "SVT-8% — Service Tax (SST) Effective from 1/3/2024",
    };

    const patch = buildN3TaxSelectionPatch(codes, null);

    expect(patch.serviceTax?.accommodation).toEqual({ n3TaxCodeId: "n3-svt-8" });
    expect(patch.exempt).toEqual({ n3TaxCodeId: null });
    expect(JSON.stringify(patch)).not.toContain("rateBp");
    expect(JSON.stringify(patch)).not.toContain("Snapshot");
  });

  it("accepts the id-only payload, canonicalizes 8% from N3, and clears Accommodation readiness", async () => {
    const codes = emptyCodes();
    codes.accommodation.id = "n3-svt-8";
    const browserPatch = {
      serviceTaxRegistered: true,
      ...buildN3TaxSelectionPatch(codes, null),
    };
    const validated = validateSettingsPatch(browserPatch);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const canonical = await canonicalizeSettingsPatch(validated.patch, async (kind) => {
      expect(kind).toBe("tax_code");
      return N3_SVT_8;
    });
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;

    const saved = applySettingsPatch(defaultFinancialSettings("tenant"), canonical.value);
    const readiness = folioReadinessProjection(saved);

    expect(saved.serviceTax.accommodation).toEqual({
      n3TaxCodeId: "n3-svt-8",
      n3TaxCodeSnapshot: "SVT-8%",
      rateBp: 800,
    });
    expect(readiness.missing).not.toContain("Accommodation Service Tax rate");
    expect(readiness.missing).not.toContain("Accommodation Service Tax tax code");
    expect(readiness.missing).toContain("Food & Beverage Service Tax rate");
  });

  it("replaces the settings cache from the authoritative PATCH response", () => {
    const client = readFileSync("src/lib/folio-client.ts", "utf8");
    expect(client).toContain(
      'onSuccess: (data) => qc.setQueryData(["charge-settings", sessionKey], data)',
    );
    expect(client).not.toMatch(
      /useSaveChargeSettings\(\)[\s\S]*?invalidateQueries\(\{ queryKey: \["charge-settings"\]/,
    );
  });

  it("shows actionable save errors instead of the generic fallback", () => {
    expect(folioErrorMessage(new FolioApiError("financial_settings_write_failed", 500))).toBe(
      "Charges and taxes could not be saved. Nothing was changed. Please try again.",
    );
    expect(folioErrorMessage(new FolioApiError("invalid_tax_code", 400))).toBe(
      "Choose the N3 Tax Code again, then save.",
    );
  });
});
