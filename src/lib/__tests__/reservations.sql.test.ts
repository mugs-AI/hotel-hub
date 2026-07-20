/**
 * Milestone 1.1.1 — live-DB tests for reservation schema, constraints and
 * the SECURITY DEFINER RPC. Gated on PGHOST/PGUSER exactly like the
 * existing provision-owner tests: skipped when Postgres creds aren't
 * exposed to the test shell so CI without DB access still passes.
 *
 * These tests use synthetic tenant/room fixtures created in a
 * transaction-style teardown so they never touch real hotel data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

const hasPg = Boolean(process.env.PGHOST && process.env.PGUSER);
const d = hasPg ? describe : describe.skip;

function psqlRaw(sql: string): { stdout: string; ok: boolean; err?: string } {
  try {
    const stdout = execFileSync("psql", ["-Atqc", sql], { encoding: "utf8" });
    return { stdout: stdout.trim(), ok: true };
  } catch (e) {
    const err = (e as { stderr?: Buffer }).stderr?.toString() ?? (e as Error).message;
    return { stdout: "", ok: false, err };
  }
}

const tag = `mile111_${Date.now()}`;
const tenantAKey = `${tag}_A`;
const tenantBKey = `${tag}_B`;
let tenantAId = "";
let tenantBId = "";
let roomA1 = "";
let roomA2 = "";
let roomB1 = "";

d("Milestone 1.1.1 — schema & RPC (live)", () => {
  beforeAll(() => {
    // Tenants
    const a = psqlRaw(
      `INSERT INTO public.hotel_tenants(n3_tenant_key, tenant_code, company_name) VALUES ('${tenantAKey}', 'A', 'A Test') RETURNING id;`,
    );
    expect(a.ok).toBe(true);
    tenantAId = a.stdout;
    const b = psqlRaw(
      `INSERT INTO public.hotel_tenants(n3_tenant_key, tenant_code, company_name) VALUES ('${tenantBKey}', 'B', 'B Test') RETURNING id;`,
    );
    tenantBId = b.stdout;
    // Settings (required for RPC setup_incomplete gate) w/ walk-in customer.
    psqlRaw(
      `INSERT INTO public.hotel_settings(tenant_id, currency, timezone, n3_walk_in_customer_id, n3_walk_in_customer_code) VALUES ('${tenantAId}', 'MYR', 'Asia/Kuala_Lumpur', 'wi-1', 'WI');`,
    );
    psqlRaw(
      `INSERT INTO public.hotel_settings(tenant_id, currency, timezone, n3_walk_in_customer_id, n3_walk_in_customer_code) VALUES ('${tenantBId}', 'MYR', 'Asia/Kuala_Lumpur', 'wi-1', 'WI');`,
    );
    // Rooms
    const rA1 = psqlRaw(
      `INSERT INTO public.hotel_rooms(tenant_id, n3_stock_id, n3_stock_code, room_number, max_occupancy, base_rate) VALUES ('${tenantAId}', 's1', '${tag}A1', '${tag}A1', 2, 200) RETURNING id;`,
    );
    roomA1 = rA1.stdout;
    const rA2 = psqlRaw(
      `INSERT INTO public.hotel_rooms(tenant_id, n3_stock_id, n3_stock_code, room_number, max_occupancy, base_rate) VALUES ('${tenantAId}', 's2', '${tag}A2', '${tag}A2', 4, 300) RETURNING id;`,
    );
    roomA2 = rA2.stdout;
    const rB1 = psqlRaw(
      `INSERT INTO public.hotel_rooms(tenant_id, n3_stock_id, n3_stock_code, room_number, max_occupancy, base_rate) VALUES ('${tenantBId}', 's1', '${tag}B1', '${tag}B1', 2, 200) RETURNING id;`,
    );
    roomB1 = rB1.stdout;
  });

  afterAll(() => {
    // Delete children first
    psqlRaw(`DELETE FROM public.hotel_tenants WHERE n3_tenant_key IN ('${tenantAKey}','${tenantBKey}');`);
  });

  function createRes(
    tenantId: string,
    arrival: string,
    departure: string,
    rooms: Array<{ id: string; adults?: number; agreed?: number; reason?: string }>,
  ) {
    const roomsJson = JSON.stringify(
      rooms.map((r) => ({
        hotel_room_id: r.id,
        agreed_rate: r.agreed ?? 200,
        adults: r.adults ?? 2,
        children: 0,
        rate_override_reason: r.reason ?? null,
      })),
    ).replace(/'/g, "''");
    const guestsJson = JSON.stringify([{ full_name: "Test", is_primary: true }]).replace(/'/g, "''");
    return psqlRaw(
      `SELECT out_booking_reference FROM public.hotelhub_create_reservation('${tenantId}'::uuid, 'tester', 'walk_in', '${arrival}'::date, '${departure}'::date, NULL, '${roomsJson}'::jsonb, '${guestsJson}'::jsonb);`,
    );
  }

  it("creates a reservation with a BKYYMMDDNNN booking reference (no 42702)", () => {
    const res = createRes(tenantAId, "2026-08-01", "2026-08-03", [{ id: roomA1 }]);
    expect(res.err ?? "").not.toContain("ambiguous");
    expect(res.err ?? "").not.toContain("42702");
    expect(res.ok).toBe(true);
    expect(res.stdout).toMatch(/^BK\d{6}\d{3}$/);
  });

  it("rejects overlapping reservation for the same room (exclusion)", () => {
    const res = createRes(tenantAId, "2026-08-02", "2026-08-04", [{ id: roomA1 }]);
    expect(res.ok).toBe(false);
    expect(res.err ?? "").toMatch(/room_not_available/);
  });

  it("allows adjacent stay (checkout day == arrival day)", () => {
    const res = createRes(tenantAId, "2026-08-03", "2026-08-05", [{ id: roomA1 }]);
    expect(res.ok).toBe(true);
  });

  it("allows different rooms on overlapping dates", () => {
    const res = createRes(tenantAId, "2026-08-01", "2026-08-03", [{ id: roomA2 }]);
    expect(res.ok).toBe(true);
  });

  it("cross-tenant same-code rooms are isolated (Tenant B free even when Tenant A booked)", () => {
    const res = createRes(tenantBId, "2026-08-01", "2026-08-03", [{ id: roomB1 }]);
    expect(res.ok).toBe(true);
  });

  it("released allocations do not block future availability", () => {
    // Manually release the earlier allocation, then rebook overlapping range.
    const rel = psqlRaw(
      `UPDATE public.hotel_reservation_rooms SET allocation_status='released' WHERE tenant_id='${tenantAId}' AND hotel_room_id='${roomA2}';`,
    );
    expect(rel.ok).toBe(true);
    const res = createRes(tenantAId, "2026-08-02", "2026-08-04", [{ id: roomA2 }]);
    expect(res.ok).toBe(true);
  });

  it("rejects unknown tenant", () => {
    const res = createRes("00000000-0000-0000-0000-000000000000", "2026-08-10", "2026-08-11", [
      { id: roomA1 },
    ]);
    expect(res.ok).toBe(false);
    expect(res.err ?? "").toMatch(/setup_incomplete|room_not_found/);
  });

  it("rejects duplicate room in same payload", () => {
    const res = createRes(tenantAId, "2026-09-01", "2026-09-03", [
      { id: roomA1 },
      { id: roomA1 },
    ]);
    expect(res.ok).toBe(false);
    expect(res.err ?? "").toMatch(/duplicate_room/);
  });

  it("rejects rate override without reason", () => {
    const res = createRes(tenantAId, "2026-09-05", "2026-09-06", [
      { id: roomA1, agreed: 999 }, // != base_rate, no reason
    ]);
    expect(res.ok).toBe(false);
    expect(res.err ?? "").toMatch(/rate_override_reason_required/);
  });

  it("browser-role user cannot read reservations directly (RLS deny)", () => {
    const res = psqlRaw(
      `SET ROLE authenticated; SELECT count(*) FROM public.hotel_reservations; RESET ROLE;`,
    );
    // Either 0 rows (denied) or permission-denied. Both are acceptable proof of deny-by-default.
    expect(!res.ok || res.stdout === "0").toBe(true);
  });
});
