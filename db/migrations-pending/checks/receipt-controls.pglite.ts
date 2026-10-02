/* eslint-disable @typescript-eslint/no-explicit-any -- standalone SQL check script */
/**
 * Real-SQL check for the staged receipt-controls migrations, run against an
 * in-process Postgres (PGlite) — never against the connected database.
 * Run: NODE_PATH=/tmp/pg/node_modules bun db/migrations-pending/checks/receipt-controls.pglite.ts
 * PGlite is single-connection: concurrency is exercised as interleaved
 * transactions/unique-index races, not true parallel sessions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — dev-only dependency resolved via NODE_PATH, not a project dependency.
import { PGlite } from "@electric-sql/pglite";

const dir = join(import.meta.dir, "..");
const T = "00000000-0000-4000-8000-000000000001";
const R = "00000000-0000-4000-8000-000000000002";
const D = "00000000-0000-4000-8000-000000000003";
const T2 = "00000000-0000-4000-8000-000000000011";
const R2 = "00000000-0000-4000-8000-000000000012";
const D2 = "00000000-0000-4000-8000-000000000013";
let failures = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}
async function throws(db: any, sql: string, params: unknown[], code: string) {
  try {
    await db.query(sql, params);
    return false;
  } catch (e: any) {
    return String(e?.message ?? "").includes(code);
  }
}

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.hotel_tenants (id uuid PRIMARY KEY);
  CREATE TABLE public.hotel_reservations (id uuid PRIMARY KEY, tenant_id uuid, CONSTRAINT hotel_reservations_tenant_id_uk UNIQUE (tenant_id, id));
  CREATE TABLE public.hotel_reservation_deposits (id uuid PRIMARY KEY, tenant_id uuid, reservation_id uuid, status text);
  INSERT INTO public.hotel_tenants VALUES ('${T}'), ('${T2}');
  INSERT INTO public.hotel_reservations VALUES ('${R2}', '${T2}');
  INSERT INTO public.hotel_reservation_deposits VALUES ('${D2}', '${T2}', '${R2}', 'posted');
  INSERT INTO public.hotel_reservations VALUES ('${R}', '${T}');
  INSERT INTO public.hotel_reservation_deposits VALUES ('${D}', '${T}', '${R}', 'posted');
`);
await db.exec(readFileSync(join(dir, "20261002110000_hh_receipt_controls.sql"), "utf8"));
await db.exec(readFileSync(join(dir, "20261002110100_hh_receipt_alert_outbox.sql"), "utf8"));
check("both migrations apply on a clean schema", true);

const create = `SELECT * FROM public.hotelhub_receipt_control_create($1,$2,$3,$4,$5,'correction','Wrong amount keyed',
  '{"amountCents":5000}','{"amountCents":8000}','[]',5000,8000,'fd-1')`;
const k1 = "00000000-0000-4000-8000-0000000000a1";
const r1 = (await db.query(create, [T, R, D, k1, "f".repeat(64)])).rows[0] as any;
check("create returns pending v1", r1.state === "pending" && r1.version === 1);
const again = (await db.query(create, [T, R, D, k1, "f".repeat(64)])).rows[0] as any;
check("same client key + fingerprint replays the same row", again.id === r1.id);
check(
  "same key, different fingerprint conflicts",
  await throws(db, create, [T, R, D, k1, "e".repeat(64)], "receipt_control_key_conflict"),
);
check(
  "second active request for the deposit is refused",
  await throws(
    db,
    create,
    [T, R, D, "00000000-0000-4000-8000-0000000000a2", "d".repeat(64)],
    "receipt_control_active_exists",
  ),
);
check(
  "reason/proposal are immutable",
  await throws(
    db,
    `UPDATE public.hotel_receipt_control_requests SET reason='x' WHERE id=$1`,
    [r1.id],
    "receipt_control_immutable",
  ),
);
check(
  "request rows cannot be deleted",
  await throws(
    db,
    `DELETE FROM public.hotel_receipt_control_requests WHERE id=$1`,
    [r1.id],
    "receipt_control_immutable",
  ),
);
const outbox1 = await db.query(
  `SELECT count(*)::int n FROM public.hotel_receipt_alert_outbox WHERE request_id=$1`,
  [r1.id],
);
check("pending alert queued exactly once", (outbox1.rows[0] as any).n === 1);

const decide = `SELECT * FROM public.hotelhub_receipt_control_decide($1,$2,$3,$4,$5,$6,null,null)`;
check(
  "stale version is refused",
  await throws(
    db,
    decide,
    [T, r1.id, 9, "approve", "approved_awaiting_n3", "owner-1"],
    "version_conflict",
  ),
);
const a = (await db.query(decide, [T, r1.id, 1, "approve", "approved_awaiting_n3", "owner-1"]))
  .rows[0] as any;
check(
  "approve moves to approved_awaiting_n3 v2",
  a.state === "approved_awaiting_n3" && a.version === 2,
);
check(
  "double approval is refused (stale version)",
  await throws(
    db,
    decide,
    [T, r1.id, 1, "approve", "approved_awaiting_n3", "owner-2"],
    "version_conflict",
  ),
);
const dec = (
  await db.query(`SELECT * FROM public.hotel_receipt_control_decisions WHERE request_id=$1`, [
    r1.id,
  ])
).rows as any[];
check(
  "decision records requester and approver separately",
  dec[0].requester_n3_user_key === "fd-1" &&
    dec[0].actor_n3_user_key === "owner-1" &&
    dec[0].self_approved === false,
);
check(
  "decisions are append-only",
  await throws(
    db,
    `UPDATE public.hotel_receipt_control_decisions SET note='x'`,
    [],
    "receipt_control_immutable",
  ),
);
const versionsAfterApprove = await db.query(
  `SELECT count(*)::int n FROM public.hotel_receipt_versions`,
);
check(
  "approval alone writes no effective receipt version",
  (versionsAfterApprove.rows[0] as any).n === 0,
);

const claim = `SELECT public.hotelhub_receipt_control_claim($1,$2,$3,'verify',$4) AS id`;
const c1 = ((await db.query(claim, [T, r1.id, 2, "owner-1"])).rows[0] as any).id;
const c2 = ((await db.query(claim, [T, r1.id, 2, "owner-1"])).rows[0] as any).id;
check("first claim wins, duplicate claim gets nothing", !!c1 && c2 === null);
const complete = `SELECT * FROM public.hotelhub_receipt_control_complete($1,$2,$3,$4,$5,'owner-1',$6)`;
check(
  "applied without version evidence is refused",
  await throws(db, complete, [T, r1.id, c1, "applied", "verified", null], "invalid_transition"),
);
const done = (
  await db.query(complete, [
    T,
    r1.id,
    c1,
    "applied",
    "verified",
    JSON.stringify({
      state: "active",
      receiptId: "rcpt",
      docCode: "OR-TEST",
      documentDate: "2026-10-02",
      currency: "MYR",
      amountCents: 8000,
      paymentLines: [],
      replacementOf: null,
      fingerprint: "a".repeat(64),
    }),
  ])
).rows[0] as any;
check("verified completion applies the request", done.state === "applied");
const v = (await db.query(`SELECT * FROM public.hotel_receipt_versions`)).rows as any[];
check(
  "exactly one receipt version recorded",
  v.length === 1 && Number(v[0].amount_cents) === 8000 && v[0].version_no === 1,
);
check(
  "receipt versions are append-only",
  await throws(
    db,
    `UPDATE public.hotel_receipt_versions SET amount_cents=1`,
    [],
    "receipt_control_immutable",
  ),
);
check(
  "completing the same claim twice is refused",
  await throws(db, complete, [T, r1.id, c1, "needs_review", "x", null], "claim_not_found"),
);

// Unmatched evidence path → needs_review + failure alert.
const r2 = (
  await db.query(
    create
      .replace("'correction'", "'void'")
      .replace("8000,'fd-1'", "null,'fd-1'")
      .replace("'{\"amountCents\":8000}'", "'{}'"),
    [T, R, D, "00000000-0000-4000-8000-0000000000a3", "c".repeat(64)],
  )
).rows[0] as any;
await db.query(decide, [T, r2.id, 1, "approve", "approved_awaiting_n3", "fd-1"]);
const c3 = ((await db.query(claim, [T, r2.id, 2, "fd-1"])).rows[0] as any).id;
const nr = (await db.query(complete, [T, r2.id, c3, "needs_review", "n3_receipt_missing", null]))
  .rows[0] as any;
check(
  "missing evidence holds Needs review, no version",
  nr.state === "needs_review" &&
    (
      (
        await db.query(
          `SELECT count(*)::int n FROM public.hotel_receipt_versions WHERE request_id=$1`,
          [r2.id],
        )
      ).rows[0] as any
    ).n === 0,
);
const selfDec = (
  await db.query(
    `SELECT self_approved FROM public.hotel_receipt_control_decisions WHERE request_id=$1 AND decision='approve'`,
    [r2.id],
  )
).rows[0] as any;
check("self-approval is flagged in the audit trail", selfDec.self_approved === true);
const fa = await db.query(
  `SELECT count(*)::int n FROM public.hotel_receipt_alert_outbox WHERE request_id=$1 AND event='execution_failure'`,
  [r2.id],
);
check("failure alert queued once", (fa.rows[0] as any).n === 1);
check(
  "Needs review blocks a new conflicting request",
  await throws(
    db,
    create,
    [T, R, D, "00000000-0000-4000-8000-0000000000a4", "b".repeat(64)],
    "receipt_control_active_exists",
  ),
);

// Outbox delivery claim (migration 2).
const claimAlerts = `SELECT * FROM public.hotelhub_receipt_alert_claim($1, 10)`;
const al = (await db.query(claimAlerts, [T])).rows as any[];
const al2 = (await db.query(claimAlerts, [T])).rows as any[];
check("alert claim hands out each alert once", al.length > 0 && al2.length === 0);

// ---- Review blockers (independent review of 15bf) ----
check(
  "compound FK: request cannot point at another tenant's reservation/deposit",
  await throws(
    db,
    `INSERT INTO public.hotel_receipt_control_requests (tenant_id, reservation_id, deposit_id, client_request_id,
      request_fingerprint, kind, reason, original, proposal, comparison, original_amount_cents, requested_by_n3_user_key)
     VALUES ($1,$2,$3,gen_random_uuid(),$4,'void','x','{}','{}','{}',5000,'u')`,
    [T, R2, D2, "a".repeat(64)],
    "foreign key",
  ),
);
check(
  "compound FK: deposit must belong to the stated reservation",
  await throws(
    db,
    `INSERT INTO public.hotel_receipt_control_requests (tenant_id, reservation_id, deposit_id, client_request_id,
      request_fingerprint, kind, reason, original, proposal, comparison, original_amount_cents, requested_by_n3_user_key)
     VALUES ($1,$2,$3,gen_random_uuid(),$4,'void','x','{}','{}','{}',5000,'u')`,
    [T2, R2, D, "a".repeat(64)],
    "foreign key",
  ),
);
check(
  "compound FK: receipt version deposit must equal the request's deposit",
  await throws(
    db,
    `INSERT INTO public.hotel_receipt_versions (tenant_id, deposit_id, request_id, version_no, state, receipt_id,
      doc_code, document_date, currency, amount_cents, payment_lines, evidence_fingerprint, verified_by_n3_user_key)
     VALUES ($1,$2,$3,99,'active','x','d','2026-10-01','MYR',1,'[]','f','u')`,
    [T2, D2, r1.id],
    "foreign key",
  ),
);
const astral = "\u{1F600}"; // 2 UTF-16 units each
const utf = (await db.query(`SELECT public.hotelhub_utf16_length($1) a, public.hotelhub_utf16_length($2) b`, [
  astral.repeat(250),
  "é".repeat(500),
])).rows[0] as any;
check("UTF-16 length counts astral chars as two units", utf.a === 500 && utf.b === 500);
const D3 = "00000000-0000-4000-8000-000000000023";
await db.query(`INSERT INTO public.hotel_reservation_deposits VALUES ($1,$2,$3,'posted')`, [D3, T, R]);
const createAt = `SELECT * FROM public.hotelhub_receipt_control_create($1,$2,$3,gen_random_uuid(),$4,'void',$5,
  '{}','{}','[]',5000,null,'fd-1')`;
check(
  "RPC refuses a reason over 500 UTF-16 units (251 astral chars)",
  await throws(db, createAt, [T, R, D3, "9".repeat(64), astral.repeat(251)], "invalid_reason"),
);
check(
  "RPC refuses an untrimmed reason",
  await throws(db, createAt, [T, R, D3, "9".repeat(64), " padded "], "invalid_reason"),
);
const r3 = (await db.query(createAt, [T, R, D3, "8".repeat(64), astral.repeat(250)])).rows[0] as any;
check("RPC accepts exactly 500 UTF-16 units", r3.state === "pending");
check(
  "execution mode is immutable",
  await throws(
    db,
    `UPDATE public.hotel_receipt_control_requests SET execution_mode='direct' WHERE id=$1`,
    [r3.id],
    "receipt_control_immutable",
  ),
);
const held = (await db.query(decide, [T, r3.id, 1, "hold", "needs_review", "owner-1"])).rows[0] as any;
check("Hold sets no approval", held.state === "needs_review" && held.approved_at === null);
check(
  "pending -> Hold -> Needs review cannot be claimed for verify",
  await throws(db, claim, [T, r3.id, held.version, "owner-1"], "not_approved"),
);
await db.query(decide, [T, r3.id, held.version, "reject", "rejected", "owner-1"]);

// Approved void: confirmed void evidence recorded even though the step fails.
const D4 = "00000000-0000-4000-8000-000000000024";
await db.query(`INSERT INTO public.hotel_reservation_deposits VALUES ($1,$2,$3,'posted')`, [D4, T, R]);
const r4 = (await db.query(createAt, [T, R, D4, "7".repeat(64), "Duplicate"])).rows[0] as any;
const a4 = (await db.query(decide, [T, r4.id, 1, "approve", "approved_awaiting_n3", "owner-1"])).rows[0] as any;
check("approval records approver once", a4.approved_by_n3_user_key === "owner-1" && !!a4.approved_at);
check(
  "approval cannot be rewritten",
  await throws(
    db,
    `UPDATE public.hotel_receipt_control_requests SET approved_by_n3_user_key='x' WHERE id=$1`,
    [r4.id],
    "receipt_control_immutable",
  ),
);
check(
  "manual mode refuses a write step claim",
  await throws(
    db,
    `SELECT public.hotelhub_receipt_control_claim($1,$2,$3,'void',$4)`,
    [T, r4.id, a4.version, "owner-1"],
    "automation_unavailable",
  ),
);
const c4 = ((await db.query(claim, [T, r4.id, a4.version, "owner-1"])).rows[0] as any).id;
// Simulate a concurrent version bump: completion against a stale claim is refused.
await db.exec(`ALTER TABLE public.hotel_receipt_control_requests DISABLE TRIGGER hotel_receipt_control_requests_guard`);
await db.query(`UPDATE public.hotel_receipt_control_requests SET version = version + 1 WHERE id=$1`, [r4.id]);
check(
  "completion with a stale claim version is refused",
  await throws(db, complete, [T, r4.id, c4, "needs_review", "x", null], "claim_stale"),
);
await db.query(`UPDATE public.hotel_receipt_control_requests SET version = version - 1 WHERE id=$1`, [r4.id]);
await db.exec(`ALTER TABLE public.hotel_receipt_control_requests ENABLE TRIGGER hotel_receipt_control_requests_guard`);
const voidedV = JSON.stringify({
  state: "voided", receiptId: "rv", docCode: "OR-V", documentDate: "2026-10-01", currency: "MYR",
  amountCents: 5000, paymentLines: [], replacementOf: null, fingerprint: "b".repeat(64),
});
const activeV = voidedV.replace('"voided"', '"active"');
check(
  "a failed outcome cannot carry ACTIVE (financial success) evidence",
  await throws(db, complete, [T, r4.id, c4, "failed", "replacement_failed", activeV], "invalid_transition"),
);
const f4 = (await db.query(complete, [T, r4.id, c4, "failed", "replacement_failed", voidedV])).rows[0] as any;
const v4 = (await db.query(`SELECT state FROM public.hotel_receipt_versions WHERE request_id=$1`, [r4.id])).rows as any[];
check(
  "confirmed void evidence is recorded even when the replacement step fails",
  f4.state === "failed" && v4.length === 1 && v4[0].state === "voided",
);

// Alert fencing: a stale worker cannot settle a newer claim.
await db.query(`UPDATE public.hotel_receipt_alert_outbox SET status='pending', next_attempt_at=now() - interval '1 minute', claim_token=null`);
const fresh = (await db.query(claimAlerts, [T])).rows as any[];
const target = fresh[0];
const settle = `SELECT public.hotelhub_receipt_alert_settle($1,$2,$3,'disabled','transport_not_configured')`;
check(
  "settle without the claim token is refused",
  await throws(db, settle, [T, target.id, null], "alert_not_claimed"),
);
// Stale takeover: the claim expires and another worker re-claims.
await db.query(`UPDATE public.hotel_receipt_alert_outbox SET claimed_at = now() - interval '11 minutes' WHERE id=$1`, [target.id]);
const retaken = (await db.query(claimAlerts, [T])).rows as any[];
const newer = retaken.find((r) => r.id === target.id);
check("stale claim is re-issued with a new token", !!newer && newer.claim_token !== target.claim_token);
check(
  "the stale worker's old token cannot settle the newer claim",
  await throws(db, settle, [T, target.id, target.claim_token], "alert_not_claimed"),
);
await db.query(settle, [T, target.id, newer.claim_token]);
const settled = (await db.query(`SELECT status, claim_token FROM public.hotel_receipt_alert_outbox WHERE id=$1`, [target.id])).rows[0] as any;
check("current token settles as disabled (no provider)", settled.status === "disabled" && settled.claim_token === null);

const grants =
  await db.query(`SELECT has_table_privilege('anon','public.hotel_receipt_control_requests','SELECT') a,
  has_table_privilege('authenticated','public.hotel_receipt_versions','SELECT') b,
  has_function_privilege('authenticated','public.hotelhub_receipt_control_decide(uuid,uuid,integer,text,text,text,text,text)','EXECUTE') c`);
const g = grants.rows[0] as any;
check("browser roles have no table or function access", !g.a && !g.b && !g.c);

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
