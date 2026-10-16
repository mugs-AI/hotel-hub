// Disposable PostgreSQL only. No Lovable/N3 connection or native race claim.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const req = createRequire(resolve(process.env.HH_SQL_TEST_TOOLS, "package.json"));
const native = process.env.HH_ACCOUNTANT_NATIVE_DISPOSABLE === "enabled";
let db;
if (native) {
  const url = new URL(process.env.HH_NATIVE_PG_URL);
  if (
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/hh_accountant_test" ||
    url.username !== "synthetic_test"
  )
    throw new Error("disposable native target required");
  const { Client } = req("pg");
  const client = new Client({
    connectionString: url.toString(),
    application_name: "hh_accountant_single",
  });
  await client.connect();
  const facts = (
    await client.query(
      "select current_database() as db,current_user as actor,current_setting('server_version') as version",
    )
  ).rows[0];
  assert.equal(facts.db, "hh_accountant_test");
  assert.equal(facts.actor, "synthetic_test");
  assert.match(facts.version, /^17\.6(?:\s|$)/);
  db = {
    query: (sql, args) => client.query(sql, args),
    exec: (sql) => client.query(sql),
    close: () => client.end(),
  };
} else {
  const { PGlite } = req("@electric-sql/pglite");
  const { btree_gist } = req("@electric-sql/pglite/contrib/btree_gist");
  db = new PGlite({ extensions: { btree_gist } });
}
const t = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  r = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  i = "44444444-4444-4444-8444-444444444444",
  bill = "22222222-2222-4222-8222-222222222222",
  rid = "ffffffff-ffff-4fff-8fff-ffffffffffff";
let failures = 0;
const query = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
const key = { reservationId: r, intentId: i, kind: "receipt_surplus", documentIds: [rid] };
const stamp = new Date().toISOString();
const observation = {
  available: false,
  checkedAt: stamp,
  evidenceDigest: null,
  observedAmountCents: null,
  outcomeCode: "receipt_remainder_unavailable",
};
const open = (id = "11111111-1111-4111-8111-111111111111", k = key, o = observation) =>
  query(
    "select hotelhub_accountant_case_open($1::uuid,'synthetic-owner',$2::jsonb,$3::jsonb,$4::uuid) as value",
    [t, JSON.stringify(k), JSON.stringify(o), id],
  );
const event = (row, e, request = "12121212-1212-4212-8212-121212121212", proof = null) =>
  query(
    "select hotelhub_accountant_case_event($1::uuid,'synthetic-owner',$2::uuid,$3,$4::jsonb,$5::uuid,$6::jsonb) as value",
    [t, row.caseId, row.version, JSON.stringify(e), request, proof ? JSON.stringify(proof) : null],
  );
async function denied(sql, args, code) {
  await db.exec("savepoint denial");
  let e;
  try {
    await db.query(sql, args);
  } catch (x) {
    e = x;
  }
  await db.exec("rollback to denial; release denial");
  assert.equal(e?.message, code);
}
async function check(name, fn) {
  await db.exec("begin");
  try {
    await fn();
    console.log("PASS " + name);
  } catch (e) {
    failures++;
    console.log("FAIL " + name + ": " + e.message);
  } finally {
    await db.exec("rollback");
  }
}
try {
  await db.exec("SET hotelhub.disposable_test='enabled'; SET check_function_bodies=off");
  await db.exec(readFileSync("db/checks/hh-settlement-setup.sql", "utf8"));
  await db.exec(readFileSync("db/checks/hh-settlement-seed.sql", "utf8"));
  await db.exec("SET check_function_bodies=on");
  await db.exec(
    readFileSync("supabase/migrations/20261003120216_hh_automatic_receipt_controls.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261008080000_hh_billing_settlement.sql", "utf8"),
  );
  // Optional development-only counterexample mode compiles the prior committed
  // schema in the disposable DB. It is expected to fail the added regressions.
  const migration = process.argv.includes("--before-review")
    ? execFileSync(
        "git",
        ["show", "8167d6b:supabase/migrations/20261012032508_hh_accountant_handover.sql"],
        { encoding: "utf8" },
      )
    : readFileSync("supabase/migrations/20261012032508_hh_accountant_handover.sql", "utf8");
  await db.exec(migration);
  const snapshot = {
    tenantId: t,
    reservationId: r,
    digest: "d".repeat(64),
    currency: "MYR",
    billDate: "2026-10-08",
    receipts: [{ receiptId: rid, receiptDate: "2026-09-30", reference: "SYNTHETIC-OR" }],
  };
  await db.query(
    "insert into hotel_settlement_intents(id,tenant_id,reservation_id,client_request_id,snapshot,digest,actor_n3_user_key) values($1,$2,$3,gen_random_uuid(),$4::jsonb,repeat('d',64),'synthetic-owner')",
    [i, t, r, JSON.stringify(snapshot)],
  );
  await check("stable_case_and_request_replay", async () => {
    const first = await open(),
      second = await open();
    assert.deepEqual(first, second);
    assert.equal(await query("select count(*)::int as value from hotel_accountant_cases"), 1);
    assert.equal(await query("select count(*)::int as value from hotel_accountant_case_events"), 1);
  });
  await check("known_OR_number_survives_the_durable_reference_snapshot", async () => {
    await db.query(
      "insert into hotel_settlement_evidence(tenant_id,reservation_id,intent_id,proof_digest,proof) values($1,$2,$3,repeat('a',64),$4::jsonb)",
      [
        t,
        r,
        i,
        JSON.stringify({
          kind: "balance_receipt",
          receipt: { receiptId: rid, code: "SYNTHETIC-OR-123", documentDate: "2026-09-30" },
        }),
      ],
    );
    const row = await open();
    assert.equal(row.documentReferences[0].code, "SYNTHETIC-OR-123");
  });
  await check("exclusive_day_end_includes_the_last_microseconds", async () => {
    await db.exec(
      "alter table hotel_accountant_history_start disable trigger accountant_history_immutable; update hotel_accountant_history_start set started_at=clock_timestamp()-interval '10 days'; alter table hotel_accountant_history_start enable trigger accountant_history_immutable",
    );
    const day = await query(
      "select ((clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date-1)::text as value",
    );
    const at = await query(
      "select to_char(((($1::date+1)::timestamp at time zone 'Asia/Kuala_Lumpur')-interval '500 microseconds') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as value",
      [day],
    );
    const prototype = await open();
    const id = "30303030-3030-4030-8030-303030303030";
    const row = { ...prototype, caseId: id, firstSeen: at, key: { ...key, kind: "n3_conflict" } };
    await db.query(
      "insert into hotel_accountant_cases(id,tenant_id,reservation_id,intent_id,kind,document_ids,first_seen,row_snapshot) values($1,$2,$3,$4,'n3_conflict',array[$5::uuid],$6::timestamptz,$7::jsonb)",
      [id, t, r, i, rid, at, JSON.stringify(row)],
    );
    await db.query(
      "insert into hotel_accountant_case_events(tenant_id,case_id,version,request_id,fingerprint,event,actor,created_at,row_snapshot) values($1,$2,1,gen_random_uuid(),repeat('a',64),'{}','synthetic-owner',$3::timestamptz,$4::jsonb)",
      [t, id, at, JSON.stringify(row)],
    );
    const page = await query(
      "select hotelhub_accountant_cases_read($1::uuid,'synthetic-owner',$2::date,'open',0,100) as value",
      [t, day],
    );
    assert.equal(page.complete, true);
    assert.ok(page.rows.some((x) => x.caseId === id));
  });
  await check("committed_resolution_has_exact_GET_only_replay", async () => {
    const row = await open(),
      savedEvent = {
        kind: "note",
        reason: "Synthetic saved note",
        observation: null,
        proofDigest: null,
      };
    const saved = await event(row, savedEvent);
    const replaySql =
      "select hotelhub_accountant_case_event_replay($1::uuid,'synthetic-owner',$2::uuid,$3,$4::jsonb,$5::uuid) as value";
    const args = [
      t,
      row.caseId,
      row.version,
      JSON.stringify(savedEvent),
      "12121212-1212-4212-8212-121212121212",
    ];
    assert.deepEqual(await query(replaySql, args), saved);
    await denied(
      replaySql,
      [...args.slice(0, 3), JSON.stringify({ ...savedEvent, reason: "Changed request" }), args[4]],
      "accountant_idempotency_conflict",
    );
    assert.equal(await query("select count(*)::int as value from hotel_accountant_case_events"), 2);
  });
  await check("same_request_changed_input_denied", async () => {
    await open();
    await denied(
      "select hotelhub_accountant_case_open($1::uuid,'synthetic-owner',$2::jsonb,$3::jsonb,$4::uuid)",
      [
        t,
        JSON.stringify({ ...key, kind: "n3_conflict" }),
        JSON.stringify(observation),
        "11111111-1111-4111-8111-111111111111",
      ],
      "accountant_idempotency_conflict",
    );
  });
  await check("unowned_or_and_alien_booking_cannot_be_adopted", async () => {
    for (const k of [
      { ...key, documentIds: [bill] },
      { ...key, reservationId: "88888888-8888-4888-8888-888888888888" },
    ])
      await denied(
        "select hotelhub_accountant_case_open($1::uuid,'synthetic-owner',$2::jsonb,$3::jsonb,gen_random_uuid())",
        [t, JSON.stringify(k), JSON.stringify(observation)],
        "accountant_scope_mismatch",
      );
  });
  await check("review_is_not_resolution_and_notes_keep_unknown_amount", async () => {
    const row = await open();
    const v = await event(row, {
      kind: "review",
      reason: "Synthetic acknowledgment",
      observation: null,
      proofDigest: null,
    });
    assert.equal(v.status, "reviewed");
    assert.equal(v.observation.observedAmountCents, null);
  });
  await check("stale_case_version_and_request_replay_fenced", async () => {
    const row = await open();
    const e = { kind: "note", reason: "Synthetic note", observation: null, proofDigest: null };
    const v = await event(row, e);
    assert.deepEqual(await event(row, e), v);
    await denied(
      "select hotelhub_accountant_case_event($1::uuid,'synthetic-owner',$2::uuid,$3,$4::jsonb,gen_random_uuid(),null)",
      [t, row.caseId, row.version, JSON.stringify(e)],
      "accountant_stale_version",
    );
  });
  await check("body_digest_cannot_resolve", async () => {
    const row = await open();
    await denied(
      "select hotelhub_accountant_case_event($1::uuid,'synthetic-owner',$2::uuid,$3,$4::jsonb,gen_random_uuid(),null)",
      [
        t,
        row.caseId,
        row.version,
        JSON.stringify({
          kind: "resolve",
          reason: "Synthetic",
          proofDigest: "a".repeat(64),
          observation: {
            available: true,
            checkedAt: stamp,
            evidenceDigest: "a".repeat(64),
            observedAmountCents: 0,
            outcomeCode: "verified",
          },
        }),
      ],
      "accountant_resolution_unverified",
    );
  });
  await check("immutable_case_identity_event_and_statement", async () => {
    const row = await open();
    await denied("delete from hotel_accountant_case_events", [], "accountant_immutable");
    await denied(
      "update hotel_accountant_cases set kind='refund_review'",
      [],
      "accountant_immutable",
    );
  });
  await check("read_and_statement_capture_do_not_change_case_events", async () => {
    await open();
    const day = await query(
      "select (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date::text as value",
    );
    const args = [t, day, "13131313-1313-4313-8313-131313131313"];
    const sql =
      "select hotelhub_accountant_statement($1::uuid,'synthetic-owner',$2::date,'open',$3::uuid) as value";
    const before = await query("select count(*)::int as value from hotel_accountant_case_events");
    const s = await query(sql, args);
    assert.deepEqual(await query(sql, args), s);
    const v = JSON.parse(s.pageText);
    assert.equal(v.rows.length, 1);
    assert.equal(v.rows[0].observation.observedAmountCents, null);
    assert.equal(
      await query("select count(*)::int as value from hotel_accountant_case_events"),
      before,
    );
    await denied("delete from hotel_accountant_statements", [], "accountant_immutable");
  });
  await check("historical_capture_unavailable_before_installed_history", async () => {
    const page = await query(
      "select hotelhub_accountant_cases_read($1::uuid,'synthetic-owner','2026-09-30','open',0,100) as value",
      [t],
    );
    assert.equal(page.complete, false);
    await denied(
      "select hotelhub_accountant_statement($1::uuid,'synthetic-owner','2026-09-30','open',gen_random_uuid())",
      [t],
      "accountant_history_unavailable",
    );
  });
  await check("public_roles_denied_and_rls_enabled", async () => {
    assert.equal(
      await query(
        "select count(*)::int as value from pg_class where relname in ('hotel_accountant_cases','hotel_accountant_case_events','hotel_accountant_statements','hotel_accountant_history_start') and relrowsecurity",
      ),
      4,
    );
    for (const role of ["anon", "authenticated"]) {
      assert.equal(
        await query("select has_table_privilege($1,'hotel_accountant_cases','SELECT') as value", [
          role,
        ]),
        false,
      );
      assert.equal(
        await query(
          "select has_function_privilege($1,'hotelhub_accountant_case_event(uuid,text,uuid,text,jsonb,uuid,jsonb)','EXECUTE') as value",
          [role],
        ),
        false,
      );
    }
  });
} finally {
  await db.close();
}
console.log(
  failures
    ? `FAIL ${failures} accountant SQL checks`
    : native
      ? "PASS native17.6 accountant single-session SQL; races run separately"
      : "PASS accountant SQL; native concurrency NOT VERIFIED",
);
process.exitCode = failures ? 1 : 0;
