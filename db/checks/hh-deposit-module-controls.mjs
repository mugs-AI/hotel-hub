// Disposable embedded PostgreSQL only; no URL, secret or network connection.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
const requireTool = createRequire(
  resolve(
    process.env.HH_DEPOSIT_SQL_TOOLS ||
      ".superpowers/sdd/2026-10-09-deposit-module-controls/sql-tools",
    "package.json",
  ),
);
const { PGlite } = requireTool("@electric-sql/pglite");
const pg = new PGlite();
const tenant = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const migration = readdirSync("supabase/migrations").filter((file) =>
  file.endsWith("_hh_deposit_module_controls.sql"),
);
assert.equal(migration.length, 1);
const save = async (t, version, advance, security) =>
  (
    await pg.query(
      "select public.hh_update_deposit_module_policy($1::uuid,'owner',$2,$3,$4) as policy",
      [t, version, advance, security],
    )
  ).rows[0].policy;
const claim = async (t) =>
  pg.query("insert into public.hotel_reservation_deposits(tenant_id) values($1::uuid)", [t]);
try {
  await pg.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; create table public.hotel_reservation_deposits(id uuid default gen_random_uuid(),tenant_id uuid not null,status text default 'submitting');",
  );
  await claim(tenant); // Existing rows must survive installation and disable.
  await pg.exec(readFileSync(`supabase/migrations/${migration[0]}`, "utf8"));
  let row = await save(tenant, "0", false, false);
  assert.equal(row.room_advance_enabled, false);
  assert.equal(row.security_deposit_enabled, false);
  await assert.rejects(claim(tenant), /room_advance_disabled/);
  await claim(other); // Absent policy retains legacy collection behavior.
  await assert.rejects(save(tenant, "0", true, false), /deposit_module_policy_conflict/);
  await assert.rejects(save(tenant, row.version, false, true), /security_deposit_unavailable/);
  await pg.query(
    "update public.hotel_deposit_module_policies set security_module_ready=true where tenant_id=$1::uuid",
    [tenant],
  ); // Simulates future installed custody capability.
  row = await save(tenant, row.version, false, true);
  await assert.rejects(claim(tenant), /room_advance_disabled/);
  row = await save(tenant, row.version, true, true);
  await claim(tenant);
  row = await save(tenant, row.version, true, false);
  await claim(tenant);
  assert.equal(
    (await pg.query("select count(*)::int as count from public.hotel_deposit_module_policy_events"))
      .rows[0].count,
    4,
  );
  await pg.query(
    "update public.hotel_reservation_deposits set status='posted' where tenant_id=$1::uuid",
    [tenant],
  );
  row = await save(tenant, row.version, false, false);
  assert.equal(
    (
      await pg.query(
        "select count(*)::int as count from public.hotel_reservation_deposits where tenant_id=$1::uuid and status='posted'",
        [tenant],
      )
    ).rows[0].count,
    3,
  );
  // Atomic audit: a missing actor and failed security activation leave no events.
  await assert.rejects(
    pg.query("select public.hh_update_deposit_module_policy($1::uuid,'',$2,false,false)", [
      tenant,
      row.version,
    ]),
    /invalid_deposit_module_policy/,
  );
  for (const role of ["anon", "authenticated"]) {
    await pg.exec(`set role ${role}`);
    await assert.rejects(
      pg.query("select * from public.hotel_deposit_module_policies"),
      /permission denied/,
    );
    await assert.rejects(
      pg.query("select * from public.hotel_deposit_module_policy_events"),
      /permission denied/,
    );
    await assert.rejects(save(tenant, row.version, true, false), /permission denied/);
    await pg.exec("reset role");
  }
  const rls = (
    await pg.query(
      "select bool_and(relrowsecurity) as enabled from pg_class where relname in ('hotel_deposit_module_policies','hotel_deposit_module_policy_events')",
    )
  ).rows[0];
  assert.equal(rls.enabled, true);
  await pg.exec("set role service_role");
  row = await save(tenant, row.version, true, false);
  assert.equal(row.room_advance_enabled, true);
  await assert.rejects(
    pg.query("delete from public.hotel_deposit_module_policy_events"),
    /permission denied/,
  );
  await pg.exec("reset role");
  console.log(
    "PASS embedded PostgreSQL: four modes, stale save, disabled claim, preserved rows, atomic audit, role grants/RLS. Multi-session scheduling NOT VERIFIED.",
  );
} finally {
  await pg.close();
}
