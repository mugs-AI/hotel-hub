import { describe, it, expect, vi } from "vitest";
import { prepareSourceBill } from "../source-billing-preparation.server";
import { createChargeAttributionService } from "../charge-attribution.server";
import { actor, plan } from "./fixtures/source-billing";
import { settlementFixture } from "./fixtures/settlement";
import { snapshotDigest } from "../settlement-snapshot.server";
import { validateSourceBillPlan } from "../source-billing-store.server";
import type { SettlementActor } from "../settlement-context.server";
import type { ChargeLine } from "../settlement";

function setup() {
  const payer = structuredClone(plan().payer);
  const s = settlementFixture({ receipts: [] });
  s.lines.push({
    ...s.lines[0],
    localLineId: "33333333-3333-4333-8333-333333333333",
    kind: "add_on",
    unitCents: 1000,
    subtotalCents: 1000,
    totalCents: 1000,
  });
  s.totalCents += 1000;
  const { digest: _d, ...facts } = s;
  s.digest = snapshotDigest(facts);
  let record: unknown = null,
    payerRevision = "1",
    frozen = false;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name.endsWith("put")) {
      record = {
        revision: "1",
        basis: args.p_basis,
        basisDigest: args.p_basis_digest,
        assignments: args.p_assignments,
      };
      return { data: record, error: null };
    }
    return {
      data: {
        tenantId: actor.tenantId,
        reservationId: actor.reservationId,
        payerRevision,
        payer,
        frozen,
        record,
      },
      error: null,
    };
  });
  const snapshot = vi.fn(async () => ({ kind: "confirmed" as const, value: s }));
  const attribution = createChargeAttributionService({ rpc, snapshot });
  const verifyLine = vi.fn(
    async (_a: SettlementActor, h: { customerId: number }, l: ChargeLine) => ({
      kind: "confirmed" as const,
      value: {
        ...l,
        mappingEvidence: {
          customerId: h.customerId,
          arAccountCode: h.customerId === 7 ? "GUEST-AR" : "SOURCE-AR",
        },
      },
    }),
  );
  const readBillingCustomer = vi.fn(async (a: SettlementActor, id: number) => ({
    kind: "confirmed" as const,
    value: {
      tenantId: a.tenantId,
      customerId: id,
      currencyId: 1,
      currencyRate: 1,
      billTo: { name: "Synthetic source", company: "", address: "", phone: "", email: "" },
    },
  }));
  const checkCurrent = vi.fn(() => ({ kind: "confirmed" as const, value: true as const }));
  const deps = { attribution, masters: { verifyLine, readBillingCustomer, checkCurrent } };
  return {
    deps,
    payer,
    s,
    rpc,
    snapshot,
    attribution,
    verifyLine,
    readBillingCustomer,
    setRecord: (v: unknown) => {
      record = v;
    },
    changePayer: () => {
      payerRevision = "2";
    },
    freeze: () => {
      frozen = true;
    },
  };
}
describe("authoritative current source plan preparation", () => {
  it("uses one canonical allocation snapshot, own debtor graph per line and stable leg identities without writes", async () => {
    const x = setup();
    const first = await prepareSourceBill(actor, x.deps);
    expect(first.kind).toBe("confirmed");
    if (first.kind !== "confirmed") return;
    expect(validateSourceBillPlan(first.value, actor).digest).toBe(first.value.digest);
    expect(first.value.legs.map((l) => [l.kind, l.customerId, l.snapshot.totalCents])).toEqual([
      ["source_room", 8, 50000],
      ["guest", 7, 1000],
    ]);
    expect(first.value.legs[0].snapshot.lines[0].mappingEvidence).toMatchObject({
      customerId: 8,
      arAccountCode: "SOURCE-AR",
    });
    expect(first.value.legs[1].snapshot.lines[0].mappingEvidence).toMatchObject({
      customerId: 7,
      arAccountCode: "GUEST-AR",
    });
    expect(first.value.legs[0].snapshot.billTo.name).toBe("Synthetic source");
    expect(first.value.legs.every((l) => !l.snapshot.folioProjection)).toBe(true);
    expect(x.snapshot).toHaveBeenCalledTimes(1);
    expect(x.rpc.mock.calls.every(([name]) => name.endsWith("get"))).toBe(true);
    const again = await prepareSourceBill(actor, x.deps);
    expect(again).toEqual(first);
    expect(JSON.stringify(first)).not.toContain(actor.n3Token);
  });
  it("uses the saved Owner override rather than guessing from line kind", async () => {
    const x = setup(),
      v = await x.attribution.read(actor);
    await x.attribution.save(actor, {
      expectedRevision: v.revision,
      basisDigest: v.basisDigest,
      assignments: v.rows.map((r) => ({
        lineId: r.lineId,
        leg: r.kind === "room_night" ? "guest" : "source_room",
      })),
    });
    const r = await prepareSourceBill(actor, x.deps);
    expect(r.kind).toBe("confirmed");
    if (r.kind === "confirmed")
      expect(r.value.legs.map((l) => [l.kind, l.snapshot.totalCents])).toEqual([
        ["source_room", 1000],
        ["guest", 50000],
      ]);
  });
  it("guest collection needs no source customer and puts every line on guest", async () => {
    const x = setup();
    x.payer.collectionMode = "guest";
    const r = await prepareSourceBill(actor, x.deps);
    expect(r.kind).toBe("confirmed");
    if (r.kind === "confirmed") expect(r.value.legs.map((l) => l.kind)).toEqual(["guest"]);
    expect(x.readBillingCustomer).not.toHaveBeenCalled();
  });
  it("stale saved allocation blocks rather than silently migrating choices", async () => {
    const x = setup(),
      v = await x.attribution.read(actor);
    await x.attribution.save(actor, {
      expectedRevision: v.revision,
      basisDigest: v.basisDigest,
      assignments: v.rows.map((r) => ({ lineId: r.lineId, leg: r.leg! })),
    });
    x.changePayer();
    expect(await prepareSourceBill(actor, x.deps)).toMatchObject({
      kind: "unavailable",
      code: "source_attribution_stale",
    });
    expect(x.verifyLine).not.toHaveBeenCalled();
  });
  it("unassigned derived charges require Owner review", async () => {
    const x = setup();
    x.s.lines[1].kind = "service_charge";
    const { digest: _d, ...facts } = x.s;
    x.s.digest = snapshotDigest(facts);
    expect(await prepareSourceBill(actor, x.deps)).toMatchObject({
      kind: "unavailable",
      code: "source_charge_attribution_required",
    });
    expect(x.verifyLine).not.toHaveBeenCalled();
  });
  it("failed source proof stops before sibling verification", async () => {
    const x = setup();
    x.verifyLine.mockResolvedValueOnce({ kind: "unavailable", code: "n3_unauthorized" } as never);
    expect(await prepareSourceBill(actor, x.deps)).toMatchObject({
      kind: "unavailable",
      code: "n3_unauthorized",
    });
    expect(x.verifyLine).toHaveBeenCalledTimes(1);
  });
  it("a verifier cannot change canonical money or membership", async () => {
    const x = setup();
    x.verifyLine.mockImplementationOnce(async (_a, _h, l) => ({
      kind: "confirmed",
      value: {
        ...l,
        totalCents: 1,
        mappingEvidence: { customerId: 8, arAccountCode: "SOURCE-AR" },
      },
    }));
    expect(await prepareSourceBill(actor, x.deps)).toMatchObject({
      kind: "contradiction",
      code: "source_plan_line_changed",
    });
  });
  it("detects saved payer changes during master reads", async () => {
    const x = setup();
    const original = x.readBillingCustomer.getMockImplementation()!;
    x.readBillingCustomer.mockImplementation(async (...args) => {
      const r = await original(...args);
      x.changePayer();
      return r;
    });
    expect(await prepareSourceBill(actor, x.deps)).toMatchObject({
      kind: "unavailable",
      code: "source_attribution_changed",
    });
  });
  it("rejects an actor switch across master reads", async () => {
    const x = setup(),
      a = { ...actor };
    const original = x.readBillingCustomer.getMockImplementation()!;
    x.readBillingCustomer.mockImplementation(async (...args) => {
      const r = await original(...args);
      a.n3Token = "different";
      return r;
    });
    expect(await prepareSourceBill(a, x.deps)).toMatchObject({
      kind: "contradiction",
      code: "source_plan_actor_changed",
    });
  });
  it("denies Housekeeper before any read", async () => {
    const x = setup();
    expect(await prepareSourceBill({ ...actor, role: "housekeeper" }, x.deps)).toMatchObject({
      kind: "contradiction",
      code: "settlement_forbidden",
    });
    expect(x.rpc).not.toHaveBeenCalled();
  });
});
