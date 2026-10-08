import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import * as gates from "../settlement-contracts.server";
import { coordinatorFixture, actor, intentId, billId } from "./fixtures/settlement-coordinator";
import { runSettlementStep, reconcileSettlement } from "../settlement-coordinator.server";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T04:00:00Z"));
  vi.spyOn(gates, "billingContractGate").mockImplementation((operation) => ({
    kind: "confirmed",
    value: {
      operation,
      evidenceHash: "a".repeat(64),
      concurrencyProofHash: "c".repeat(64),
      allocationMode: "preserve_existing",
      billTarget: "same_id_INV",
    },
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const post = {
  action: "post_bill" as const,
  clientRequestId: "77777777-7777-4777-8777-777777777777",
  snapshotDigest: "d".repeat(64),
  expectedRevision: "0",
};
async function step(
  f: ReturnType<typeof coordinatorFixture>,
  action: "apply_deposits" | "receive_balance" | "close",
) {
  const i = f.getIntent()!;
  return runSettlementStep(
    actor,
    {
      action,
      intentId,
      expectedRevision: i.revision,
      selectedAccountId: f.snapshot.receipts[0].payments[0].accountId,
    },
    f.deps,
  );
}
describe("one-step settlement coordinator", () => {
  it("fresh proof after the clock advances permits close without treating its own save as a stale client", async () => {
    const f = coordinatorFixture();
    await runSettlementStep(actor, post, f.deps);
    await step(f, "apply_deposits");
    await step(f, "receive_balance");
    await step(f, "receive_balance");
    vi.setSystemTime(new Date("2026-10-08T04:02:00Z"));
    const v = await step(f, "close");
    expect(v.state).toBe("closed");
    expect(f.writes).toHaveLength(4);
  });
  it("payment-account401 invalidates before a balance claim", async () => {
    const f = coordinatorFixture();
    await runSettlementStep(actor, post, f.deps);
    await step(f, "apply_deposits");
    const original = f.fetch.getMockImplementation()!;
    f.fetch.mockImplementation(async (url, init) =>
      String(url).includes("AccountCodes")
        ? new Response("{}", { status: 401 })
        : original(url, init),
    );
    await step(f, "receive_balance");
    expect(f.deps.invalidateSession).toHaveBeenCalled();
    expect(f.writes).toHaveLength(2);
  });
  it("a stale client revision never creates a new allocation", async () => {
    const f = coordinatorFixture();
    await runSettlementStep(actor, post, f.deps);
    await runSettlementStep(
      actor,
      { action: "apply_deposits", intentId, expectedRevision: "1" },
      f.deps,
    );
    expect(f.writes).toHaveLength(1);
  });
  it.each([
    "hotelhub_settlement_claim",
    "hotelhub_settlement_outcome",
    "hotelhub_settlement_prove",
  ])("allocation %s failure cannot replay the write", async (name) => {
    const f = coordinatorFixture();
    await runSettlementStep(actor, post, f.deps);
    f.fail.add(name);
    await step(f, "apply_deposits");
    f.fail.clear();
    await reconcileSettlement(actor, intentId, f.deps);
    await step(f, "apply_deposits");
    expect(f.writes).toHaveLength(2);
    expect(
      f.getIntent()?.dispatches.filter((d) => d.claim.kind === "deposit_allocation"),
    ).toHaveLength(1);
  });
  it("unknown balance receipt recovers by exact identity then allocates once", async () => {
    const f = coordinatorFixture();
    await runSettlementStep(actor, post, f.deps);
    await step(f, "apply_deposits");
    f.fault.timeout = true;
    await step(f, "receive_balance");
    f.fault.timeout = false;
    const deps = {
      ...f.deps,
      lookupExactReference: async () => ({
        kind: "confirmed" as const,
        value: ["33333333-3333-4333-8333-333333333333"],
      }),
    };
    const v = await reconcileSettlement(actor, intentId, deps);
    expect(v.receipts).toHaveLength(2);
    expect(f.writes).toHaveLength(3);
    await runSettlementStep(
      actor,
      { action: "receive_balance", intentId, expectedRevision: f.getIntent()!.revision },
      deps,
    );
    expect(f.writes).toHaveLength(4);
  });
  it("settles synthetic500/50/450 with one POST per action and one separate balance receipt", async () => {
    const f = coordinatorFixture();
    let v = await runSettlementStep(actor, post, f.deps);
    expect(v.blockers).toEqual([]);
    expect(v.bill?.outstandingCents).toBe(50000);
    expect(f.writes).toHaveLength(1);
    v = await step(f, "apply_deposits");
    expect(v.blockers).toEqual([]);
    expect(v.bill?.outstandingCents).toBe(45000);
    expect(f.writes).toHaveLength(2);
    v = await step(f, "receive_balance");
    expect(v.blockers).toEqual([]);
    expect(v.receipts).toHaveLength(2);
    expect(f.writes).toHaveLength(3);
    v = await step(f, "receive_balance");
    expect(v.state).toBe("settled");
    expect(v.bill?.outstandingCents).toBe(0);
    expect(f.writes).toHaveLength(4);
    v = await step(f, "close");
    expect(v.state).toBe("closed");
    expect(f.writes).toHaveLength(4);
  });
  it("two devices sharing a revision create exactly one durable bill attempt", async () => {
    const f = coordinatorFixture();
    await Promise.all([
      runSettlementStep(actor, post, f.deps),
      runSettlementStep(actor, post, f.deps),
    ]);
    expect(f.writes).toHaveLength(1);
    expect(f.getIntent()?.dispatches).toHaveLength(1);
  });
  it.each(["hotelhub_settlement_freeze", "hotelhub_settlement_claim"])(
    "%s failure never reaches N3",
    async (name) => {
      const f = coordinatorFixture();
      f.fail.add(name);
      await runSettlementStep(actor, post, f.deps);
      expect(f.writes).toHaveLength(0);
    },
  );
  it.each(["hotelhub_settlement_outcome", "hotelhub_settlement_prove"])(
    "%s failure preserves the fence and future requests never reissue",
    async (name) => {
      const f = coordinatorFixture();
      f.fail.add(name);
      await runSettlementStep(actor, post, f.deps);
      f.fail.clear();
      await runSettlementStep(actor, post, f.deps);
      await reconcileSettlement(actor, intentId, f.deps);
      expect(f.writes).toHaveLength(1);
      expect(f.getIntent()?.dispatches).toHaveLength(1);
    },
  );
  it.each([500, 401])(
    "HTTP%s after write invalidates or reviews without reissue",
    async (status) => {
      const f = coordinatorFixture();
      f.fault.writeStatus = status;
      await runSettlementStep(actor, post, f.deps);
      await runSettlementStep(actor, post, f.deps);
      expect(f.writes).toHaveLength(1);
      if (status === 401) expect(f.deps.invalidateSession).toHaveBeenCalled();
    },
  );
  it.each(["timeout", "malformed"] as const)(
    "%s needs GET-only exact-reference recovery; no result/multiple results never authorize",
    async (fault) => {
      const f = coordinatorFixture();
      f.fault[fault] = true;
      const v = await runSettlementStep(actor, post, f.deps);
      expect(v.allowedActions).toEqual([]);
      for (const ids of [[], [billId, billId]]) {
        await reconcileSettlement(actor, intentId, {
          ...f.deps,
          lookupExactReference: async () => ({ kind: "confirmed", value: ids }),
        });
        expect(f.writes).toHaveLength(1);
      }
      const recovered = await reconcileSettlement(actor, intentId, {
        ...f.deps,
        lookupExactReference: async () => ({ kind: "confirmed", value: [billId] }),
      });
      expect(recovered.bill?.id).toBe(billId);
      expect(f.writes).toHaveLength(1);
    },
  );
  it("401 before allocation sends no write and invalidates session", async () => {
    const f = coordinatorFixture();
    await runSettlementStep(actor, post, f.deps);
    f.fault.readStatus = 401;
    await step(f, "apply_deposits");
    expect(f.writes).toHaveLength(1);
    expect(f.deps.invalidateSession).toHaveBeenCalled();
  });
  it("changed freeze input, stale revision, front desk and housekeeper cannot dispatch", async () => {
    const f = coordinatorFixture();
    await runSettlementStep({ ...actor, role: "front_desk" }, post, f.deps);
    await runSettlementStep({ ...actor, role: "housekeeper" }, post, f.deps);
    expect(f.writes).toHaveLength(0);
    await runSettlementStep(actor, post, f.deps);
    f.snapshot.digest = "e".repeat(64);
    await step(f, "apply_deposits");
    expect(f.writes).toHaveLength(1);
  });
  it.each(["badGL", "extraOutstanding"] as const)(
    "fresh %s contradiction blocks next write",
    async (fault) => {
      const f = coordinatorFixture();
      await runSettlementStep(actor, post, f.deps);
      if (fault === "badGL") f.fault.badGL = true;
      else f.fault.extraOutstanding = 1;
      const v = await step(f, "apply_deposits");
      expect(v.allowedActions).toEqual([]);
      expect(f.writes).toHaveLength(1);
    },
  );
  it("allocation timeout recovers from saved before-state without allocating twice", async () => {
    const f = coordinatorFixture();
    await runSettlementStep(actor, post, f.deps);
    f.fault.timeout = true;
    await step(f, "apply_deposits");
    f.fault.timeout = false;
    const v = await reconcileSettlement(actor, intentId, f.deps);
    expect(v.bill?.outstandingCents).toBe(45000);
    expect(v.blockers).toEqual([]);
    await step(f, "apply_deposits");
    expect(f.writes).toHaveLength(2);
  });
  it("receipt excess prevents close and local close failure never sends another POST", async () => {
    const f = coordinatorFixture();
    await runSettlementStep(actor, post, f.deps);
    await step(f, "apply_deposits");
    await step(f, "receive_balance");
    await step(f, "receive_balance");
    f.fail.add("hotelhub_settlement_close");
    await step(f, "close");
    await step(f, "close");
    expect(f.writes).toHaveLength(4);
    f.fault.receiptExcess = 1;
    const v = await reconcileSettlement(actor, intentId, f.deps);
    expect(v.allowedActions).toEqual([]);
  });
});
