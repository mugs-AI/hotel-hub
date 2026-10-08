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
    const claim = {
      attemptId: "55555555-5555-4555-8555-555555555555",
      intentId: intent().id,
      kind: "deposit_allocation",
      receiptId: settlementFixture().receipts[0].receiptId,
      expectedRevision: "9007199254740994",
      payloadDigest: "a".repeat(64),
    };
    const { store, rpc } = setup({ data: claim, error: null });
    expect(
      await store.claim(
        actor,
        intent().id,
        "9007199254740993",
        { kind: "deposit_allocation", receiptId: claim.receiptId },
        claim.payloadDigest,
      ),
    ).toEqual(claim);
    expect(rpc.mock.calls[0][1].p_revision).toBe("9007199254740993");
  });
  it("expired_lease_never_redispatches when RPC declines claim", async () => {
    const { store, rpc } = setup({ data: null, error: null });
    expect(await store.claim(actor, intent().id, "1", { kind: "bill" }, "a".repeat(64))).toBeNull();
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
