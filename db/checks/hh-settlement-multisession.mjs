import { randomUUID } from "node:crypto";
import { connectTest } from "./hh-settlement-pg-client.mjs";
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clients = [];
async function connect() {
  const c = await connectTest();
  clients.push(c);
  return c;
}
function assert(ok, name) {
  if (!ok) throw new Error(`FAIL ${name}`);
  console.log(`PASS ${name}`);
}
async function reservation(c) {
  const res = randomUUID(),
    folio = randomUUID(),
    line = randomUUID();
  await c.query(
    "INSERT INTO hotel_reservations(id,tenant_id,booking_reference,booking_source,status,arrival_date,departure_date,currency,created_by_n3_user_key) VALUES($1,$2,$3,'walk_in','checked_in','2026-10-07','2026-10-09','MYR','synthetic-owner')",
    [res, tenant, `TEST-${res}`],
  );
  await c.query(
    "INSERT INTO hotel_folios(id,tenant_id,reservation_id,status) VALUES($1,$2,$3,'prepared')",
    [folio, tenant, res],
  );
  await c.query(
    "INSERT INTO hotel_folio_lines(id,tenant_id,folio_id,line_type,description_snapshot,unit_price_cents,subtotal_cents,total_cents,actor_n3_user_key) VALUES($1,$2,$3,'add_on','Synthetic',50000,50000,50000,'synthetic-owner')",
    [line, tenant, folio],
  );
  return { res, folio, line };
}
async function freeze(c, res) {
  return (
    await c.query(
      "SELECT hotelhub_settlement_freeze($1,$2,'synthetic-owner',hh_snapshot($2),$3) AS i",
      [tenant, res, randomUUID()],
    )
  ).rows[0].i;
}
async function waits(observer, pid) {
  for (let n = 0; n < 60; n++) {
    const { rows } = await observer.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
      [pid],
    );
    if (rows[0]?.wait_event_type === "Lock") return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}
async function expectError(promise, code) {
  try {
    await promise;
    throw new Error("write unexpectedly succeeded");
  } catch (err) {
    assert(err.message === code, code);
  }
}
try {
  const owner = await connect(),
    other = await connect();
  const { res } = await reservation(owner);
  const i = await freeze(owner, res);
  const workers = await Promise.all(Array.from({ length: 20 }, () => connect()));
  const results = await Promise.all(
    workers.map((c) =>
      c.query(
        "SELECT hotelhub_settlement_claim($1,$2,'synthetic-owner',$3,$4,'bill',NULL,$5,$6::jsonb) AS claim",
        [
          tenant,
          res,
          i.id,
          i.revision,
          "a8198524f58e72b56283ab71ebddada22840f108b46ef7165bb3fca9919c5558",
          JSON.stringify({
            kind: "bill",
            snapshotDigest: "d".repeat(64),
            payload: { synthetic: true },
          }),
        ],
      ),
    ),
  );
  assert(results.filter((r) => r.rows[0].claim !== null).length === 1, "one_claim_in_20_sessions");
  assert(
    (
      await owner.query(
        "SELECT count(*)::integer AS n FROM hotel_settlement_attempts WHERE intent_id=$1",
        [i.id],
      )
    ).rows[0].n === 1,
    "one durable dispatch attempt",
  );
  const pending = await reservation(owner);
  await owner.query("BEGIN");
  await owner.query(
    "INSERT INTO hotel_reservation_deposits(tenant_id,reservation_id,amount,currency_code,idempotency_key,n3_reference_no,created_by_n3_user_key) VALUES($1,$2,50,'MYR',$3,'SYNTHETIC-CONCURRENT','synthetic-owner')",
    [tenant, pending.res, randomUUID()],
  );
  const freezing = freeze(other, pending.res);
  const freezingError = freezing.then(
    () => null,
    (e) => e,
  );
  assert(await waits(workers[0], other.processID), "freeze waits for started deposit");
  await owner.query("COMMIT");
  const err = await freezingError;
  assert(
    err?.message === "settlement_pending_financial_operation",
    "pending deposit blocks concurrent freeze",
  );
  const inverse = await reservation(owner);
  await owner.query("BEGIN");
  await freeze(owner, inverse.res);
  const deposit = other.query(
    "INSERT INTO hotel_reservation_deposits(tenant_id,reservation_id,amount,currency_code,idempotency_key,n3_reference_no,created_by_n3_user_key) VALUES($1,$2,50,'MYR',$3,'SYNTHETIC-INVERSE','synthetic-owner')",
    [tenant, inverse.res, randomUUID()],
  );
  const depositError = deposit.then(
    () => null,
    (e) => e,
  );
  assert(await waits(workers[0], other.processID), "deposit waits for freezing transaction");
  await owner.query("COMMIT");
  assert(
    (await depositError)?.message === "settlement_locked",
    "freeze wins deposit check/insert race",
  );
  // Direct child mutation must fail rather than deadlock when another worker owns parent.
  const child = await reservation(owner);
  await owner.query("BEGIN");
  await owner.query("SELECT id FROM hotel_reservations WHERE id=$1 FOR UPDATE", [child.res]);
  await other.query("BEGIN");
  await other.query("SELECT id FROM hotel_folio_lines WHERE id=$1 FOR UPDATE", [child.line]);
  await expectError(
    other.query("UPDATE hotel_folio_lines SET quantity=2 WHERE id=$1", [child.line]),
    "settlement_busy",
  );
  await other.query("ROLLBACK");
  await owner.query("ROLLBACK");
  assert(
    (await owner.query("SELECT quantity FROM hotel_folio_lines WHERE id=$1", [child.line])).rows[0]
      .quantity === 1,
    "child-first rollback and no deadlock",
  );
  console.log("PASS all named native multi-session checks; no N3 calls");
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await Promise.all(
    clients.map(async (c) => {
      try {
        await c.query("ROLLBACK");
      } catch {}
      await c.end();
    }),
  );
}
