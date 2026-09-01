// HH-GOLIVE-01A OWNER UAT correction — requirement A.
//
// N3 is the SOLE source of the Service Tax rate. A rate submitted by the
// browser is always discarded, never stored and never kept as a fallback.
// Clearing the tax code clears the rate with it, and a chosen code whose live
// N3 rate is missing or malformed makes the whole save fail closed. The N3
// posting account of a tax code never reaches the browser.

import { describe, expect, it } from "vitest";

import { formatRateBpPercent, normalizeTaxRateToBp, type N3SelectorLoad } from "@/lib/n3-selectors";
import {
  canonicalErrorStatus,
  canonicalizeSettingsPatch,
  type SelectorLoader,
} from "@/lib/n3-canonicalize.server";
import { defaultPostingMappings } from "@/lib/posting-mappings";

function loaderFor(
  rows: Array<{ id: string; code: string; name: string | null; rateBp?: number | null }>,
): SelectorLoader {
  return async () => ({ status: "ok", items: rows }) as N3SelectorLoad;
}

describe("normalizeTaxRateToBp — N3 states a decimal fraction", () => {
  it("converts N3 decimal fractions and explicit percentages to basis points", () => {
    expect(normalizeTaxRateToBp(0.1)).toBe(1000);
    expect(normalizeTaxRateToBp("0.08")).toBe(800);
    expect(normalizeTaxRateToBp(0.06)).toBe(600);
    expect(normalizeTaxRateToBp(0.065)).toBe(650);
    expect(normalizeTaxRateToBp(" 10 % ")).toBe(1000);
    expect(normalizeTaxRateToBp(0)).toBe(0);
    expect(normalizeTaxRateToBp(1)).toBe(10_000);
  });

  it("never guesses an ambiguous or unusable rate", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "  ",
      "abc",
      {},
      [],
      true,
      NaN,
      -1,
      1.01,
      6,
      "6",
      101,
      Infinity,
    ]) {
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

  it("rejects the whole save when N3 declares no usable rate", async () => {
    const out = await canonicalizeSettingsPatch(
      { serviceTax: { accommodation: { n3TaxCodeId: "T2", rateBp: 600 } } },
      loaderFor(rows),
      defaultPostingMappings(),
    );
    expect(out).toEqual({ ok: false, code: "n3_tax_rate_unavailable" });
    expect(canonicalErrorStatus("n3_tax_rate_unavailable")).toBe(422);
  });

  it("clears the stored rate when the tax code is cleared", async () => {
    const out = await canonicalizeSettingsPatch(
      { serviceTax: { accommodation: { n3TaxCodeId: null, rateBp: 800 } } },
      loaderFor(rows),
      defaultPostingMappings(),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.serviceTax?.accommodation?.rateBp).toBeNull();
      expect(out.value.serviceTax?.accommodation?.n3TaxCodeId).toBeNull();
      expect(out.value.serviceTax?.accommodation?.n3TaxCodeSnapshot).toBeNull();
    }
  });

  it("ignores a browser rate when no tax code is submitted", async () => {
    const out = await canonicalizeSettingsPatch(
      { serviceTax: { accommodation: { rateBp: 1234 } } },
      loaderFor(rows),
      defaultPostingMappings(),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.serviceTax?.accommodation?.rateBp).toBeUndefined();
  });

  it("formats a live rate for display and never invents one", () => {
    expect(formatRateBpPercent(1000)).toBe("10%");
    expect(formatRateBpPercent(800)).toBe("8%");
    expect(formatRateBpPercent(650)).toBe("6.5%");
    expect(formatRateBpPercent(null)).toBe("no rate in N3");
    expect(formatRateBpPercent(undefined)).toBe("no rate in N3");
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
