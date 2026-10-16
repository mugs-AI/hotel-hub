import { describe, expect, it, vi } from "vitest";
import { bindSourceMatchingCheck } from "../source-billing-matching.server";
import { createSourceBillingProductionDeps } from "../source-billing-adapter.server";
import { billingPayloadDigest } from "../n3-billing.server";
import type { FrozenSourceState } from "../source-billing-frozen.server";
import { createSourceBillStore } from "../source-billing-store.server";
import { persistedIntentBoundTo, type SettlementRpc } from "../settlement-store.server";
import { actor, plan, saved, guest, source } from "./fixtures/source-billing";
import type { SavedCheckDeps } from "../saved-documents-check.server";

function fixture() {
  const p = plan();
  let stay = saved(p);
  const rpc = vi.fn<SettlementRpc>(async (name, args) => ({
    data: structuredClone(
      name === "hh_source_billing_leg_read"
        ? stay.legs.find((l) => l.legId === args.p_leg_id)
        : stay,
    ),
    error: null,
  }));
  const store = createSourceBillStore(rpc);
  const snapshot = vi.fn(async () => ({
    kind: "confirmed" as const,
    value: p.legs.find((l) => l.legId === guest)!.snapshot,
  }));
  const legDeps = vi.fn(async () => ({
    snapshot,
    now: () => new Date(),
    invalidateSession: vi.fn(),
  }));
  const legacyRead = vi.fn(async () => null);
  const base: SavedCheckDeps = {
    loadIntent: legacyRead,
    now: Date.now,
    authorize: async () => true,
    wait: async () => {},
    invalidateSession: async () => {},
  };
  return {
    p,
    rpc,
    store,
    snapshot,
    legDeps,
    base,
    legacyRead,
    change: (next: typeof stay) => {
      stay = next;
    },
    stay,
    input: { legId: guest, planDigest: p.digest, expectedRevision: "1" },
  };
}
describe("saved guest-leg matching binding", () => {
  it("loads the exact persisted guest intent and frozen snapshot without a legacy fallback", async () => {
    const x = fixture();
    const deps = await bindSourceMatchingCheck(
      actor,
      x.input,
      { store: x.store, legDeps: x.legDeps },
      x.base,
    );
    const intent = await deps.loadIntent(actor);
    expect(intent?.id).toBe(guest);
    expect(intent && persistedIntentBoundTo(intent, actor)).toBe(true);
    expect(x.legacyRead).not.toHaveBeenCalled();
    expect(await deps.snapshot!(actor, intent!.snapshot)).toMatchObject({
      kind: "confirmed",
      value: { digest: x.p.legs[1].snapshot.digest },
    });
    expect(
      x.rpc.mock.calls.every(([name]) =>
        ["hh_source_billing_read", "hh_source_billing_leg_read"].includes(name),
      ),
    ).toBe(true);
  });
  it.each([source, "99999999-9999-4999-8999-999999999999"])(
    "denies source or unrelated leg %s before master/N3 reads",
    async (legId) => {
      const x = fixture();
      await expect(
        bindSourceMatchingCheck(
          actor,
          { ...x.input, legId },
          { store: x.store, legDeps: x.legDeps },
          x.base,
        ),
      ).rejects.toThrow();
      expect(x.legDeps).not.toHaveBeenCalled();
      expect(x.snapshot).not.toHaveBeenCalled();
    },
  );
  it.each([{ planDigest: "f".repeat(64) }, { expectedRevision: "2" }])(
    "rejects stale selection %j before master/N3 reads",
    async (change) => {
      const x = fixture();
      await expect(
        bindSourceMatchingCheck(
          actor,
          { ...x.input, ...change },
          { store: x.store, legDeps: x.legDeps },
          x.base,
        ),
      ).rejects.toThrow();
      expect(x.legDeps).not.toHaveBeenCalled();
    },
  );
  it("bounds a stalled initial database binding by the shared request deadline", async () => {
    vi.useFakeTimers();
    try {
      const x = fixture();
      x.rpc.mockImplementation(() => new Promise(() => {}));
      let result = "pending";
      void bindSourceMatchingCheck(
        actor,
        x.input,
        { store: x.store, legDeps: x.legDeps },
        { ...x.base, deadlineAt: Date.now() + 10 },
      ).then(
        () => {
          result = "resolved";
        },
        () => {
          result = "cancelled";
        },
      );
      await vi.advanceTimersByTimeAsync(20);
      expect(result).toBe("cancelled");
      expect(x.legDeps).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects a revision change during the check", async () => {
    const x = fixture();
    const deps = await bindSourceMatchingCheck(
      actor,
      x.input,
      { store: x.store, legDeps: x.legDeps },
      x.base,
    );
    x.change({
      ...x.stay,
      legs: x.stay.legs.map((l) => (l.legId === guest ? { ...l, revision: "2" } : l)),
    });
    await expect(deps.loadIntent(actor)).rejects.toThrow("settlement_stale_revision");
  });
  it.each(["tenantId", "reservationId", "n3UserKey", "n3Token", "role"] as const)(
    "rejects changed %s before any further database read",
    async (key) => {
      const x = fixture();
      const deps = await bindSourceMatchingCheck(
        actor,
        x.input,
        { store: x.store, legDeps: x.legDeps },
        x.base,
      );
      x.rpc.mockClear();
      await expect(deps.loadIntent({ ...actor, [key]: "foreign" })).rejects.toThrow(
        "settlement_scope_mismatch",
      );
      expect(x.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["cancel", "session_loss"])(
    "does not resume production master reads after %s during a frozen-state read",
    async (reason) => {
      const x = fixture(),
        controller = new AbortController();
      let authorized = true,
        release!: (state: FrozenSourceState) => void;
      const lineRows = x.stay.plan.legs
        .flatMap((l) => l.snapshot.lines)
        .map(({ mappingEvidence: _mapping, ...line }) => line)
        .sort((a, b) => a.localLineId.localeCompare(b.localLineId));
      const snap = x.stay.legs[1].snapshot;
      const preparation = {
        tenantId: actor.tenantId,
        reservationId: actor.reservationId,
        folioId: snap.folioId,
        billDate: snap.billDate,
        sourceVersions: snap.sourceVersions,
        lines: lineRows,
        totalCents: x.p.totalCents,
        digest: billingPayloadDigest({
          sourceVersions: snap.sourceVersions,
          lines: lineRows,
          billDate: snap.billDate,
          totalCents: x.p.totalCents,
        }),
      };
      const state: FrozenSourceState = {
        stay: x.stay,
        preparation,
        sourceVersions: snap.sourceVersions,
        status: "checked_in",
        folioStatus: "prepared",
      };
      const verifyLine = vi.fn(async (_a, _header, line) => ({
        kind: "confirmed" as const,
        value: line,
      }));
      const readFrozenState = vi.fn(async () => state);
      readFrozenState.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const deps = createSourceBillingProductionDeps({
        store: x.store,
        prepare: vi.fn(),
        readLegacy: vi.fn(),
        readFrozenState,
        masters: () => ({
          verifyLine,
          checkCurrent: () => ({ kind: "confirmed" as const, value: true as const }),
        }),
        verifyReceipt: vi.fn(),
        now: () => new Date("2026-11-01T00:00:00Z"),
        invalidateSession: vi.fn(),
      });
      const bound = await bindSourceMatchingCheck(actor, x.input, deps.billing, {
        ...x.base,
        signal: controller.signal,
        authorize: async () => authorized,
      });
      const pending = bound.snapshot!(actor, snap);
      await vi.waitFor(() => expect(readFrozenState).toHaveBeenCalledTimes(1));
      authorized = reason !== "session_loss";
      if (reason === "cancel") controller.abort();
      if (reason === "cancel") await expect(pending).rejects.toThrow("cancelled");
      release(state);
      if (reason === "session_loss")
        expect(await pending).toMatchObject({ kind: "unavailable", code: "n3_session_expired" });
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(verifyLine).not.toHaveBeenCalled();
      expect(readFrozenState).toHaveBeenCalledTimes(1);
    },
  );
});
