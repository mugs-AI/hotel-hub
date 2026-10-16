import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const modulePath = process.env.HH_PGLITE_TEST_MODULE;
const t = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  r = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd",
  room = "11111111-1111-4111-8111-111111111111",
  request = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
describe.skipIf(!modulePath)("disposable manual no-show SQL", () => {
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
    for (const f of [
      "db/checks/hh-settlement-setup.sql",
      "db/checks/hh-settlement-seed.sql",
      "supabase/migrations/20261014011310_hh_manual_no_show.sql",
    ])
      await db.exec(readFileSync(new URL("../../../" + f, import.meta.url), "utf8"));
    await db.exec(
      `INSERT INTO hotel_reservations(id,tenant_id,booking_reference,booking_source,status,arrival_date,departure_date,currency,created_by_n3_user_key) VALUES('${r}','${t}','NOSHOW-FIXTURE','walk_in','confirmed','2026-01-01','2026-01-02','MYR','fixture-staff'); INSERT INTO hotel_settings(tenant_id) VALUES('${t}'); INSERT INTO hotel_user_roles(tenant_id,n3_user_key,role) VALUES('${t}','fixture-staff','front_desk'); INSERT INTO hotel_rooms(id,tenant_id,n3_stock_id,n3_stock_code,room_number) VALUES('${room}','${t}','fixture-stock','101','101'); INSERT INTO hotel_reservation_rooms(id,tenant_id,reservation_id,hotel_room_id,arrival_date,departure_date,base_rate_snapshot,agreed_rate,adults) VALUES('22222222-2222-4222-8222-222222222222','${t}','${r}','${room}','2026-01-01','2026-01-02',100,100,1); SET check_function_bodies=on;`,
    );
  }, 30000);
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.exec("TRUNCATE hotel_receipt_control_requests CASCADE");
    await db.exec(
      `UPDATE hotel_reservations SET status='confirmed',checked_in_at=null,arrival_date='2026-01-01',departure_date='2026-01-02',updated_at='2026-01-01T00:00:00Z' WHERE id='${r}'; UPDATE hotel_reservation_rooms SET allocation_status='reserved' WHERE reservation_id='${r}'; UPDATE hotel_user_roles SET is_active=true WHERE tenant_id='${t}'; DELETE FROM hotel_reservation_deposits WHERE reservation_id='${r}';`,
    );
    const found = await db.query<{ present: boolean }>(
      "SELECT to_regclass('public.hotel_no_show_actions') IS NOT NULL present",
    );
    if (found.rows[0].present)
      await db.exec(`TRUNCATE hotel_no_show_actions CASCADE; TRUNCATE hotel_reservation_events`);
  });
  async function call(
    p: { tenant?: string; actor?: string; revision?: string; reason?: string } = {},
  ) {
    try {
      const revision =
        p.revision ??
        (
          await db.query<{ v: string }>(
            `SELECT updated_at::text v FROM hotel_reservations WHERE id='${r}'`,
          )
        ).rows[0].v;
      const q = await db.query<{ result: unknown }>(
        `SELECT hh_mark_reservation_no_show('${p.tenant ?? t}','${r}','${p.actor ?? "fixture-staff"}','${revision}','${request}','${p.reason ?? "Guest did not arrive"}') result`,
      );
      return { error: null, result: q.rows[0].result };
    } catch (e) {
      return { error: (e as Error).message, result: null };
    }
  }
  it("releases its reserved room and preserves housekeeping and deposits", async () => {
    const before = (await db.query("SELECT * FROM hotel_room_housekeeping ORDER BY id")).rows;
    const out = await call();
    expect(out).toMatchObject({
      error: null,
      result: {
        reservationId: r,
        status: "no_show",
        releasedRoomIds: [room],
        accountingReviewRequired: false,
      },
    });
    expect(
      (await db.query<{ status: string }>(`SELECT status FROM hotel_reservations WHERE id='${r}'`))
        .rows[0].status,
    ).toBe("no_show");
    expect((await db.query("SELECT * FROM hotel_room_housekeeping ORDER BY id")).rows).toEqual(
      before,
    );
  });
  it("replays the saved result without another event", async () => {
    const revision = (
      await db.query<{ v: string }>(
        `SELECT updated_at::text v FROM hotel_reservations WHERE id='${r}'`,
      )
    ).rows[0].v;
    const first = await call({ revision });
    expect(first.error).toBe(null);
    expect(await call({ revision })).toEqual(first);
    const rows = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM hotel_reservation_events WHERE reservation_id='${r}' AND event_type='reservation_no_show'`,
    );
    expect(rows.rows[0].n).toBe(1);
  });
  it.each(["checked_in", "checked_out", "cancelled", "tentative"])(
    "rejects %s without room release",
    async (status) => {
      await db.exec(`UPDATE hotel_reservations SET status='${status}' WHERE id='${r}'`);
      expect((await call()).error).toBe("no_show_ineligible");
      expect(
        (
          await db.query<{ s: string }>(
            `SELECT allocation_status s FROM hotel_reservation_rooms WHERE reservation_id='${r}'`,
          )
        ).rows[0].s,
      ).toBe("reserved");
    },
  );
  it("rejects arrival today or later", async () => {
    await db.exec(
      `UPDATE hotel_reservations SET arrival_date=(clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur')::date, departure_date=(clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur')::date+1 WHERE id='${r}'`,
    );
    expect((await call()).error).toBe("no_show_ineligible");
  });
  it("rejects occupied allocation even with confirmed header", async () => {
    await db.exec(
      `UPDATE hotel_reservation_rooms SET allocation_status='occupied' WHERE reservation_id='${r}'`,
    );
    expect((await call()).error).toBe("no_show_occupied");
  });
  it("denies stale revision and alien tenant", async () => {
    expect((await call({ revision: "2025-01-01T00:00:00Z" })).error).toBe("reservation_changed");
    expect((await call({ tenant: "99999999-9999-4999-8999-999999999999" })).error).toBe(
      "forbidden",
    );
  });
  it("denies revoked staff even for replay", async () => {
    expect((await call()).error).toBe(null);
    await db.exec(
      `UPDATE hotel_user_roles SET is_active=false WHERE tenant_id='${t}' AND n3_user_key='fixture-staff'`,
    );
    expect((await call()).error).toBe("forbidden");
  });
  it("retains receipt rows and records an unposted accounting review binding", async () => {
    await db.exec(
      `INSERT INTO hotel_reservation_deposits(tenant_id,reservation_id,amount,currency_code,idempotency_key,n3_reference_no,status,created_by_n3_user_key,n3_receipt_id) VALUES('${t}','${r}',33,'MYR','fixture-or','fixture-reference','posted','fixture-staff','33333333-3333-4333-8333-333333333333')`,
    );
    const before = (await db.query("SELECT * FROM hotel_reservation_deposits")).rows;
    expect(await call()).toMatchObject({ error: null, result: { accountingReviewRequired: true } });
    expect((await db.query("SELECT * FROM hotel_reservation_deposits")).rows).toEqual(before);
    const q = await db.query<{ receipt_refs: unknown[] }>(
      "SELECT receipt_refs FROM hotel_no_show_reviews",
    );
    expect(q.rows).toHaveLength(1);
    expect(q.rows[0].receipt_refs).toHaveLength(1);
  });
  async function correction(state: string, claim = false) {
    const deposit = "55555555-5555-4555-8555-55555555555d",
      correctionId = "77777777-7777-4777-8777-77777777777d";
    await db.exec(`INSERT INTO hotel_reservation_deposits(id,tenant_id,reservation_id,amount,currency_code,idempotency_key,n3_reference_no,status,created_by_n3_user_key) VALUES('${deposit}','${t}','${r}',33,'MYR','fixture-correction-or','fixture-reference','posted','fixture-staff');
    INSERT INTO hotel_receipt_control_requests(id,tenant_id,reservation_id,deposit_id,client_request_id,request_fingerprint,kind,reason,original,proposal,comparison,original_amount_cents,proposed_amount_cents,state,requested_by_n3_user_key) VALUES('${correctionId}','${t}','${r}','${deposit}',gen_random_uuid(),repeat('a',64),'correction','Synthetic review','{}','{}','{}',3300,3000,'${state}','fixture-staff');`);
    if (claim)
      await db.exec(
        `INSERT INTO hotel_receipt_control_executions(tenant_id,request_id,step,state,claimed_by_n3_user_key,claimed_version) VALUES('${t}','${correctionId}','verify','claimed','fixture-staff',1)`,
      );
  }
  it.each(["pending", "approved_awaiting_n3", "applying", "failed", "needs_review"])(
    "does not release rooms with unresolved receipt state %s",
    async (state) => {
      await correction(state);
      expect((await call()).error).toBe("receipt_correction_pending");
      expect(
        (await db.query<{ s: string }>(`SELECT status s FROM hotel_reservations WHERE id='${r}'`))
          .rows[0].s,
      ).toBe("confirmed");
      expect(
        (
          await db.query<{ s: string }>(
            `SELECT allocation_status s FROM hotel_reservation_rooms WHERE reservation_id='${r}'`,
          )
        ).rows[0].s,
      ).toBe("reserved");
      expect((await db.query("SELECT * FROM hotel_no_show_actions")).rows).toHaveLength(0);
    },
  );
  it("does not release rooms with an outstanding receipt execution claim", async () => {
    await correction("applied", true);
    expect((await call()).error).toBe("receipt_correction_pending");
    expect((await db.query("SELECT * FROM hotel_no_show_actions")).rows).toHaveLength(0);
  });
});
