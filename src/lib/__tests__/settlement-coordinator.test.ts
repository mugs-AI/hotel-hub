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
  action: "apply_deposits" | "receive_balance" | "apply_balance" | "close",
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
  it("proves and closes a synthetic settlement with non-RFC N3 document GUIDs", async () => {
    const f = coordinatorFixture({
      billId: "22222222-2222-6222-0222-222222222222",
      balanceId: "33333333-3333-6333-f333-333333333333",
    });
    const posted = await runSettlementStep(actor, post, f.deps);
    expect(posted.bill?.id).toBe("22222222-2222-6222-0222-222222222222");
    await step(f, "apply_deposits");
    await step(f, "receive_balance");
    await step(f, "apply_balance");
    expect((await step(f, "close")).state).toBe("closed");
    expect(f.writes).toHaveLength(4);
  });
  it("retains a non-RFC acknowledged locator as unknown until GET proof, without re-posting", async () => {
    const f = coordinatorFixture({ billId: "22222222-2222-6222-0222-222222222222" });
    f.fault.readStatus = 503;
    const first = await runSettlementStep(actor, post, f.deps);
    expect(first.bill).toBeNull();
    expect(f.getIntent()?.dispatches[0].outcome).toMatchObject({
      kind: "unknown",
      documentId: "22222222-2222-6222-0222-222222222222",
    });
    f.fault.readStatus = 200;
    expect((await reconcileSettlement(actor, intentId, f.deps)).bill?.id).toBe(
      "22222222-2222-6222-0222-222222222222",
    );
    expect(f.writes).toHaveLength(1);
  });
  it("recovers an uncertain bill through one exact-reference non-RFC N3 identity", async () => {
    const f = coordinatorFixture({ billId: "22222222-2222-6222-0222-222222222222" });
    f.fault.timeout = true;
    await runSettlementStep(actor, post, f.deps);
    f.fault.timeout = false;
    const v = await reconcileSettlement(actor, intentId, {
      ...f.deps,
      lookupExactReference: async () => ({
        kind: "confirmed",
        value: ["22222222-2222-6222-0222-222222222222"],
      }),
    });
    expect(v.bill?.id).toBe("22222222-2222-6222-0222-222222222222");
    expect(f.writes).toHaveLength(1);
  });
  it("background GET verifies without persisting or dispatching", async () => {
    const { readSettlementStatus } = await import("../settlement-coordinator.server");
    const f = coordinatorFixture();
    await runSettlementStep(actor, post, f.deps);
    const previous = f.getIntent();
    f.calls.length = 0;
    vi.setSystemTime(new Date("2026-10-08T04:02:00Z"));
    await readSettlementStatus(actor, f.deps);
    expect(f.calls.every((x) => x.endsWith("_read"))).toBe(true);
    expect(f.getIntent()).toEqual(previous);
    expect(f.writes).toHaveLength(1);
  });

  it("fresh proof after the clock advances permits close without treating its own save as a stale client", async () => {
    const f = coordinatorFixture();
    await runSettlementStep(actor, post, f.deps);
    await step(f, "apply_deposits");
    await step(f, "receive_balance");
    await step(f, "apply_balance");
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
      { action: "apply_balance", intentId, expectedRevision: f.getIntent()!.revision },
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
    v = await step(f, "apply_balance");
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
    await step(f, "apply_balance");
    f.fail.add("hotelhub_settlement_close");
    await step(f, "close");
    await step(f, "close");
    expect(f.writes).toHaveLength(4);
    f.fault.receiptExcess = 1;
    const v = await reconcileSettlement(actor, intentId, f.deps);
    expect(v.allowedActions).toEqual([]);
  });
});

it("rereads the accounting set and blocks a concurrent external unmatch", async () => {
  const f = coordinatorFixture();
  await runSettlementStep(actor, post, f.deps);
  await step(f, "apply_deposits");
  await step(f, "receive_balance");
  await step(f, "apply_balance");
  const priorFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (...args: Parameters<typeof fetch>) => {
      const out = await priorFetch(...args);
      if (String(args[0]).includes("ARReceipts/GLPosting")) f.fault.extraOutstanding = 50;
      return out;
    }),
  );
  const v = await step(f, "close");
  expect(v.state).not.toBe("closed");
  expect(v.blockers).toContain("settlement_evidence_changed");
  expect(f.calls).not.toContain("hotelhub_settlement_close");
});
it("created and recovered balance receipts offer apply instead of another payment", async () => {
  const f = coordinatorFixture();
  await runSettlementStep(actor, post, f.deps);
  await step(f, "apply_deposits");
  const v = await step(f, "receive_balance");
  expect(v.allowedActions).toEqual(["apply_balance"]);
  const recovered = await reconcileSettlement(actor, intentId, f.deps);
  expect(recovered.allowedActions).toEqual(["apply_balance"]);
});

it("a participating receipt change during final verification prevents close", async () => {
  const f = coordinatorFixture();
  await runSettlementStep(actor, post, f.deps);
  await step(f, "apply_deposits");
  await step(f, "receive_balance");
  await step(f, "apply_balance");
  const prior = vi.mocked(fetch).getMockImplementation()!;
  const counts = new Map<string, number>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (...args: Parameters<typeof fetch>) => {
      const out = await prior(...args);
      const url = String(args[0]);
      if (url.includes("/ARReceipts/") && !url.includes("GLPosting")) {
        const n = (counts.get(url) || 0) + 1;
        counts.set(url, n);
        if (n > 1) {
          const data = await out.json();
          data.data.description = "Concurrent change";
          return Response.json(data);
        }
      }
      return out;
    }),
  );
  const view = await step(f, "close");
  expect(view.blockers).toContain("settlement_evidence_changed");
  expect(f.calls).not.toContain("hotelhub_settlement_close");
});
