/* eslint-disable @typescript-eslint/no-explicit-any -- standalone SQL check script */
/**
 * TRUE multi-session check of the staged receipt-controls migrations against a
 * throwaway PostgreSQL server started in /tmp (never the connected database).
 * Run: PG_URL=postgres://postgres@localhost/rcms?host=/tmp/rpg&port=55432 bun db/migrations-pending/checks/receipt-controls.multisession.ts
 * Each session is a separate server backend (separate connection/transaction).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SQL } from "bun";

const url = process.env.PG_URL!;
const dir = join(import.meta.dir, "..");
const T = "00000000-0000-4000-8000-000000000001";
const R = "00000000-0000-4000-8000-000000000002";
let failures = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "PASS" : "FAIL"} ${n}`); if (!ok) failures++; };
const pool = new SQL({ url, max: 30 });
const q = (s: string, p: unknown[] = []) => pool.unsafe(s, p as any[]);
const errOf = async (p: Promise<any>) => { try { await p; return "ok"; } catch (e: any) { return String(e?.message ?? e); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await q(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).simple();
await q(`DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE public.hotel_tenants (id uuid PRIMARY KEY);
  CREATE TABLE public.hotel_reservations (id uuid PRIMARY KEY, tenant_id uuid, CONSTRAINT hotel_reservations_tenant_id_uk UNIQUE (tenant_id, id));
  CREATE TABLE public.hotel_reservation_deposits (id uuid PRIMARY KEY, tenant_id uuid, reservation_id uuid, status text);
  INSERT INTO public.hotel_tenants VALUES ('${T}');
  INSERT INTO public.hotel_reservations VALUES ('${R}', '${T}');`).simple();
await q(readFileSync(join(dir, "20261002110000_hh_receipt_controls.sql"), "utf8")).simple();
await q(readFileSync(join(dir, "20261002110100_hh_receipt_alert_outbox.sql"), "utf8")).simple();
check("both staged migrations apply on real PostgreSQL", true);

let n = 0;
async function newRequest() {
  n++;
  const d = `00000000-0000-4000-8000-${String(900000000000 + n)}`;
  await q(`INSERT INTO public.hotel_reservation_deposits VALUES ($1,$2,$3,'posted')`, [d, T, R]);
  const [r] = await q(`SELECT * FROM public.hotelhub_receipt_control_create($1,$2,$3,gen_random_uuid(),$4,'void','Multi-session',
    '{}','{}','[]',5000,null,'fd-1')`, [T, R, d, String(n).padStart(64, "0")]);
  return { ...r, deposit: d };
}
const decide = (c: any, id: string, ver: number, dec: string, to: string, actor = "owner-1") =>
  c.unsafe(`SELECT * FROM public.hotelhub_receipt_control_decide($1,$2,$3,$4,$5,$6,null,null)`, [T, id, ver, dec, to, actor]);
const ev = (fp: string) => JSON.stringify({ state: "voided", receiptId: "r" + fp, docCode: "OR", documentDate: "2026-10-02",
  currency: "MYR", amountCents: 0, paymentLines: [], replacementOf: null, fingerprint: fp.padEnd(64, "0") });
const atomic = (c: any, id: string, ver: number, fp: string) =>
  c.unsafe(`SELECT * FROM public.hotelhub_receipt_control_verify_atomic($1,$2,$3,'owner-1','applied','verified',$4::text::jsonb)`, [T, id, ver, ev(fp)]);

// 1. 20 parallel sessions race verify_atomic on one approved request.
{
  const r = await newRequest();
  const [a] = await decide(pool, r.id, 1, "approve", "approved_awaiting_n3");
  const res = await Promise.all(Array.from({ length: 20 }, (_, i) => errOf(atomic(pool, r.id, a.version, "a" + i))));
  const ok = res.filter((x) => x === "ok").length;
  const [c] = await q(`SELECT (SELECT count(*)::int FROM public.hotel_receipt_versions WHERE request_id=$1) v,
    (SELECT count(*)::int FROM public.hotel_receipt_control_executions WHERE request_id=$1) e,
    (SELECT count(*)::int FROM public.hotel_receipt_control_decisions WHERE request_id=$1 AND decision='verify') d`, [r.id]);
  check(`20 concurrent verify_atomic: exactly 1 wins (${ok}), rest claim_conflict`, ok === 1 && res.filter((x) => x.includes("claim_conflict")).length === 19);
  check("20 concurrent verify_atomic: one version, one execution, one verify decision", c.v === 1 && c.e === 1 && c.d === 1);
}

// 2. 10 parallel approvals of one pending request.
{
  const r = await newRequest();
  const res = await Promise.all(Array.from({ length: 10 }, (_, i) => errOf(decide(pool, r.id, 1, "approve", "approved_awaiting_n3", "owner-" + i))));
  const [c] = await q(`SELECT count(*)::int n FROM public.hotel_receipt_control_decisions WHERE request_id=$1`, [r.id]);
  check("10 concurrent approvals: exactly 1 succeeds, 9 version_conflict, 1 decision row",
    res.filter((x) => x === "ok").length === 1 && res.filter((x) => x.includes("version_conflict")).length === 9 && c.n === 1);
}

// 3. Reject from session B while session A holds an uncommitted claim (approved Needs review).
{
  const r = await newRequest();
  const [a] = await decide(pool, r.id, 1, "approve", "approved_awaiting_n3");
  const [h] = await decide(pool, r.id, a.version, "hold", "needs_review");
  const A = await pool.reserve(); const B = await pool.reserve();
  await A.unsafe("BEGIN");
  const [{ id: exec }] = await A.unsafe(`SELECT public.hotelhub_receipt_control_claim($1,$2,$3,'verify','owner-1') AS id`, [T, r.id, h.version]);
  const bP = errOf(decide(B, r.id, h.version + 1, "reject", "rejected", "owner-2"));
  await sleep(300);
  const [lock] = await q(`SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock'`);
  check("reject in session B blocks on session A's row lock while claim is uncommitted", lock.n >= 1);
  await A.unsafe("COMMIT");
  const bRes = await bP;
  check("after A commits its claim, B's reject is refused claim_conflict", bRes.includes("claim_conflict"));
  const [st] = await q(`SELECT state FROM public.hotel_receipt_control_requests WHERE id=$1`, [r.id]);
  check("request still needs_review (not rejected, active index not freed)", st.state === "needs_review");
  const [done] = await q(`SELECT * FROM public.hotelhub_receipt_control_complete($1,$2,$3,'applied','verified','owner-1',$4::text::jsonb)`, [T, r.id, exec, ev("b")]);
  check("claimed worker then completes on its fenced version", done.state === "applied");
  A.release(); B.release();
}

// 4. Recovery (session B) racing the old worker's complete (session C).
{
  const r = await newRequest();
  const [a] = await decide(pool, r.id, 1, "approve", "approved_awaiting_n3");
  const [{ id: oldExec }] = await q(`SELECT public.hotelhub_receipt_control_claim($1,$2,$3,'verify','owner-1') AS id`, [T, r.id, a.version]);
  await q(`UPDATE public.hotel_receipt_control_executions SET created_at = now() - interval '6 minutes' WHERE id=$1`, [oldExec]);
  const B = await pool.reserve(); const C = await pool.reserve();
  await B.unsafe("BEGIN");
  await B.unsafe(`SELECT * FROM public.hotelhub_receipt_control_recover($1,$2,$3,'owner-1',300)`, [T, r.id, a.version + 1]);
  const cP = errOf(C.unsafe(`SELECT * FROM public.hotelhub_receipt_control_complete($1,$2,$3,'applied','verified','owner-1',$4::text::jsonb)`, [T, r.id, oldExec, ev("c")]));
  await sleep(300);
  await B.unsafe("COMMIT");
  const cRes = await cP;
  check("old worker's complete racing a committed recovery is refused claim_not_found", cRes.includes("claim_not_found"));
  const [c] = await q(`SELECT r.state, r.approved_at IS NOT NULL ap, (SELECT count(*)::int FROM public.hotel_receipt_versions WHERE request_id=$1) v
    FROM public.hotel_receipt_control_requests r WHERE id=$1`, [r.id]);
  check("after race: approved_awaiting_n3, approval kept, no version written", c.state === "approved_awaiting_n3" && c.ap && c.v === 0);
  B.release(); C.release();
}

// 5. Old worker's complete committing first, recovery second.
{
  const r = await newRequest();
  const [a] = await decide(pool, r.id, 1, "approve", "approved_awaiting_n3");
  const [{ id: oldExec }] = await q(`SELECT public.hotelhub_receipt_control_claim($1,$2,$3,'verify','owner-1') AS id`, [T, r.id, a.version]);
  await q(`UPDATE public.hotel_receipt_control_executions SET created_at = now() - interval '6 minutes' WHERE id=$1`, [oldExec]);
  const C = await pool.reserve(); const B = await pool.reserve();
  await C.unsafe("BEGIN");
  await C.unsafe(`SELECT * FROM public.hotelhub_receipt_control_complete($1,$2,$3,'applied','verified','owner-1',$4::text::jsonb)`, [T, r.id, oldExec, ev("d")]);
  const bP = errOf(B.unsafe(`SELECT * FROM public.hotelhub_receipt_control_recover($1,$2,$3,'owner-1',300)`, [T, r.id, a.version + 1]));
  await sleep(300);
  await C.unsafe("COMMIT");
  const bRes = await bP;
  check("recovery after a committed completion is refused (version_conflict), applied stays applied", bRes.includes("version_conflict"));
  C.release(); B.release();
}

// 6. 10 parallel creates for one deposit with different keys; 10 parallel with the same key.
{
  n++;
  const d = `00000000-0000-4000-8000-${String(900000000000 + n)}`;
  await q(`INSERT INTO public.hotel_reservation_deposits VALUES ($1,$2,$3,'posted')`, [d, T, R]);
  const mk = (key: string, fp: string) => errOf(q(`SELECT * FROM public.hotelhub_receipt_control_create($1,$2,$3,$4,$5,'void','Race',
    '{}','{}','[]',5000,null,'fd-1')`, [T, R, d, key, fp]));
  const res = await Promise.all(Array.from({ length: 10 }, (_, i) => mk(crypto.randomUUID(), String(i).padStart(64, "f"))));
  check("10 concurrent creates, different keys: exactly 1 active request",
    res.filter((x) => x === "ok").length === 1 && res.filter((x) => x.includes("active_exists") || x.includes("duplicate key")).length === 9);
  n++;
  const d2 = `00000000-0000-4000-8000-${String(900000000000 + n)}`;
  await q(`INSERT INTO public.hotel_reservation_deposits VALUES ($1,$2,$3,'posted')`, [d2, T, R]);
  const key = crypto.randomUUID();
  const same = await Promise.all(Array.from({ length: 10 }, () => errOf(q(`SELECT * FROM public.hotelhub_receipt_control_create($1,$2,$3,$4,$5,'void','Race',
    '{}','{}','[]',5000,null,'fd-1')`, [T, R, d2, key, "e".repeat(64)]))));
  const [c] = await q(`SELECT count(*)::int n FROM public.hotel_receipt_control_requests WHERE deposit_id=$1`, [d2]);
  console.log("  same-key outcomes:", JSON.stringify([...new Set(same)]));
  check("10 concurrent creates, same key+fingerprint: exactly 1 row stored", c.n === 1);
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await pool.close();
process.exit(failures === 0 ? 0 : 1);
