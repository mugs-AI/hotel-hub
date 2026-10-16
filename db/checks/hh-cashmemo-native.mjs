// Disposable PostgreSQL only. No N3/network client or operational DB fallback.
import { readFileSync, readdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { connectTest } from "./hh-settlement-pg-client.mjs";
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  res = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
const digest = (v) => createHash("sha256").update(canonical(v)).digest("hex");
const seal = (v) => ({ ...v, digest: digest(v) });
export async function freezeCurrentGuest(client) {
  await client.query(
    "INSERT INTO hotel_settings(tenant_id,timezone,n3_walk_in_customer_id) VALUES($1,'Asia/Kuala_Lumpur','7')",
    [tenant],
  );
  await client.query(
    "INSERT INTO hotel_financial_settings(tenant_id,service_tax_registered,n3_tax_code_exempt_id,rounding_mode) VALUES($1,false,'8','none')",
    [tenant],
  );
  await client.query(
    "INSERT INTO hotel_user_roles(tenant_id,n3_user_key,role) VALUES($1,'synthetic-staff','front_desk'),($1,'synthetic-hk','housekeeper')",
    [tenant],
  );
  await client.query(
    "UPDATE hotel_folio_lines SET n3_stock_id_snapshot='101',n3_uom_id_snapshot='1',n3_tax_code_id_snapshot='8',tax_class='non_taxable' WHERE tenant_id=$1 AND folio_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'",
    [tenant],
  );
  const source = (
    await client.query("SELECT id FROM hotel_booking_sources WHERE tenant_id=$1", [tenant])
  ).rows[0].id;
  const policy = {
    sourceId: source,
    version: "1",
    defaultCollectionMode: "guest",
    allowedCollectionModes: ["guest"],
    sourceCustomerId: null,
    guestCustomerId: 7,
    guestDocumentTitle: "Guest folio",
    guestItemDescription: "Accommodation",
    showRoomPrices: true,
  };
  await client.query(
    "INSERT INTO hotel_reservation_payers(tenant_id,reservation_id,source_id,collection_mode,policy_snapshot,confirmed_by) VALUES($1,$2,$3,'guest',$4::jsonb,'synthetic-owner')",
    [tenant, res, source, JSON.stringify(policy)],
  );
  const payer = (
    await client.query(
      "SELECT hh_source_billing_payer_json(p) payer FROM hotel_reservation_payers p WHERE tenant_id=$1 AND reservation_id=$2",
      [tenant, res],
    )
  ).rows[0].payer;
  const sources = (
    await client.query("SELECT hotelhub_settlement_sources($1,$2) sources", [tenant, res])
  ).rows[0].sources;
  const date = (
    await client.query("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur')::date::text d")
  ).rows[0].d;
  const s = seal({
    tenantId: tenant,
    reservationId: res,
    folioId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    revision: "1",
    currency: "MYR",
    currencyId: 1,
    currencyRate: 1,
    propertyTimezone: "Asia/Kuala_Lumpur",
    billDate: date,
    sourceVersions: sources,
    customerId: 7,
    billTo: { name: "Synthetic guest", company: "", address: "", phone: "", email: "" },
    lines: [
      {
        localLineId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        kind: "add_on",
        stockId: 101,
        uomId: 1,
        taxCodeId: 8,
        qty: 1,
        unitCents: 50000,
        subtotalCents: 50000,
        taxCents: 0,
        totalCents: 50000,
        description: "Synthetic charge",
        mappingEvidence: { synthetic: true },
      },
    ],
    receipts: [],
    totalCents: 50000,
  });
  const legId = randomUUID(),
    p = seal({
      version: 1,
      scope: { tenantId: tenant, reservationId: res },
      payer,
      legs: [
        {
          legId,
          kind: "guest",
          customerId: 7,
          collectionMode: "guest",
          documentTitle: "Sales Invoice",
          itemDescription: "",
          showPrices: true,
          snapshot: s,
        },
      ],
      totalCents: s.totalCents,
    });
  const stay = (
    await client.query(
      "SELECT hh_source_billing_freeze($1,$2,'synthetic-owner',$3::jsonb,$4) stay",
      [tenant, res, JSON.stringify(p), randomUUID()],
    )
  ).rows[0].stay;
  return { stay, snapshot: s, plan: p, tenant, res };
}
export async function claimCurrentGuest(client, fixture, actor = "synthetic-owner") {
  const leg = fixture.stay.legs[0],
    payload = { synthetic: true },
    facts = { kind: "bill", snapshotDigest: fixture.snapshot.digest, payload };
  return (
    await client.query(
      "SELECT hh_source_billing_leg_claim($1,$2,$3,$4,$5,$4,$6,'bill',NULL,$7,$8::jsonb) claim",
      [
        tenant,
        res,
        actor,
        leg.legId,
        fixture.plan.digest,
        leg.revision,
        digest(payload),
        JSON.stringify(facts),
      ],
    )
  ).rows[0].claim;
}
async function main() {
  const clients = [];
  try {
    const admin = await connectTest({ empty: true });
    clients.push(admin);
    await admin.query("SET hotelhub.disposable_test='enabled';SET check_function_bodies=off");
    for (const f of [
      "db/checks/hh-settlement-setup.sql",
      "supabase/migrations/20261003120216_hh_automatic_receipt_controls.sql",
      "supabase/migrations/20261012075339_hh_staff_receipt_authority.sql",
      "db/checks/hh-settlement-seed.sql",
    ])
      await admin.query(readFileSync(f, "utf8"));
    await admin.query("SET check_function_bodies=on");
    const pending = readdirSync("supabase/migrations")
      .filter(
        (f) =>
          /^202610/.test(f) &&
          f.slice(0, 14) >= "20261008080000" &&
          f.slice(0, 14) !== "20261012075339",
      )
      .sort();
    assert.equal(pending.length, 11);
    for (const f of pending) await admin.query(readFileSync("supabase/migrations/" + f, "utf8"));
    const fixture = await freezeCurrentGuest(admin);
    console.log(
      "PASS combined11 migrations and current canonical source freeze on native PostgreSQL17.6",
    );
    const workers = await Promise.all(Array.from({ length: 20 }, () => connectTest()));
    clients.push(...workers);
    assert.equal(new Set(workers.map((c) => c.processID)).size, 20);
    const claims = await Promise.all(
      workers.map((c, i) =>
        claimCurrentGuest(c, fixture, i % 2 ? "synthetic-staff" : "synthetic-owner"),
      ),
    );
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM hotel_settlement_attempts WHERE intent_id=$1",
          [fixture.stay.legs[0].legId],
        )
      ).rows[0].n,
      1,
    );
    console.log(
      "PASS exactly one current source-leg claim across20 independent Owner/FrontDesk sessions",
    );
    assert.equal(await claimCurrentGuest(admin, fixture), null);
    await assert.rejects(
      () => claimCurrentGuest(admin, fixture, "synthetic-hk"),
      /settlement_forbidden/,
    );
    console.log("PASS duplicate replay creates no second claim; Housekeeper denied");
    console.log(
      "N3 financial acceptance, allocation concurrency and whole-stay close NOT VERIFIED by this SQL proof",
    );
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
