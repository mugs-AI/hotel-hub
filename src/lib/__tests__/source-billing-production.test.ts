import { describe, it, expect, vi } from "vitest";
import { createSourceBillingProductionDeps } from "../source-billing-adapter.server";
import { readSourceCheckout } from "../source-billing-confirmation.server";
import { actor, plan, saved } from "./fixtures/source-billing";
import type { SourceBillStore } from "../source-billing-store.server";
function setup() {
  const p = plan(),
    stay = saved(p);
  const ports = {
    store: { read: vi.fn(async () => null), freeze: vi.fn() } as unknown as SourceBillStore,
    prepare: vi.fn(async () => ({ kind: "confirmed" as const, value: p })),
    readLegacy: vi.fn(async () => false),
    readFrozenState: vi.fn(async () => {
      throw Error("frozen-state-required");
    }),
    masters: vi.fn(() => ({
      verifyLine: vi.fn(),
      checkCurrent: () => ({ kind: "confirmed" as const, value: true as const }),
    })),
    verifyReceipt: vi.fn(),
    now: () => new Date("2026-10-15T00:00:00Z"),
    invalidateSession: vi.fn(async () => {}),
  };
  return { p, stay, ports };
}
describe("source billing production service assembly", () => {
  it("connects authoritative prepare to existing zero-write confirmation review and closed gates", async () => {
    const x = setup(),
      deps = createSourceBillingProductionDeps(x.ports),
      v = await readSourceCheckout(actor, deps);
    expect(v.review).toMatchObject({ planDigest: x.p.digest, canConfirm: false });
    expect(v.blockers).toContain("n3_billing_contract_unverified");
    expect(x.ports.store.freeze).not.toHaveBeenCalled();
    expect(x.ports.readFrozenState).not.toHaveBeenCalled();
  });
  it("requires canonical frozen recovery rather than passing a leg to whole-folio repricing", async () => {
    const x = setup(),
      deps = createSourceBillingProductionDeps(x.ports),
      leg = x.stay.legs[0];
    const own = await deps.billing.legDeps(actor, leg),
      r = await own.snapshot(actor, leg.snapshot);
    expect(r).toMatchObject({ kind: "unavailable", code: "settlement_frozen_read_unavailable" });
    expect(x.ports.readFrozenState).toHaveBeenCalledTimes(1);
  });
  it("denies a different frozen snapshot without any local or N3 reads", async () => {
    const x = setup(),
      deps = createSourceBillingProductionDeps(x.ports),
      leg = x.stay.legs[0],
      own = await deps.billing.legDeps(actor, leg);
    expect(await own.snapshot(actor, x.stay.legs[1].snapshot)).toMatchObject({
      kind: "contradiction",
      code: "settlement_scope_mismatch",
    });
    expect(x.ports.readFrozenState).not.toHaveBeenCalled();
  });
});
