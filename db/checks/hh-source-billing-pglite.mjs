// Disposable embedded PostgreSQL. Native multi-session concurrency is a separate gate.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const req = createRequire(resolve(process.env.HH_SQL_TEST_TOOLS, "package.json"));
const { PGlite } = req("@electric-sql/pglite");
const { btree_gist } = req("@electric-sql/pglite/contrib/btree_gist");
const db = new PGlite({ extensions: { btree_gist } });
const t = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  r = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  f = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const source = "44444444-4444-4444-8444-444444444444",
  guest = "55555555-5555-4555-8555-555555555555",
  extra = "33333333-3333-4333-8333-333333333333";
const canonical = (v) =>
  Array.isArray(v)
    ? "[" + v.map(canonical).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
const seal = (v) => ({ ...v, digest: createHash("sha256").update(canonical(v)).digest("hex") });
const query = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
let failures = 0;
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
async function prepare() {
  await db.query(
    "update hotel_folio_lines set unit_price_cents=30000,subtotal_cents=30000,total_cents=30000,n3_stock_id_snapshot='101',n3_uom_id_snapshot='1',n3_tax_code_id_snapshot='8' where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'",
  );
  await db.query(
    "insert into hotel_folio_lines(id,tenant_id,folio_id,line_type,description_snapshot,unit_price_cents,subtotal_cents,total_cents,actor_n3_user_key,n3_stock_id_snapshot,n3_uom_id_snapshot,n3_tax_code_id_snapshot) values($1,$2,$3,'add_on','Synthetic extra',4000,4000,4000,'synthetic-owner','101','1','8')",
    [extra, t, f],
  );
  const src = await query(
    "select id as value from hotel_booking_sources where tenant_id=$1 and source_code='walk_in'",
    [t],
  );
  const policy = {
    sourceId: src,
    version: "1",
    defaultCollectionMode: "source",
    allowedCollectionModes: ["guest", "source"],
    sourceCustomerId: 8,
    guestCustomerId: 7,
    guestDocumentTitle: "Synthetic source",
    guestItemDescription: "Accommodation",
    showRoomPrices: false,
  };
  await query(
    "select hh_source_billing_policy_put($1::uuid,$2::uuid,'synthetic-owner','owner','1',$3::jsonb) as value",
    [t, src, JSON.stringify(policy)],
  );
  const at = await query("select updated_at::text as value from hotel_reservations where id=$1", [
    r,
  ]);
  const confirmed = await query(
    "select hh_source_billing_payer_confirm($1::uuid,$2::uuid,'synthetic-owner','owner',$3::uuid,'source','0','2',$4::timestamptz) as value",
    [t, r, src, at],
  );
  const versions = await query("select hotelhub_settlement_sources($1::uuid,$2::uuid) as value", [
    t,
    r,
  ]);
  const date = await query(
    "select (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date::text as value",
  );
  const line = (id, description, n) => ({
    localLineId: id,
    kind: "add_on",
    stockId: 101,
    uomId: 1,
    taxCodeId: 8,
    qty: 1,
    unitCents: n,
    subtotalCents: n,
    taxCents: 0,
    totalCents: n,
    description,
    mappingEvidence: { verified: true },
  });
  const snap = (customer, lines) =>
    seal({
      tenantId: t,
      reservationId: r,
      folioId: f,
      revision: "0",
      currency: "MYR",
      currencyId: 1,
      currencyRate: 1,
      propertyTimezone: "Asia/Kuala_Lumpur",
      billDate: date,
      customerId: customer,
      billTo: { name: "Synthetic " + customer, company: "", address: "", phone: "", email: "" },
      lines,
      totalCents: lines.reduce((n, l) => n + l.totalCents, 0),
      receipts: [],
      sourceVersions: versions,
    });
  return seal({
    version: 1,
    scope: { tenantId: t, reservationId: r },
    payer: confirmed.payer,
    totalCents: 34000,
    legs: [
      {
        legId: source,
        kind: "source_room",
        customerId: 8,
        collectionMode: "source",
        documentTitle: "Synthetic source",
        itemDescription: "Accommodation",
        showPrices: false,
        snapshot: snap(8, [
          line("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "Synthetic charge", 30000),
        ]),
      },
      {
        legId: guest,
        kind: "guest",
        customerId: 7,
        collectionMode: "guest",
        documentTitle: "Sales Invoice",
        itemDescription: "",
        showPrices: true,
        snapshot: snap(7, [line(extra, "Synthetic extra", 4000)]),
      },
    ],
  });
}
const freeze = (p, id = randomUUID()) =>
  query(
    "select hh_source_billing_freeze($1::uuid,$2::uuid,'synthetic-owner',$3::jsonb,$4::uuid) as value",
    [t, r, JSON.stringify(p), id],
  );
const readLeg = (leg, digest, intent = leg) =>
  query(
    "select hh_source_billing_leg_read($1::uuid,$2::uuid,'synthetic-owner','owner',$3::uuid,$4) as value",
    [t, r, leg, digest],
  );
try {
  await db.exec("SET hotelhub.disposable_test='enabled'; SET check_function_bodies=off");
  await db.exec(readFileSync("db/checks/hh-settlement-setup.sql", "utf8"));
  await db.exec(readFileSync("db/checks/hh-settlement-seed.sql", "utf8"));
  await db.exec("SET check_function_bodies=on");
  for (const file of [
    "20261003120216_hh_automatic_receipt_controls.sql",
    "20261008080000_hh_billing_settlement.sql",
  ])
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
  await db.query(
    "insert into hotel_settings(tenant_id,n3_walk_in_customer_id,n3_walk_in_customer_code) values($1,'7','SYNTHETIC-GUEST')",
    [t],
  );
  await db.exec(readFileSync("supabase/migrations/20261011225957_hh_source_billing.sql", "utf8"));
  await check("one_booking_two_distinct_intents_and_numbers_atomic_replay", async () => {
    const p = await prepare(),
      id = randomUUID(),
      first = await freeze(p, id),
      second = await freeze(p, id);
    assert.deepEqual(first, second);
    assert.equal(new Set(first.legs.map((l) => l.id)).size, 2);
    assert.equal(new Set(first.legs.map((l) => l.hhNumber)).size, 2);
    assert.deepEqual(
      first.legs.map((l) => l.snapshot.totalCents),
      [30000, 4000],
    );
    assert.equal(
      await query("select count(*)::int as value from hotel_source_billing_line_membership"),
      2,
    );
    await denied(
      "select hotelhub_settlement_read($1::uuid,$2::uuid)",
      [t, r],
      "source_billing_leg_required",
    );
  });
  await check("legacy_single_bill_still_readable_without_source_fields", async () => {
    const snap = {
      tenantId: t,
      reservationId: r,
      folioId: f,
      digest: "d".repeat(64),
      sourceVersions: await query(
        "select hotelhub_settlement_sources($1::uuid,$2::uuid) as value",
        [t, r],
      ),
      receipts: [],
      currency: "MYR",
      totalCents: 50000,
    };
    const result = await query(
      "select hotelhub_settlement_freeze($1::uuid,$2::uuid,'synthetic-owner',$3::jsonb,$4::uuid) as value",
      [t, r, JSON.stringify(snap), randomUUID()],
    );
    assert.equal(
      (await query("select hotelhub_settlement_read($1::uuid,$2::uuid) as value", [t, r])).id,
      result.id,
    );
    assert.equal(result.legId, undefined);
  });
  await check("payer_changed_before_freeze_cannot_rebase_or_issue_old_customer", async () => {
    const p = await prepare();
    await db.query(
      "update hotel_reservation_payers set revision=revision+1,collection_mode='guest' where tenant_id=$1 and reservation_id=$2",
      [t, r],
    );
    await denied(
      "select hh_source_billing_freeze($1::uuid,$2::uuid,'synthetic-owner',$3::jsonb,$4::uuid)",
      [t, r, JSON.stringify(p), randomUUID()],
      "source_billing_payer_changed",
    );
  });
  await check("duplicate_missing_or_modified_charge_membership_denied", async () => {
    const p = await prepare();
    p.legs[1].snapshot.lines[0].localLineId = p.legs[0].snapshot.lines[0].localLineId;
    p.legs[1].snapshot = seal(
      Object.fromEntries(Object.entries(p.legs[1].snapshot).filter(([k]) => k !== "digest")),
    );
    const q = seal(Object.fromEntries(Object.entries(p).filter(([k]) => k !== "digest")));
    await denied(
      "select hh_source_billing_freeze($1::uuid,$2::uuid,'synthetic-owner',$3::jsonb,$4::uuid)",
      [t, r, JSON.stringify(q), randomUUID()],
      "source_billing_charge_mismatch",
    );
    assert.equal(
      await query("select count(*)::int as value from hotel_source_document_numbers"),
      0,
    );
  });
  await check("same_walkin_customer_cannot_adopt_another_bookings_receipt", async () => {
    const p = await prepare(),
      alien = "12121212-1212-4212-8212-121212121212";
    await db.query(
      "insert into hotel_reservation_deposits(id,tenant_id,reservation_id,amount,currency_code,idempotency_key,n3_reference_no,n3_receipt_id,status,created_by_n3_user_key) values($1,$2,'88888888-8888-4888-8888-888888888888',40,'MYR','synthetic-alien','ALIEN-OR','ffffffff-ffff-4fff-8fff-ffffffffffff','posted','synthetic-owner')",
      [alien, t],
    );
    p.legs[1].snapshot.receipts = [
      {
        depositId: alien,
        reservationId: r,
        receiptId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        customerId: 7,
        currency: "MYR",
        amountCents: 4000,
        reference: "ALIEN-OR",
        receiptDate: p.legs[1].snapshot.billDate,
        payments: [],
      },
    ];
    p.legs[1].snapshot = seal(
      Object.fromEntries(Object.entries(p.legs[1].snapshot).filter(([k]) => k !== "digest")),
    );
    const q = seal(Object.fromEntries(Object.entries(p).filter(([k]) => k !== "digest")));
    await denied(
      "select hh_source_billing_freeze($1::uuid,$2::uuid,'synthetic-owner',$3::jsonb,$4::uuid)",
      [t, r, JSON.stringify(q), randomUUID()],
      "settlement_scope_mismatch",
    );
    assert.equal(await query("select count(*)::int as value from hotel_source_billing_plans"), 0);
  });
  async function reversedHistory(p, malformed = false) {
    const original = "14141414-1414-4414-8414-141414141414",
      reversal = "15151515-1515-4515-8515-151515151515";
    await db.query(
      "insert into hotel_folio_lines(id,tenant_id,folio_id,line_type,status,description_snapshot,unit_price_cents,subtotal_cents,total_cents,actor_n3_user_key,n3_stock_id_snapshot,n3_uom_id_snapshot,n3_tax_code_id_snapshot) values($1,$2,$3,'add_on','reversed','Historical removed charge',1000,1000,1000,'synthetic-owner','101','1','8')",
      [original, t, f],
    );
    await db.query(
      "insert into hotel_folio_lines(id,tenant_id,folio_id,line_type,status,description_snapshot,unit_price_cents,subtotal_cents,total_cents,actor_n3_user_key,n3_stock_id_snapshot,n3_uom_id_snapshot,n3_tax_code_id_snapshot,reverses_line_id,reason) values($1,$2,$3,'reversal','committed','Historical cancellation',-1000,-1000,-1000,'synthetic-owner',$4,'1','8',$5,'Synthetic reversal')",
      [reversal, t, f, malformed ? "102" : "101", original],
    );
    const versions = await query("select hotelhub_settlement_sources($1::uuid,$2::uuid) as value", [
      t,
      r,
    ]);
    for (const l of p.legs)
      l.snapshot = seal({
        ...Object.fromEntries(Object.entries(l.snapshot).filter(([k]) => k !== "digest")),
        sourceVersions: versions,
      });
    return seal(Object.fromEntries(Object.entries(p).filter(([k]) => k !== "digest")));
  }
  await check("valid_reversal_history_freezes_only_active_membership", async () => {
    const p = await reversedHistory(await prepare());
    const stay = await freeze(p);
    assert.deepEqual(
      stay.legs.map((l) => l.snapshot.totalCents),
      [30000, 4000],
    );
    assert.equal(
      await query("select count(*)::int as value from hotel_source_billing_line_membership"),
      2,
    );
    assert.equal(await query("select count(*)::int as value from hotel_folio_lines"), 4);
    assert.equal(
      p.legs[0].snapshot.sourceVersions.filter((v) => v.table === "hotel_folio_lines").length,
      4,
    );
  });
  await check("malformed_cancelling_reversal_history_is_not_silently_ignored", async () => {
    const p = await reversedHistory(await prepare(), true);
    await denied(
      "select hh_source_billing_freeze($1::uuid,$2::uuid,'synthetic-owner',$3::jsonb,$4::uuid)",
      [t, r, JSON.stringify(p), randomUUID()],
      "source_billing_charge_mismatch",
    );
    assert.equal(await query("select count(*)::int as value from hotel_source_billing_plans"), 0);
  });
  await check("line_and_payer_mutations_fenced_after_freeze", async () => {
    const p = await prepare();
    await freeze(p);
    await denied(
      "update hotel_folio_lines set total_cents=40001 where id=$1",
      [extra],
      "settlement_locked",
    );
    const src = p.payer.policy.sourceId,
      at = await query("select updated_at::text as value from hotel_reservations where id=$1", [r]);
    await denied(
      "select hh_source_billing_payer_confirm($1::uuid,$2::uuid,'synthetic-owner','owner',$3::uuid,'guest','1','2',$4::timestamptz)",
      [t, r, src, at],
      "settlement_locked",
    );
    await denied("delete from hotel_source_billing_line_membership", [], "settlement_immutable");
  });
  await check("exact_leg_reader_never_returns_sibling_or_foreign_plan", async () => {
    const p = await prepare();
    await freeze(p);
    assert.equal((await readLeg(source, p.digest)).id, source);
    assert.equal((await readLeg(guest, p.digest)).id, guest);
    await denied(
      "select hh_source_billing_leg_read($1::uuid,$2::uuid,'synthetic-owner','owner',$3::uuid,$4)",
      [t, r, source, "f".repeat(64)],
      "settlement_scope_mismatch",
    );
    await denied(
      "select hh_source_billing_leg_claim($1::uuid,$2::uuid,'synthetic-owner',$3::uuid,$4,$5::uuid,'1','bill',null,'d',null)",
      [t, r, source, p.digest, guest],
      "settlement_scope_mismatch",
    );
  });
  await check("source_receipt_denied_at_both_scoped_and_core_claim", async () => {
    const p = await prepare();
    await freeze(p);
    await denied(
      "select hh_source_billing_leg_claim($1::uuid,$2::uuid,'synthetic-owner',$3::uuid,$4,$3::uuid,'1','balance_receipt',null,'d',null)",
      [t, r, source, p.digest],
      "source_billing_guest_action_required",
    );
    await denied(
      "select hotelhub_settlement_claim($1::uuid,$2::uuid,'synthetic-owner',$3::uuid,'1','balance_receipt',null,'d',null)",
      [t, r, source],
      "source_billing_guest_action_required",
    );
  });
  await check("one_claim_per_leg_outcome_returns_only_its_intent", async () => {
    const p = await prepare();
    await freeze(p);
    const facts = {
        kind: "bill",
        snapshotDigest: p.legs[0].snapshot.digest,
        payload: { synthetic: true },
      },
      hash = createHash("sha256").update(canonical(facts.payload)).digest("hex");
    const args = [t, r, source, p.digest, source, "1", "bill", null, hash, JSON.stringify(facts)];
    const sql =
      "select hh_source_billing_leg_claim($1::uuid,$2::uuid,'synthetic-owner',$3::uuid,$4,$5::uuid,$6,$7,$8::uuid,$9,$10::jsonb) as value";
    const claim = await query(sql, args);
    assert.equal(claim.intentId, source);
    assert.equal(await query(sql, args), null);
    const outcome = await query(
      "select hh_source_billing_leg_outcome($1::uuid,$2::uuid,'synthetic-owner',$3::uuid,$4,$5::uuid,'2',$6::uuid,$7,$8::jsonb) as value",
      [
        t,
        r,
        source,
        p.digest,
        source,
        claim.attemptId,
        hash,
        JSON.stringify({ kind: "unknown", code: "n3_timeout" }),
      ],
    );
    assert.equal(outcome.id, source);
    assert.equal(outcome.state, "needs_review");
    assert.equal((await readLeg(guest, p.digest)).state, "frozen");
    assert.equal(
      (
        await query(
          "select hh_source_billing_read($1::uuid,$2::uuid,'synthetic-owner','owner') as value",
          [t, r],
        )
      ).revision,
      "3",
    );
  });
  await check("individual_source_or_guest_close_and_abandon_denied", async () => {
    const p = await prepare();
    await freeze(p);
    for (const leg of [source, guest]) {
      await denied(
        "select hotelhub_settlement_close($1::uuid,$2::uuid,'synthetic-owner',$3::uuid,'1',$4)",
        [t, r, leg, "d".repeat(64)],
        "source_billing_whole_stay_required",
      );
      await denied(
        "select hotelhub_settlement_abandon($1::uuid,$2::uuid,'synthetic-owner',$3::uuid,'1')",
        [t, r, leg],
        "source_billing_whole_stay_required",
      );
    }
  });
  await check("source_plan_cannot_coexist_with_active_legacy_intent", async () => {
    const p = await prepare();
    await db.query(
      "insert into hotel_settlement_intents(tenant_id,reservation_id,client_request_id,snapshot,digest,actor_n3_user_key) values($1,$2,$3,$4,'d'||repeat('d',63),'synthetic-owner')",
      [
        t,
        r,
        randomUUID(),
        JSON.stringify({ tenantId: t, reservationId: r, digest: "d".repeat(64) }),
      ],
    );
    await denied(
      "select hh_source_billing_freeze($1::uuid,$2::uuid,'synthetic-owner',$3::jsonb,$4::uuid)",
      [t, r, JSON.stringify(p), randomUUID()],
      "settlement_locked",
    );
  });
  await check("second_leg_number_overflow_rolls_back_whole_plan_and_first_number", async () => {
    const p = await prepare(),
      date = p.legs[0].snapshot.billDate,
      period = date.slice(2, 4) + date.slice(5, 7);
    await db.query(
      "insert into hotel_source_document_counters(tenant_id,series,period,last_number) values($1,'bill',$2,99998)",
      [t, period],
    );
    await denied(
      "select hh_source_billing_freeze($1::uuid,$2::uuid,'synthetic-owner',$3::jsonb,$4::uuid)",
      [t, r, JSON.stringify(p), randomUUID()],
      "source_document_number_overflow",
    );
    assert.equal(await query("select count(*)::int as value from hotel_settlement_intents"), 0);
    assert.equal(await query("select count(*)::int as value from hotel_source_billing_plans"), 0);
    assert.equal(
      await query("select count(*)::int as value from hotel_source_document_numbers"),
      0,
    );
    assert.equal(
      await query("select last_number as value from hotel_source_document_counters"),
      99998,
    );
  });
  await check("public_roles_cannot_read_mutate_or_execute_source_ledger", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec("set local role " + role);
      await denied(
        "select * from hotel_source_billing_plans",
        [],
        "permission denied for table hotel_source_billing_plans",
      );
      await denied(
        "select hh_source_billing_read($1::uuid,$2::uuid,'synthetic-owner','owner')",
        [t, r],
        "permission denied for function hh_source_billing_read",
      );
      await db.exec("reset role");
    }
  });
  if (failures) throw Error(failures + " source leg SQL checks failed");
  console.log("PASS durable source legs; native concurrency NOT VERIFIED");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
