import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const modulePath = process.env.HH_PGLITE_TEST_MODULE;
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const booking = "44444444-4444-4444-8444-444444444444";
const oldAllocation = "11111111-1111-4111-8111-111111111111";
const destination = "22222222-2222-4222-8222-222222222222";
const version = "2026-10-16T00:00:00Z";
type Engine = {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
};

// Execute the unchanged production routine in a fresh, in-memory PostgreSQL.
// This proves allocation replacement, guest remapping and rollback, not native concurrent scheduling.
describe.skipIf(!modulePath)("atomic reservation room replacement PostgreSQL contract", () => {
  let db: Engine;
  beforeAll(async () => {
    const mod = await import(/* @vite-ignore */ modulePath!);
    db = new mod.PGlite();
    await db.exec(
      readFileSync("src/lib/__tests__/fixtures/hh-change-controls-prerequisites.sql", "utf8"),
    );
    await db.exec(`
      ALTER TABLE hotel_reservations ADD booking_source text DEFAULT 'walk_in', ADD arrival_date date DEFAULT '2026-10-16', ADD departure_date date DEFAULT '2026-10-17', ADD notes text, ADD external_booking_reference text, ADD updated_at timestamptz DEFAULT '${version}';
      ALTER TABLE hotel_guests ALTER id SET DEFAULT gen_random_uuid(), ADD nationality text, ADD nationality_code text, ADD notes text, ADD identity_type text, ADD identity_number text;
      ALTER TABLE hotel_reservation_guests ADD id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ADD reservation_room_id uuid;
      CREATE TABLE hotel_settings(tenant_id uuid, post_check_in_guest_edit_policy text DEFAULT 'locked', allow_owner_primary_guest_change_after_check_in boolean DEFAULT false);
      CREATE TABLE hotel_mutation_requests(tenant_id uuid,client_request_id uuid,scope text,reservation_id uuid,result jsonb, UNIQUE(tenant_id,scope,client_request_id));
      CREATE TABLE hotel_booking_sources(tenant_id uuid,source_code text,is_active boolean);
      CREATE TABLE hotel_rooms(id uuid PRIMARY KEY,tenant_id uuid,base_rate numeric,max_occupancy integer,is_active boolean);
      CREATE TABLE hotel_reservation_rooms(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,reservation_id uuid,hotel_room_id uuid REFERENCES hotel_rooms(id), UNIQUE(reservation_id,hotel_room_id),arrival_date date,departure_date date,base_rate_snapshot numeric,agreed_rate numeric,adults integer,children integer,allocation_status text,rate_override_reason text,remark text,stay_range daterange GENERATED ALWAYS AS (daterange(arrival_date,departure_date,'[)')) STORED);
      ALTER TABLE hotel_reservation_guests ADD FOREIGN KEY(reservation_room_id) REFERENCES hotel_reservation_rooms(id);
      CREATE TABLE hotel_reservation_events(tenant_id uuid,reservation_id uuid,event_type text,summary text,actor_n3_user_key text,metadata jsonb);
      UPDATE hotel_reservations SET status='confirmed';
      INSERT INTO hotel_rooms VALUES ('${oldAllocation}','${tenant}',188,2,true),('${destination}','${tenant}',300,2,true);
      INSERT INTO hotel_reservation_rooms VALUES ('${oldAllocation}','${tenant}','${booking}','${oldAllocation}','2026-10-16','2026-10-17',188,188,1,0,'reserved',NULL,'Keep this remark');
      UPDATE hotel_reservation_guests SET reservation_room_id='${oldAllocation}';
      UPDATE hotel_guests SET identity_type='passport',identity_number='SYNTHETIC-TEST-ONLY';
    `);
    await db.exec(
      readFileSync(
        "supabase/migrations/20260807144233_9679b18c-d1b9-4463-93ad-14b975330a5d.sql",
        "utf8",
      ),
    );
  }, 20000);
  beforeEach(async () => {
    await db.exec("BEGIN");
  });
  afterEach(async () => {
    await db.exec("ROLLBACK");
  });
  afterAll(async () => {
    await db?.close();
  });
  async function replace(requestId = crypto.randomUUID(), expected = version, tenantId = tenant) {
    const link = (await db.query<{ id: string }>("SELECT id FROM hotel_reservation_guests")).rows[0]
      .id;
    return db.query<{ out_replayed: boolean }>(
      `SELECT * FROM hotelhub_update_reservation_v2($1::uuid,$2::uuid,'synthetic-owner','owner',$3::uuid,'synthetic-room-replacement',$4::timestamptz,'walk_in','2026-10-16','2026-10-17',NULL,NULL,$5::jsonb,$6::jsonb,NULL)`,
      [
        tenantId,
        booking,
        requestId,
        expected,
        JSON.stringify([
          {
            client_key: "stable-room-key",
            reservation_room_id: null,
            hotel_room_id: destination,
            agreed_rate: 300,
            adults: 1,
            children: 0,
            remark: "Keep this remark",
          },
        ]),
        JSON.stringify([
          {
            client_key: "stable-guest-key",
            reservation_guest_id: link,
            full_name: "Synthetic Guest",
            is_primary: true,
            assigned_room_client_key: "stable-room-key",
            identity_action: "keep",
          },
        ]),
      ],
    );
  }
  it("replaces the only allocation and remaps the same guest without touching stored identity", async () => {
    await replace();
    const rooms = (
      await db.query<{ id: string; hotel_room_id: string; agreed_rate: string }>(
        "SELECT * FROM hotel_reservation_rooms",
      )
    ).rows;
    expect(rooms).toHaveLength(1);
    expect(rooms[0].id).not.toBe(oldAllocation);
    expect(rooms[0].hotel_room_id).toBe(destination);
    expect(Number(rooms[0].agreed_rate)).toBe(300);
    expect(
      (
        await db.query<{ reservation_room_id: string }>(
          "SELECT reservation_room_id FROM hotel_reservation_guests",
        )
      ).rows[0].reservation_room_id,
    ).toBe(rooms[0].id);
    expect(
      (await db.query<{ identity_number: string }>("SELECT identity_number FROM hotel_guests"))
        .rows[0].identity_number,
    ).toBe("SYNTHETIC-TEST-ONLY");
  });
  it("replays the same request without another allocation or event", async () => {
    const request = crypto.randomUUID();
    await replace(request);
    expect((await replace(request)).rows[0].out_replayed).toBe(true);
    expect((await db.query("SELECT * FROM hotel_reservation_rooms")).rows).toHaveLength(1);
    expect((await db.query("SELECT * FROM hotel_reservation_events")).rows).toHaveLength(1);
  });
  it("rolls back the room and guest assignment when the destination has an overlapping booking", async () => {
    await db.exec(
      `INSERT INTO hotel_reservation_rooms(tenant_id,reservation_id,hotel_room_id,arrival_date,departure_date,allocation_status) VALUES ('${tenant}',gen_random_uuid(),'${destination}','2026-10-16','2026-10-17','reserved'); SAVEPOINT attempted;`,
    );
    await expect(replace()).rejects.toThrow("room_unavailable");
    await db.exec("ROLLBACK TO SAVEPOINT attempted");
    expect(
      (
        await db.query<{ hotel_room_id: string }>(
          "SELECT hotel_room_id FROM hotel_reservation_rooms WHERE reservation_id=$1",
          [booking],
        )
      ).rows[0].hotel_room_id,
    ).toBe(oldAllocation);
    expect(
      (
        await db.query<{ reservation_room_id: string }>(
          "SELECT reservation_room_id FROM hotel_reservation_guests",
        )
      ).rows[0].reservation_room_id,
    ).toBe(oldAllocation);
    expect((await db.query("SELECT * FROM hotel_mutation_requests")).rows).toHaveLength(0);
  });
  it("rejects an outdated reservation version", async () => {
    await expect(replace(undefined, "2026-10-15T00:00:00Z")).rejects.toThrow("stale_reservation");
  });
  it("rejects another tenant", async () => {
    await expect(
      replace(undefined, version, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    ).rejects.toThrow("reservation_not_found");
  });
  it("rejects changing room inventory after check-in", async () => {
    await db.exec("UPDATE hotel_reservations SET status='checked_in'");
    await expect(replace()).rejects.toThrow("correction_reason_required");
  });
});
