import { describe, it, expect } from "vitest";
import { createChargeAttributionService } from "../charge-attribution.server";
import { actor, plan } from "./fixtures/source-billing";
import { settlementFixture } from "./fixtures/settlement";
import { snapshotDigest } from "../settlement-snapshot.server";
import type { SettlementActor } from "../settlement-context.server";
const payer = plan().payer;
function fixture() {
  const s = settlementFixture({ receipts: [] });
  s.lines[0].kind = "room_night";
  s.totalCents = s.lines[0].totalCents;
  const { digest: _d, ...rest } = s;
  return { ...rest, digest: snapshotDigest(rest) };
}
function setup() {
  let frozen = false,
    record: unknown = null,
    snapshot = fixture();
  const calls: string[] = [];
  const service = createChargeAttributionService({
    async rpc(name, args) {
      calls.push(name);
      if (name.endsWith("get"))
        return {
          data: {
            tenantId: actor.tenantId,
            reservationId: actor.reservationId,
            payerRevision: "1",
            payer,
            frozen,
            record,
          },
          error: null,
        };
      record = {
        revision: "1",
        basis: args.p_basis,
        basisDigest: args.p_basis_digest,
        assignments: args.p_assignments,
      };
      return { data: record, error: null };
    },
    async snapshot() {
      return { kind: "confirmed", value: snapshot };
    },
  });
  return {
    service,
    calls,
    setFrozen: () => {
      frozen = true;
    },
    setRecord: (r: unknown) => {
      record = r;
    },
    setSnapshot: (s: ReturnType<typeof fixture>) => {
      snapshot = s;
    },
  };
}
describe("scoped charge attribution service", () => {
  it("GET proposes room/source allocation without writes or private proof fields", async () => {
    const x = setup(),
      v = await x.service.read(actor);
    expect(v.rows[0].leg).toBe("source_room");
    expect(v.revision).toBe("0");
    expect(x.calls).toEqual(["hh_source_attribution_get"]);
    expect(JSON.stringify(v)).not.toMatch(/n3Token|mappingEvidence|sourceVersions/);
  });
  it("Owner saves one assignment for every canonical line", async () => {
    const x = setup(),
      v = await x.service.read(actor);
    const saved = await x.service.save(actor, {
      expectedRevision: v.revision,
      basisDigest: v.basisDigest,
      assignments: v.rows.map((r) => ({ lineId: r.lineId, leg: r.leg! })),
    });
    expect(saved.revision).toBe("1");
    expect(x.calls.filter((n) => n.endsWith("put"))).toHaveLength(1);
  });
  it("Front Desk cannot save", async () => {
    const x = setup();
    await expect(
      x.service.save(
        { ...actor, role: "front_desk" },
        { expectedRevision: "0", basisDigest: "a".repeat(64), assignments: [] },
      ),
    ).rejects.toThrow("forbidden");
    expect(x.calls).toHaveLength(0);
  });
  it("stale reviewed basis cannot be saved", async () => {
    const x = setup(),
      v = await x.service.read(actor);
    await expect(
      x.service.save(actor, {
        expectedRevision: "0",
        basisDigest: "a".repeat(64),
        assignments: v.rows.map((r) => ({ lineId: r.lineId, leg: "guest" })),
      }),
    ).rejects.toThrow("source_attribution_changed");
    expect(x.calls.filter((n) => n.endsWith("put"))).toHaveLength(0);
  });
  it("requires exact unique membership", async () => {
    const x = setup(),
      v = await x.service.read(actor),
      a = { lineId: v.rows[0].lineId, leg: "source_room" as const };
    await expect(
      x.service.save(actor, {
        expectedRevision: "0",
        basisDigest: v.basisDigest,
        assignments: [a, a],
      }),
    ).rejects.toThrow("source_charge_attribution_invalid");
  });
  it("frozen stays cannot change allocation", async () => {
    const x = setup(),
      v = await x.service.read(actor);
    x.setFrozen();
    await expect(
      x.service.save(actor, {
        expectedRevision: "0",
        basisDigest: v.basisDigest,
        assignments: v.rows.map((r) => ({ lineId: r.lineId, leg: "source_room" })),
      }),
    ).rejects.toThrow("source_attribution_frozen");
  });
  it("rejects a current snapshot from another booking", async () => {
    const x = setup(),
      s = fixture();
    s.reservationId = "88888888-8888-4888-8888-888888888888";
    const { digest: _d, ...facts } = s;
    x.setSnapshot({ ...facts, digest: snapshotDigest(facts) });
    await expect(x.service.read(actor)).rejects.toThrow("source_attribution_scope_mismatch");
  });
  it("detects an actor switch across a snapshot await", async () => {
    const a: SettlementActor = { ...actor },
      s = fixture();
    const service = createChargeAttributionService({
      rpc: async () => ({
        data: {
          tenantId: a.tenantId,
          reservationId: a.reservationId,
          payerRevision: "1",
          payer,
          frozen: false,
          record: null,
        },
        error: null,
      }),
      snapshot: async () => {
        a.n3UserKey = "different";
        return { kind: "confirmed", value: s };
      },
    });
    await expect(service.read(a)).rejects.toThrow("source_attribution_scope_mismatch");
  });
});
