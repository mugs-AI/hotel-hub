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
const create = (policyRevision = "0") => {
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
    policyRevision,
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
    it("proof permits restrict grants and claim only one dispatch", async () => {
      const data = {
        receiptId: "99999999-9999-4999-8999-999999999999",
        tenantKey: "TEST",
        packageHash: "a".repeat(64),
        payloadHash: "b".repeat(64),
        expiresAt: Date.now() + 60000,
        package: { tenantKey: "TEST" },
        original: receiptSnapshot(),
      };
      const p = await call("hotelhub_receipt_proof_prepare", data);
      expect(p.phase).toBe("prepared");
      await db.exec("SET ROLE authenticated");
      await expect(db.query("select * from hotel_receipt_update_proof_permits")).rejects.toThrow(
        "permission denied",
      );
      await expect(
        call("hotelhub_receipt_proof_claim", { id: p.id, payloadHash: data.payloadHash }),
      ).rejects.toThrow("permission denied");
      await db.exec("RESET ROLE");
      await expect(
        call("hotelhub_receipt_proof_claim", { id: p.id, payloadHash: "c".repeat(64) }),
      ).rejects.toThrow();
      expect(
        await call("hotelhub_receipt_proof_claim", { id: p.id, payloadHash: data.payloadHash }),
      ).toEqual({ dispatchGranted: true });
      expect(
        await call("hotelhub_receipt_proof_claim", { id: p.id, payloadHash: data.payloadHash }),
      ).toEqual({ dispatchGranted: false });
      await call("hotelhub_receipt_proof_finish", {
        id: p.id,
        phase: "unknown",
        report: { outcome: "needs_review" },
      });
      expect(
        await call("hotelhub_receipt_proof_claim", { id: p.id, payloadHash: data.payloadHash }),
      ).toEqual({ dispatchGranted: false });
      await expect(
        call("hotelhub_receipt_proof_prepare", { ...data, packageHash: "d".repeat(64) }),
      ).rejects.toThrow();
      await expect(
        call("hotelhub_receipt_proof_finish", { id: p.id, phase: "prepared" }),
      ).rejects.toThrow();
      await expect(
        db.query("delete from hotel_receipt_update_proof_permits where id=$1", [p.id]),
      ).rejects.toThrow();
    });
    it("proof permits deny other tenants/roles and expiry", async () => {
      const data = {
        receiptId: "88888888-8888-4888-8888-888888888888",
        tenantKey: "TEST",
        packageHash: "e".repeat(64),
        payloadHash: "f".repeat(64),
        expiresAt: Date.now() - 1,
        package: {},
        original: receiptSnapshot(),
      };
      await expect(call("hotelhub_receipt_proof_prepare", data)).rejects.toThrow();
      await expect(
        call(
          "hotelhub_receipt_proof_prepare",
          { ...data, expiresAt: Date.now() + 60000 },
          "front_desk",
        ),
      ).rejects.toThrow("forbidden");
      const p = await call("hotelhub_receipt_proof_prepare", {
        ...data,
        expiresAt: Date.now() + 60000,
      });
      await expect(
        call(
          "hotelhub_receipt_proof_claim",
          { id: p.id, payloadHash: data.payloadHash },
          "owner",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ),
      ).rejects.toThrow();
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
        await db.query<Record<string, unknown>>(
          "select * from hotel_receipt_control_requests where tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and state<>'rejected'",
        )
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
        await db.query<Record<string, unknown>>(
          "select * from hotel_receipt_control_requests where tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and state<>'rejected'",
        )
      ).rows[0]!;
      // The original was created with approval ON. Relaxation must not
      // execute it; close it and create a NEW proposal under the OFF policy.
      await expect(
        call("hotelhub_receipt_control_v2_authorize", {
          requestId: q.id,
          expectedVersion: q.version,
          kind: "direct_policy",
          policyRevision: "1",
        }),
      ).rejects.toThrow("approval_required");
      await call("hotelhub_receipt_control_v2_authorize", {
        requestId: q.id,
        expectedVersion: q.version,
        kind: "reject",
        policyRevision: "1",
      });
      const direct = await create("1");
      const authorized = await call("hotelhub_receipt_control_v2_authorize", {
        requestId: direct.id,
        expectedVersion: direct.version,
        kind: "direct_policy",
        policyRevision: "1",
      });
      expect(authorized.approved_at).toBe(null);
      const first = await call("hotelhub_receipt_control_v2_reserve", {
        requestId: direct.id,
        expectedVersion: authorized.version,
        payloadHash: "sha256-payload-00000001",
        policyRevision: "1",
      });
      expect(first.dispatchGranted).toBe(true);
      expect(
        (
          await call("hotelhub_receipt_control_v2_reserve", {
            requestId: direct.id,
            expectedVersion: authorized.version,
            payloadHash: "sha256-payload-00000001",
            policyRevision: "1",
          })
        ).dispatchGranted,
      ).toBe(false);
    });
    it("does not release an unknown write through legacy recovery/rejection", async () => {
      const q = (
        await db.query<Record<string, unknown>>(
          "select * from hotel_receipt_control_requests where tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and state<>'rejected'",
        )
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
        await db.query<Record<string, unknown>>(
          "select * from hotel_receipt_control_requests where tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and state<>'rejected'",
        )
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

    it("proven no-write rejection can be closed, but its dispatch cannot be reused", async () => {
      const tenant = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const q = (
        await db.query<Record<string, unknown>>(
          "select * from hotel_receipt_control_requests where tenant_id=$1",
          [tenant],
        )
      ).rows[0]!;
      const a = (
        await db.query<Record<string, unknown>>(
          "select * from hotel_receipt_edit_attempts where tenant_id=$1",
          [tenant],
        )
      ).rows[0]!;
      const rejected = await call(
        "hotelhub_receipt_control_v2_settle",
        {
          requestId: q.id,
          attemptId: a.id,
          claimedVersion: a.claimed_version,
          expectedVersion: q.version,
          result: { kind: "rejected_no_write", code: "proven_stale_rejection" },
        },
        "owner",
        tenant,
      );
      await expect(
        call(
          "hotelhub_receipt_control_v2_authorize",
          {
            requestId: q.id,
            expectedVersion: rejected.version,
            kind: "manual_approval",
            policyRevision: "2",
          },
          "owner",
          tenant,
        ),
      ).rejects.toThrow("claim_conflict");
      expect(
        (
          await call(
            "hotelhub_receipt_control_v2_authorize",
            {
              requestId: q.id,
              expectedVersion: rejected.version,
              kind: "reject",
              policyRevision: "2",
            },
            "owner",
            tenant,
          )
        ).state,
      ).toBe("rejected");
      const decision = (
        await db.query<{ from_state: string }>(
          "select from_state from hotel_receipt_control_decisions where tenant_id=$1 and decision='reject'",
          [tenant],
        )
      ).rows[0]!;
      expect(decision.from_state).toBe("needs_review");
    });
    for (const kind of ["manual_approval", "direct_policy"] as const) {
      it(`recovers ${kind} after a pre-dispatch hold without altering authorization or resending an attempt`, async () => {
        const tenant = crypto.randomUUID(),
          res = crypto.randomUUID(),
          dep = crypto.randomUUID();
        await db.query("insert into hotel_tenants values($1)", [tenant]);
        await db.query(
          "insert into hotel_reservations(tenant_id,id,status) values($1,$2,'checked_in')",
          [tenant, res],
        );
        await db.query(
          "insert into hotel_reservation_deposits(tenant_id,id,reservation_id,status) values($1,$2,$3,'posted')",
          [tenant, dep, res],
        );
        const revision = kind === "direct_policy" ? "1" : "0";
        if (kind === "direct_policy")
          await call(
            "hotelhub_change_policy_set",
            {
              expectedRevision: "0",
              depositApprovalRequired: false,
              contactApprovalRequired: false,
            },
            "owner",
            tenant,
          );
        const original = receiptSnapshot();
        const q = await call(
          "hotelhub_receipt_control_v2_create",
          {
            reservationId: res,
            depositId: dep,
            clientRequestId: crypto.randomUUID(),
            fingerprint: "hold-retry-proposal-00000001",
            reason: "correction",
            original,
            proposal: {
              kind: "correction",
              amountCents: 6500,
              accountId: original.paymentLines[0]!.accountId,
              contact: original.contact,
            },
            comparison: { fields: [], depositDeltaCents: 1500, balanceDeltaCents: -1500 },
            policyRevision: revision,
          },
          "owner",
          tenant,
        );
        const a = await call(
          "hotelhub_receipt_control_v2_authorize",
          { requestId: q.id, expectedVersion: q.version, kind, policyRevision: revision },
          "owner",
          tenant,
        );
        const held = await call(
          "hotelhub_receipt_control_v2_hold",
          { requestId: q.id, expectedVersion: a.version, code: "n3_preflight_unavailable" },
          "owner",
          tenant,
        );
        await expect(
          call(
            "hotelhub_receipt_control_v2_authorize",
            { requestId: q.id, expectedVersion: a.version, kind, policyRevision: revision },
            "owner",
            tenant,
          ),
        ).rejects.toThrow("version_conflict");
        const retry = await call(
          "hotelhub_receipt_control_v2_authorize",
          { requestId: q.id, expectedVersion: held.version, kind, policyRevision: revision },
          "owner",
          tenant,
        );
        expect(retry.state).toBe("approved_awaiting_n3");
        expect(retry.version).toBe(Number(held.version) + 1);
        expect(retry.automation_meta).toEqual(a.automation_meta);
        expect(retry.approved_at).toEqual(a.approved_at);
        const history = await db.query<{ count: number }>(
          "select count(*)::integer as count from hotel_receipt_control_decisions where request_id=$1 and outcome_code='pre_dispatch_retry_authorized'",
          [q.id],
        );
        expect(history.rows[0]!.count).toBe(1);
        const reserved = await call(
          "hotelhub_receipt_control_v2_reserve",
          {
            requestId: q.id,
            expectedVersion: retry.version,
            payloadHash: "retry-payload-hash-00000001",
            policyRevision: revision,
          },
          "owner",
          tenant,
        );
        expect(reserved.dispatchGranted).toBe(true);
        await expect(
          call(
            "hotelhub_receipt_control_v2_authorize",
            { requestId: q.id, expectedVersion: retry.version, kind, policyRevision: revision },
            "owner",
            tenant,
          ),
        ).rejects.toThrow("claim_conflict");
      });
    }
    it("policy relaxation cannot directly execute a proposal created under mandatory approval", async () => {
      const tenant = crypto.randomUUID(),
        res = crypto.randomUUID(),
        dep = crypto.randomUUID();
      await db.query("insert into hotel_tenants values($1)", [tenant]);
      await db.query(
        "insert into hotel_reservations(tenant_id,id,status) values($1,$2,'checked_in')",
        [tenant, res],
      );
      await db.query(
        "insert into hotel_reservation_deposits(tenant_id,id,reservation_id,status) values($1,$2,$3,'posted')",
        [tenant, dep, res],
      );
      const original = receiptSnapshot();
      const q = await call(
        "hotelhub_receipt_control_v2_create",
        {
          reservationId: res,
          depositId: dep,
          clientRequestId: crypto.randomUUID(),
          fingerprint: "relaxed-policy-proposal-0001",
          reason: "correction",
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
      await call(
        "hotelhub_change_policy_set",
        { expectedRevision: "0", depositApprovalRequired: false, contactApprovalRequired: false },
        "owner",
        tenant,
      );
      await expect(
        call(
          "hotelhub_receipt_control_v2_authorize",
          {
            requestId: q.id,
            expectedVersion: q.version,
            kind: "direct_policy",
            policyRevision: "1",
          },
          "owner",
          tenant,
        ),
      ).rejects.toThrow("approval_required");
      const approved = await call(
        "hotelhub_receipt_control_v2_authorize",
        {
          requestId: q.id,
          expectedVersion: q.version,
          kind: "manual_approval",
          policyRevision: "1",
        },
        "owner",
        tenant,
      );
      expect(approved.approved_at).not.toBe(null);
    });
    it.skipIf(!nativeUrl)(
      "two native connections grant one receipt and one proof dispatch under real row-lock barriers",
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
          const proof = await call(
            "hotelhub_receipt_proof_prepare",
            {
              receiptId: crypto.randomUUID(),
              packageHash: "1".repeat(64),
              payloadHash: "2".repeat(64),
              expiresAt: Date.now() + 60000,
              package: { tenantKey: "TEST" },
              original,
            },
            "owner",
            tenant,
          );
          const proofQuery =
            "select public.hotelhub_receipt_proof_claim($1::uuid,$2::text,$3::text,$4::jsonb) as result";
          const proofValues = [
            tenant,
            "owner-1",
            "owner",
            JSON.stringify({ id: proof.id, payloadHash: "2".repeat(64) }),
          ];
          await left.query("BEGIN");
          const proofGranted = await left.query(proofQuery, proofValues);
          const proofWaiting = right.query(proofQuery, proofValues);
          let proofLocked = false;
          const proofDeadline = Date.now() + 5000;
          while (Date.now() < proofDeadline) {
            const activity = await db.query<{ wait_event_type: string }>(
              "select wait_event_type from pg_stat_activity where pid=$1",
              [pid],
            );
            if (activity.rows[0]?.wait_event_type === "Lock") {
              proofLocked = true;
              break;
            }
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          await left.query("COMMIT");
          const proofDenied = await proofWaiting;
          expect(proofLocked).toBe(true);
          expect(proofGranted.rows[0].result.dispatchGranted).toBe(true);
          expect(proofDenied.rows[0].result.dispatchGranted).toBe(false);
        } finally {
          await left.query("ROLLBACK");
          await left.end();
          await right.end();
        }
      },
      15000,
    );
  },
);
