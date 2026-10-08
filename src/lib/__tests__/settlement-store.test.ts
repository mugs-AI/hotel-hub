import { billingPayloadDigest } from "../n3-billing.server";
import { describe, expect, it, vi } from "vitest";
import { createSettlementStore, type SettlementRpc } from "../settlement-store.server";
import { settlementFixture } from "./fixtures/settlement";
import type { Intent } from "../settlement";
import type { SettlementActor, SettlementProof } from "../settlement-context.server";
const actor: SettlementActor = {
  ...settlementFixture(),
  n3UserKey: "synthetic-owner",
  n3Token: "never-persist-this",
  role: "owner",
};
function intent(): Intent {
  return {
    tenantId: actor.tenantId,
    reservationId: actor.reservationId,
    id: "22222222-2222-4222-8222-222222222222",
    revision: "9007199254740993",
    state: "frozen",
    snapshot: settlementFixture(),
    dispatches: [],
  };
}
function setup(
  result: { data: unknown; error: null | { code?: string; message?: string } } = {
    data: intent(),
    error: null,
  },
) {
  const rpc = vi.fn<SettlementRpc>().mockResolvedValue(result);
  return { rpc, store: createSettlementStore(rpc) };
}
describe("service-only settlement store", () => {
  it("persisted dispatch authority survives a service read but cannot be copied from JSON", async () => {
    const { persistedDispatchBoundTo } = await import("../settlement-store.server");
    const facts = {
      kind: "bill" as const,
      snapshotDigest: settlementFixture().digest,
      payload: { synthetic: true },
    };
    const dispatch = {
      claim: {
        attemptId: "55555555-5555-4555-8555-555555555555",
        intentId: intent().id,
        kind: "bill",
        expectedRevision: "1",
        payloadDigest: billingPayloadDigest(facts.payload),
      },
      outcome: null,
      facts,
    };
    const { store } = setup({ data: { ...intent(), dispatches: [dispatch] }, error: null });
    const got = (await store.read(actor))!;
    expect(
      persistedDispatchBoundTo(got.dispatches[0], actor, intent().id, settlementFixture().digest),
    ).toBe(true);
    expect(
      persistedDispatchBoundTo(
        structuredClone(got.dispatches[0]),
        actor,
        intent().id,
        settlementFixture().digest,
      ),
    ).toBe(false);
    expect(Object.isFrozen(got.dispatches[0].facts)).toBe(true);
    expect(Object.isFrozen(got.dispatches[0].claim)).toBe(true);
    expect(Object.isFrozen(got.dispatches[0])).toBe(true);
  });
  it("a saved attempt with missing recovery facts is never treated as recoverable", async () => {
    const dispatch = {
      claim: {
        attemptId: "55555555-5555-4555-8555-555555555555",
        intentId: intent().id,
        kind: "bill",
        expectedRevision: "1",
        payloadDigest: "a".repeat(64),
      },
      outcome: null,
    };
    const { store } = setup({ data: { ...intent(), dispatches: [dispatch] }, error: null });
    await expect(store.read(actor)).rejects.toThrow("settlement_invalid_result");
  });
  it("claim atomically persists immutable date-bearing recovery facts", async () => {
    const payload = { synthetic: "persist exact payload" };
    const { billingPayloadDigest } = await import("../n3-billing.server");
    const facts = { kind: "bill" as const, snapshotDigest: settlementFixture().digest, payload };
    const claim = {
      attemptId: "55555555-5555-4555-8555-555555555555",
      intentId: intent().id,
      kind: "bill",
      expectedRevision: "9007199254740994",
      payloadDigest: billingPayloadDigest(payload),
    };
    const { store, rpc } = setup({ data: claim, error: null });
    await store.claim(
      actor,
      intent().id,
      intent().revision,
      { kind: "bill", facts } as Parameters<typeof store.claim>[3],
      claim.payloadDigest,
    );
    expect(rpc.mock.calls[0][1].p_dispatch_facts).toEqual(facts);
  });
  it("forged JSON recovery facts or a digest mismatch are rejected before RPC", async () => {
    const { store, rpc } = setup();
    const facts = {
      kind: "bill" as const,
      snapshotDigest: settlementFixture().digest,
      payload: { n3Token: actor.n3Token },
    };
    await expect(
      store.claim(
        actor,
        intent().id,
        intent().revision,
        { kind: "bill", facts } as Parameters<typeof store.claim>[3],
        "a".repeat(64),
      ),
    ).rejects.toThrow("settlement_invalid_dispatch_facts");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("schema_absent_disables_new_writer without fallback", async () => {
    const { rpc, store } = setup({
      data: null,
      error: { code: "PGRST202", message: "missing RPC" },
    });
    await expect(
      store.freeze(actor, settlementFixture(), "33333333-3333-4333-8333-333333333333"),
    ).rejects.toThrow("settlement_setup_required");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("preserves lossless revisions and passes only server-derived scope", async () => {
    const { rpc, store } = setup();
    const got = await store.freeze(
      actor,
      settlementFixture(),
      "33333333-3333-4333-8333-333333333333",
    );
    expect(got.revision).toBe("9007199254740993");
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("hotelhub_settlement_freeze");
    expect(args.p_actor).toBe(actor.n3UserKey);
    expect(args.p_tenant_id).toBe(actor.tenantId);
    expect(JSON.stringify(args)).not.toContain(actor.n3Token);
  });
  it("front desk cannot invoke any writer", async () => {
    const { rpc, store } = setup();
    await expect(
      store.freeze(
        { ...actor, role: "front_desk" },
        settlementFixture(),
        "33333333-3333-4333-8333-333333333333",
      ),
    ).rejects.toThrow("settlement_forbidden");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("alien snapshot denied before database", async () => {
    const { rpc, store } = setup();
    await expect(
      store.freeze(
        actor,
        settlementFixture({ tenantId: "44444444-4444-4444-8444-444444444444" }),
        "33333333-3333-4333-8333-333333333333",
      ),
    ).rejects.toThrow("settlement_scope_mismatch");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("alien database result never leaks", async () => {
    const { store } = setup({
      data: { ...intent(), tenantId: "44444444-4444-4444-8444-444444444444" },
      error: null,
    });
    await expect(store.read(actor)).rejects.toThrow("settlement_scope_mismatch");
  });
  it("number revision rejected instead of lossy coercion", async () => {
    const { store } = setup({ data: { ...intent(), revision: 9007199254740992 }, error: null });
    await expect(store.read(actor)).rejects.toThrow("settlement_invalid_result");
  });
  it("read absent intent is null", async () => {
    const { store } = setup({ data: null, error: null });
    expect(await store.read(actor)).toBeNull();
  });
  it("claimed dispatch binds exact scope revision payload and receipt", async () => {
    const receipt = settlementFixture().receipts[0];
    const rows = [
      {
        customerId: 7,
        receiptDocType: "OR" as const,
        receiptDocId: receipt.receiptId,
        docType: "INV" as const,
        docId: "33333333-3333-4333-8333-333333333333",
        paymentAmount: 50,
      },
    ];
    const facts = {
      kind: "deposit_allocation" as const,
      snapshotDigest: settlementFixture().digest,
      payload: rows,
      billId: rows[0].docId,
      receipt,
      before: {
        receipt,
        code: "SYNTHETIC-OR",
        immutableHeaderFingerprint: "e".repeat(64),
        amountCents: 5000,
        refundCents: 0,
        remainderCents: 5000,
        allocations: [],
        fingerprints: ["a".repeat(64), "b".repeat(64)],
      },
      expectedTotalToBillCents: 5000,
      expectedAfterFingerprint: "c".repeat(64),
    };
    const claim = {
      attemptId: "55555555-5555-4555-8555-555555555555",
      intentId: intent().id,
      kind: "deposit_allocation",
      receiptId: receipt.receiptId,
      expectedRevision: "9007199254740994",
      payloadDigest: billingPayloadDigest(rows),
    };
    const { store, rpc } = setup({ data: claim, error: null });
    expect(
      await store.claim(
        actor,
        intent().id,
        "9007199254740993",
        { kind: "deposit_allocation", receiptId: claim.receiptId, facts },
        claim.payloadDigest,
      ),
    ).toEqual(claim);
    expect(rpc.mock.calls[0][1].p_revision).toBe("9007199254740993");
    expect(rpc.mock.calls[0][1].p_dispatch_facts).toEqual(facts);
  });
  it("expired_lease_never_redispatches when RPC declines claim", async () => {
    const { store, rpc } = setup({ data: null, error: null });
    expect(
      await store.claim(
        actor,
        intent().id,
        "1",
        {
          kind: "bill",
          facts: {
            kind: "bill",
            snapshotDigest: settlementFixture().digest,
            payload: { synthetic: true },
          },
        },
        billingPayloadDigest({ synthetic: true }),
      ),
    ).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("stale_worker_cannot_record and receives stable error", async () => {
    const { store } = setup({
      data: null,
      error: { code: "P0001", message: "settlement_stale_revision" },
    });
    await expect(
      store.recordOutcome(
        actor,
        {
          attemptId: "55555555-5555-4555-8555-555555555555",
          intentId: intent().id,
          kind: "bill",
          expectedRevision: "1",
          payloadDigest: "a".repeat(64),
        },
        { kind: "unknown", code: "timeout" },
      ),
    ).rejects.toThrow("settlement_stale_revision");
  });
  it("pending deposit/receipt refuses freeze without retry", async () => {
    const { store, rpc } = setup({
      data: null,
      error: { code: "P0001", message: "settlement_pending_financial_operation" },
    });
    await expect(
      store.freeze(actor, settlementFixture(), "33333333-3333-4333-8333-333333333333"),
    ).rejects.toThrow("settlement_pending_financial_operation");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("forged proof never reaches SQL", async () => {
    const { store, rpc } = setup();
    await expect(store.recordProof(actor, intent().id, "1", {} as SettlementProof)).rejects.toThrow(
      "settlement_untrusted_proof",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
