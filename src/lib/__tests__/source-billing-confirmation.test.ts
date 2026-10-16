import { beforeEach, describe, expect, it, vi } from "vitest";
import { actor, guest, plan, saved, request } from "./fixtures/source-billing";
import * as gates from "../settlement-contracts.server";
import * as sourceGates from "../source-billing-n3.server";
import * as coordinator from "../source-billing-coordinator.server";
import * as confirmation from "../source-billing-confirmation.server";
import type { SourceBillingDeps } from "../source-billing-coordinator.server";
import type { SourceStayView } from "../source-billing-view";
import type { StoredSourceStay } from "../source-billing-store.server";

function fixture() {
  const p = plan();
  let stored: StoredSourceStay | null = null;
  const writes: string[] = [];
  const state = (): SourceStayView => ({
    reservationId: actor.reservationId,
    revision: "1",
    planDigest: p.digest,
    canClose: false,
    blockers: [],
    legs: (stored?.legs ?? []).map((l) => ({
      legId: l.legId,
      kind: l.legKind,
      hhNumber: l.hhNumber,
      view: {
        tenantId: actor.tenantId,
        reservationId: actor.reservationId,
        intentId: l.id,
        snapshotDigest: l.snapshot.digest,
        revision: l.revision,
        state: l.state,
        currency: "MYR",
        bill: null,
        receipts: [],
        blockers: [],
        allowedActions: writes.includes(l.id) ? [] : ["post_bill"],
        verifiedAt: null,
      },
    })),
  });
  vi.spyOn(coordinator, "readSourceBillingStatus").mockImplementation(async () => state());
  vi.spyOn(coordinator, "runSourceBillStep").mockImplementation(async (_a, input) => {
    writes.push(input.legId);
    return state();
  });
  const store = {
    read: vi.fn(async () => stored),
    freeze: vi.fn(async () => {
      stored = saved(p);
      return stored;
    }),
  } as unknown as SourceBillingDeps["store"];
  const deps: confirmation.SourceConfirmationDeps = {
    billing: {
      store,
      legDeps: async () => {
        throw Error("not used in orchestration test");
      },
    },
    readLegacy: vi.fn(async () => false),
    prepare: vi.fn(async () => ({ kind: "confirmed" as const, value: p })),
  };
  return {
    p,
    deps,
    store,
    writes,
    state,
    setStored(v: StoredSourceStay | null) {
      stored = v;
    },
  };
}
const accepted = { kind: "confirmed", value: {} } as never;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(gates, "billingContractGate").mockReturnValue(accepted);
  vi.spyOn(sourceGates, "sourceBillingDocumentGate").mockReturnValue(accepted);
});
describe("folio confirmation and per-leg dispatch", () => {
  it("reads a review without freezing or posting and excludes private plan fields", async () => {
    const f = fixture();
    const v = await confirmation.readSourceCheckout(actor, f.deps);
    expect(v.review).toMatchObject({ planDigest: f.p.digest, totalCents: 34000, canConfirm: true });
    expect(v.review?.legs.map((l) => l.totalCents)).toEqual([30000, 4000]);
    expect(f.store.freeze).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
    expect(JSON.stringify(v)).not.toContain("mappingEvidence");
    expect(JSON.stringify(v)).not.toContain("private-test-token");
  });
  it("rechecks the reviewed full folio and freezes before dispatching each bill", async () => {
    const f = fixture();
    const v = await confirmation.confirmSourceCheckout(
      { ...actor, role: "front_desk" },
      {
        expectedFolioRevision: f.p.legs[0].snapshot.revision,
        planDigest: f.p.digest,
        clientRequestId: request,
      },
      f.deps,
    );
    expect(f.store.freeze).toHaveBeenCalledWith(
      expect.objectContaining({ role: "front_desk" }),
      f.p,
      request,
    );
    expect(f.writes).toEqual(f.p.legs.map((l) => l.legId));
    expect(v.stay?.canClose).toBe(false);
  });
  it("refuses stale amount, payer, date or folio review before any freeze", async () => {
    const f = fixture();
    await expect(
      confirmation.confirmSourceCheckout(
        actor,
        {
          expectedFolioRevision: f.p.legs[0].snapshot.revision,
          planDigest: "a".repeat(64),
          clientRequestId: request,
        },
        f.deps,
      ),
    ).rejects.toThrow("settlement_snapshot_changed");
    await expect(
      confirmation.confirmSourceCheckout(
        actor,
        {
          expectedFolioRevision: "999",
          planDigest: f.p.digest,
          clientRequestId: request,
        },
        f.deps,
      ),
    ).rejects.toThrow("settlement_snapshot_changed");
    expect(f.store.freeze).not.toHaveBeenCalled();
  });
  it("does not repost an existing stay, even after a failed confirmation response", async () => {
    const f = fixture();
    f.setStored(saved(f.p));
    await confirmation.confirmSourceCheckout(
      actor,
      {
        expectedFolioRevision: f.p.legs[0].snapshot.revision,
        planDigest: f.p.digest,
        clientRequestId: request,
      },
      f.deps,
    );
    expect(f.deps.prepare).not.toHaveBeenCalled();
    expect(f.store.freeze).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  });
  it.each(["digest", "revision"])(
    "rejects a saved plan with a changed reviewed %s",
    async (field) => {
      const f = fixture();
      f.setStored(saved(f.p));
      const input = {
        expectedFolioRevision: field === "revision" ? "999" : f.p.legs[0].snapshot.revision,
        planDigest: field === "digest" ? "a".repeat(64) : f.p.digest,
        clientRequestId: request,
      };
      await expect(confirmation.confirmSourceCheckout(actor, input, f.deps)).rejects.toThrow(
        "settlement_snapshot_changed",
      );
      expect(f.store.freeze).not.toHaveBeenCalled();
      expect(f.writes).toEqual([]);
    },
  );
  it("stops all sibling dispatches after session expiry", async () => {
    const f = fixture();
    vi.spyOn(coordinator, "runSourceBillStep").mockImplementation(async (_a, input) => {
      f.writes.push(input.legId);
      return { ...f.state(), blockers: ["n3_session_expired"] };
    });
    const v = await confirmation.confirmSourceCheckout(
      actor,
      {
        expectedFolioRevision: f.p.legs[0].snapshot.revision,
        planDigest: f.p.digest,
        clientRequestId: request,
      },
      f.deps,
    );
    expect(f.writes).toHaveLength(1);
    expect(v.blockers).toContain("n3_session_expired");
  });
  it("keeps source success and guest uncertainty without retrying either leg", async () => {
    const f = fixture();
    vi.spyOn(coordinator, "runSourceBillStep").mockImplementation(async (_a, input) => {
      f.writes.push(input.legId);
      const s = f.state();
      if (input.legId === guest) {
        s.blockers.push("settlement_identity_requires_review");
      }
      return s;
    });
    const input = {
      expectedFolioRevision: f.p.legs[0].snapshot.revision,
      planDigest: f.p.digest,
      clientRequestId: request,
    };
    const v = await confirmation.confirmSourceCheckout(actor, input, f.deps);
    expect(v.blockers).toContain("settlement_identity_requires_review");
    await confirmation.confirmSourceCheckout(actor, input, f.deps);
    expect(f.writes).toHaveLength(2);
  });
  it("keeps closed contracts from freezing or dispatching", async () => {
    const f = fixture();
    vi.spyOn(gates, "billingContractGate").mockReturnValue({
      kind: "unavailable",
      code: "n3_billing_contract_unverified",
    });
    const v = await confirmation.confirmSourceCheckout(
      actor,
      {
        expectedFolioRevision: f.p.legs[0].snapshot.revision,
        planDigest: f.p.digest,
        clientRequestId: request,
      },
      f.deps,
    );
    expect(v.review?.canConfirm).toBe(false);
    expect(f.store.freeze).not.toHaveBeenCalled();
  });
  it("preserves ordinary legacy intents for their existing recovery screen", async () => {
    const f = fixture();
    vi.mocked(f.deps.readLegacy).mockResolvedValue(true);
    expect((await confirmation.readSourceCheckout(actor, f.deps)).legacy).toBe(true);
    expect(f.deps.prepare).not.toHaveBeenCalled();
    await expect(
      confirmation.confirmSourceCheckout(
        actor,
        { expectedFolioRevision: "1", planDigest: f.p.digest, clientRequestId: request },
        f.deps,
      ),
    ).rejects.toThrow("settlement_locked");
  });
  it("rejects Housekeeper, malformed input and a prepared plan belonging to another stay", async () => {
    const f = fixture();
    const input = { expectedFolioRevision: "1", planDigest: f.p.digest, clientRequestId: request };
    await expect(
      confirmation.confirmSourceCheckout({ ...actor, role: "housekeeper" }, input, f.deps),
    ).rejects.toThrow("settlement_forbidden");
    await expect(
      confirmation.confirmSourceCheckout(actor, { ...input, clientRequestId: "bad" }, f.deps),
    ).rejects.toThrow("settlement_invalid_input");
    vi.mocked(f.deps.prepare).mockResolvedValue({
      kind: "confirmed",
      value: { ...f.p, scope: { ...f.p.scope, reservationId: request } },
    });
    await expect(confirmation.readSourceCheckout(actor, f.deps)).rejects.toThrow(
      "source_billing_invalid_plan",
    );
  });
});

it("binds the HTTP service methods to the fixed source coordinator", async () => {
  const f = fixture();
  f.setStored(saved(f.p));
  vi.spyOn(coordinator, "reconcileSourceBills").mockImplementation(async () => f.state());
  const services = confirmation.createSourceBillingServices(f.deps);
  const step = {
    legId: guest,
    planDigest: f.p.digest,
    expectedRevision: "1",
    action: {
      action: "post_bill" as const,
      intentId: guest,
      expectedRevision: "1",
      snapshotDigest: f.p.legs[1].snapshot.digest,
      clientRequestId: request,
    },
  };
  const result = await services.step(actor, step);
  expect(result.stay?.planDigest).toBe(f.p.digest);
  expect(coordinator.runSourceBillStep).toHaveBeenCalledWith(actor, step, f.deps.billing);
  await services.reconcile(actor, f.p.digest);
  expect(coordinator.reconcileSourceBills).toHaveBeenCalledWith(actor, f.p.digest, f.deps.billing);
});
