/**
 * Front-desk readability correction — reservation list sorting moved into SQL.
 *
 * These tests pin the properties the correction brief requires of the
 * `hotelhub_list_reservations` routine, read from the migration source:
 *
 *  - tenant scoping is a bound parameter, never string-interpolated;
 *  - the sort key is a fixed allow-list of CASE branches (no dynamic SQL);
 *  - ordering ties are broken deterministically by created_at then id, so a
 *    row can never straddle two pages;
 *  - guest name / mobile filtering matches ANY linked guest (primary or not)
 *    across the complete tenant result, before sorting and paging;
 *  - the routine is not exposed to anon/authenticated.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "supabase/migrations");
const SQL = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(DIR, f), "utf8"))
  .filter((s) => s.includes("hotelhub_list_reservations"))
  .join("\n");

describe("hotelhub_list_reservations — SQL contract", () => {
  it("exists in a migration", () => {
    expect(SQL.length).toBeGreaterThan(0);
    expect(SQL).toMatch(/create\s+or\s+replace\s+function\s+public\.hotelhub_list_reservations/i);
  });

  it("scopes every read to the tenant parameter", () => {
    expect(SQL).toMatch(/tenant_id\s*=\s*p_tenant_id/i);
  });

  it("uses no dynamic SQL", () => {
    // `GRANT EXECUTE` is fine; an EXECUTE statement inside the body is not.
    expect(SQL).not.toMatch(/execute\s+(format|'|"|v_|p_)/i);
    expect(SQL).not.toMatch(/quote_ident|format\(/i);
  });

  it("sorts on a fixed allow-list of CASE branches", () => {
    for (const key of [
      "bookingReference",
      "primaryGuestName",
      "arrivalDate",
      "departureDate",
      "roomNo",
      "guestCount",
      "bookingSource",
      "status",
      "createdAt",
    ]) {
      expect(SQL).toContain(`'${key}'`);
    }
    expect(SQL).toMatch(/case\s+v_key\s+when/i);
  });

  it("breaks ordering ties deterministically", () => {
    expect(SQL.toLowerCase()).toContain("created_at desc");
    expect(SQL.toLowerCase()).toMatch(/order by[\s\S]{0,600}created_at desc,\s*\n?\s*id desc/);
  });

  it("matches linked non-primary guests when filtering by name or mobile", () => {
    expect(SQL).toMatch(/exists\s*\(/i);
    expect(SQL).toContain("hotel_reservation_guests");
    expect(SQL.toLowerCase()).toContain("full_name");
    expect(SQL.toLowerCase()).toContain("mobile");
  });

  it("is executable only by the service role", () => {
    expect(SQL).toMatch(/revoke\s+all\s+on\s+function\s+public\.hotelhub_list_reservations/i);
    expect(SQL).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.hotelhub_list_reservations[\s\S]{0,200}service_role/i,
    );
  });
});

const LATEST = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(DIR, f), "utf8"))
  .filter((s) => s.includes("CREATE OR REPLACE FUNCTION public.hotelhub_list_reservations"))
  .slice(-1)[0] as string;

describe("hotelhub_list_reservations — roomNo sorts on room_number", () => {
  it("derives a tenant-scoped room-number sort aggregate", () => {
    expect(LATEST).toContain("AS room_number_sort");
    expect(LATEST).toMatch(
      /string_agg\(num, ',' ORDER BY num\)[\s\S]{0,400}rm\.room_number[\s\S]{0,400}rm\.tenant_id = p_tenant_id/,
    );
  });

  it("uses the room-number key for roomNo, not the display labels", () => {
    expect(LATEST).toContain("WHEN 'roomNo' THEN a.room_number_sort");
    expect(LATEST).not.toMatch(/WHEN 'roomNo' THEN[^\n]*room_labels/);
  });

  it("still returns display labels unchanged", () => {
    expect(LATEST).toContain("'roomLabels', to_jsonb(n.room_labels)");
    expect(LATEST).toMatch(/nullif\(btrim\(coalesce\(rm\.display_name, ''\)\), ''\)/);
  });

  it("keeps deterministic tie-breakers and service-role-only execution", () => {
    expect(LATEST.toLowerCase()).toMatch(/created_at desc,\s*\n?\s*id desc/);
    expect(LATEST).toMatch(/grant\s+execute[\s\S]{0,200}service_role/i);
    expect(LATEST).not.toMatch(/execute\s+(format|'|v_|p_)/i);
  });
});

describe("front-desk routes — no prohibited small text classes", () => {
  const ROUTES = [
    "src/routes/reservations.index.tsx",
    "src/routes/reservations.calendar.tsx",
    "src/routes/reservations.$id_.checkout.tsx",
  ];
  for (const route of ROUTES) {
    it(`${route} uses at least text-sm`, () => {
      const src = readFileSync(join(process.cwd(), route), "utf8");
      expect(src).not.toMatch(/text-xs/);
      expect(src).not.toMatch(/text-\[1[012]px\]/);
    });
  }
});
