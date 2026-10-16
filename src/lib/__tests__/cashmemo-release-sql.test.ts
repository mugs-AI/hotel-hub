import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const modulePath = process.env.HH_PGLITE_TEST_MODULE,
  root = new URL("../../../", import.meta.url);
describe.skipIf(!modulePath)(
  "combined CashMemo backend candidate against current receipt baseline",
  () => {
    let db: {
      exec(s: string): Promise<unknown>;
      query<T = Record<string, unknown>>(s: string, a?: unknown[]): Promise<{ rows: T[] }>;
      close(): Promise<void>;
    };
    beforeAll(async () => {
      const { PGlite } = await import(/* @vite-ignore */ modulePath!),
        { btree_gist } = await import(
          /* @vite-ignore */ modulePath!.replace(/\/index\.js$/, "/contrib/btree_gist.js")
        );
      db = new PGlite({ extensions: { btree_gist } });
      await db.exec("SET hotelhub.disposable_test='enabled';SET check_function_bodies=off");
      await db.exec(readFileSync(new URL("db/checks/hh-settlement-setup.sql", root), "utf8"));
      // These two are already installed remotely. Reconstruct them only inside this
      // disposable database; never put them in the pending installation list.
      for (const f of [
        "20261003120216_hh_automatic_receipt_controls.sql",
        "20261012075339_hh_staff_receipt_authority.sql",
      ])
        await db.exec(readFileSync(new URL("supabase/migrations/" + f, root), "utf8"));
      await db.exec(readFileSync(new URL("db/checks/hh-settlement-seed.sql", root), "utf8"));
      await db.exec("SET check_function_bodies=on");
    }, 30000);
    afterAll(async () => db?.close());
    it("applies every pending additive migration in order with PostgreSQL body checking enabled", async () => {
      const applied = new Set(["20261003120216", "20261012075339"]);
      const pending = readdirSync(new URL("supabase/migrations/", root))
        .filter(
          (f) =>
            /^202610/.test(f) && f.slice(0, 14) >= "20261008080000" && !applied.has(f.slice(0, 14)),
        )
        .sort();
      expect(pending).toHaveLength(11);
      for (const f of pending) {
        try {
          await db.exec(readFileSync(new URL("supabase/migrations/" + f, root), "utf8"));
        } catch (e) {
          throw Error(f + ": " + (e as Error).message);
        }
      }
      const rows = (
        await db.query<{ name: string }>(
          "SELECT c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('hotel_billing_preparations','hotel_source_charge_attributions','hotel_reservation_payers','hotel_source_billing_legs','hotel_receipt_applied_events') ORDER BY c.relname",
        )
      ).rows;
      expect(rows).toHaveLength(5);
    });
    it("rehearses the native runner's actual canonical freeze and duplicate-claim fixture", async () => {
      const { freezeCurrentGuest, claimCurrentGuest } = await import(
        /* @vite-ignore */ new URL("../../../db/checks/hh-cashmemo-native.mjs", import.meta.url)
          .href
      );
      const client = { query: (s: string, a?: unknown[]) => db.query(s, a) };
      const fixture = await freezeCurrentGuest(client);
      expect(await claimCurrentGuest(client, fixture)).toHaveProperty("attemptId");
      expect(await claimCurrentGuest(client, fixture)).toBeNull();
    });
    it("keeps public financial bypasses revoked and the installed receipt generation intact", async () => {
      const r = (
        await db.query<{ oldCreate: boolean; freeze: boolean; helper: boolean; contact: boolean }>(
          "SELECT has_function_privilege('service_role','hotelhub_create_reservation(uuid,text,text,date,date,text,text,jsonb,jsonb)','EXECUTE') AS \"oldCreate\",has_function_privilege('service_role','hh_source_billing_freeze(uuid,uuid,text,jsonb,uuid)','EXECUTE') AS freeze,has_function_privilege('service_role','hh_source_billing_freeze_before_attribution(uuid,uuid,text,jsonb,uuid)','EXECUTE') AS helper,EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='hotel_receipt_versions' AND column_name='verified_contact') AS contact",
        )
      ).rows[0];
      expect(r).toEqual({ oldCreate: false, freeze: true, helper: false, contact: true });
    });
  },
);
