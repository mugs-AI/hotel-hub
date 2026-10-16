import { readFileSync, readdirSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
const modulePath = process.env.HH_PGLITE_TEST_MODULE;
const t = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  r = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  request = "33333333-3333-4333-8333-333333333333";
const root = new URL("../../../", import.meta.url);
describe.skipIf(!modulePath)("disposable staff checkout SQL authority", () => {
  let db: {
    exec(sql: string): Promise<unknown>;
    query<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<{ rows: T[] }>;
    close(): Promise<void>;
  };
  beforeAll(async () => {
    const { PGlite } = await import(/* @vite-ignore */ modulePath!);
    const { btree_gist } = await import(
      /* @vite-ignore */ modulePath!.replace(/\/index\.js$/, "/contrib/btree_gist.js")
    );
    db = new PGlite({ extensions: { btree_gist } });
    await db.exec("SET hotelhub.disposable_test='enabled'; SET check_function_bodies=off");
    for (const file of [
      "db/checks/hh-settlement-setup.sql",
      "db/checks/hh-settlement-seed.sql",
      "supabase/migrations/20261008080000_hh_billing_settlement.sql",
      "supabase/migrations/20261011225957_hh_source_billing.sql",
    ])
      await db.exec(readFileSync(new URL(file, root), "utf8"));
    const migration = readdirSync(new URL("supabase/migrations/", root)).find((f) =>
      f.endsWith("_hh_staff_settlement_authority.sql"),
    )!;
    await db.exec(readFileSync(new URL("supabase/migrations/" + migration, root), "utf8"));
    const helpers = readFileSync(new URL("db/checks/hh-settlement-single.sql", root), "utf8").split(
      "-- Real immutable receipt linkage",
    )[0];
    await db.exec(helpers);
    await db.exec(
      `INSERT INTO hotel_user_roles(tenant_id,n3_user_key,role) VALUES('${t}','synthetic-staff','front_desk'),('${t}','synthetic-housekeeper','housekeeper'); INSERT INTO hotel_settings(tenant_id) VALUES('${t}'); SET check_function_bodies=on;`,
    );
  }, 30000);
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.exec("BEGIN");
  });
  afterEach(async () => {
    await db.exec("ROLLBACK");
  });
  async function freeze(actor = "synthetic-staff") {
    return (
      await db.query<{ v: Record<string, unknown> }>(
        "SELECT hotelhub_settlement_freeze($1::uuid,$2::uuid,$3,hh_snapshot(),$4::uuid) v",
        [t, r, actor, request],
      )
    ).rows[0].v;
  }
  it("staff can freeze and replay a durable intent with their audited identity", async () => {
    const i = await freeze();
    expect(i.state).toBe("frozen");
    expect(await freeze()).toEqual(i);
    const rows = (
      await db.query<{ actor: string }>(
        "SELECT actor_n3_user_key actor FROM hotel_settlement_intents",
      )
    ).rows;
    expect(rows).toEqual([{ actor: "synthetic-staff" }]);
  });
  it.each(["synthetic-housekeeper", "missing-user"])("denies %s before freezing", async (actor) => {
    await expect(freeze(actor)).rejects.toThrow("settlement_forbidden");
  });
  it("revoked staff cannot resume an Owner-created intent", async () => {
    await freeze("synthetic-owner");
    await db.exec(
      `UPDATE hotel_user_roles SET is_active=false WHERE tenant_id='${t}' AND n3_user_key='synthetic-staff'`,
    );
    await expect(freeze()).rejects.toThrow("settlement_forbidden");
  });
  it("another tenant cannot borrow the staff identity", async () => {
    await expect(
      db.query(
        "SELECT hotelhub_settlement_freeze($1::uuid,$2::uuid,'synthetic-staff',hh_snapshot(),$3::uuid)",
        ["99999999-9999-4999-8999-999999999999", r, request],
      ),
    ).rejects.toThrow("settlement_forbidden");
  });
  it("staff reserves ordinary bill numbers but cannot reserve refund numbers", async () => {
    const got = (
      await db.query<{ v: { hhNumber: string } }>(
        "SELECT hh_source_document_number_reserve($1::uuid,$2::uuid,'synthetic-staff','bill',$3::uuid,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date) v",
        [t, r, request],
      )
    ).rows[0].v;
    expect(got.hhNumber).toMatch(/^SI\d{9}$/);
    await expect(
      db.query(
        "SELECT hh_source_document_number_reserve($1::uuid,$2::uuid,'synthetic-staff','refund',$3::uuid,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date)",
        [t, r, request],
      ),
    ).rejects.toThrow("settlement_forbidden");
  });
  it("retains the full settlement proof, recovery, close and rollback checks for staff", async () => {
    await db.exec(
      `UPDATE hotel_user_roles SET role='front_desk' WHERE tenant_id='${t}' AND n3_user_key='synthetic-owner'`,
    );
    const suite = readFileSync(new URL("db/checks/hh-settlement-single.sql", root), "utf8").split(
      "-- Real immutable receipt linkage",
    )[1];
    await db.exec("-- Real immutable receipt linkage" + suite);
    const closed = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM hotel_settlement_events WHERE event='closed'",
      )
    ).rows[0].n;
    expect(closed).toBeGreaterThan(0);
  });
  it("staff does not gain the existing Owner guard", async () => {
    await expect(
      db.query("SELECT hotelhub_settlement_owner($1::uuid,'synthetic-staff')", [t]),
    ).rejects.toThrow("settlement_forbidden");
  });
  it("staff cannot override source policy", async () => {
    await expect(
      db.query(
        "SELECT hh_source_billing_policy_put($1::uuid,gen_random_uuid(),'synthetic-staff','front_desk','0','{}')",
        [t],
      ),
    ).rejects.toThrow("source_billing_forbidden");
  });
  it("service-only writers and private guard remain inaccessible to public roles", async () => {
    const rows = (
      await db.query<{ name: string; anon: boolean; authenticated: boolean }>(
        "SELECT proname name, has_function_privilege('anon',p.oid,'execute') anon, has_function_privilege('authenticated',p.oid,'execute') authenticated FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (proname='hotelhub_settlement_operator' OR proname IN ('hotelhub_settlement_freeze','hotelhub_settlement_claim','hotelhub_settlement_outcome','hotelhub_settlement_prove','hotelhub_settlement_close','hotelhub_settlement_abandon','hh_source_billing_freeze','hh_source_billing_leg_claim','hh_source_billing_leg_outcome','hh_source_billing_leg_prove','hh_source_document_number_reserve'))",
      )
    ).rows;
    expect(rows.length).toBe(12);
    expect(rows.every((x) => !x.anon && !x.authenticated)).toBe(true);
  });
});
