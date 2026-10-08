import { describe, it, expect, vi, afterEach } from "vitest";
import { coordinatorFixture, actor, intentId } from "./fixtures/settlement-coordinator";
import * as gates from "../settlement-contracts.server";
import { runSettlementStep } from "../settlement-coordinator.server";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("settlement close service boundary", () => {
  it("requires runtime accounting proof and sends the persisted digest to one atomic RPC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T04:00:00Z"));
    vi.spyOn(gates, "billingContractGate").mockImplementation((operation) => ({
      kind: "confirmed",
      value: {
        operation,
        evidenceHash: "a".repeat(64),
        concurrencyProofHash: "b".repeat(64),
        allocationMode: "preserve_existing",
        billTarget: "same_id_INV",
      },
    }));
    const f = coordinatorFixture();
    await runSettlementStep(
      actor,
      {
        action: "post_bill",
        clientRequestId: "77777777-7777-4777-8777-777777777777",
        snapshotDigest: f.snapshot.digest,
        expectedRevision: "0",
      },
      f.deps,
    );
    const step = async (action: "apply_deposits" | "receive_balance" | "close") =>
      runSettlementStep(
        actor,
        {
          action,
          intentId,
          expectedRevision: f.getIntent()!.revision,
          selectedAccountId: f.snapshot.receipts[0].payments[0].accountId,
        },
        f.deps,
      );
    await step("close");
    expect(f.calls.filter((x) => x.endsWith("_close"))).toHaveLength(0);
    await step("apply_deposits");
    await step("receive_balance");
    await step("receive_balance");
    expect((await step("close")).state).toBe("closed");
    await step("close");
    expect(f.calls.filter((x) => x.endsWith("_close"))).toHaveLength(1);
    expect(f.writes).toHaveLength(4);
  });
});
