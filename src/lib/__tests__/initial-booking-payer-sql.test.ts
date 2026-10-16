import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from "vitest";
const modulePath = process.env.HH_PGLITE_TEST_MODULE;
const root = new URL("../../../", import.meta.url);
describe.skipIf(!modulePath)("atomic reservation and initial payer", () => {
  let db: {
    exec(s: string): Promise<unknown>;
    query<T = Record<string, unknown>>(s: string, a?: unknown[]): Promise<{ rows: T[] }>;
    close(): Promise<void>;
  };
  const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let source: string, room: string;
  beforeAll(async () => {
    const { PGlite } = await import(/* @vite-ignore */ modulePath!);
    const { btree_gist } = await import(
      /* @vite-ignore */ modulePath!.replace(/\/index\.js$/, "/contrib/btree_gist.js")
    );
    db = new PGlite({ extensions: { btree_gist } });
    await db.exec("SET hotelhub.disposable_test='enabled'; SET check_function_bodies=off");
    const files = readdirSync(new URL("supabase/migrations/", root));
    for (const f of [
      "db/checks/hh-settlement-setup.sql",
      "db/checks/hh-settlement-seed.sql",
      "supabase/migrations/20261008080000_hh_billing_settlement.sql",
      "supabase/migrations/20261011225957_hh_source_billing.sql",
      "supabase/migrations/" + files.find((f) => f.endsWith("_hh_initial_reservation_payer.sql")),
    ])
      await db.exec(readFileSync(new URL(f, root), "utf8"));
    await db.exec("SET check_function_bodies=on");
    source = (
      await db.query<{ id: string }>("SELECT id FROM hotel_booking_sources WHERE tenant_id=$1", [
        tenant,
      ])
    ).rows[0].id;
    await db.exec(
      `INSERT INTO hotel_settings(tenant_id,currency,timezone,n3_walk_in_customer_id) VALUES ('${tenant}','MYR','Asia/Kuala_Lumpur','7'); INSERT INTO hotel_user_roles(tenant_id,n3_user_key,role) VALUES ('${tenant}','synthetic-fd','front_desk');`,
    );
    room = (
      await db.query<{ id: string }>(
        "INSERT INTO hotel_rooms(tenant_id,n3_stock_id,n3_stock_code,room_number,max_occupancy,base_rate) VALUES ($1,'7','7','7',2,200) RETURNING id",
        [tenant],
      )
    ).rows[0].id;
  }, 30000);
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.exec("BEGIN");
    await db.query(
      "INSERT INTO hotel_source_billing_policies(tenant_id,source_id,default_collection_mode,allowed_collection_modes,source_customer_id,guest_customer_id,guest_document_title,guest_item_description,show_room_prices) VALUES ($1,$2,'source',ARRAY['guest','source'],8,7,'Source Sales','Accommodation',false)",
      [tenant, source],
    );
  });
  afterEach(async () => {
    await db.exec("ROLLBACK");
  });
  async function create(
    opts: {
      actor?: string;
      role?: string;
      version?: string;
      mode?: string;
      sourceId?: string;
      badGuest?: boolean;
    } = {},
  ) {
    return db.query<{ out_reservation_id: string }>(
      `SELECT * FROM hh_source_reservation_create($1::uuid,$2::text,'walk_in'::text,'2027-07-20'::date,'2027-07-22'::date,NULL::text,NULL::text,$3::jsonb,$4::jsonb,$5::text,$6::uuid,$7::text,$8::text)`,
      [
        tenant,
        opts.actor ?? "synthetic-fd",
        JSON.stringify([{ hotel_room_id: room, agreed_rate: 200, adults: 1, children: 0 }]),
        JSON.stringify([
          {
            full_name: opts.badGuest ? "" : "Synthetic guest",
            is_primary: true,
            assigned_hotel_room_id: room,
          },
        ]),
        opts.role ?? "front_desk",
        opts.sourceId ?? source,
        opts.version ?? "1",
        opts.mode ?? "source",
      ],
    );
  }
  it("creates a Front Desk booking with the selected default and one audited immutable policy copy", async () => {
    const id = (await create()).rows[0].out_reservation_id;
    const payer = (
      await db.query<{
        collection_mode: string;
        policy_snapshot: { version: string };
        confirmed_by: string;
      }>("SELECT * FROM hotel_reservation_payers WHERE reservation_id=$1", [id])
    ).rows[0];
    expect(payer.collection_mode).toBe("source");
    expect(payer.policy_snapshot.version).toBe("1");
    expect(payer.confirmed_by).toBe("synthetic-fd");
    expect(
      (
        await db.query(
          "SELECT id FROM hotel_source_billing_audit WHERE reservation_id=$1 AND event='payer_confirmed'",
          [id],
        )
      ).rows,
    ).toHaveLength(1);
    await db.query(
      "UPDATE hotel_source_billing_policies SET version=2,guest_customer_id=9 WHERE tenant_id=$1",
      [tenant],
    );
    expect(
      (
        await db.query<{ policy_snapshot: { guestCustomerId: number } }>(
          "SELECT policy_snapshot FROM hotel_reservation_payers WHERE reservation_id=$1",
          [id],
        )
      ).rows[0].policy_snapshot.guestCustomerId,
    ).toBe(7);
  });
  it("permits an allowed entry choice instead of the default", async () => {
    const id = (await create({ mode: "guest" })).rows[0].out_reservation_id;
    expect(
      (
        await db.query<{ collection_mode: string }>(
          "SELECT collection_mode FROM hotel_reservation_payers WHERE reservation_id=$1",
          [id],
        )
      ).rows[0].collection_mode,
    ).toBe("guest");
  });
  it.each([
    { version: "0" },
    { mode: "bad" },
    { sourceId: "99999999-9999-4999-8999-999999999999" },
    { actor: "synthetic-owner", role: "front_desk" },
  ])("denies stale/invalid/forged selection before creating rows: %j", async (opts) => {
    await db.exec("SAVEPOINT attempt");
    await expect(create(opts)).rejects.toThrow();
    await db.exec("ROLLBACK TO attempt; RELEASE attempt");
    expect(
      (await db.query("SELECT reservation_id FROM hotel_reservation_payers")).rows,
    ).toHaveLength(0);
    expect((await db.query("SELECT id FROM hotel_reservations")).rows).toHaveLength(2);
  });
  it("rolls the entire booking back when payer audit persistence fails", async () => {
    await db.exec(
      "CREATE FUNCTION public.fail_initial_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_audit_failure'; END $$; CREATE TRIGGER fail_initial_audit BEFORE INSERT ON hotel_source_billing_audit FOR EACH ROW EXECUTE FUNCTION public.fail_initial_audit(); SAVEPOINT attempt",
    );
    await expect(create()).rejects.toThrow("synthetic_audit_failure");
    await db.exec("ROLLBACK TO attempt; RELEASE attempt");
    expect((await db.query("SELECT id FROM hotel_reservations")).rows).toHaveLength(2);
    expect(
      (await db.query("SELECT reservation_id FROM hotel_reservation_payers")).rows,
    ).toHaveLength(0);
  });
  it("entry GET never creates a payer", async () => {
    const r = (
      await db.query<{ v: unknown }>(
        "SELECT hh_source_billing_entry_get($1,'walk_in','synthetic-fd','front_desk') v",
        [tenant],
      )
    ).rows[0].v;
    expect(r).toMatchObject({
      tenantId: tenant,
      required: true,
      policy: { sourceId: source, defaultCollectionMode: "source" },
    });
    expect(
      (await db.query("SELECT reservation_id FROM hotel_reservation_payers")).rows,
    ).toHaveLength(0);
  });
  it("revokes the old create escape hatch and denies browser execution", async () => {
    expect(
      (
        await db.query<{ old: boolean; fresh: boolean; browser: boolean }>(
          "SELECT has_function_privilege('service_role','hotelhub_create_reservation(uuid,text,text,date,date,text,text,jsonb,jsonb)','EXECUTE') old, has_function_privilege('service_role','hh_source_reservation_create(uuid,text,text,date,date,text,text,jsonb,jsonb,text,uuid,text,text)','EXECUTE') fresh, has_function_privilege('authenticated','hh_source_reservation_create(uuid,text,text,date,date,text,text,jsonb,jsonb,text,uuid,text,text)','EXECUTE') browser",
        )
      ).rows[0],
    ).toEqual({ old: false, fresh: true, browser: false });
  });
});
