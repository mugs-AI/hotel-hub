import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { receiptSnapshot } from "./fixtures/receipt-controls";

// Explicit external test tool, never a product dependency or Cloud connection.
const wasmModule = process.env.HH_PGLITE_TEST_MODULE;
const nativeUrl = process.env.HH_TEST_PG_URL;
const nativeModule = process.env.HH_PG_TEST_MODULE;
function assertDisposableUrl(value: string) {
  const u = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
    !/^\/hh_test_[a-z0-9_]+$/.test(u.pathname) ||
    u.search ||
    process.env.HH_TEST_PG_DISPOSABLE !== "YES"
  )
    throw new Error("Disposable loopback hh_test_ database and explicit marker required");
}
if (nativeUrl) assertDisposableUrl(nativeUrl);
type Engine = {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
};
const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  R = "44444444-4444-4444-8444-444444444444",
  D = "55555555-5555-4555-8555-555555555555";
let db: Engine;
const sql = (file: string) => readFileSync(file, "utf8");
const call = async (name: string, data: unknown = {}, role = "owner", tenant = T) =>
  (
    await db.query<{ result: Record<string, unknown> }>(
      `select public.${name}($1::uuid,$2::text,$3::text,$4::jsonb) as result`,
      [tenant, "owner-1", role, JSON.stringify(data)],
    )
  ).rows[0]!.result;
const create = () => {
  const original = receiptSnapshot();
  return call("hotelhub_receipt_control_v2_create", {
    reservationId: R,
    depositId: D,
    clientRequestId: crypto.randomUUID(),
    fingerprint: "test-proposal-hash-00000001",
    reason: "guest no small notes",
    original,
    proposal: {
      kind: "correction",
      amountCents: 6500,
      accountId: original.paymentLines[0]!.accountId,
      contact: original.contact,
    },
    comparison: { fields: [], depositDeltaCents: 1500, balanceDeltaCents: -1500 },
    policyRevision: "0",
  });
};

describe.skipIf(!wasmModule && !nativeUrl)(
  nativeUrl
    ? "isolated native PostgreSQL evidence"
    : "isolated PostgreSQL WASM functional evidence (NOT native concurrent proof)",
  () => {
    beforeAll(async () => {
      if (nativeUrl) {
        if (!nativeModule) throw new Error("HH_PG_TEST_MODULE must point to external pg test tool");
        const mod = await import(/* @vite-ignore */ nativeModule);
        const client = new (mod.Client ?? mod.default.Client)({ connectionString: nativeUrl });
        await client.connect();
        db = {
          exec: (s) => client.query(s),
          query: (s, p) => client.query(s, p),
          close: () => client.end(),
        };
        const occupied = await db.query<{ count: number }>(
          "select count(*)::integer as count from information_schema.tables where table_schema='public'",
        );
        if (occupied.rows[0]!.count !== 0) throw new Error("Refusing nonempty disposable database");
      } else {
        const mod = await import(/* @vite-ignore */ wasmModule!);
        db = new mod.PGlite();
      }
      await db.exec(sql("src/lib/__tests__/fixtures/hh-change-controls-prerequisites.sql"));
      await db.exec(sql("supabase/migrations/20260929090000_hh_folio_bill_to.sql"));
      await db.exec(
        sql("supabase/migrations/20261002053219_29e0e715-1683-4b3a-84db-657d4ef30ebc.sql"),
      );
      await db.exec(
        sql("supabase/migrations/20261002053302_002c40fe-30f8-462c-a989-2c37291223c3.sql"),
      );
      await db.exec(sql("supabase/migrations/20261003120216_hh_automatic_receipt_controls.sql"));
    }, 20000);
    afterAll(async () => {
      await db?.close();
    });
    it("creates immutable generation-2 proposals with policy defaults and blocks a second active request", async () => {
      const row = await create();
      expect(row.generation).toBe(2);
      expect(row.execution_mode).toBe("direct");
      await expect(create()).rejects.toThrow();
      await expect(
        db.exec(`update hotel_receipt_control_requests set generation=1 where id='${row.id}'`),
      ).rejects.toThrow("receipt_control_immutable");
    });
    it("refuses alien tenant reservation/deposit IDs and Housekeeper requests", async () => {
      await expect(
        call(
          "hotelhub_receipt_control_v2_create",
          { reservationId: R, depositId: D },
          "owner",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ),
      ).rejects.toThrow();
      await expect(call("hotelhub_receipt_control_v2_create", {}, "housekeeper")).rejects.toThrow(
        "forbidden",
      );
    });
    it("enforces actual SQL caller grants", async () => {
      await db.exec("SET ROLE anon");
      await expect(db.query("select * from hotel_change_control_policies")).rejects.toThrow();
      await expect(call("hotelhub_change_policy_set", {})).rejects.toThrow("permission denied");
      await db.exec("RESET ROLE");
    });
    it("refuses missing authorization kind instead of recording a false direct authorization", async () => {
      const q = (
        await db.query<Record<string, unknown>>("select * from hotel_receipt_control_requests")
      ).rows[0]!;
      await expect(
        call("hotelhub_receipt_control_v2_authorize", {
          requestId: q.id,
          expectedVersion: q.version,
          policyRevision: "0",
        }),
      ).rejects.toThrow("approval_required");
    });
    it("direct authorization never fabricates Admin approval, then reserves a dispatch only once", async () => {
      const policy = await call("hotelhub_change_policy_set", {
        expectedRevision: "0",
        depositApprovalRequired: false,
        contactApprovalRequired: false,
      });
      expect(policy.revision).toBe("1");
      const q = (
        await db.query<Record<string, unknown>>("select * from hotel_receipt_control_requests")
      ).rows[0]!;
      const authorized = await call("hotelhub_receipt_control_v2_authorize", {
        requestId: q.id,
        expectedVersion: q.version,
        kind: "direct_policy",
        policyRevision: "1",
      });
      expect(authorized.approved_at).toBe(null);
      const first = await call("hotelhub_receipt_control_v2_reserve", {
        requestId: q.id,
        expectedVersion: authorized.version,
        payloadHash: "sha256-payload-00000001",
        policyRevision: "1",
      });
      expect(first.dispatchGranted).toBe(true);
      expect(
        (
          await call("hotelhub_receipt_control_v2_reserve", {
            requestId: q.id,
            expectedVersion: authorized.version,
            payloadHash: "sha256-payload-00000001",
            policyRevision: "1",
          })
        ).dispatchGranted,
      ).toBe(false);
    });
    it("does not release an unknown write through legacy recovery/rejection", async () => {
      const q = (
        await db.query<Record<string, unknown>>("select * from hotel_receipt_control_requests")
      ).rows[0]!;
      const a = (
        await db.query<Record<string, unknown>>("select * from hotel_receipt_edit_attempts")
      ).rows[0]!;
      await call("hotelhub_receipt_control_v2_settle", {
        requestId: q.id,
        attemptId: a.id,
        claimedVersion: a.claimed_version,
        expectedVersion: q.version,
        result: { kind: "unknown", code: "timeout" },
      });
      await expect(
        db.query(
          "select hotelhub_receipt_control_recover($1::uuid,$2::uuid,$3::integer,$4::text,$5::integer)",
          [T, q.id, Number(q.version) + 1, "owner-1", 0],
        ),
      ).rejects.toThrow("automation_unavailable");
      await expect(
        call("hotelhub_receipt_control_v2_authorize", {
          requestId: q.id,
          expectedVersion: Number(q.version) + 1,
          kind: "reject",
          policyRevision: "1",
        }),
      ).rejects.toThrow("claim_conflict");
    });
    it("fences late workers and atomically completes a proven MYR65 result once", async () => {
      const q = (
        await db.query<Record<string, unknown>>("select * from hotel_receipt_control_requests")
      ).rows[0]!;
      const a = (
        await db.query<Record<string, unknown>>("select * from hotel_receipt_edit_attempts")
      ).rows[0]!;
      const version = {
        state: "active",
        receiptId: "11111111-1111-4111-8111-111111111111",
        docCode: "OR-TEST/001",
        documentDate: "2026-10-01",
        currency: "MYR",
        amountCents: 6500,
        paymentLines: [{ accountId: "33333333-3333-4333-8333-333333333333", amountCents: 6500 }],
        replacementOf: null,
        fingerprint: "exact-journal-fingerprint",
      };
      const input = {
        requestId: q.id,
        attemptId: a.id,
        claimedVersion: a.claimed_version,
        expectedVersion: q.version,
        result: { kind: "verified", version, contact: receiptSnapshot().contact },
      };
      await expect(
        call("hotelhub_receipt_control_v2_settle", {
          ...input,
          expectedVersion: Number(q.version) - 1,
        }),
      ).rejects.toThrow("claim_stale");
      expect((await call("hotelhub_receipt_control_v2_settle", input)).state).toBe("applied");
      expect((await call("hotelhub_receipt_control_v2_settle", input)).state).toBe("applied");
      expect(
        (
          await db.query<{ count: number }>(
            "select count(*)::integer as count from hotel_receipt_versions",
          )
        ).rows[0]!.count,
      ).toBe(1);
      expect(
        (
          await db.query<{ amount_cents: number }>(
            "select amount_cents::integer from hotel_receipt_versions",
          )
        ).rows[0]!.amount_cents,
      ).toBe(6500);
    });
    it("keeps local effective details unchanged until approval and detects guest-fallback drift", async () => {
      await call("hotelhub_change_policy_set", {
        expectedRevision: "1",
        depositApprovalRequired: false,
        contactApprovalRequired: true,
      });
      const original = {
        name: "Original",
        company: "",
        address: "",
        phone: "0100000000",
        email: "old@example.test",
      };
      const result = await call(
        "hotelhub_bill_to_change_save",
        {
          reservationId: R,
          expectedRevision: "0",
          clientRequestId: crypto.randomUUID(),
          original,
          billTo: { ...original, name: "Requested" },
          reason: "guest company",
        },
        "front_desk",
      );
      expect(result.outcome).toBe("pending");
      expect(result.billTo).toEqual(original);
      const pending = result.pending as Record<string, unknown>;
      await db.exec("update hotel_guests set full_name='Intervening' where full_name='Original'");
      await expect(
        call("hotelhub_bill_to_change_decide", {
          requestId: pending.id,
          expectedVersion: pending.version,
          decision: "approve",
        }),
      ).rejects.toThrow("bill_to_changed");
      await db.exec("update hotel_guests set full_name='Original' where full_name='Intervening'");
      expect(
        (
          await call("hotelhub_bill_to_change_decide", {
            requestId: pending.id,
            expectedVersion: pending.version,
            decision: "approve",
          })
        ).state,
      ).toBe("applied");
      expect(
        (await db.query<{ name: string }>("select name from hotel_folio_bill_to")).rows[0]!.name,
      ).toBe("Requested");
    });
    it("local direct mode remains tenant/stage scoped and idempotent for FrontDesk", async () => {
      await call("hotelhub_change_policy_set", {
        expectedRevision: "2",
        depositApprovalRequired: false,
        contactApprovalRequired: false,
      });
      const original = {
        name: "Requested",
        company: "",
        address: "",
        phone: "0100000000",
        email: "old@example.test",
      };
      const input = {
        reservationId: R,
        expectedRevision: "1",
        clientRequestId: crypto.randomUUID(),
        original,
        billTo: { ...original, name: "Direct" },
      };
      expect((await call("hotelhub_bill_to_change_save", input, "front_desk")).outcome).toBe(
        "applied",
      );
      expect(
        (await call("hotelhub_bill_to_change_save", input, "front_desk")).effectiveRevision,
      ).toBe("2");
      await db.exec("update hotel_reservations set status='checked_out'");
      await expect(
        call(
          "hotelhub_bill_to_change_save",
          { ...input, clientRequestId: crypto.randomUUID() },
          "front_desk",
        ),
      ).rejects.toThrow("bill_to_locked");
    });

    it("tightened policy requires real approval before a previously direct-authorized proposal can dispatch", async () => {
      const tenant = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        res = "88888888-8888-4888-8888-888888888888",
        dep = "99999999-9999-4999-8999-999999999999";
      await db.query(
        "insert into hotel_reservations(tenant_id,id,status) values($1,$2,'checked_in')",
        [tenant, res],
      );
      await db.query("insert into hotel_reservation_deposits values($1,$2,$3,'posted')", [
        tenant,
        dep,
        res,
      ]);
      await call(
        "hotelhub_change_policy_set",
        { expectedRevision: "0", depositApprovalRequired: false, contactApprovalRequired: false },
        "owner",
        tenant,
      );
      const original = receiptSnapshot();
      const proposal = {
        kind: "correction",
        amountCents: 6500,
        accountId: original.paymentLines[0]!.accountId,
        contact: original.contact,
      };
      const q = await call(
        "hotelhub_receipt_control_v2_create",
        {
          reservationId: res,
          depositId: dep,
          clientRequestId: crypto.randomUUID(),
          fingerprint: "second-proposal-hash-0000001",
          reason: "new amount",
          original,
          proposal,
          comparison: { fields: [], depositDeltaCents: 1500, balanceDeltaCents: -1500 },
          policyRevision: "1",
        },
        "owner",
        tenant,
      );
      const direct = await call(
        "hotelhub_receipt_control_v2_authorize",
        { requestId: q.id, expectedVersion: q.version, kind: "direct_policy", policyRevision: "1" },
        "owner",
        tenant,
      );
      await call(
        "hotelhub_change_policy_set",
        { expectedRevision: "1", depositApprovalRequired: true, contactApprovalRequired: false },
        "owner",
        tenant,
      );
      await expect(
        call(
          "hotelhub_receipt_control_v2_reserve",
          {
            requestId: q.id,
            expectedVersion: direct.version,
            payloadHash: "second-payload-hash-0000001",
            policyRevision: "2",
          },
          "owner",
          tenant,
        ),
      ).rejects.toThrow("approval_required");
      const approved = await call(
        "hotelhub_receipt_control_v2_authorize",
        {
          requestId: q.id,
          expectedVersion: direct.version,
          kind: "manual_approval",
          policyRevision: "2",
        },
        "owner",
        tenant,
      );
      expect(approved.approved_at).not.toBe(null);
      expect(
        (
          await call(
            "hotelhub_receipt_control_v2_reserve",
            {
              requestId: q.id,
              expectedVersion: approved.version,
              payloadHash: "second-payload-hash-0000001",
              policyRevision: "2",
            },
            "owner",
            tenant,
          )
        ).dispatchGranted,
      ).toBe(true);
    });
    it("attempt payload and local proposal are immutable after creation", async () => {
      await expect(
        db.exec("update hotel_receipt_edit_attempts set payload_hash='tampered-payload-hash'"),
      ).rejects.toThrow("receipt_control_immutable");
      await expect(
        db.exec(
          'update hotel_bill_to_change_requests set requested=\'{"name":"tampered"}\'::jsonb',
        ),
      ).rejects.toThrow("receipt_control_immutable");
    });
  },
);
it.skipIf(!nativeUrl)(
  "two native connections grant exactly one dispatch under a real row-lock barrier",
  async () => {
    const mod = await import(/* @vite-ignore */ nativeModule!);
    const Client = mod.Client ?? mod.default.Client;
    const left = new Client({ connectionString: nativeUrl });
    const right = new Client({ connectionString: nativeUrl });
    await left.connect();
    await right.connect();
    try {
      const tenant = crypto.randomUUID(),
        reservation = crypto.randomUUID(),
        deposit = crypto.randomUUID();
      await db.query("insert into hotel_tenants(id) values($1)", [tenant]);
      await db.query(
        "insert into hotel_reservations(tenant_id,id,status) values($1,$2,'checked_in')",
        [tenant, reservation],
      );
      await db.query("insert into hotel_reservation_deposits values($1,$2,$3,'posted')", [
        tenant,
        deposit,
        reservation,
      ]);
      const original = receiptSnapshot();
      const row = await call(
        "hotelhub_receipt_control_v2_create",
        {
          reservationId: reservation,
          depositId: deposit,
          clientRequestId: crypto.randomUUID(),
          fingerprint: "race-proposal-fingerprint",
          reason: "race test",
          original,
          proposal: {
            kind: "correction",
            amountCents: 6500,
            accountId: original.paymentLines[0]!.accountId,
            contact: original.contact,
          },
          comparison: { fields: [], depositDeltaCents: 1500, balanceDeltaCents: -1500 },
          policyRevision: "0",
        },
        "owner",
        tenant,
      );
      const authorized = await call(
        "hotelhub_receipt_control_v2_authorize",
        {
          requestId: row.id,
          expectedVersion: row.version,
          kind: "manual_approval",
          policyRevision: "0",
        },
        "owner",
        tenant,
      );
      const query =
        "select public.hotelhub_receipt_control_v2_reserve($1::uuid,$2::text,$3::text,$4::jsonb) as result";
      const values = [
        tenant,
        "owner-1",
        "owner",
        JSON.stringify({
          requestId: row.id,
          expectedVersion: authorized.version,
          payloadHash: "race-payload-fingerprint",
          policyRevision: "0",
        }),
      ];
      await left.query("BEGIN");
      const granted = await left.query(query, values);
      const pid = (await right.query("select pg_backend_pid() as pid")).rows[0].pid;
      const waiting = right.query(query, values);
      const deadline = Date.now() + 5000;
      let locked = false;
      while (Date.now() < deadline) {
        const activity = await db.query<{ wait_event_type: string }>(
          "select wait_event_type from pg_stat_activity where pid=$1",
          [pid],
        );
        if (activity.rows[0]?.wait_event_type === "Lock") {
          locked = true;
          break;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      // Release even if barrier observation failed, so no hanging connection.
      await left.query("COMMIT");
      const denied = await waiting;
      expect(locked).toBe(true);
      expect(granted.rows[0].result.dispatchGranted).toBe(true);
      expect(denied.rows[0].result.dispatchGranted).toBe(false);
      expect(
        (
          await db.query<{ count: number }>(
            "select count(*)::integer as count from hotel_receipt_edit_attempts where tenant_id=$1",
            [tenant],
          )
        ).rows[0]!.count,
      ).toBe(1);
    } finally {
      await left.query("ROLLBACK");
      await left.end();
      await right.end();
    }
  },
  15000,
);
