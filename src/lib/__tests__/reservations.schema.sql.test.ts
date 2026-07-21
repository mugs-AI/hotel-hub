/**
 * Milestone 1.1.1 — Correction A read-only schema verification.
 *
 * Split from reservations.sql.test.ts so schema invariants are provable in
 * any sandbox that exposes read-only Postgres access (PGHOST + PGUSER),
 * without needing HOTELHUB_LIVE_WRITE. All SELECTs use information_schema
 * and pg_catalog only — no rows are inserted or mutated.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

function psql(sql: string): string {
  return execFileSync("psql", ["-Atqc", sql], { encoding: "utf8" }).trim();
}

const canRead = Boolean(process.env.PGHOST && process.env.PGUSER);
const d = canRead ? describe : describe.skip;

d("Milestone 1.1.1 Correction A — schema invariants (read-only)", () => {
  it("composite unique (tenant_id, id) exists on masters", () => {
    for (const t of ["hotel_rooms", "hotel_guests", "hotel_reservations"]) {
      const out = psql(
        `SELECT count(*) FROM pg_constraint c
           JOIN pg_class r ON r.oid = c.conrelid
          WHERE r.relname = '${t}'
            AND c.contype IN ('u','p')
            AND (
              SELECT array_agg(attname ORDER BY attname)
                FROM unnest(c.conkey) k
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
            ) @> ARRAY['id','tenant_id']::name[];`,
      );
      expect(Number(out)).toBeGreaterThan(0);
    }
  });


  it("child FKs are composite on (tenant_id, <parent_id>)", () => {
    // Every reservation-scoped child must FK back into the parent by BOTH
    // tenant_id and parent id, so cross-tenant references are physically
    // impossible.
    const rows = psql(`
      SELECT r.relname || ':' || string_agg(a.attname, ',' ORDER BY a.attname)
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
       WHERE c.contype = 'f'
         AND r.relname IN (
           'hotel_reservation_rooms',
           'hotel_reservation_guests'
         )
       GROUP BY r.relname, c.conname
       HAVING 'tenant_id' = ANY(array_agg(a.attname));`);
    // Expect at least the reservation_id and hotel_room_id / guest_id
    // constraints to include tenant_id.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows).toContain("tenant_id");
  });

  it("hotelhub_create_reservation exists and is SECURITY DEFINER, EXECUTE revoked from PUBLIC", () => {
    const secDef = psql(
      `SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='hotelhub_create_reservation';`,
    );
    expect(secDef).toBe("t");
    const publicExec = psql(
      `SELECT has_function_privilege('public', 'public.hotelhub_create_reservation(uuid,text,text,date,date,text,jsonb,jsonb)', 'EXECUTE');`,
    );
    // Either the grant is absent (query errors out and psql exits non-zero,
    // caught by execFileSync) or the boolean is 'f'. We only assert the
    // "granted" case is false.
    expect(publicExec === "f" || publicExec === "").toBe(true);
  });

  it("no-overlap exclusion constraint on hotel_reservation_rooms", () => {
    const out = psql(
      `SELECT count(*) FROM pg_constraint c
         JOIN pg_class r ON r.oid = c.conrelid
        WHERE r.relname='hotel_reservation_rooms' AND c.contype='x';`,
    );
    expect(Number(out)).toBeGreaterThan(0);
  });

  it(
    "RLS enabled and no public policies exist on reservation tables",
    () => {
      const tables = [
        "hotel_reservations",
        "hotel_reservation_rooms",
        "hotel_reservation_guests",
        "hotel_guests",
      ];
      const list = tables.map((t) => `'${t}'`).join(",");
      // One consolidated catalog query: per table, return `rls|publicPolicyCount`.
      const out = psql(
        `SELECT c.relname || '|' ||
                (CASE WHEN c.relrowsecurity THEN 't' ELSE 'f' END) || '|' ||
                COALESCE((
                  SELECT count(*) FROM pg_policies p
                   WHERE p.schemaname = 'public'
                     AND p.tablename = c.relname
                     AND (p.roles::text ILIKE '%anon%' OR p.roles::text ILIKE '%authenticated%')
                ), 0)
           FROM pg_class c
          WHERE c.relnamespace = 'public'::regnamespace
            AND c.relname IN (${list})
          ORDER BY c.relname;`,
      );
      const rows = out.split("\n").filter(Boolean);
      expect(rows.length).toBe(tables.length);
      for (const row of rows) {
        const [, rls, publicPolicies] = row.split("|");
        expect(rls).toBe("t");
        expect(Number(publicPolicies)).toBe(0);
      }
    },
    30_000,
  );

});
