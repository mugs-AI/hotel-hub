// Final review regression scenarios; real disposable PostgreSQL, no external calls.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const req = createRequire(
  resolve(
    process.env.HH_SECURITY_SQL_TOOLS || ".superpowers/sdd/2026-10-09-security-cash/sql-tools",
    "package.json",
  ),
);
const { PGlite } = req("@electric-sql/pglite");
const pg = new PGlite();
let failures = 0;
await pg.exec(
  "create role anon;create role authenticated;create role service_role bypassrls;create table hotel_reservations(id uuid primary key,tenant_id uuid,status text,booking_reference text,unique(tenant_id,id));create table hotel_rooms(id uuid primary key,tenant_id uuid,room_number text,unique(tenant_id,id));create table hotel_reservation_rooms(id uuid primary key,tenant_id uuid,reservation_id uuid,hotel_room_id uuid,allocation_status text);create table hotel_reservation_deposits(tenant_id uuid);",
);
for (const ending of ["_hh_deposit_module_controls.sql", "_hh_security_cash.sql"]) {
  const f = readdirSync("supabase/migrations").find((f) => f.endsWith(ending));
  await pg.exec(readFileSync("supabase/migrations/" + f, "utf8"));
}
async function setup() {
  const t = randomUUID(),
    res = randomUUID(),
    rooms = [randomUUID(), randomUUID(), randomUUID()],
    stays = [randomUUID(), randomUUID(), randomUUID()];
  await pg.query("insert into hotel_reservations values($1,$2,'confirmed','BK-REVIEW')", [res, t]);
  for (let i = 0; i < 3; i++) {
    await pg.query("insert into hotel_rooms values($1,$2,$3)", [rooms[i], t, String(101 + i)]);
    await pg.query("insert into hotel_reservation_rooms values($1,$2,$3,$4,'reserved')", [
      stays[i],
      t,
      res,
      rooms[i],
    ]);
  }
  await pg.query("select hh_update_deposit_module_policy($1,'owner','0',true,true)", [t]);
  const cmd = (body, role = "owner") =>
    pg
      .query("select hh_security_command($1,$2,$3,$4,$5,$6::jsonb) as r", [
        t,
        res,
        role === "front_desk" ? "desk" : "owner",
        role,
        randomUUID(),
        JSON.stringify(body),
      ])
      .then((r) => r.rows[0].r);
  const collect = (i = 0) =>
    cmd({
      action: "collect",
      roomStayId: stays[i],
      payer: "Guest",
      recipient: "Guest",
      storage: "Envelope " + i,
      method: "cash",
      policyVersion: "0",
    });
  const statement = (body) =>
    pg
      .query("select hh_security_statement($1,'desk','front_desk',$2,$3::jsonb) as r", [
        t,
        randomUUID(),
        JSON.stringify(body),
      ])
      .then((r) => r.rows[0].r);
  return { t, res, rooms, stays, cmd, collect, statement };
}
async function check(name, fn) {
  try {
    await fn();
    console.log("PASS " + name);
  } catch (e) {
    failures++;
    console.log("FAIL " + name + ": " + e.message);
  }
}
try {
  await check("stale collection policy refuses a changed amount", async () => {
    const c = await setup();
    await pg.query("select hh_security_policy($1,'owner','0',10000,true,'New terms')", [c.t]);
    await assert.rejects(c.collect(), /security_policy_changed/);
  });
  await check("guest-favorable dispute restores due without fabricating cash", async () => {
    const c = await setup();
    let h = await c.collect();
    h = await c.cmd({
      action: "deduct",
      holdingId: h.id,
      version: h.version,
      cents: 2000,
      reason: "Missing key disputed",
      evidence: "Inspection",
      acknowledgment: "",
      disputed: true,
    });
    h = await c.cmd({
      action: "inspect",
      holdingId: h.id,
      version: h.version,
      clear: true,
      evidence: "Inspection complete",
    });
    h = await c.cmd({
      action: "reserve_return",
      holdingId: h.id,
      version: h.version,
      recipient: "Guest",
    });
    h = await c.cmd({
      action: "confirm_return",
      holdingId: h.id,
      version: h.version,
      operationId: h.pendingReturn.id,
      recipient: "Guest",
      acknowledgment: "Guest signed RM30",
    });
    assert.equal(h.heldCents, 2000);
    h = await c.cmd({
      action: "restore_due",
      holdingId: h.id,
      version: h.version,
      cents: 2000,
      reason: "Owner accepts guest dispute",
      evidence: "Case settlement",
      acknowledgment: "Guest accepted",
    });
    assert.equal(h.heldCents, 2000);
    assert.equal(h.returnableCents, 2000);
    await assert.rejects(
      c.cmd({
        action: "restore_due",
        holdingId: h.id,
        version: h.version,
        cents: 1,
        reason: "Too much",
        evidence: "Case",
        acknowledgment: "Signed",
      }),
      /security_invalid_amount/,
    );
    h = await c.cmd({
      action: "reserve_return",
      holdingId: h.id,
      version: h.version,
      recipient: "Guest",
    });
    h = await c.cmd({
      action: "confirm_return",
      holdingId: h.id,
      version: h.version,
      operationId: h.pendingReturn.id,
      recipient: "Guest",
      acknowledgment: "Guest received remaining RM20",
    });
    assert.equal(h.heldCents, 0);
    assert.equal(h.openCase, true);
    h = await c.cmd({
      action: "resolve_case",
      holdingId: h.id,
      version: h.version,
      reason: "All cash returned",
      evidence: "Signed RM30 plus RM20",
    });
    assert.equal(h.openCase, false);
    const events = (
      await pg.query(
        "select event,delta_held,delta_due from hotel_security_events where tenant_id=$1 and holding_id=$2 and event in('deduct','restore_due')",
        [c.t, h.id],
      )
    ).rows;
    assert.equal(events.length, 2);
    assert.equal(events.find((e) => e.event === "restore_due").delta_held, 0);
  });
  await check("opposing envelope discrepancies remain reviewable", async () => {
    const c = await setup();
    const h1 = await c.collect(),
      h2 = await c.collect(1);
    let s = await c.statement({
      action: "count",
      from: "2026-01-01T00:00:00Z",
      counts: [
        { holdingId: h1.id, cents: 4000 },
        { holdingId: h2.id, cents: 6000 },
      ],
      singlePerson: false,
      note: "Opposing discrepancies",
      storage: "Safe",
    });
    s = (
      await pg.query("select hh_security_statement($1,'owner','owner',$2,$3::jsonb) as r", [
        c.t,
        randomUUID(),
        JSON.stringify({
          action: "sign",
          statementId: s.id,
          version: s.version,
          acknowledgment: "Count reviewed",
        }),
      ])
    ).rows[0].r;
    assert.equal(s.varianceCents, 0);
    assert.equal(s.status, "variance_needs_review");
    assert.equal(s.envelopeVariances.length, 2);
  });
  await check("completed history is excluded from current count inputs", async () => {
    const c = await setup();
    const h1 = await c.collect();
    let h2 = await c.collect(1);
    h2 = await c.cmd({
      action: "inspect",
      holdingId: h2.id,
      version: h2.version,
      clear: true,
      evidence: "Clear",
    });
    h2 = await c.cmd({
      action: "reserve_return",
      holdingId: h2.id,
      version: h2.version,
      recipient: "Guest",
    });
    h2 = await c.cmd({
      action: "confirm_return",
      holdingId: h2.id,
      version: h2.version,
      operationId: h2.pendingReturn.id,
      recipient: "Guest",
      acknowledgment: "Signed",
    });
    const s = await c.statement({
      action: "count",
      from: "2026-01-01T00:00:00Z",
      counts: [{ holdingId: h1.id, cents: 5000 }],
      singlePerson: true,
      note: "Current envelope only",
      storage: "Safe",
    });
    assert.equal(s.countedCents, 5000);
    assert.equal(s.snapshot.holdings.length, 2);
  });
  await check("room moves invalidate the previous clearance", async () => {
    const c = await setup();
    let h = await c.collect();
    h = await c.cmd({
      action: "inspect",
      holdingId: h.id,
      version: h.version,
      clear: true,
      evidence: "101 clear",
    });
    await pg.query("update hotel_reservation_rooms set hotel_room_id=$1 where id=$2", [
      c.rooms[1],
      c.stays[0],
    ]);
    h = (await pg.query("select hh_security_holding($1,$2) as r", [c.t, h.id])).rows[0].r;
    assert.equal(h.inspectionClear, false);
    await assert.rejects(
      c.cmd({ action: "reserve_return", holdingId: h.id, version: h.version, recipient: "Guest" }),
      /security_inspection_required/,
    );
  });
  await check(
    "room move preserves pending handover and requires Owner reconciliation",
    async () => {
      const c = await setup();
      let h = await c.collect();
      h = await c.cmd({
        action: "inspect",
        holdingId: h.id,
        version: h.version,
        clear: true,
        evidence: "101 clear",
      });
      h = await c.cmd(
        { action: "reserve_return", holdingId: h.id, version: h.version, recipient: "Guest" },
        "front_desk",
      );
      const operation = h.pendingReturn.id;
      await pg.query("update hotel_reservation_rooms set hotel_room_id=$1 where id=$2", [
        c.rooms[1],
        c.stays[0],
      ]);
      h = (await pg.query("select hh_security_holding($1,$2) as r", [c.t, h.id])).rows[0].r;
      assert.equal(h.pendingReturn.id, operation);
      await assert.rejects(
        c.cmd(
          {
            action: "confirm_return",
            holdingId: h.id,
            version: h.version,
            operationId: operation,
            recipient: "Guest",
            acknowledgment: "Signed",
          },
          "front_desk",
        ),
        /security_owner_reconciliation_required/,
      );
      h = await c.cmd({
        action: "confirm_return",
        holdingId: h.id,
        version: h.version,
        operationId: operation,
        recipient: "Guest",
        acknowledgment: "Signed",
        reason: "Owner reconciled room move, cash and inspection paper",
      });
      assert.equal(h.heldCents, 0);
    },
  );
  await check("waiver collection receipt identifies actual collecting staff", async () => {
    const c = await setup();
    await c.cmd({ action: "waive", roomStayId: c.stays[0], reason: "Initial waiver" });
    const h = await c.cmd(
      {
        action: "collect",
        roomStayId: c.stays[0],
        payer: "Guest",
        recipient: "Guest",
        storage: "Envelope",
        method: "cash",
        policyVersion: "0",
      },
      "front_desk",
    );
    assert.equal(h.collectedBy, "desk");
  });
} finally {
  await pg.close();
}
if (failures) process.exitCode = 1;
