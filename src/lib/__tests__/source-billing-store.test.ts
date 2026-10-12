import { describe, expect, it, vi } from "vitest";
import { createSourceBillStore } from "../source-billing-store.server";
import { billingPayloadDigest } from "../n3-billing.server";
import type { SettlementRpc } from "../settlement-store.server";
import { source, guest, request, actor, plan, saved } from "./fixtures/source-billing";
function fixture(p = plan()) {
  const stay = saved(p);
  const rpc = vi.fn<SettlementRpc>(async (name, args) => ({
    data:
      name === "hh_source_billing_leg_read"
        ? (stay.legs.find((l) => l.legId === args.p_leg_id) ?? null)
        : stay,
    error: null,
  }));
  return { p, stay, rpc, store: createSourceBillStore(rpc) };
}
describe("durable source billing store", () => {
  it("one_booking_two_distinct_intents with frozen membership and stable local numbers", async () => {
    const { store, rpc, p } = fixture();
    const result = await store.freeze(actor, p, request);
    expect(result.legs.map((l) => l.id)).toEqual([source, guest]);
    expect(result.legs.map((l) => l.hhNumber)).toEqual(["SI261000001", "SI261000002"]);
    expect(rpc).toHaveBeenCalledWith(
      "hh_source_billing_freeze",
      expect.objectContaining({ p_plan: p, p_request_id: request }),
    );
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(actor.n3Token);
    expect(Object.isFrozen(result.plan.legs[0].snapshot.lines)).toBe(true);
  });
  it("leg_claim_cannot_use_sibling_intent before any RPC", async () => {
    const { store, rpc } = fixture();
    const leg = await store.forLeg(actor, source, plan().digest);
    rpc.mockClear();
    await expect(
      leg.claim(
        actor,
        guest,
        "1",
        { kind: "bill", facts: { kind: "bill", snapshotDigest: "d".repeat(64), payload: {} } },
        billingPayloadDigest({}),
      ),
    ).rejects.toThrow("settlement_scope_mismatch");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("source receive/allocation actions denied even on direct scoped store calls", async () => {
    const { store, rpc } = fixture();
    const leg = await store.forLeg(actor, source, plan().digest);
    rpc.mockClear();
    await expect(
      leg.claim(
        actor,
        source,
        "1",
        { kind: "balance_receipt", facts: {} as never },
        "d".repeat(64),
      ),
    ).rejects.toThrow("source_billing_guest_action_required");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("same_request_same_numbers_replay uses the same durable request", async () => {
    const { store, p } = fixture();
    expect(await store.freeze(actor, p, request)).toEqual(await store.freeze(actor, p, request));
  });
  it("rejects changed plan hashes and duplicate line membership without a freeze RPC", async () => {
    const { store, rpc, p } = fixture();
    const changed = structuredClone(p);
    changed.legs[1].snapshot.lines[0].localLineId = changed.legs[0].snapshot.lines[0].localLineId;
    await expect(store.freeze(actor, changed, request)).rejects.toThrow(
      "source_billing_invalid_plan",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returned sibling or changed frozen snapshot cannot satisfy a selected leg read", async () => {
    const { store, rpc, stay } = fixture();
    rpc.mockResolvedValue({ data: stay.legs[1], error: null });
    await expect(store.readLeg(actor, source, stay.plan.digest)).rejects.toThrow(
      "settlement_scope_mismatch",
    );
  });
  it("result must preserve all saved leg membership exactly once", async () => {
    const { store, rpc, stay } = fixture();
    rpc.mockResolvedValue({ data: { ...stay, legs: [stay.legs[0], stay.legs[0]] }, error: null });
    await expect(store.read(actor)).rejects.toThrow("source_billing_invalid_result");
  });
  it("scope/role/setup and whole-stay close gates remain closed", async () => {
    const { store, rpc } = fixture();
    await expect(store.freeze({ ...actor, role: "front_desk" }, plan(), request)).rejects.toThrow(
      "settlement_forbidden",
    );
    const leg = await store.forLeg(actor, guest, plan().digest);
    rpc.mockClear();
    await expect(leg.close(actor, guest, "1", "d".repeat(64))).rejects.toThrow(
      "source_billing_whole_stay_required",
    );
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { code: "42883" } });
    await expect(store.read(actor)).rejects.toThrow("settlement_setup_required");
  });
  it("scoped adapter retains exact intent and plan scope on every read and write", async () => {
    const { store, rpc, stay } = fixture();
    const leg = await store.forLeg(actor, guest, stay.plan.digest);
    rpc.mockClear();
    expect((await leg.read(actor))?.id).toBe(guest);
    expect(rpc).toHaveBeenCalledWith(
      "hh_source_billing_leg_read",
      expect.objectContaining({
        p_leg_id: guest,
        p_plan_digest: stay.plan.digest,
        p_actor: actor.n3UserKey,
      }),
    );
    await expect(leg.read({ ...actor, reservationId: request })).rejects.toThrow(
      "settlement_scope_mismatch",
    );
  });
});
