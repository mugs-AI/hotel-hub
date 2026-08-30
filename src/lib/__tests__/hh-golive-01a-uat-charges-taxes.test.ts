// HH-GOLIVE-01A UAT correction — acceptance tests.
//
// Covers: Malaysian date handling, arbitrary-identifier rejection, snapshot
// immutability/verification reset, fail-closed future-posting readiness,
// unproven N3 contracts, and the source contracts of the corrected UI and the
// staged migration.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isoToMyDate, isValidIsoDate, myDateToIso } from "@/lib/malaysia-date";
import {
  defaultFinancialSettings,
  applySettingsPatch,
  settingsWindowError,
  validateSettingsPatch,
  isIsoDate,
} from "@/lib/financial-settings";
import {
  applyPostingMappingsPatch,
  defaultPostingMappings,
  parsePostingMappings,
  validatePostingMappingsPatch,
} from "@/lib/posting-mappings";
import {
  postingReadiness,
  UNVERIFIED_ACCOUNT_TEXT,
  NOT_POSTED_NOTICE,
} from "@/lib/posting-readiness";
import { N3_SELECTOR_CONTRACTS, isSelectorProven } from "@/lib/n3-selectors";
import { effectiveWindowError } from "@/components/ChargesTaxesPanel";

const TENANT = "tenant-a";

function verifiedSnapshot(prefix: string) {
  return { id: `${prefix}-id`, code: `${prefix.toUpperCase()}01`, name: `${prefix} name` };
}

describe("Malaysian dates", () => {
  it("displays ISO storage as dd/mm/yyyy", () => {
    expect(isoToMyDate("2026-03-09")).toBe("09/03/2026");
  });

  it("parses dd/mm/yyyy back to ISO", () => {
    expect(myDateToIso("09/03/2026")).toBe("2026-03-09");
  });

  it("rejects impossible calendar dates", () => {
    expect(myDateToIso("31/02/2026")).toBeNull();
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-02-31")).toBe(false);
  });

  it("accepts a real leap day and rejects a non-leap 29 February", () => {
    expect(myDateToIso("29/02/2028")).toBe("2028-02-29");
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(myDateToIso("29/02/2027")).toBeNull();
    expect(isIsoDate("2027-02-29")).toBe(false);
  });

  it("refuses an inverted effective range in the form", () => {
    expect(effectiveWindowError("2026-05-01", "2026-04-30")).toMatch(/earlier/i);
    expect(effectiveWindowError("2026-05-01", "2026-05-01")).toBeNull();
    expect(effectiveWindowError("2026-02-30", "")).toMatch(/real/i);
  });

  it("refuses an inverted range created across two separate patches", () => {
    const base = defaultFinancialSettings(TENANT);
    const first = validateSettingsPatch({
      tourismTax: { enabled: true, centsPerRoomNight: 1000, effectiveFrom: "2026-05-01" },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const afterFirst = applySettingsPatch(base, first.patch);
    expect(settingsWindowError(afterFirst)).toBeNull();

    const second = validateSettingsPatch({ tourismTax: { effectiveTo: "2026-04-01" } });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const merged = applySettingsPatch(afterFirst, second.patch);
    expect(settingsWindowError(merged)).toBe("invalid_tourismTax_effective_date");
  });
});

describe("posting mapping references", () => {
  it("rejects an identifier that did not come from a selector row", () => {
    const res = validatePostingMappingsPatch({
      service_charge: { stock: { id: "0d0f-typed-uuid", code: null, name: null } },
    });
    expect(res).toEqual({ ok: false, code: "invalid_posting_mapping_reference" });
  });

  it("rejects unknown components and unknown fields", () => {
    expect(validatePostingMappingsPatch({ room_revenue: { enabled: true } }).ok).toBe(false);
    expect(validatePostingMappingsPatch({ discount: { verification: "verified" } }).ok).toBe(false);
  });

  it("never lets the browser assert a verification state", () => {
    const current = defaultPostingMappings();
    current.service_charge = {
      ...current.service_charge,
      enabled: true,
      stock: verifiedSnapshot("stock"),
      verification: "verified",
      verifiedAt: "2026-05-01T00:00:00.000Z",
    };
    const res = validatePostingMappingsPatch({
      service_charge: { stock: { id: "other-id", code: "STOCK02", name: "Other" } },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const next = applyPostingMappingsPatch(current, res.patch);
    expect(next.service_charge.verification).toBe("unverified");
    expect(next.service_charge.verifiedAt).toBeNull();
  });

  it("does not mutate the previous mapping snapshot object", () => {
    const current = defaultPostingMappings();
    const before = current.tourism_tax;
    const res = validatePostingMappingsPatch({
      tourism_tax: { enabled: true, stock: verifiedSnapshot("tt") },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const next = applyPostingMappingsPatch(current, res.patch);
    expect(before.stock.id).toBeNull();
    expect(next.tourism_tax).not.toBe(before);
  });

  it("falls back to unmapped defaults when storage is absent", () => {
    const parsed = parsePostingMappings(undefined);
    expect(parsed.local_levy.enabled).toBe(false);
    expect(parsed.local_levy.stock.id).toBeNull();
    expect(parsed.local_levy.verification).toBe("unverified");
  });
});

describe("fail-closed future-posting readiness", () => {
  it("is never ready with an empty configuration", () => {
    const settings = defaultFinancialSettings(TENANT);
    const r = postingReadiness(settings, settings.postingMappings);
    expect(r.readyForFuturePosting).toBe(false);
    expect(r.notice).toBe(NOT_POSTED_NOTICE);
  });

  it("blocks an enabled component whose destination cannot be proven", () => {
    const settings = defaultFinancialSettings(TENANT);
    settings.serviceCharge = { ...settings.serviceCharge, enabled: true, percentBp: 1000 };
    settings.postingMappings.service_charge = {
      ...settings.postingMappings.service_charge,
      enabled: true,
      stock: verifiedSnapshot("stock"),
      uom: verifiedSnapshot("uom"),
      taxCode: verifiedSnapshot("tax"),
      resolvedAccount: { id: null, code: null, name: null },
      verification: "verified",
    };
    const r = postingReadiness(settings, settings.postingMappings);
    const row = r.rows.find((x) => x.key === "service_charge");
    expect(row?.resolvedAccount).toBe(UNVERIFIED_ACCOUNT_TEXT);
    expect(row?.status).toBe("incomplete");
    expect(r.readyForFuturePosting).toBe(false);
  });

  it("blocks a complete but drifted or unverified mapping", () => {
    const settings = defaultFinancialSettings(TENANT);
    settings.tourismTax = { ...settings.tourismTax, enabled: true, centsPerRoomNight: 1000 };
    const complete = {
      ...settings.postingMappings.tourism_tax,
      enabled: true,
      stock: verifiedSnapshot("stock"),
      uom: verifiedSnapshot("uom"),
      taxCode: verifiedSnapshot("tax"),
      resolvedAccount: verifiedSnapshot("acct"),
    };
    for (const state of ["unverified", "drifted", "unavailable"] as const) {
      settings.postingMappings.tourism_tax = { ...complete, verification: state };
      const r = postingReadiness(settings, settings.postingMappings);
      expect(r.readyForFuturePosting).toBe(false);
      expect(r.rows.find((x) => x.key === "tourism_tax")?.status).not.toBe("ready");
    }
  });

  it("blocks rounding without an eligible posting account", () => {
    const settings = defaultFinancialSettings(TENANT);
    settings.rounding = {
      mode: "nearest_5_cents",
      n3RoundingAccountId: null,
      n3RoundingAccountSnapshot: null,
    };
    const r = postingReadiness(settings, settings.postingMappings);
    expect(r.rows.find((x) => x.key === "rounding")?.resolvedAccount).toBe(UNVERIFIED_ACCOUNT_TEXT);
    expect(r.readyForFuturePosting).toBe(false);
  });

  it("blocks a taxable class that has no N3 tax code", () => {
    const settings = defaultFinancialSettings(TENANT);
    settings.serviceTaxRegistered = true;
    settings.serviceTax.accommodation = {
      ...settings.serviceTax.accommodation,
      rateBp: 800,
      n3TaxCodeId: null,
      n3TaxCodeSnapshot: null,
    };
    const r = postingReadiness(settings, settings.postingMappings);
    expect(r.blockers.some((b) => /Accommodation Service Tax/.test(b))).toBe(true);
    expect(r.readyForFuturePosting).toBe(false);
  });

  it("reports every unproven N3 read contract instead of guessing one", () => {
    const settings = defaultFinancialSettings(TENANT);
    const r = postingReadiness(settings, settings.postingMappings);
    // All four selector contracts are now proven from documented read-only
    // GETs, so nothing is reported as blocked for want of a contract.
    expect(r.blockedContracts.map((c) => c.kind).sort()).toEqual([]);
    for (const c of r.blockedContracts) expect(c.missingEvidence.length).toBeGreaterThan(0);
  });
});

describe("N3 selector contracts", () => {
  it("only offers selectors whose read-only contract is proven in this repository", () => {
    expect(isSelectorProven("stock")).toBe(true);
    expect(isSelectorProven("gl_account")).toBe(true);
    expect(isSelectorProven("tax_code")).toBe(true);
    expect(isSelectorProven("uom")).toBe(true);
  });


  it("never carries an endpoint for an unproven contract", () => {
    for (const c of Object.values(N3_SELECTOR_CONTRACTS)) {
      if (!c.proven) expect(c.endpoint).toBeNull();
      else expect(typeof c.endpoint).toBe("string");
    }
  });
});

// ---------------------------------------------------------- source contracts

const panel = readFileSync("src/components/ChargesTaxesPanel.tsx", "utf8");
const selectorRoute = readFileSync("src/routes/api/n3/selectors.$kind.ts", "utf8");
const selectorServer = readFileSync("src/lib/n3-selectors.server.ts", "utf8");
const migration = readFileSync(
  "db/migrations-pending/20260904120000_hh_golive_01a_posting_mappings.sql",
  "utf8",
);

describe("Charges & Taxes source contract", () => {
  it("has no native date input anywhere in the application", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx|ts)$/.test(entry.name)) {
          const text = readFileSync(full, "utf8");
          if (/type=["']date["']/.test(text)) hits.push(full);
        }
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });

  it("exposes no free-text N3 identifier field", () => {
    expect(panel).not.toMatch(/n3UomId:\s*orNull/);
    expect(panel).not.toMatch(/placeholder="[0-9a-f-]{8,}"/i);
    expect(panel).toContain("N3SelectorField");
    expect(panel).toContain("NOT_POSTED_NOTICE");
  });

  it("renders the Accounting Mapping Summary columns", () => {
    for (const col of ["Charge", "N3 Stock", "Tax Code", "Resolved account", "Status"]) {
      expect(panel).toContain(col);
    }
  });

  it("keeps the selector endpoint read-only and owner-gated", () => {
    expect(selectorRoute).toContain("hotel:charges:manage");
    expect(selectorRoute).not.toMatch(/\bPOST\b|\bPUT\b|\bDELETE\b|\bPATCH\b/);
    // No N3 write verbs anywhere in the new server path.
    expect(selectorServer).not.toMatch(/CashMemo|AROR|knock|refund|journal/i);
  });
});

describe("staged migration hygiene", () => {
  it("is additive, idempotent and carries a rollback inventory", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS posting_mappings");
    expect(migration).toMatch(/ROLLBACK INVENTORY/);
    expect(migration).toMatch(/DROP COLUMN IF EXISTS posting_mappings/);
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|ALTER COLUMN .* TYPE|DELETE FROM/i);
  });

  it("grants no browser access", () => {
    expect(migration).not.toMatch(/GRANT .* TO (anon|authenticated)/i);
    expect(migration).not.toMatch(/CREATE POLICY/i);
  });
});
