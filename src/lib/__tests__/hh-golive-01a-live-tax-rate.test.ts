// HH-GOLIVE-01A OWNER UAT correction — requirement A.
//
// The Service Tax rate is no longer a suggestion the Owner accepts. It comes
// from the chosen proven N3 Output Tax code, and whatever rate the browser
// submits is REPLACED by the live N3 rate on save. Nothing is guessed: when N3
// declares no usable rate, the submitted rate stands and an unset rate keeps
// blocking readiness. The N3 posting account of a tax code never reaches the
// browser.
import { describe, expect, it } from "vitest";

import { normalizeTaxRateToBp, type N3SelectorLoad } from "@/lib/n3-selectors";
import { canonicalizeSettingsPatch, type SelectorLoader } from "@/lib/n3-canonicalize.server";
import { defaultPostingMappings } from "@/lib/posting-mappings";

function loaderFor(
  rows: Array<{ id: string; code: string; name: string | null; rateBp?: number | null }>,
): SelectorLoader {
  return async () => ({ status: "ok", items: rows }) as N3SelectorLoad;
}

describe("normalizeTaxRateToBp — N3 states a percentage", () => {
  it("converts plain and decimal percentages to basis points", () => {
    expect(normalizeTaxRateToBp(6)).toBe(600);
    expect(normalizeTaxRateToBp("8")).toBe(800);
    expect(normalizeTaxRateToBp("6.5")).toBe(650);
    expect(normalizeTaxRateToBp(" 10 % ")).toBe(1000);
    expect(normalizeTaxRateToBp(0)).toBe(0);
  });

  it("never guesses a rate from unusable input", () => {
    for (const bad of [null, undefined, "", "  ", "abc", {}, [], true, NaN, -1, 101, Infinity]) {
      expect(normalizeTaxRateToBp(bad)).toBeNull();
    }
  });
});

describe("server-authoritative Service Tax rate", () => {
  const rows = [
    { id: "T1", code: "SR", name: "Service Tax 8%", rateBp: 800 },
    { id: "T2", code: "SR0", name: "No declared rate", rateBp: null },
  ];

  it("overwrites a browser-submitted rate with the live N3 rate", async () => {
    const out = await canonicalizeSettingsPatch(
      { serviceTax: { accommodation: { n3TaxCodeId: "T1", rateBp: 1 } } },
      loaderFor(rows),
      defaultPostingMappings(),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.serviceTax?.accommodation?.rateBp).toBe(800);
      expect(out.value.serviceTax?.accommodation?.n3TaxCodeSnapshot).toBe("SR");
    }
  });

  it("keeps the submitted rate when N3 declares none, and guesses nothing", async () => {
    const out = await canonicalizeSettingsPatch(
      { serviceTax: { accommodation: { n3TaxCodeId: "T2", rateBp: 600 } } },
      loaderFor(rows),
      defaultPostingMappings(),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.serviceTax?.accommodation?.rateBp).toBe(600);
  });

  it("never lets a browser snapshot or posting account through", async () => {
    const out = await canonicalizeSettingsPatch(
      {
        serviceTax: {
          accommodation: {
            n3TaxCodeId: "T1",
            n3TaxCodeSnapshot: "SPOOF",
            rateBp: 9999,
          },
        },
      },
      loaderFor(rows),
      defaultPostingMappings(),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.serviceTax?.accommodation?.n3TaxCodeSnapshot).toBe("SR");
      expect(out.value.serviceTax?.accommodation?.rateBp).toBe(800);
      expect(JSON.stringify(out.value)).not.toContain("postingAccountId");
    }
  });
});
