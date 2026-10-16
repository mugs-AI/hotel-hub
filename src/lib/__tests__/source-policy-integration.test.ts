import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from "vitest";
import { createSourcePolicyStore } from "../source-billing-policy-store.server";
import { handleSourcePolicyHttp, type SourcePolicyHttpDeps } from "../source-policy-http.server";
import { actor, plan } from "./fixtures/source-billing";
const modulePath = process.env.HH_PGLITE_TEST_MODULE,
  root = new URL("../../../", import.meta.url);
describe.skipIf(!modulePath)("source policy HTTP to fenced PostgreSQL persistence", () => {
  let db: {
      exec(sql: string): Promise<unknown>;
      query<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<{ rows: T[] }>;
      close(): Promise<void>;
    },
    sourceId: string;
  const t = actor.tenantId,
    r = actor.reservationId;
  beforeAll(async () => {
    const { PGlite } = await import(/* @vite-ignore */ modulePath!),
      { btree_gist } = await import(
        /* @vite-ignore */ modulePath!.replace(/\/index\.js$/, "/contrib/btree_gist.js")
      );
    db = new PGlite({ extensions: { btree_gist } });
    await db.exec("SET hotelhub.disposable_test='enabled'; SET check_function_bodies=off");
    const migrations = readdirSync(new URL("supabase/migrations/", root));
    for (const file of [
      "db/checks/hh-settlement-setup.sql",
      "db/checks/hh-settlement-seed.sql",
      "supabase/migrations/20261008080000_hh_billing_settlement.sql",
      "supabase/migrations/20261011225957_hh_source_billing.sql",
      "supabase/migrations/" +
        migrations.find((f) => f.endsWith("_hh_staff_settlement_authority.sql")),
    ])
      await db.exec(readFileSync(new URL(file, root), "utf8"));
    await db.exec("SET check_function_bodies=on");
    sourceId = (
      await db.query<{ id: string }>(
        "SELECT id FROM hotel_booking_sources WHERE tenant_id=$1::uuid",
        [t],
      )
    ).rows[0].id;
  }, 30000);
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.exec("BEGIN");
  });
  afterEach(async () => {
    await db.exec("ROLLBACK");
  });
  function deps(role = actor.role): SourcePolicyHttpDeps {
    return {
      actor: async () => ({ ...actor, reservationId: "", role }),
      exists: async (kind, id, a) =>
        (
          await db.query(
            `SELECT id FROM ${kind === "policy" ? "hotel_booking_sources" : "hotel_reservations"} WHERE tenant_id=$1::uuid AND id=$2::uuid`,
            [a.tenantId, id],
          )
        ).rows.length === 1,
      store: createSourcePolicyStore(
        async (name, args) => {
          // Names come exclusively from the trusted SourcePolicyStore; placeholders carry every value.
          const names = Object.keys(args),
            sql = `SELECT ${name}(${names.map((n, i) => `${n} => $${i + 1}`).join(",")}) v`;
          // Each RPC gets a savepoint, matching PostgREST's independent request transaction.
          await db.exec("SAVEPOINT rpc");
          try {
            const value = (
              await db.query<{ v: unknown }>(
                sql,
                names.map((n) => (typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n])),
              )
            ).rows[0].v;
            await db.exec("RELEASE rpc");
            return { data: value, error: null };
          } catch (e) {
            await db.exec("ROLLBACK TO rpc; RELEASE rpc");
            return { data: null, error: { message: (e as Error).message } };
          }
        },
        async (a, id) => ({
          kind: "confirmed",
          value: { tenantId: a.tenantId, customerId: id, active: true },
        }),
      ),
    };
  }
  function req(body?: unknown) {
    return new Request("https://hotel.test/api/hotel/test", {
      method: body === undefined ? "GET" : "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function payerInput(collectionMode: "guest" | "source", expectedRevision: string) {
    const v = await (await handleSourcePolicyHttp("payer_read", req(), r, deps())).json();
    return {
      collectionMode,
      expectedRevision,
      expectedSourceId: v.sourceId,
      expectedPolicyVersion: (v.policy ?? v.payer.policy).version,
      expectedReservationUpdatedAt: v.updatedAt,
    };
  }
  async function configure() {
    const policy = { ...plan().payer.policy, sourceId, version: "0" };
    const res = await handleSourcePolicyHttp(
      "policy_save",
      req({ expectedVersion: "0", policy }),
      sourceId,
      deps(),
    );
    expect(res.status).toBe(200);
    return { ...policy, version: "1" };
  }
  it.each(["policy", "source", "booking"] as const)(
    "refuses a %s change after the Owner's GET review",
    async (kind) => {
      const p = await configure(),
        reviewed = await payerInput("source", "0");
      if (kind === "policy")
        expect(
          (
            await handleSourcePolicyHttp(
              "policy_save",
              req({ expectedVersion: "1", policy: { ...p, sourceCustomerId: 9 } }),
              sourceId,
              deps(),
            )
          ).status,
        ).toBe(200);
      else if (kind === "source") {
        await db.query(
          "INSERT INTO hotel_booking_sources(tenant_id,source_code,display_name) VALUES($1::uuid,'phone','Phone') ON CONFLICT(tenant_id,source_code) DO NOTHING",
          [t],
        );
        await db.query(
          "UPDATE hotel_reservations SET booking_source='phone',updated_at=clock_timestamp() WHERE id=$1::uuid",
          [r],
        );
      } else
        await db.query(
          "UPDATE hotel_reservations SET updated_at=clock_timestamp() WHERE id=$1::uuid",
          [r],
        );
      const result = await handleSourcePolicyHttp("payer_save", req(reviewed), r, deps());
      expect(result.status).toBe(409);
      expect(
        (await db.query<{ n: number }>("SELECT count(*)::int n FROM hotel_reservation_payers"))
          .rows[0].n,
      ).toBe(0);
      expect(
        (
          await db.query<{ n: number }>(
            "SELECT count(*)::int n FROM hotel_source_billing_audit WHERE event='payer_confirmed'",
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );
  it("GET never creates a payer; explicit Owner save persists exactly one audited revision", async () => {
    await configure();
    const preview = await handleSourcePolicyHttp("payer_read", req(), r, deps());
    expect(preview.status).toBe(200);
    expect(
      (await db.query<{ n: number }>("SELECT count(*)::int n FROM hotel_reservation_payers"))
        .rows[0].n,
    ).toBe(0);
    const saved = await handleSourcePolicyHttp(
      "payer_save",
      req(await payerInput("source", "0")),
      r,
      deps(),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      revision: "1",
      payer: { collectionMode: "source", policy: { sourceCustomerId: 8 } },
    });
    expect(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int n FROM hotel_source_billing_audit WHERE event='payer_confirmed'",
        )
      ).rows[0].n,
    ).toBe(1);
    const stale = await handleSourcePolicyHttp(
      "payer_save",
      req(await payerInput("guest", "0")),
      r,
      deps(),
    );
    expect(stale.status).toBe(409);
    expect(
      (
        await db.query<{ revision: number }>(
          "SELECT revision::int revision FROM hotel_reservation_payers",
        )
      ).rows,
    ).toEqual([{ revision: 1 }]);
  });
  it("changing source defaults leaves the existing booking payer snapshot unchanged", async () => {
    const p = await configure();
    expect(
      (await handleSourcePolicyHttp("payer_save", req(await payerInput("source", "0")), r, deps()))
        .status,
    ).toBe(200);
    expect(
      (
        await handleSourcePolicyHttp(
          "policy_save",
          req({
            expectedVersion: "1",
            policy: { ...p, sourceCustomerId: 9, defaultCollectionMode: "guest" },
          }),
          sourceId,
          deps(),
        )
      ).status,
    ).toBe(200);
    const view = await (await handleSourcePolicyHttp("payer_read", req(), r, deps())).json();
    expect(view).toMatchObject({
      revision: "1",
      payer: { collectionMode: "source", policy: { version: "1", sourceCustomerId: 8 } },
      policy: { version: "2", sourceCustomerId: 9, defaultCollectionMode: "guest" },
    });
  });
  it("Front Desk reads but cannot change an existing saved payer through the mounted endpoint", async () => {
    await configure();
    await handleSourcePolicyHttp("payer_save", req(await payerInput("source", "0")), r, deps());
    await db.query(
      "INSERT INTO hotel_user_roles(tenant_id,n3_user_key,role) VALUES($1::uuid,'synthetic-staff','front_desk')",
      [t],
    );
    const fd = deps("front_desk");
    fd.actor = async () => ({ ...actor, n3UserKey: "synthetic-staff", role: "front_desk" });
    expect((await handleSourcePolicyHttp("payer_read", req(), r, fd)).status).toBe(200);
    expect(
      (await handleSourcePolicyHttp("payer_save", req(await payerInput("guest", "1")), r, fd))
        .status,
    ).toBe(403);
  });
  it("a completed stay stays read-only and cannot gain another payer revision", async () => {
    await configure();
    await handleSourcePolicyHttp("payer_save", req(await payerInput("source", "0")), r, deps());
    await db.query("UPDATE hotel_reservations SET status='checked_out' WHERE id=$1::uuid", [r]);
    const preview = await handleSourcePolicyHttp("payer_read", req(), r, deps());
    expect(await preview.json()).toMatchObject({
      frozen: true,
      payer: { collectionMode: "source" },
    });
    const denied = await handleSourcePolicyHttp(
      "payer_save",
      req(await payerInput("guest", "1")),
      r,
      deps(),
    );
    expect(denied.status).toBe(409);
    expect(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int n FROM hotel_source_billing_audit WHERE event='payer_confirmed'",
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
