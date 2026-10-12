// Actual sorted migration integration, isolated PGlite; never an operational DB.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const req = createRequire(
  resolve(
    process.env.HH_SQL_TEST_TOOLS || ".superpowers/sdd/2026-10-08-n3-billing-settlement/pg-client",
    "package.json",
  ),
);
const { PGlite } = req("@electric-sql/pglite");
const { btree_gist } = req("@electric-sql/pglite/contrib/btree_gist");
const db = new PGlite({ extensions: { btree_gist } });
const names = ["claim", "complete", "decide", "recover", "verify_atomic"].map(
  (n) => "hotelhub_receipt_control_" + n,
);
try {
  await db.exec("SET hotelhub.disposable_test='enabled'; SET check_function_bodies=off;");
  await db.exec(readFileSync("db/checks/hh-settlement-setup.sql", "utf8"));
  await db.exec(readFileSync("db/checks/hh-settlement-seed.sql", "utf8"));
  await db.exec("SET check_function_bodies=on");
  await db.exec(
    readFileSync("supabase/migrations/20261003120216_hh_automatic_receipt_controls.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261008080000_hh_billing_settlement.sql", "utf8"),
  );
  const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    requestId = randomUUID();
  await db.query(
    `insert into hotel_receipt_control_requests(id,tenant_id,reservation_id,deposit_id,client_request_id,request_fingerprint,kind,reason,original,proposal,comparison,original_amount_cents,proposed_amount_cents,state,requested_by_n3_user_key,execution_mode,generation,automation_meta,approved_by_n3_user_key,approved_at)
    values($1,$2,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',$3,repeat('c',64),'correction','Synthetic generation isolation','{}','{}','{}',5000,6000,'needs_review','synthetic-owner','direct',2,'{}','synthetic-owner',now())`,
    [requestId, tenant, randomUUID()],
  );
  await db.query(
    "insert into hotel_receipt_edit_attempts(tenant_id,request_id,claimed_version,payload_hash,phase,actor) values($1,$2,1,repeat('a',64),'unknown','synthetic-owner')",
    [tenant, requestId],
  );
  const calls = [
    "select hotelhub_receipt_control_claim($1::uuid,$2::uuid,1,'verify','synthetic-owner')",
    "select hotelhub_receipt_control_complete($1::uuid,$2::uuid,gen_random_uuid(),'needs_review','synthetic','synthetic-owner',null)",
    "select hotelhub_receipt_control_decide($1::uuid,$2::uuid,1,'reject','rejected','synthetic-owner','synthetic',null)",
    "select hotelhub_receipt_control_recover($1::uuid,$2::uuid,1,'synthetic-owner',60)",
    "select hotelhub_receipt_control_verify_atomic($1::uuid,$2::uuid,1,'synthetic-owner','needs_review','synthetic',null)",
  ];
  let failures = 0;
  for (let i = 0; i < names.length; i++) {
    await db.exec("BEGIN");
    try {
      await assert.rejects(db.query(calls[i], [tenant, requestId]), /automation_unavailable/);
      console.log("PASS combined migration blocks generation2 via " + names[i]);
    } catch (error) {
      failures++;
      console.log("FAIL " + names[i] + ": " + error.message);
    } finally {
      await db.exec("ROLLBACK");
    }
  }
  const saved = (
    await db.query("select state,version from hotel_receipt_control_requests where id=$1", [
      requestId,
    ])
  ).rows[0];
  assert.equal(saved.state, "needs_review");
  assert.equal(saved.version, 1);
  if (failures) throw new Error(failures + " generation-isolation regressions");
} finally {
  await db.close();
}
