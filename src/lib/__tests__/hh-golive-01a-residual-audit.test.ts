// HH-GOLIVE-01A residual audit fixes.
//
// 1. The Owner verification run time is shown in Malaysian format, not in
//    whatever format the viewer's device happens to use.
// 2. A tax code with no usable live N3 rate cannot be chosen at all, a real 0%
//    Exempt code can, and the current selection shows the live rate resolved
//    from the loaded N3 list by immutable identifier.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { formatMyTimestamp } from "@/lib/malaysia-date";
import { formatRateBpPercent, isTaxRowSelectable } from "@/lib/n3-selectors";

function read(p: string) {
  return readFileSync(p, "utf8");
}

describe("Owner verification timestamp is Malaysian", () => {
  const src = read("src/routes/settings_.n3-financial-verification.tsx");

  it("renders the run time through the Malaysian timestamp helper", () => {
    expect(src).toContain('import { formatMyTimestamp } from "@/lib/malaysia-date"');
    expect(src).toContain("{formatMyTimestamp(run.runAt)}");
  });

  it("no longer uses the device-dependent default formatter", () => {
    expect(src).not.toContain("toLocaleString()");
  });

  it("formats an instant deterministically in Kuala Lumpur time", () => {
    // 2026-03-01T02:30:00Z is 10:30 on 1 March in Asia/Kuala_Lumpur.
    expect(formatMyTimestamp("2026-03-01T02:30:00Z")).toBe("01/03/2026 10:30");
  });
});

describe("tax selector eligibility", () => {
  it("refuses rows whose live N3 rate is missing or malformed", () => {
    for (const bad of [null, undefined, NaN, Infinity]) {
      expect(isTaxRowSelectable({ rateBp: bad as number | null })).toBe(false);
    }
  });

  it("accepts a real 0% Exempt rate and ordinary rates", () => {
    expect(isTaxRowSelectable({ rateBp: 0 })).toBe(true);
    expect(isTaxRowSelectable({ rateBp: 800 })).toBe(true);
  });

  it("shows 0% for an Exempt code rather than 'no rate in N3'", () => {
    expect(formatRateBpPercent(0)).toBe("0%");
    expect(formatRateBpPercent(null)).toBe("no rate in N3");
  });
});

describe("tax selector screen wiring", () => {
  const selector = read("src/components/N3SelectorField.tsx");
  const panel = read("src/components/ChargesTaxesPanel.tsx");

  it("offers no Select action for an unusable tax row", () => {
    expect(selector).toContain("showsRate && !isTaxRowSelectable(row)");
    expect(selector).toContain("No rate in N3 — fix it in N3 first");
  });

  it("resolves the displayed rate from the loaded list by immutable id", () => {
    expect(selector).toContain("rows.find((r) => r.id === value.id)");
    expect(selector).toContain("formatRateBpPercent(selectedRateBp)");
  });

  it("passes the stored tax code id so the live rate can be resolved", () => {
    expect(panel).toContain("value={{ id: codes[c].id, code: codes[c].text");
  });

  it("still never submits a browser-entered Service Tax rate", () => {
    expect(panel).not.toContain("rateBp: bp");
  });
});
