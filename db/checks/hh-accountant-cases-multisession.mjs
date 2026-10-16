// Requires the guarded disposable native bootstrap, never an operational DB.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const req = createRequire(resolve(process.env.HH_SQL_TEST_TOOLS, "package.json"));
const url = new URL(process.env.HH_NATIVE_PG_URL);
assert.equal(process.env.HH_ACCOUNTANT_NATIVE_DISPOSABLE, "enabled");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/hh_accountant_test");
assert.equal(url.username, "synthetic_test");
const { Client } = req("pg");
const clients = [0, 1, 2].map(
  (n) =>
    new Client({ connectionString: url.toString(), application_name: "hh_accountant_race_" + n }),
);
await Promise.all(clients.map((c) => c.connect()));
const [a, b, observer] = clients;
const t = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  r = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  i = "44444444-4444-4444-8444-444444444444",
  rid = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const key = { reservationId: r, intentId: i, kind: "receipt_surplus", documentIds: [rid] };
const obs = {
  available: false,
  checkedAt: new Date().toISOString(),
  evidenceDigest: null,
  observedAmountCents: null,
  outcomeCode: "unknown",
};
const request = "16161616-1616-4616-8616-161616161616";
const sql =
  "select hotelhub_accountant_case_open($1::uuid,'synthetic-owner',$2::jsonb,$3::jsonb,$4::uuid) as value";
const args = [t, JSON.stringify(key), JSON.stringify(obs), request];
const result = (p) =>
  p.then(
    (r) => ({ value: r.rows[0]?.value }),
    (e) => ({ error: e.message }),
  );
async function blocked(pid) {
  const until = Date.now() + 2000;
  while (Date.now() < until) {
    const state = (
      await observer.query("select wait_event_type from pg_stat_activity where pid=$1", [pid])
    ).rows[0];
    if (state?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("expected independent backend lock wait");
}
try {
  const facts = (
    await observer.query(
      "select current_database() as db,current_user as actor,current_setting('server_version') as version",
    )
  ).rows[0];
  assert.equal(facts.db, "hh_accountant_test");
  assert.equal(facts.actor, "synthetic_test");
  assert.match(facts.version, /^17\.6(?:\s|$)/);
  await Promise.all(clients.map((c) => c.query("set statement_timeout='5s'")));
  const pids = await Promise.all(
    clients.map(async (c) => (await c.query("select pg_backend_pid() as pid")).rows[0].pid),
  );
  assert.equal(new Set(pids).size, 3);
  console.log("Native PostgreSQL " + facts.version + "; three distinct backend PIDs");
  await a.query("begin");
  const first = (await a.query(sql, args)).rows[0].value;
  const replayJob = result(b.query(sql, args));
  await blocked(pids[1]);
  await a.query("commit");
  assert.deepEqual((await replayJob).value, first);
  assert.equal(
    (await observer.query("select count(*)::int as n from hotel_accountant_cases")).rows[0].n,
    1,
  );
  console.log("PASS duplicate request waits then replays one case/event");
  const eventSql =
    "select hotelhub_accountant_case_event($1::uuid,'synthetic-owner',$2::uuid,$3,$4::jsonb,$5::uuid,null) as value";
  const e = JSON.stringify({
    kind: "note",
    reason: "Synthetic concurrent note",
    observation: null,
    proofDigest: null,
  });
  await a.query("begin");
  const second = (
    await a.query(eventSql, [
      t,
      first.caseId,
      first.version,
      e,
      "17171717-1717-4717-8717-171717171717",
    ])
  ).rows[0].value;
  const staleJob = result(
    b.query(eventSql, [t, first.caseId, first.version, e, "18181818-1818-4818-8818-181818181818"]),
  );
  await blocked(pids[1]);
  await a.query("commit");
  assert.equal((await staleJob).error, "accountant_stale_version");
  console.log("PASS stale concurrent event cannot overwrite the committed version");
  await a.query("begin");
  await a.query("select 1 from hotel_reservations where id=$1 for update", [r]);
  const laterJob = result(
    b.query(eventSql, [t, first.caseId, "3", e, "19191919-1919-4919-8919-191919191919"]),
  );
  await blocked(pids[1]);
  await a.query(eventSql, [
    t,
    first.caseId,
    second.version,
    e,
    "20202020-2020-4020-8020-202020202020",
  ]);
  await a.query("commit");
  assert.equal((await laterJob).value.version, "4");
  const events = (
    await observer.query(
      "select version,created_at from hotel_accountant_case_events order by version",
    )
  ).rows;
  for (let n = 1; n < events.length; n++)
    assert.ok(events[n].created_at >= events[n - 1].created_at);
  console.log("PASS waiting writer stamps history after the earlier committed event");
  const alienJob = await result(
    b.query(sql, [
      t,
      JSON.stringify({ ...key, reservationId: "88888888-8888-4888-8888-888888888888" }),
      JSON.stringify(obs),
      request,
    ]),
  );
  assert.equal(alienJob.error, "accountant_idempotency_conflict");
  console.log("PASS conflicting request identity on another booking is rejected");
  const day = (
    await observer.query(
      "select (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date::text as day",
    )
  ).rows[0].day;
  const ssql =
      "select hotelhub_accountant_statement($1::uuid,'synthetic-owner',$2::date,'open',$3::uuid) as value",
    sargs = [t, day, "21212121-2121-4121-8121-212121212121"];
  const statements = await Promise.all([a.query(ssql, sargs), b.query(ssql, sargs)]);
  assert.deepEqual(statements[0].rows[0].value, statements[1].rows[0].value);
  const saved = statements[0].rows[0].value;
  await b.query(eventSql, [t, first.caseId, "4", e, "23232323-2323-4323-8323-232323232323"]);
  const reprint = (
    await a.query(
      "select hotelhub_accountant_statement_read($1::uuid,'synthetic-owner',$2::uuid) as value",
      [t, saved.statementId],
    )
  ).rows[0].value;
  assert.deepEqual(reprint, saved);
  console.log(
    "PASS concurrent statement capture replays one snapshot; later events never change its bytes",
  );
  // The proof's timestamp is its oldest GET time. A parent-lock wait must not
  // turn an expired observation into resolution authority.
  const agedAt = new Date(Date.now() - 59000).toISOString();
  const agedProof = {
    tenantId: t,
    reservationId: r,
    intentId: i,
    intentRevision: "1",
    snapshotDigest: "d".repeat(64),
    provenance: "external_n3_matching",
    billId: "22222222-2222-4222-8222-222222222222",
    billOutstandingCents: 0,
    checkedAt: agedAt,
    digest: "a".repeat(64),
    observationDigest: "b".repeat(64),
    receiptObservations: [{ receiptId: rid, remainderCents: 0, refundCents: 0 }],
  };
  const resolutionEvent = {
    kind: "resolve",
    reason: "Synthetic aged proof",
    proofDigest: agedProof.digest,
    observation: {
      available: true,
      checkedAt: agedAt,
      evidenceDigest: agedProof.observationDigest,
      observedAmountCents: 0,
      outcomeCode: "verified",
    },
  };
  await a.query("begin");
  await a.query("select 1 from hotel_reservations where id=$1 for update", [r]);
  const agedJob = result(
    b.query(
      "select hotelhub_accountant_case_event($1::uuid,'synthetic-owner',$2::uuid,'5',$3::jsonb,$4::uuid,$5::jsonb) as value",
      [
        t,
        first.caseId,
        JSON.stringify(resolutionEvent),
        "24242424-2424-4424-8424-242424242424",
        JSON.stringify(agedProof),
      ],
    ),
  );
  await blocked(pids[1]);
  await a.query("select pg_sleep(2)");
  await a.query("commit");
  assert.equal((await agedJob).error, "accountant_resolution_unverified");
  console.log("PASS expired original GET evidence cannot resolve after a lock wait");
  console.log("PASS six native accountant concurrency/history scenarios");
} finally {
  await a.query("rollback").catch(() => {});
  await b.query("rollback").catch(() => {});
  await Promise.all(clients.map((c) => c.end()));
}
