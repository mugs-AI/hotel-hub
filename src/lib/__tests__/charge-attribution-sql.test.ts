import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from "vitest";
import { createChargeAttributionService } from "../charge-attribution.server";
import { handleChargeAttributionHttp } from "../charge-attribution-http.server";
import { fixtureActor as actor, evidenceSnapshot } from "./fixtures/settlement-evidence";
import { snapshotDigest } from "../settlement-snapshot.server";
import { billingPayloadDigest } from "../n3-billing.server";
import { partitionSourceBill } from "../source-billing-plan.server";
import { createSourceBillStore } from "../source-billing-store.server";
import { readFrozenSourceState, type FrozenSourceDb } from "../source-billing-adapter.server";
import { loadFrozenSourceLeg } from "../source-billing-frozen.server";
import type { ReservationPayerSnapshot } from "../source-billing";
const modulePath = process.env.HH_PGLITE_TEST_MODULE,
  root = new URL("../../../", import.meta.url),
  t = actor.tenantId,
  r = actor.reservationId;
describe.skipIf(!modulePath)(
  "HTTP to real PostgreSQL charge allocation and freeze enforcement",
  () => {
    let db: {
        exec(s: string): Promise<unknown>;
        query<T = Record<string, unknown>>(s: string, a?: unknown[]): Promise<{ rows: T[] }>;
        close(): Promise<void>;
      },
      payer: ReservationPayerSnapshot;
    beforeAll(async () => {
      const { PGlite } = await import(/* @vite-ignore */ modulePath!),
        { btree_gist } = await import(
          /* @vite-ignore */ modulePath!.replace(/\/index\.js$/, "/contrib/btree_gist.js")
        );
      db = new PGlite({ extensions: { btree_gist } });
      await db.exec("SET hotelhub.disposable_test='enabled';SET check_function_bodies=off");
      const files = readdirSync(new URL("supabase/migrations/", root));
      for (const file of [
        "db/checks/hh-settlement-setup.sql",
        "db/checks/hh-settlement-seed.sql",
        "supabase/migrations/20261008080000_hh_billing_settlement.sql",
        "supabase/migrations/20261011225957_hh_source_billing.sql",
        ...[
          "_hh_staff_settlement_authority.sql",
          "_hh_canonical_billing_preparation.sql",
          "_hh_source_charge_attribution.sql",
        ].map((s) => "supabase/migrations/" + files.find((f) => f.endsWith(s))),
      ])
        await db.exec(readFileSync(new URL(file, root), "utf8"));
      await db.exec(
        `INSERT INTO hotel_settings(tenant_id) VALUES('${t}');INSERT INTO hotel_user_roles(tenant_id,n3_user_key,role) VALUES('${t}','synthetic-staff','front_desk'),('${t}','synthetic-hk','housekeeper');SET check_function_bodies=on;`,
      );
    }, 30000);
    afterAll(async () => db?.close());
    beforeEach(async () => {
      await db.exec("BEGIN");
      await db.exec(
        `UPDATE hotel_folio_lines SET tax_class='accommodation',n3_stock_id_snapshot='101',n3_uom_id_snapshot='1',n3_tax_code_id_snapshot='8';INSERT INTO hotel_financial_settings(tenant_id,service_tax_registered,n3_tax_code_exempt_id) VALUES('${t}',false,'8')`,
      );
      const sourceId = (
        await db.query<{ id: string }>("SELECT id FROM hotel_booking_sources WHERE tenant_id=$1", [
          t,
        ])
      ).rows[0].id;
      await db.query(
        "INSERT INTO hotel_reservation_payers(tenant_id,reservation_id,source_id,collection_mode,policy_snapshot,confirmed_by) VALUES($1,$2,$3,'guest',$4::jsonb,'synthetic-owner')",
        [
          t,
          r,
          sourceId,
          JSON.stringify({
            sourceId,
            version: "1",
            defaultCollectionMode: "guest",
            allowedCollectionModes: ["guest", "source"],
            sourceCustomerId: 8,
            guestCustomerId: 7,
            guestDocumentTitle: "Source Sales",
            guestItemDescription: "Accommodation",
            showRoomPrices: false,
          }),
        ],
      );
      payer = (
        await db.query<{ v: ReservationPayerSnapshot }>(
          "SELECT hh_source_billing_payer_json(p) v FROM hotel_reservation_payers p WHERE tenant_id=$1 AND reservation_id=$2",
          [t, r],
        )
      ).rows[0].v;
    });
    afterEach(async () => {
      await db.exec("ROLLBACK");
    });
    async function snapshot() {
      const s = evidenceSnapshot();
      s.receipts = [];
      s.lines[0].kind = "add_on";
      s.lines[0].description = "Synthetic charge";
      s.billDate = (
        await db.query<{ d: string }>(
          "SELECT (clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur')::date::text d",
        )
      ).rows[0].d;
      s.sourceVersions = (
        await db.query<{ v: typeof s.sourceVersions }>(
          "SELECT hotelhub_settlement_sources($1,$2) v",
          [t, r],
        )
      ).rows[0].v;
      const { digest: _d, ...facts } = s;
      return { ...facts, digest: snapshotDigest(facts) };
    }
    async function rpc(name: string, args: Record<string, unknown>) {
      await db.exec("SAVEPOINT rpc");
      try {
        const names = Object.keys(args),
          value = (
            await db.query<{ v: unknown }>(
              `SELECT ${name}(${names.map((n, i) => `${n} => $${i + 1}`).join(",")}) v`,
              names.map((n) => (typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n])),
            )
          ).rows[0].v;
        await db.exec("RELEASE rpc");
        return { data: value, error: null };
      } catch (e) {
        await db.exec("ROLLBACK TO rpc;RELEASE rpc");
        return { data: null, error: { message: (e as Error).message } };
      }
    }
    function deps(role = actor.role) {
      return {
        actor: async () => ({
          ...actor,
          role,
          n3UserKey:
            role === "front_desk"
              ? "synthetic-staff"
              : role === "housekeeper"
                ? "synthetic-hk"
                : actor.n3UserKey,
        }),
        service: createChargeAttributionService({
          rpc,
          snapshot: async () => ({ kind: "confirmed", value: await snapshot() }),
        }),
      };
    }
    const request = (body?: unknown) =>
      new Request("https://hotel.test/api/hotel/test", {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    async function input() {
      const v = await (await handleChargeAttributionHttp(request(), r, deps())).json();
      return {
        expectedRevision: v.revision,
        basisDigest: v.basisDigest,
        assignments: v.rows.map((x: { lineId: string }) => ({ lineId: x.lineId, leg: "guest" })),
      };
    }
    function frozenDb(): FrozenSourceDb {
      return {
        rpc,
        from(table) {
          const filters: Array<[string, unknown]> = [];
          let descending = false;
          if (!/^[a-z_]+$/.test(table)) throw Error("invalid test table");
          const q = {
            select: () => q,
            eq: (column: string, value: unknown) => {
              if (!/^[a-z_]+$/.test(column)) throw Error("invalid column");
              filters.push([column, value]);
              return q;
            },
            order: () => {
              descending = true;
              return q;
            },
            async limit(n: number) {
              const where = filters.map(([key], i) => `${key}=$${i + 1}`).join(" AND "),
                params = filters.map(([, v]) => v);
              const all = await db.query<{ row: Record<string, unknown> }>(
                `SELECT to_jsonb(x) row FROM (SELECT * FROM ${table} WHERE ${where}${descending ? " ORDER BY revision DESC" : ""}) x`,
                params,
              );
              return {
                data: all.rows.slice(0, n).map((x) => x.row),
                count: all.rows.length,
                error: null,
              };
            },
          };
          return q;
        },
      };
    }
    it("real immutable preparation recovers the exact frozen guest leg through the production reader", async () => {
      expect((await freeze(await sourcePlan())).error).toBeNull();
      const store = createSourceBillStore(rpc),
        stay = (await store.read(actor))!,
        leg = stay.legs[0],
        port = frozenDb();
      const count = async () =>
        (await db.query("SELECT id FROM hotel_settlement_attempts")).rows.length;
      const before = await count();
      const result = await loadFrozenSourceLeg(actor, leg, {
        readState: (a) => readFrozenSourceState(a, store, port),
        masters: {
          verifyLine: async (_a, _h, l) => ({ kind: "confirmed", value: l }),
          checkCurrent: () => ({ kind: "confirmed", value: true }),
        },
        verifyReceipt: async () => {
          throw Error("no guest advances in this fixture");
        },
        now: () => new Date("2099-01-01T00:00:00Z"),
      });
      expect(result).toEqual({ kind: "confirmed", value: leg.snapshot });
      expect(await count()).toBe(before);
      expect((await db.query("SELECT id FROM hotel_billing_preparations")).rows).toHaveLength(1);
    });
    it("production frozen reader requires the current staff's scoped read authority", async () => {
      expect((await freeze(await sourcePlan())).error).toBeNull();
      const store = createSourceBillStore(rpc);
      await expect(
        readFrozenSourceState(
          { ...actor, role: "housekeeper", n3UserKey: "synthetic-hk" },
          store,
          frozenDb(),
        ),
      ).rejects.toThrow("settlement_forbidden");
    });
    it("GET reads assignments without any preparation, intent, allocation or audit write", async () => {
      expect((await handleChargeAttributionHttp(request(), r, deps())).status).toBe(200);
      for (const table of [
        "hotel_source_charge_attributions",
        "hotel_source_charge_attribution_audit",
        "hotel_billing_preparations",
        "hotel_settlement_intents",
      ])
        expect((await db.query(`SELECT 1 FROM ${table}`)).rows).toHaveLength(0);
    });
    it("explicit Owner save persists one audited allocation and no billing preparation", async () => {
      const body = await input();
      expect((await handleChargeAttributionHttp(request(body), r, deps())).status).toBe(200);
      expect((await db.query("SELECT 1 FROM hotel_source_charge_attributions")).rows).toHaveLength(
        1,
      );
      expect(
        (await db.query("SELECT 1 FROM hotel_source_charge_attribution_audit")).rows,
      ).toHaveLength(1);
      expect((await db.query("SELECT 1 FROM hotel_billing_preparations")).rows).toHaveLength(0);
      expect((await handleChargeAttributionHttp(request(body), r, deps())).status).toBe(409);
    });
    it.each(["charge", "payer"])(
      "a %s change after GET refuses stale review without audit",
      async (kind) => {
        const body = await input();
        await db.exec(
          kind === "charge"
            ? "UPDATE hotel_folio_lines SET description_snapshot='Changed'"
            : "UPDATE hotel_reservation_payers SET revision=revision+1",
        );
        expect((await handleChargeAttributionHttp(request(body), r, deps())).status).toBe(409);
        expect(
          (await db.query("SELECT 1 FROM hotel_source_charge_attributions")).rows,
        ).toHaveLength(0);
      },
    );
    it("Front Desk reads but cannot save, and Housekeeping cannot read", async () => {
      const body = await input();
      expect((await handleChargeAttributionHttp(request(), r, deps("front_desk"))).status).toBe(
        200,
      );
      expect((await handleChargeAttributionHttp(request(body), r, deps("front_desk"))).status).toBe(
        403,
      );
      expect((await handleChargeAttributionHttp(request(), r, deps("housekeeper"))).status).toBe(
        403,
      );
    });
    it("rejects duplicate or absent line membership", async () => {
      const body = await input();
      body.assignments.push({ ...body.assignments[0] });
      expect((await handleChargeAttributionHttp(request(body), r, deps())).status).toBe(409);
    });
    it("a stale source fingerprint passed directly to SQL is refused", async () => {
      await handleChargeAttributionHttp(request(await input()), r, deps());
      const row = (
        await db.query<{ basis: unknown; basis_digest: string }>(
          "SELECT * FROM hotel_source_charge_attributions",
        )
      ).rows[0];
      await db.exec("UPDATE hotel_folio_lines SET description_snapshot='Changed again'");
      const result = await rpc("hh_source_attribution_put", {
        p_tenant: t,
        p_reservation: r,
        p_actor: actor.n3UserKey,
        p_role: "owner",
        p_expected_revision: "1",
        p_basis: row.basis,
        p_basis_digest: row.basis_digest,
        p_assignments: [{ lineId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", leg: "guest" }],
      });
      expect(result.error?.message).toContain("source_attribution_changed");
      expect(
        (await db.query("SELECT 1 FROM hotel_source_charge_attribution_audit")).rows,
      ).toHaveLength(1);
    });
    async function sourcePlan() {
      const s = await snapshot(),
        p = partitionSourceBill(s, payer, new Map(), {
          source: "44444444-4444-4444-8444-444444444444",
          guest: "55555555-5555-4555-8555-555555555555",
        });
      if (p.kind !== "confirmed") throw Error(p.code);
      return p.value;
    }
    const freeze = (p: unknown) =>
      rpc("hh_source_billing_freeze", {
        p_tenant_id: t,
        p_reservation_id: r,
        p_actor: actor.n3UserKey,
        p_plan: p,
        p_request_id: "33333333-3333-4333-8333-333333333333",
      });
    it("freeze enforces saved allocation, then exact replay remains stable", async () => {
      await handleChargeAttributionHttp(request(await input()), r, deps());
      const p = await sourcePlan();
      const first = await freeze(p);
      expect(first.error).toBeNull();
      expect(await freeze(p)).toEqual(first);
      expect((await db.query("SELECT 1 FROM hotel_billing_preparations")).rows).toHaveLength(1);
      expect((await handleChargeAttributionHttp(request(await input()), r, deps())).status).toBe(
        409,
      );
    });
    it("saved-payer stays cannot bypass allocation through legacy freeze", async () => {
      const result = await rpc("hotelhub_settlement_freeze", {
        p_tenant_id: t,
        p_reservation_id: r,
        p_actor: actor.n3UserKey,
        p_snapshot: await snapshot(),
        p_client_request_id: "33333333-3333-4333-8333-333333333333",
      });
      expect(result.error?.message).toContain("source_billing_leg_required");
      expect((await db.query("SELECT 1 FROM hotel_settlement_intents")).rows).toHaveLength(0);
    });
    it("changed charges after a saved allocation cannot freeze", async () => {
      await handleChargeAttributionHttp(request(await input()), r, deps());
      await db.exec("UPDATE hotel_folio_lines SET description_snapshot='Changed after save'");
      expect((await freeze(await sourcePlan())).error?.message).toContain(
        "source_attribution_changed",
      );
    });
    it("internal bypass helpers cannot be executed by service or browser roles", async () => {
      for (const name of [
        "hh_source_billing_freeze_before_attribution(uuid,uuid,text,jsonb,uuid)",
        "hotelhub_settlement_freeze_before_attribution(uuid,uuid,text,jsonb,uuid)",
        "hh_source_attribution_assert_plan(uuid,uuid,jsonb)",
      ])
        for (const role of ["service_role", "authenticated", "anon"])
          expect(
            (
              await db.query<{ v: boolean }>("SELECT has_function_privilege($1,$2,'EXECUTE') v", [
                role,
                name,
              ])
            ).rows[0].v,
          ).toBe(false);
    });
    it("normal guest allocation can freeze defaults without an Owner save", async () => {
      expect((await freeze(await sourcePlan())).error).toBeNull();
      expect((await db.query("SELECT 1 FROM hotel_source_charge_attributions")).rows).toHaveLength(
        0,
      );
    });
    it.each(["payer", "charge"] as const)(
      "closed stay rejects an old allocation after a %s change without a verified frozen source plan",
      async (kind) => {
        expect((await handleChargeAttributionHttp(request(await input()), r, deps())).status).toBe(
          200,
        );
        if (kind === "payer")
          await db.exec(
            "UPDATE hotel_reservation_payers SET revision=2,policy_snapshot=jsonb_set(policy_snapshot,'{sourceCustomerId}','999')",
          );
        else
          await db.exec(
            "UPDATE hotel_folio_lines SET description_snapshot='Changed before closure'",
          );
        await db.exec(
          "UPDATE hotel_reservations SET status='cancelled' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'",
        );
        const response = await handleChargeAttributionHttp(request(), r, deps());
        expect(response.status).toBe(409);
        expect(await response.json()).not.toHaveProperty("rows");
      },
    );
    it("reads a verified saved frozen plan without repricing current charges or rereading N3", async () => {
      await handleChargeAttributionHttp(request(await input()), r, deps());
      expect((await freeze(await sourcePlan())).error).toBeNull();
      const d = deps();
      d.service = createChargeAttributionService({
        rpc,
        snapshot: async () => {
          throw Error("unexpected_current_snapshot_read");
        },
      });
      const response = await handleChargeAttributionHttp(request(), r, d);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        frozen: true,
        stale: false,
        guestCustomerId: 7,
        rows: [{ description: "Synthetic charge", leg: "guest" }],
      });
    });
    it("source collection requires the stored Owner override rather than a different submitted leg", async () => {
      await db.exec("UPDATE hotel_reservation_payers SET collection_mode='source'");
      payer = { ...payer, collectionMode: "source" };
      const body = await input();
      body.assignments[0].leg = "source_room";
      expect((await handleChargeAttributionHttp(request(body), r, deps())).status).toBe(200);
      const s = await snapshot(),
        customers = new Map([
          [
            8,
            {
              tenantId: t,
              customerId: 8,
              currencyId: 1,
              currencyRate: 1,
              billTo: { name: "Synthetic source", company: "", address: "", phone: "", email: "" },
            },
          ],
        ]);
      const make = (leg: "guest" | "source_room") =>
        partitionSourceBill(
          s,
          payer,
          new Map([[s.lines[0].localLineId, leg]]),
          {
            source: "44444444-4444-4444-8444-444444444444",
            guest: "55555555-5555-4555-8555-555555555555",
          },
          customers,
        );
      const wrong = make("guest");
      if (wrong.kind !== "confirmed") throw Error(wrong.code);
      expect((await freeze(wrong.value)).error?.message).toContain(
        "source_charge_attribution_invalid",
      );
      const correct = make("source_room");
      if (correct.kind !== "confirmed") throw Error(correct.code);
      expect((await freeze(correct.value)).error).toBeNull();
    });
    it("a previous property-day basis is denied even with current fingerprints and valid digest", async () => {
      await handleChargeAttributionHttp(request(await input()), r, deps());
      const row = (
        await db.query<{ basis: Record<string, unknown>; assignments: unknown }>(
          "SELECT basis,assignments FROM hotel_source_charge_attributions",
        )
      ).rows[0];
      row.basis.billDate = "2000-01-01";
      expect(
        (
          await rpc("hh_source_attribution_put", {
            p_tenant: t,
            p_reservation: r,
            p_actor: actor.n3UserKey,
            p_role: "owner",
            p_expected_revision: "1",
            p_basis: row.basis,
            p_basis_digest: billingPayloadDigest(row.basis),
            p_assignments: row.assignments,
          })
        ).error?.message,
      ).toContain("source_attribution_changed");
    });
    it("audit failure rolls back allocation rather than leaving an unaudited save", async () => {
      const body = await input();
      await db.exec(
        "CREATE FUNCTION fail_attribution_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_audit_failure'; END $$; CREATE TRIGGER fail_attribution_audit BEFORE INSERT ON hotel_source_charge_attribution_audit FOR EACH ROW EXECUTE FUNCTION fail_attribution_audit()",
      );
      expect((await handleChargeAttributionHttp(request(body), r, deps())).status).toBe(503);
      expect((await db.query("SELECT 1 FROM hotel_source_charge_attributions")).rows).toHaveLength(
        0,
      );
    });
    it("rejects cross-site and browser amount fields before saving", async () => {
      const body = await input(),
        cross = request(body);
      cross.headers.set("origin", "https://other.test");
      expect((await handleChargeAttributionHttp(cross, r, deps())).status).toBe(403);
      expect(
        (await handleChargeAttributionHttp(request({ ...body, totalCents: 1 }), r, deps())).status,
      ).toBe(400);
      expect((await db.query("SELECT 1 FROM hotel_source_charge_attributions")).rows).toHaveLength(
        0,
      );
    });
  },
);
