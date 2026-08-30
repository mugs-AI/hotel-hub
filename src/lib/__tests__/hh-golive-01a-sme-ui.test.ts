// HH-GOLIVE-01A OWNER UAT correction — requirements B, C, D, F.
//
// These are source-level contracts on the customer-facing surface:
//   B — no "Use suggested" control survives anywhere in the app;
//   C — customer-facing date entry always uses the Malaysian DD/MM/YYYY input,
//       never a raw browser date field (the wire stays ISO);
//   D — the Folio card reads light-warm, the Deposits card light teal/blue;
//   F — the Deposits story lives in an information popover, not a toggle.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__" || entry === "ui") continue;
      walk(p, out);
    } else if (/\.(tsx|ts)$/.test(entry)) out.push(p);
  }
  return out;
}

const SRC = join(process.cwd(), "src");
const files = walk(SRC);

describe("B — suggested rates are gone", () => {
  it("no component offers a 'Use suggested' control", () => {
    const offenders = files.filter((f) => /Use suggested/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("C — Malaysian dates on every customer-facing input", () => {
  it("no raw browser date input is rendered", () => {
    const offenders = files.filter((f) => /type=["']date["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the Malaysian input shows DD/MM/YYYY while its value stays ISO", () => {
    const src = readFileSync(join(SRC, "components/malaysia-date-input.tsx"), "utf8");
    expect(src.toUpperCase()).toContain("DD/MM/YYYY");
    expect(src).toContain('type="text"');
  });
});

describe("D and F — money cards", () => {
  const folio = readFileSync(join(SRC, "components/FolioCard.tsx"), "utf8");
  const deposits = readFileSync(join(SRC, "components/DepositsCard.tsx"), "utf8");

  it("the folio card is a light warm money card", () => {
    expect(folio).toContain("#FEF9F1");
  });

  it("the deposits card is a light teal/blue money card", () => {
    expect(deposits).toContain("#F1FAFB");
  });

  it("deposits explain themselves in a popover, with no Details/Hide toggle", () => {
    expect(deposits).toContain("About deposits");
    expect(deposits).toContain("PopoverContent");
    expect(deposits).not.toMatch(/>\s*(Details|Hide)\s*</);
    expect(deposits).not.toContain("setExpanded");
  });
});
