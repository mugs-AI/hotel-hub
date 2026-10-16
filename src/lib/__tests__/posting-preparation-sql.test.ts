import { readFileSync, readdirSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { evidenceSnapshot, fixtureActor as actor } from "./fixtures/settlement-evidence";
import { loadSettlementSnapshot, snapshotDigest } from "../settlement-snapshot.server";
import { billingPayloadDigest } from "../n3-billing.server";
import { preparePostingLines, derivedPostingLineId } from "../posting-preparation.server";
import { partitionSourceBill } from "../source-billing-plan.server";
import { computeFolio, type StoredFolioLine } from "../folio";
import { defaultFinancialSettings } from "../financial-settings";
import { preparedSettlementFolio } from "./fixtures/settlement-folio";
import type { ReservationPayerSnapshot } from "../source-billing";
const modulePath = process.env.HH_PGLITE_TEST_MODULE;
const root = new URL("../../../", import.meta.url),
  t = actor.tenantId,
  r = actor.reservationId;
const request = "33333333-3333-4333-8333-333333333333";
describe.skipIf(!modulePath)(
  "atomic canonical billing preparation in disposable PostgreSQL",
  () => {
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
      for (const suffix of [
        "_hh_staff_settlement_authority.sql",
        "_hh_canonical_billing_preparation.sql",
      ])
        await db.exec(
          readFileSync(
            new URL(
              "supabase/migrations/" +
                readdirSync(new URL("supabase/migrations/", root)).find((f) => f.endsWith(suffix))!,
              root,
            ),
            "utf8",
          ),
        );
      await db.exec(
        `INSERT INTO hotel_settings(tenant_id) VALUES('${t}'); INSERT INTO hotel_user_roles(tenant_id,n3_user_key,role) VALUES('${t}','synthetic-staff','front_desk'),('${t}','synthetic-housekeeper','housekeeper'); SET check_function_bodies=on`,
      );
    }, 30000);
    afterAll(async () => db?.close());
    beforeEach(async () => {
      await db.exec("BEGIN");
    });
    afterEach(async () => {
      await db.exec("ROLLBACK");
    });
    async function snapshot(taxed = true) {
      await db.exec(
        `UPDATE hotel_folio_lines SET tax_class='accommodation',n3_stock_id_snapshot='101',n3_uom_id_snapshot='1',n3_tax_code_id_snapshot='8' WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'; INSERT INTO hotel_financial_settings(tenant_id,service_tax_registered,service_tax_accommodation_rate_bp,n3_tax_code_accommodation_id,n3_tax_code_exempt_id) VALUES('${t}',${taxed},800,'8','8')`,
      );
      const s = evidenceSnapshot();
      s.receipts = [];
      s.lines[0].kind = "add_on";
      s.lines[0].description = "Synthetic charge";
      s.lines[0].taxCents = taxed ? 4000 : 0;
      s.lines[0].totalCents = taxed ? 54000 : 50000;
      s.totalCents = s.lines[0].totalCents;
      s.billDate = (
        await db.query<{ d: string }>(
          "SELECT (clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur')::date::text d",
        )
      ).rows[0].d;
      s.sourceVersions = (
        await db.query<{ v: typeof s.sourceVersions }>(
          "SELECT hotelhub_settlement_sources($1::uuid,$2::uuid) v",
          [t, r],
        )
      ).rows[0].v;
      const { digest: _d, ...facts } = s;
      s.digest = snapshotDigest(facts);
      return s;
    }
    async function freeze(s: ReturnType<typeof evidenceSnapshot>, who = "synthetic-staff") {
      return (
        await db.query<{ v: Record<string, unknown> }>(
          "SELECT hotelhub_settlement_freeze($1::uuid,$2::uuid,$3,$4::jsonb,$5::uuid) v",
          [t, r, who, JSON.stringify(s), request],
        )
      ).rows[0].v;
    }
    async function freezeSource(s: ReturnType<typeof evidenceSnapshot>) {
      const sourceId = (
        await db.query<{ id: string }>(
          "SELECT id FROM hotel_booking_sources WHERE tenant_id=$1::uuid",
          [t],
        )
      ).rows[0].id;
      const policy = {
        sourceId,
        version: "1",
        defaultCollectionMode: "guest" as const,
        allowedCollectionModes: ["guest" as const],
        sourceCustomerId: null,
        guestCustomerId: 7,
        guestDocumentTitle: "Guest folio",
        guestItemDescription: "Accommodation",
        showRoomPrices: true,
      };
      await db.query(
        "INSERT INTO hotel_reservation_payers(tenant_id,reservation_id,source_id,collection_mode,policy_snapshot,confirmed_by) VALUES($1::uuid,$2::uuid,$3::uuid,'guest',$4::jsonb,'synthetic-owner')",
        [t, r, sourceId, JSON.stringify(policy)],
      );
      const payer = (
        await db.query<{ v: ReservationPayerSnapshot }>(
          "SELECT hh_source_billing_payer_json(p) v FROM hotel_reservation_payers p WHERE tenant_id=$1::uuid AND reservation_id=$2::uuid",
          [t, r],
        )
      ).rows[0].v;
      const p = partitionSourceBill(s, payer, new Map(), {
        source: "44444444-4444-4444-8444-444444444444",
        guest: "55555555-5555-4555-8555-555555555555",
      });
      if (p.kind !== "confirmed") throw Error(p.code);
      return (
        await db.query<{ v: { legs: unknown[] } }>(
          "SELECT hh_source_billing_freeze($1::uuid,$2::uuid,'synthetic-staff',$3::jsonb,$4::uuid) v",
          [t, r, JSON.stringify(p.value), request],
        )
      ).rows[0].v;
    }
    function seal<T extends { digest: string }>(s: T) {
      const { digest: _d, ...v } = s;
      s.digest = billingPayloadDigest(v);
      return s;
    }
    it("freezes RM540 including computed SST and preserves the original RM500/zero-tax row", async () => {
      const s = await snapshot();
      expect((await freeze(s)).state).toBe("frozen");
      const raw = (
        await db.query<{ tax_cents: number; total_cents: number }>(
          "SELECT tax_cents,total_cents FROM hotel_folio_lines WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'",
        )
      ).rows[0];
      expect(raw).toEqual({ tax_cents: 0, total_cents: 50000 });
      const prep = (
        await db.query<{ total_cents: number }>(
          "SELECT total_cents FROM hotel_billing_preparations",
        )
      ).rows;
      expect(prep).toEqual([{ total_cents: 54000 }]);
    });
    it("takes the actual folio calculator through canonical preparation and snapshot freeze", async () => {
      const s = await snapshot(),
        settings = defaultFinancialSettings(t);
      settings.serviceTaxRegistered = true;
      settings.serviceTax.accommodation.rateBp = 800;
      settings.serviceTax.accommodation.n3TaxCodeId = "8";
      settings.exempt.n3TaxCodeId = "8";
      const raw = (await db.query<Record<string, unknown>>("SELECT * FROM hotel_folio_lines"))
        .rows[0];
      const view = preparedSettlementFolio();
      view.propertyDate = s.billDate;
      view.lines[0].lineType = "add_on";
      view.lines[0].description = String(raw.description_snapshot);
      view.lines[0].taxRateBp = 800;
      view.readiness.serviceTaxRegistered = true;
      const base: StoredFolioLine = {
        id: String(raw.id),
        lineType: "add_on",
        status: "draft",
        taxClass: "accommodation",
        description: String(raw.description_snapshot),
        quantity: 1,
        unitPriceCents: 50000,
        subtotalCents: 50000,
        reversesLineId: null,
        reason: null,
        stayDate: null,
        reservationRoomId: null,
        roomLabel: null,
        actorLabel: null,
        createdAt: new Date().toISOString(),
      };
      const calculated = computeFolio({
        currency: "MYR",
        settings,
        lines: [base],
        guestTaxClass: "malaysian_citizen",
        occupiedRoomNights: 0,
        tourismTaxCollectedCents: 0,
        propertyDate: s.billDate,
      });
      expect(calculated.calculationComplete).toBe(true);
      view.derived = calculated.derived.map((l) => ({
        key: l.key,
        lineType: l.lineType,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPriceCents / 100,
        amount: l.amountCents / 100,
        taxRateBp: 800,
      }));
      view.totals.serviceTax = calculated.totals.serviceTaxCents / 100;
      view.totals.grandTotal = calculated.totals.grandTotalCents / 100;
      const prepared = await preparePostingLines(actor, {
        folioId: s.folioId,
        rawLines: [raw],
        view,
        settings,
        resolveRoomUom: async () => ({ kind: "confirmed", value: 1 }),
      });
      if (prepared.kind !== "confirmed") throw Error(prepared.code);
      const loaded = await loadSettlementSnapshot(actor, {
        now: () => new Date(),
        readFacts: async () => ({
          ...s,
          lines: prepared.value,
          folioProjection: { version: 1, folio: view },
          prepared: true,
          reservationStatus: "checked_in",
          historyGap: false,
          blockers: [],
        }),
        verifyLine: async (_a, line) => ({
          kind: "confirmed",
          value: { ...line, mappingEvidence: s.lines[0].mappingEvidence },
        }),
        verifyReceipt: async () => ({ kind: "unavailable", code: "unexpected_receipt" }),
      });
      if (loaded.kind !== "confirmed") throw Error(loaded.code);
      expect(loaded.value.totalCents).toBe(54000);
      expect((await freeze(loaded.value)).state).toBe("frozen");
    });
    it("same freeze key replays without preparing or auditing twice", async () => {
      const s = await snapshot();
      expect(await freeze(s)).toEqual(await freeze(s));
      expect(
        (await db.query<{ n: number }>("SELECT count(*)::int n FROM hotel_billing_preparations"))
          .rows[0].n,
      ).toBe(1);
    });
    it("cannot omit SST merely because raw tax_cents is still zero", async () => {
      const s = await snapshot();
      s.lines[0].taxCents = 0;
      s.lines[0].totalCents = s.totalCents = 50000;
      seal(s);
      await expect(freeze(s)).rejects.toThrow("settlement_preparation_invalid");
    });
    it("refuses a forged extra cent in tax", async () => {
      const s = await snapshot();
      s.lines[0].taxCents = 4001;
      s.lines[0].totalCents = s.totalCents = 54001;
      seal(s);
      await expect(freeze(s)).rejects.toThrow("settlement_preparation_invalid");
    });
    it("requires fresh local source facts", async () => {
      const s = await snapshot();
      await db.exec(
        "UPDATE hotel_folio_lines SET unit_price_cents=60000,subtotal_cents=60000,total_cents=60000",
      );
      await expect(freeze(s)).rejects.toThrow("settlement_snapshot_changed");
    });
    it.each(["synthetic-housekeeper", "missing-user"])(
      "denies %s before any preparation",
      async (who) => {
        const s = await snapshot();
        await expect(freeze(s, who)).rejects.toThrow("settlement_forbidden");
      },
    );
    it("denies a foreign folio", async () => {
      const s = await snapshot();
      s.folioId = "77777777-7777-4777-8777-777777777777";
      seal(s);
      await expect(freeze(s)).rejects.toThrow("settlement_scope_mismatch");
    });
    it("stores a mapped service charge as a canonical line, never as another operational folio item", async () => {
      const s = await snapshot();
      await db.exec(
        `UPDATE hotel_financial_settings SET service_charge_enabled=true,service_charge_percent_bp=1000,service_charge_service_tax_applies=true,posting_mappings='{"service_charge":{"enabled":true,"stock":{"id":"102"},"uom":{"id":"3"},"taxCode":{"id":"8"}}}' WHERE tenant_id='${t}'`,
      );
      s.lines.push({
        ...s.lines[0],
        localLineId: derivedPostingLineId(actor, s.folioId, "service_charge"),
        kind: "service_charge",
        stockId: 102,
        uomId: 3,
        qty: 1,
        unitCents: 5000,
        subtotalCents: 5000,
        taxCents: 400,
        totalCents: 5400,
        description: "Service charge 10%",
      });
      s.totalCents = 59400;
      s.sourceVersions = (
        await db.query<{ v: typeof s.sourceVersions }>(
          "SELECT hotelhub_settlement_sources($1::uuid,$2::uuid) v",
          [t, r],
        )
      ).rows[0].v;
      seal(s);
      expect((await freeze(s)).state).toBe("frozen");
      expect(
        (await db.query<{ n: number }>("SELECT count(*)::int n FROM hotel_folio_lines")).rows[0].n,
      ).toBe(1);
    });
    it("rolls back preparation together with a later freeze failure", async () => {
      const s = await snapshot();
      s.totalCents += 1;
      seal(s);
      await db.exec("SAVEPOINT rollback_preparation");
      await expect(freeze(s)).rejects.toThrow("settlement_preparation_invalid");
      await db.exec("ROLLBACK TO rollback_preparation");
      expect(
        (await db.query<{ n: number }>("SELECT count(*)::int n FROM hotel_billing_preparations"))
          .rows[0].n,
      ).toBe(0);
      expect(
        (
          await db.query<{ n: number }>(
            "SELECT count(*)::int n FROM hotel_audit_events WHERE event_type='hotel.billing.prepared'",
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("keeps canonical rows immutable and inaccessible to browser database roles", async () => {
      await freeze(await snapshot());
      await db.exec("SAVEPOINT immutability");
      await expect(
        db.exec("UPDATE hotel_billing_preparations SET total_cents=1"),
      ).rejects.toThrow();
      await db.exec("ROLLBACK TO immutability");
      const rows = (
        await db.query<{ rls: boolean; a: boolean; b: boolean }>(
          "SELECT relrowsecurity rls,has_table_privilege('anon',oid,'SELECT') a,has_table_privilege('authenticated',oid,'SELECT') b FROM pg_class WHERE oid='hotel_billing_preparations'::regclass",
        )
      ).rows;
      expect(rows).toEqual([{ rls: true, a: false, b: false }]);
    });
    it("keeps internal preparation writes unreachable as direct service RPCs", async () => {
      const row = (
        await db.query<{ allowed: boolean }>(
          "SELECT has_function_privilege('service_role','hotelhub_billing_preparation_save(uuid,uuid,text,uuid,date,jsonb,jsonb)','EXECUTE') allowed",
        )
      ).rows[0];
      expect(row.allowed).toBe(false);
    });
    it("rejects duplicate canonical membership", async () => {
      const s = await snapshot();
      s.lines.push(structuredClone(s.lines[0]));
      s.totalCents *= 2;
      seal(s);
      await expect(freeze(s)).rejects.toThrow("settlement_preparation_invalid");
    });
    it("rejects a replacement stock ID for an existing captured charge", async () => {
      const s = await snapshot();
      s.lines[0].stockId = 999;
      seal(s);
      await expect(freeze(s)).rejects.toThrow("settlement_preparation_invalid");
    });
    it("refuses JSON string amounts instead of canonical numeric cents", async () => {
      const s = await snapshot();
      (s.lines[0] as unknown as Record<string, unknown>).taxCents = "4000";
      seal(s);
      await expect(freeze(s)).rejects.toThrow("settlement_preparation_invalid");
    });
    it("refuses per-line tax rounding that disagrees with the folio class total", async () => {
      const s = await snapshot();
      await db.exec(
        "UPDATE hotel_folio_lines SET unit_price_cents=6,subtotal_cents=6,total_cents=6",
      );
      await db.exec(
        `INSERT INTO hotel_folio_lines SELECT (jsonb_populate_record(NULL::hotel_folio_lines,to_jsonb(l)||'{"id":"77777777-7777-4777-8777-777777777777"}'::jsonb)).* FROM hotel_folio_lines l`,
      );
      s.lines = [
        { ...s.lines[0], qty: 1, unitCents: 6, subtotalCents: 6, taxCents: 0, totalCents: 6 },
        {
          ...s.lines[0],
          localLineId: "77777777-7777-4777-8777-777777777777",
          qty: 1,
          unitCents: 6,
          subtotalCents: 6,
          taxCents: 0,
          totalCents: 6,
        },
      ];
      s.totalCents = 12;
      s.sourceVersions = (
        await db.query<{ v: typeof s.sourceVersions }>(
          "SELECT hotelhub_settlement_sources($1::uuid,$2::uuid) v",
          [t, r],
        )
      ).rows[0].v;
      seal(s);
      await expect(freeze(s)).rejects.toThrow("settlement_preparation_invalid");
    });
    for (const route of ["legacy", "source"] as const) {
      it.each([
        ["nearest_5_cents", 101, false],
        ["nearest_10_cents", 106, false],
        ["nearest_5_cents", 105, true],
        ["nearest_10_cents", 110, true],
      ] as const)(
        `${route} checks configured %s rounding for %i cents before saving`,
        async (mode, amount, valid) => {
          const s = await snapshot(false);
          await db.query("UPDATE hotel_financial_settings SET rounding_mode=$1", [mode]);
          await db.query(
            "UPDATE hotel_folio_lines SET unit_price_cents=$1,subtotal_cents=$1,total_cents=$1",
            [amount],
          );
          s.lines[0] = {
            ...s.lines[0],
            unitCents: amount,
            subtotalCents: amount,
            totalCents: amount,
          };
          s.totalCents = amount;
          s.sourceVersions = (
            await db.query<{ v: typeof s.sourceVersions }>(
              "SELECT hotelhub_settlement_sources($1::uuid,$2::uuid) v",
              [t, r],
            )
          ).rows[0].v;
          seal(s);
          const call = () => (route === "legacy" ? freeze(s) : freezeSource(s));
          if (valid) {
            await call();
            expect(
              (
                await db.query<{ n: number }>(
                  "SELECT count(*)::int n FROM hotel_billing_preparations",
                )
              ).rows[0].n,
            ).toBe(1);
          } else {
            await db.exec("SAVEPOINT rounding_failure");
            await expect(call()).rejects.toThrow("settlement_preparation_invalid");
            await db.exec("ROLLBACK TO rounding_failure");
            expect(
              (
                await db.query<{ n: number }>(
                  "SELECT count(*)::int n FROM hotel_billing_preparations",
                )
              ).rows[0].n,
            ).toBe(0);
          }
        },
      );
    }
    it("requires every enabled calculated charge", async () => {
      const s = await snapshot();
      await db.exec(
        "UPDATE hotel_financial_settings SET service_charge_enabled=true,service_charge_percent_bp=1000",
      );
      s.sourceVersions = (
        await db.query<{ v: typeof s.sourceVersions }>(
          "SELECT hotelhub_settlement_sources($1::uuid,$2::uuid) v",
          [t, r],
        )
      ).rows[0].v;
      seal(s);
      await expect(freeze(s)).rejects.toThrow("settlement_preparation_invalid");
    });
    it("source freeze uses canonical tax/membership rather than raw zero-tax totals", async () => {
      const s = await snapshot();
      await db.exec(
        `UPDATE hotel_financial_settings SET service_charge_enabled=true,service_charge_percent_bp=1000,service_charge_service_tax_applies=true,posting_mappings='{"service_charge":{"enabled":true,"stock":{"id":"102"},"uom":{"id":"3"},"taxCode":{"id":"8"}}}'`,
      );
      s.lines.push({
        ...s.lines[0],
        localLineId: derivedPostingLineId(actor, s.folioId, "service_charge"),
        kind: "service_charge",
        stockId: 102,
        uomId: 3,
        qty: 1,
        unitCents: 5000,
        subtotalCents: 5000,
        taxCents: 400,
        totalCents: 5400,
        description: "Service charge 10%",
      });
      s.totalCents = 59400;
      s.sourceVersions = (
        await db.query<{ v: typeof s.sourceVersions }>(
          "SELECT hotelhub_settlement_sources($1::uuid,$2::uuid) v",
          [t, r],
        )
      ).rows[0].v;
      seal(s);
      const stay = await freezeSource(s);
      expect(stay.legs).toHaveLength(1);
      expect(
        (
          await db.query<{ n: number }>(
            "SELECT count(*)::int n FROM hotel_source_billing_line_membership",
          )
        ).rows[0].n,
      ).toBe(2);
      expect(
        (await db.query<{ n: number }>("SELECT count(*)::int n FROM hotel_folio_lines")).rows[0].n,
      ).toBe(1);
    });
  },
);
