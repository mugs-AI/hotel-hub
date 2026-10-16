import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const modulePath = process.env.HH_PGLITE_TEST_MODULE;
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reservation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const migration = new URL(
  "../../../supabase/migrations/20261014001420_hh_reservation_operation_controls.sql",
  import.meta.url,
);
describe.skipIf(!modulePath)("disposable reservation control SQL", () => {
  let db: {
    exec(sql: string): Promise<unknown>;
    query<T>(sql: string): Promise<{ rows: T[] }>;
    close(): Promise<void>;
  };
  beforeAll(async () => {
    const { PGlite } = await import(/* @vite-ignore */ modulePath!);
    const { btree_gist } = await import(
      /* @vite-ignore */ modulePath!.replace(/\/index\.js$/, "/contrib/btree_gist.js")
    );
    db = new PGlite({ extensions: { btree_gist } });
    await db.exec("SET hotelhub.disposable_test='enabled'; SET check_function_bodies=off;");
    await db.exec(
      readFileSync(new URL("../../../db/checks/hh-settlement-setup.sql", import.meta.url), "utf8"),
    );
    await db.exec(
      readFileSync(new URL("../../../db/checks/hh-settlement-seed.sql", import.meta.url), "utf8"),
    );
    await db.exec(`INSERT INTO hotel_settings(tenant_id) VALUES ('${tenant}');
      INSERT INTO hotel_user_roles(tenant_id,n3_user_key,role) VALUES ('${tenant}','fixture-staff','front_desk');
      INSERT INTO hotel_rooms(id,tenant_id,n3_stock_id,n3_stock_code,room_number) VALUES ('11111111-1111-4111-8111-111111111111','${tenant}','fixture-stock','101','101');
      INSERT INTO hotel_reservation_rooms(id,tenant_id,reservation_id,hotel_room_id,arrival_date,departure_date,base_rate_snapshot,agreed_rate,adults) VALUES ('22222222-2222-4222-8222-222222222222','${tenant}','${reservation}','11111111-1111-4111-8111-111111111111','2026-10-07','2026-10-09',100,100,1);
      INSERT INTO hotel_guests(id,tenant_id,full_name) VALUES ('33333333-3333-4333-8333-333333333333','${tenant}','Synthetic guest');
      INSERT INTO hotel_reservation_guests(tenant_id,reservation_id,guest_id,is_primary,reservation_room_id) VALUES ('${tenant}','${reservation}','33333333-3333-4333-8333-333333333333',true,'22222222-2222-4222-8222-222222222222');
      CREATE OR REPLACE FUNCTION hotelhub_property_now(p_tenant_id uuid) RETURNS timestamp LANGUAGE sql STABLE AS $$SELECT timestamp '2026-10-14 08:00:00'$$;`);
    await db.exec(readFileSync(migration, "utf8"));
    // Both legacy overloads have defaults, making a direct six-argument SQL
    // call ambiguous. Alias only in this disposable DB to exercise its body.
    await db.exec(
      "ALTER FUNCTION hotelhub_check_in_reservation(uuid,uuid,text,timestamptz,boolean,uuid) RENAME TO hh_disposable_check_in_six",
    );
    await db.exec("SET check_function_bodies=on;");
  }, 30000);
  afterAll(async () => db?.close());
  async function attempt(sql: string) {
    try {
      return { result: (await db.query<{ result: unknown }>(sql)).rows[0]?.result, error: null };
    } catch (e) {
      return { result: null, error: (e as Error).message };
    }
  }
  async function disable() {
    return attempt(
      `SELECT hh_operation_controls_update('${tenant}','synthetic-owner','0',false) result`,
    );
  }
  beforeEach(async () => {
    await db.exec(
      `UPDATE hotel_reservations SET status='confirmed',checked_in_at=null WHERE id='${reservation}'; UPDATE hotel_reservation_rooms SET allocation_status='reserved' WHERE reservation_id='${reservation}';`,
    );
    // Reset policy only when the additive columns exist; baseline RED remains runnable.
    const has = await db.query<{ present: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='hotel_settings' AND column_name='operation_controls_revision') present",
    );
    if (has.rows[0].present)
      await db.exec(
        `UPDATE hotel_settings SET rate_change_enabled=true,operation_controls_revision=0 WHERE tenant_id='${tenant}'`,
      );
  });
  it("preserves existing ON default and version-fences Owner changes", async () => {
    expect(await attempt(`SELECT hh_operation_controls_read('${tenant}') result`)).toMatchObject({
      error: null,
      result: { rateChangeEnabled: true, revision: "0", available: true },
    });
    expect(await disable()).toMatchObject({
      error: null,
      result: { rateChangeEnabled: false, revision: "1" },
    });
    expect((await disable()).error).toBe("operation_controls_stale");
  });
  it("denies a staff or foreign-tenant policy write", async () => {
    expect(
      (
        await attempt(
          `SELECT hh_operation_controls_update('${tenant}','fixture-staff','0',false) result`,
        )
      ).error,
    ).toBe("forbidden");
    expect(
      (
        await attempt(
          "SELECT hh_operation_controls_update('99999999-9999-4999-8999-999999999999','synthetic-owner','0',false) result",
        )
      ).error,
    ).toBe("forbidden");
  });
  it("OFF denies new rate requests and applying saved rate requests, while rejection remains possible", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    await db.exec(
      `DELETE FROM hotel_reservation_operation_requests WHERE id='${id}'; INSERT INTO hotel_reservation_operation_requests(id,tenant_id,reservation_id,operation_type,state,requested_by_n3_user_key,idempotency_key) VALUES ('${id}','${tenant}','${reservation}','rate_change','pending','synthetic-owner','fixture-pending-rate');`,
    );
    await disable();
    expect(
      (
        await attempt(
          `INSERT INTO hotel_reservation_operation_requests(tenant_id,reservation_id,operation_type,requested_by_n3_user_key,idempotency_key) VALUES ('${tenant}','${reservation}','rate_change','fixture-staff','fixture-new-rate') RETURNING state result`,
        )
      ).error,
    ).toBe("rate_change_disabled");
    expect(
      (
        await attempt(
          `UPDATE hotel_reservation_operation_requests SET state='applied' WHERE id='${id}' RETURNING state result`,
        )
      ).error,
    ).toBe("rate_change_disabled");
    expect(
      await attempt(
        `UPDATE hotel_reservation_operation_requests SET state='rejected',decided_by_n3_user_key='synthetic-owner',decided_at=now() WHERE id='${id}' RETURNING state result`,
      ),
    ).toMatchObject({ error: null, result: "rejected" });
  });
  it.each([
    [6, false],
    [6, true],
    [7, false],
    [7, true],
  ])(
    "blocks expired check-in overload %i, early=%s, without changing allocation",
    async (arity, early) => {
      const call = `SELECT out_status result FROM ${arity === 6 ? "hh_disposable_check_in_six" : "hotelhub_check_in_reservation"}('${tenant}'::uuid,'${reservation}'::uuid,'synthetic-owner'::text,NULL::timestamptz,${early}::boolean,NULL::uuid${arity === 7 ? ",NULL::uuid" : ""})`;
      expect((await attempt(call)).error).toBe("stay_dates_expired");
      const rows = await db.query<{ status: string; allocation_status: string }>(
        `SELECT r.status,rr.allocation_status FROM hotel_reservations r JOIN hotel_reservation_rooms rr ON rr.reservation_id=r.id WHERE r.id='${reservation}'`,
      );
      expect(rows.rows[0]).toEqual({ status: "confirmed", allocation_status: "reserved" });
    },
  );
  it("denies browser execution of both policy RPCs", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      try {
        expect(
          (await attempt(`SELECT hh_operation_controls_read('${tenant}') result`)).error,
        ).toMatch(/permission denied/);
      } finally {
        await db.exec("RESET ROLE");
      }
    }
  });
  it("checks wall-clock departure after a transaction-start clock becomes stale", async () => {
    await db.exec(`UPDATE hotel_reservations SET arrival_date=((clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur')::date-2),departure_date=(clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur')::date WHERE id='${reservation}';
      CREATE OR REPLACE FUNCTION hotelhub_property_now(p_tenant_id uuid) RETURNS timestamp LANGUAGE sql STABLE AS $$SELECT (clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur') - interval '1 day'$$;`);
    const result = await attempt(
      `SELECT out_status result FROM hotelhub_check_in_reservation('${tenant}'::uuid,'${reservation}'::uuid,'synthetic-owner'::text,NULL::timestamptz,false,NULL::uuid,NULL::uuid)`,
    );
    expect(result.error).toBe("stay_dates_expired");
  });
});
