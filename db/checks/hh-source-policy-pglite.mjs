// Disposable embedded PostgreSQL only. No operational credentials or N3 calls.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const req = createRequire(
  resolve(
    process.env.HH_SQL_TEST_TOOLS || ".superpowers/sdd/2026-10-08-n3-billing-settlement/pg-client",
    "package.json",
  ),
);
const { PGlite } = req("@electric-sql/pglite");
const { btree_gist } = req("@electric-sql/pglite/contrib/btree_gist");
const db = new PGlite({ extensions: { btree_gist } });
const t = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  res = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let failures = 0,
  source;
async function denied(sql, args, code) {
  await db.exec("savepoint expected_denial");
  let error;
  try {
    await db.query(sql, args);
  } catch (e) {
    error = e;
  }
  await db.exec("rollback to expected_denial; release expected_denial");
  assert.equal(error?.message, code);
}
async function check(name, fn) {
  await db.exec("BEGIN");
  try {
    await fn();
    console.log("PASS " + name);
  } catch (e) {
    failures++;
    console.log("FAIL " + name + ": " + e.message);
  } finally {
    await db.exec("ROLLBACK");
  }
}
const policy = (version = "1", guest = 7) => ({
  sourceId: source,
  version,
  defaultCollectionMode: "guest",
  allowedCollectionModes: ["guest", "source"],
  sourceCustomerId: 8,
  guestCustomerId: guest,
  guestDocumentTitle: "Synthetic source",
  guestItemDescription: "Accommodation",
  showRoomPrices: false,
});
const save = (p = policy(), actor = "synthetic-owner", role = "owner") =>
  db
    .query("select hh_source_billing_policy_put($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb) as value", [
      t,
      source,
      actor,
      role,
      p.version,
      JSON.stringify(p),
    ])
    .then((r) => r.rows[0].value);
const facts = () =>
  db
    .query(
      "select hh_source_billing_reservation_get($1::uuid,$2::uuid,'synthetic-owner','owner') as value",
      [t, res],
    )
    .then((r) => r.rows[0].value);
const confirm = async (
  mode = "guest",
  actor = "synthetic-owner",
  role = "owner",
  revision = "0",
  at,
  policyVersion = "1",
) => {
  const f = await facts();
  return db
    .query(
      "select hh_source_billing_payer_confirm($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7,$8,$9::timestamptz) as value",
      [t, res, actor, role, source, mode, revision, policyVersion, at || f.updatedAt],
    )
    .then((r) => r.rows[0].value);
};
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
  await db.query(
    "insert into hotel_settings(tenant_id,n3_walk_in_customer_id,n3_walk_in_customer_code) values($1,'7','SYNTHETIC-GUEST')",
    [t],
  );
  await db.query(
    "insert into hotel_user_roles(tenant_id,n3_user_key,role) values($1,'synthetic-desk','front_desk')",
    [t],
  );
  const files = readdirSync("supabase/migrations").filter((f) =>
    f.endsWith("_hh_source_billing.sql"),
  );
  assert.equal(files.length, 1);
  const migration = readFileSync("supabase/migrations/" + files[0], "utf8");
  await db.exec(
    process.env.HH_SOURCE_SQL_POLICY_ONLY === "true"
      ? migration.split("-- Local HH identifiers only;")[0]
      : migration,
  );
  source = (
    await db.query(
      "select id from hotel_booking_sources where tenant_id=$1 and source_code='walk_in'",
      [t],
    )
  ).rows[0].id;
  await check("walkin_mapping_migrates_once_without_reparenting_stays", async () => {
    const before = (
      await db.query(
        "select guest_customer_id,version from hotel_source_billing_policies where tenant_id=$1 and source_id=$2",
        [t, source],
      )
    ).rows[0];
    assert.equal(before.guest_customer_id, 7);
    assert.equal(Number(before.version), 1);
    await save(policy("1", 9));
    await db.query("select hh_source_billing_seed_walkin($1::uuid)", [t]);
    assert.equal(
      (
        await db.query(
          "select guest_customer_id from hotel_source_billing_policies where tenant_id=$1 and source_id=$2",
          [t, source],
        )
      ).rows[0].guest_customer_id,
      9,
    );
    assert.equal(
      (await db.query("select count(*)::int as n from hotel_reservation_payers", [])).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select n3_walk_in_customer_id from hotel_settings where tenant_id=$1", [t]))
        .rows[0].n3_walk_in_customer_id,
      "7",
    );
  });
  await check("owner_save_fences_policy_version_and_records_audit", async () => {
    assert.equal((await save()).version, "2");
    await denied(
      "select hh_source_billing_policy_put($1::uuid,$2::uuid,'synthetic-owner','owner','1',$3::jsonb)",
      [t, source, JSON.stringify(policy())],
      "source_policy_version_conflict",
    );
    assert.equal(
      (await db.query("select count(*)::int as n from hotel_source_billing_audit", [])).rows[0].n,
      1,
    );
  });
  await check("role_string_cannot_elevate_frontdesk", async () => {
    await denied(
      "select hh_source_billing_policy_put($1::uuid,$2::uuid,'synthetic-desk','owner','1',$3::jsonb)",
      [t, source, JSON.stringify(policy())],
      "source_billing_forbidden",
    );
  });
  await check("compound_scope_rejects_another_tenant_source", async () => {
    const alien = (
      await db.query("select id from hotel_booking_sources where tenant_id<>$1 limit 1", [t])
    ).rows[0].id;
    await denied(
      "select hh_source_billing_policy_put($1::uuid,$2::uuid,'synthetic-owner','owner','0',$3::jsonb)",
      [t, alien, JSON.stringify({ ...policy("0"), sourceId: alien })],
      "source_policy_scope_mismatch",
    );
  });
  await check("payer_confirmation_uses_server_actor_time_and_preserves_snapshot", async () => {
    const first = await confirm();
    assert.equal(first.revision, "1");
    assert.equal(first.payer.confirmedBy, "synthetic-owner");
    assert.ok(Date.parse(first.payer.confirmedAt));
    assert.equal(first.payer.policy.guestCustomerId, 7);
    await save(policy("1", 9));
    assert.deepEqual((await facts()).payer, first.payer);
  });
  await check("old_unclassified_stay_requires_owner", async () => {
    const f = await facts();
    await denied(
      "select hh_source_billing_payer_confirm($1::uuid,$2::uuid,'synthetic-desk','front_desk',$3::uuid,'guest','0','1',$4::timestamptz)",
      [t, res, source, f.updatedAt],
      "source_payer_owner_required",
    );
  });
  await check("stale_reservation_timestamp_cannot_confirm", async () => {
    await denied(
      "select hh_source_billing_payer_confirm($1::uuid,$2::uuid,'synthetic-owner','owner',$3::uuid,'guest','0','1','2000-01-01'::timestamptz)",
      [t, res, source],
      "source_payer_revision_conflict",
    );
  });
  await check("stale_policy_and_payer_revision_cannot_confirm", async () => {
    const f = await facts();
    await denied(
      "select hh_source_billing_payer_confirm($1::uuid,$2::uuid,'synthetic-owner','owner',$3::uuid,'guest','0','0',$4::timestamptz)",
      [t, res, source, f.updatedAt],
      "source_policy_version_conflict",
    );
    await confirm();
    const next = await facts();
    await denied(
      "select hh_source_billing_payer_confirm($1::uuid,$2::uuid,'synthetic-owner','owner',$3::uuid,'guest','0','1',$4::timestamptz)",
      [t, res, source, next.updatedAt],
      "source_payer_revision_conflict",
    );
  });
  await check("agoda_property_collect_uses_configured_mode_not_name", async () => {
    await save();
    const result = await confirm("guest", "synthetic-owner", "owner", "0", undefined, "2");
    assert.equal(result.payer.collectionMode, "guest");
    assert.deepEqual(result.payer.policy.allowedCollectionModes, ["guest", "source"]);
  });
  await check("disabled_or_unpermitted_source_mode_refused", async () => {
    const f = await facts();
    await denied(
      "select hh_source_billing_payer_confirm($1::uuid,$2::uuid,'synthetic-owner','owner',$3::uuid,'source','0','1',$4::timestamptz)",
      [t, res, source, f.updatedAt],
      "source_collection_mode_not_allowed",
    );
    await db.query("update hotel_booking_sources set is_active=false where id=$1", [source]);
    await denied(
      "select hh_source_billing_payer_confirm($1::uuid,$2::uuid,'synthetic-owner','owner',$3::uuid,'guest','0','1',$4::timestamptz)",
      [t, res, source, f.updatedAt],
      "source_policy_scope_mismatch",
    );
  });
  await check("closed_stay_cannot_change_payer", async () => {
    await db.query("update hotel_reservations set status='cancelled' where id=$1", [res]);
    const f = await facts();
    await denied(
      "select hh_source_billing_payer_confirm($1::uuid,$2::uuid,'synthetic-owner','owner',$3::uuid,'guest','0','1',$4::timestamptz)",
      [t, res, source, f.updatedAt],
      "source_payer_frozen",
    );
  });
  await check("saved_payer_requires_owner_for_later_changes", async () => {
    await confirm();
    const f = await facts();
    await denied(
      "select hh_source_billing_payer_confirm($1::uuid,$2::uuid,'synthetic-desk','front_desk',$3::uuid,'guest','1','1',$4::timestamptz)",
      [t, res, source, f.updatedAt],
      "source_payer_owner_required",
    );
  });
  await check("public_roles_cannot_read_or_execute_privileged_source_paths", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec("set local role " + role);
      await denied(
        "select * from hotel_reservation_payers",
        [],
        "permission denied for table hotel_reservation_payers",
      );
      await denied(
        "select hh_source_billing_seed_walkin($1::uuid)",
        [t],
        "permission denied for function hh_source_billing_seed_walkin",
      );
      await db.exec("reset role");
    }
  });
  await check("append_only_source_audit_cannot_be_edited", async () => {
    await save();
    await denied("delete from hotel_source_billing_audit", [], "source_billing_audit_immutable");
  });
  const date = (
    await db.query(
      "select (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date::text as value",
    )
  ).rows[0].value;
  const reserve = (
    operation,
    series = "bill",
    reservation = res,
    actor = "synthetic-owner",
    day = date,
  ) =>
    db
      .query(
        "select hh_source_document_number_reserve($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::date) as value",
        [t, reservation, actor, series, operation, day],
      )
      .then((r) => r.rows[0].value);
  await check("document_numbers_replay_same_operation_and_twenty_unique_requests", async () => {
    const operations = Array.from({ length: 20 }, () => crypto.randomUUID());
    const values = await Promise.all(operations.map((op) => reserve(op)));
    assert.equal(new Set(values.map((v) => v.hhNumber)).size, 20);
    assert.equal(values[0].hhNumber, "SI" + date.slice(2, 4) + date.slice(5, 7) + "00001");
    assert.equal((await reserve(operations[0])).hhNumber, values[0].hhNumber);
    assert.equal(
      (await db.query("select count(*)::int as n from hotel_source_document_numbers")).rows[0].n,
      20,
    );
  });
  await check("numbering_operation_cannot_reparent_to_sibling_reservation", async () => {
    const op = crypto.randomUUID();
    await reserve(op);
    await denied(
      "select hh_source_document_number_reserve($1::uuid,$2::uuid,'synthetic-owner','bill',$3::uuid,$4::date)",
      [t, "88888888-8888-4888-8888-888888888888", op, date],
      "source_document_number_scope_mismatch",
    );
  });
  await check("numbering_preserves_prior_date_replay_and_refuses_new_backdating", async () => {
    const op = crypto.randomUUID();
    await db.query(
      "insert into hotel_source_document_numbers(tenant_id,reservation_id,series,operation_id,document_date,hh_number,actor) values($1,$2,'bill',$3,'2020-01-01','SI200100001','synthetic-owner')",
      [t, res, op],
    );
    assert.equal(
      (await reserve(op, "bill", res, "synthetic-owner", "2020-01-01")).hhNumber,
      "SI200100001",
    );
    await denied(
      "select hh_source_document_number_reserve($1::uuid,$2::uuid,'synthetic-owner','bill',$3::uuid,'2020-01-01')",
      [t, res, crypto.randomUUID()],
      "source_document_date_invalid",
    );
  });
  await check("number_overflow_denied_without_consuming_or_reusing_identifiers", async () => {
    const period = date.slice(2, 4) + date.slice(5, 7);
    await db.query(
      "insert into hotel_source_document_counters(tenant_id,series,period,last_number) values($1,'bill',$2,99999)",
      [t, period],
    );
    await denied(
      "select hh_source_document_number_reserve($1::uuid,$2::uuid,'synthetic-owner','bill',$3::uuid,$4::date)",
      [t, res, crypto.randomUUID(), date],
      "source_document_number_overflow",
    );
    assert.equal(
      (await db.query("select count(*)::int as n from hotel_source_document_numbers")).rows[0].n,
      0,
    );
  });
  await check("numbering_owner_only_and_receipt_refund_series_independent", async () => {
    const op = crypto.randomUUID();
    await denied(
      "select hh_source_document_number_reserve($1::uuid,$2::uuid,'synthetic-desk','bill',$3::uuid,$4::date)",
      [t, res, op, date],
      "settlement_forbidden",
    );
    assert.match((await reserve(op, "receipt")).hhNumber, /^OR\d{9}$/);
    assert.match((await reserve(op, "refund")).hhNumber, /^RF\d{9}$/);
    assert.equal(
      (await db.query("select count(*)::int as n from hotel_settlement_attempts")).rows[0].n,
      0,
    );
  });
  await check("numbering_public_roles_denied_and_reserved_number_immutable", async () => {
    const op = crypto.randomUUID();
    await reserve(op);
    await denied("delete from hotel_source_document_numbers", [], "settlement_immutable");
    for (const role of ["anon", "authenticated"]) {
      await db.exec("set local role " + role);
      await denied(
        "select hh_source_document_number_reserve($1::uuid,$2::uuid,'synthetic-owner','bill',$3::uuid,$4::date)",
        [t, res, op, date],
        "permission denied for function hh_source_document_number_reserve",
      );
      await db.exec("reset role");
    }
  });
  if (failures) throw new Error(failures + " source-policy/numbering checks failed");
  console.log("PASS source policy SQL; native multi-session concurrency NOT VERIFIED");
} finally {
  await db.close();
}
