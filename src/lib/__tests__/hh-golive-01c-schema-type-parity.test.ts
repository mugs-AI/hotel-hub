import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath =
  "supabase/migrations/20260916120000_hh_golive_01c_posting_mappings_parity.sql";
const migration = readFileSync(migrationPath, "utf8");
const generatedTypes = readFileSync("src/integrations/supabase/types.ts", "utf8");
const folioStore = readFileSync("src/lib/folio-store.server.ts", "utf8");

describe("HH-GOLIVE-01C posting-mappings schema/type parity", () => {
  it("records the production column through one canonical additive migration", () => {
    expect(migration).toMatch(
      /alter table public\.hotel_financial_settings\s+add column if not exists posting_mappings jsonb/i,
    );
    expect(migration).not.toMatch(/drop\s+(table|column)|truncate|delete\s+from/i);
  });

  it("keeps browser database access closed", () => {
    expect(migration).not.toMatch(/grant\s+.*\s+to\s+(anon|authenticated)/i);
    expect(migration).not.toMatch(/create\s+policy/i);
  });

  it("includes the table and JSONB column in generated database types", () => {
    expect(generatedTypes).toContain("hotel_financial_settings: {");
    expect(generatedTypes).toMatch(/Row:\s*\{[\s\S]*?posting_mappings: Json \| null/);
    expect(generatedTypes).toMatch(/Insert:\s*\{[\s\S]*?posting_mappings\?: Json \| null/);
    expect(generatedTypes).toMatch(/Update:\s*\{[\s\S]*?posting_mappings\?: Json \| null/);
  });

  it("keeps missing-column handling fail-closed until the migration is applied", () => {
    expect(folioStore).toContain('FolioError("posting_mappings_storage_unavailable", 503)');
    expect(folioStore).toContain("isMissingPostingMappingsColumn");
  });

  it("removes the superseded pending-migration source reference", () => {
    expect(folioStore).not.toContain("db/migrations-pending");
    expect(generatedTypes).not.toContain("db/migrations-pending");
  });
});
