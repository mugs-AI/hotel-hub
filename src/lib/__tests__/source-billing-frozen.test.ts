import { describe, it, expect, vi } from "vitest";
import { loadFrozenSourceLeg } from "../source-billing-frozen.server";
import { actor, plan, saved } from "./fixtures/source-billing";
import { billingPayloadDigest } from "../n3-billing.server";
import type { SettlementActor } from "../settlement-context.server";
import type { ChargeLine, LinkedReceipt } from "../settlement";
function setup() {
  const stay = saved(plan()),
    leg = stay.legs[0],
    s = leg.snapshot;
  const lines = stay.plan.legs
    .flatMap((l) => l.snapshot.lines)
    .map(({ mappingEvidence: _m, ...line }) => line)
    .sort((a, b) => a.localLineId.localeCompare(b.localLineId));
  const prep = {
    tenantId: actor.tenantId,
    reservationId: actor.reservationId,
    folioId: s.folioId,
    billDate: s.billDate,
    sourceVersions: s.sourceVersions,
    lines,
    totalCents: stay.plan.totalCents,
    digest: "",
  };
  prep.digest = billingPayloadDigest({
    sourceVersions: prep.sourceVersions,
    lines,
    billDate: prep.billDate,
    totalCents: prep.totalCents,
  });
  const state = {
    stay,
    preparation: prep,
    sourceVersions: s.sourceVersions,
    status: "checked_in",
    folioStatus: "prepared",
  };
  const readState = vi.fn(async () => structuredClone(state));
  const verifyLine = vi.fn(async (_a: SettlementActor, _h: unknown, l: ChargeLine) => ({
    kind: "confirmed" as const,
    value: structuredClone(l),
  }));
  const verifyReceipt = vi.fn(async (_a: SettlementActor, _s: unknown, r: LinkedReceipt) => ({
    kind: "confirmed" as const,
    value: r,
  }));
  const deps = {
    readState,
    masters: {
      verifyLine,
      checkCurrent: () => ({ kind: "confirmed" as const, value: true as const }),
    },
    verifyReceipt,
    now: () => new Date("2026-11-01T00:00:00Z"),
  };
  return { state, stay, leg, deps, readState, verifyLine, verifyReceipt };
}
describe("immutable canonical frozen-leg recovery", () => {
  it("preserves exact saved source leg across midnight without repricing or sibling lines", async () => {
    const x = setup(),
      r = await loadFrozenSourceLeg(actor, x.leg, x.deps);
    expect(r).toEqual({ kind: "confirmed", value: x.leg.snapshot });
    expect(x.verifyLine).toHaveBeenCalledTimes(x.leg.snapshot.lines.length);
    expect(x.verifyLine.mock.calls[0][1]).toMatchObject({ customerId: 8 });
    expect(x.verifyReceipt).not.toHaveBeenCalled();
    expect(x.readState).toHaveBeenCalledTimes(2);
  });
  it("verifies only the selected guest leg under its own debtor", async () => {
    const x = setup(),
      l = x.stay.legs[1];
    expect(await loadFrozenSourceLeg(actor, l, x.deps)).toEqual({
      kind: "confirmed",
      value: l.snapshot,
    });
    expect(x.verifyLine.mock.calls[0][1]).toMatchObject({ customerId: 7 });
  });
  it("denies changed raw source versions before network proof", async () => {
    const x = setup();
    x.state.sourceVersions = [
      { table: "hotel_folios", id: x.leg.snapshot.folioId, version: "changed" },
    ];
    expect(await loadFrozenSourceLeg(actor, x.leg, x.deps)).toMatchObject({
      kind: "contradiction",
      code: "settlement_snapshot_changed",
    });
    expect(x.verifyLine).not.toHaveBeenCalled();
  });
  it("denies missing or tampered immutable canonical preparation", async () => {
    const x = setup();
    x.state.preparation.lines[0].totalCents++;
    expect(await loadFrozenSourceLeg(actor, x.leg, x.deps)).toMatchObject({
      kind: "contradiction",
      code: "settlement_preparation_mismatch",
    });
  });
  it("denies a sibling leg supplied with another leg identity", async () => {
    const x = setup(),
      bad = { ...x.leg, snapshot: x.stay.legs[1].snapshot };
    expect(await loadFrozenSourceLeg(actor, bad, x.deps)).toMatchObject({
      kind: "contradiction",
      code: "settlement_scope_mismatch",
    });
  });
  it("cannot reuse saved mapping evidence after current account graph changes", async () => {
    const x = setup();
    x.verifyLine.mockImplementation(async (_a, _h, l) => ({
      kind: "confirmed",
      value: { ...l, mappingEvidence: { changed: true } },
    }));
    expect(await loadFrozenSourceLeg(actor, x.leg, x.deps)).toMatchObject({
      kind: "contradiction",
      code: "settlement_snapshot_changed",
    });
  });
  it("stops on N3 expiry without probing more lines", async () => {
    const x = setup();
    x.verifyLine.mockResolvedValueOnce({
      kind: "unavailable",
      code: "n3_session_expired",
    } as never);
    expect(await loadFrozenSourceLeg(actor, x.leg, x.deps)).toMatchObject({
      kind: "unavailable",
      code: "n3_session_expired",
    });
    expect(x.readState).toHaveBeenCalledTimes(1);
  });
  it("normalizes a current-master 401 to the coordinator stop signal", async () => {
    const x = setup();
    x.verifyLine.mockResolvedValueOnce({ kind: "unavailable", code: "n3_unauthorized" } as never);
    expect(await loadFrozenSourceLeg(actor, x.leg, x.deps)).toMatchObject({
      kind: "unavailable",
      code: "n3_session_expired",
    });
    expect(x.readState).toHaveBeenCalledTimes(1);
  });
  it("fences source changes during verification", async () => {
    const x = setup();
    x.verifyLine.mockImplementation(async (_a, _h, l) => {
      x.state.sourceVersions = [
        { table: "hotel_folios", id: x.leg.snapshot.folioId, version: "late" },
      ];
      return { kind: "confirmed", value: l };
    });
    expect(await loadFrozenSourceLeg(actor, x.leg, x.deps)).toMatchObject({
      kind: "contradiction",
      code: "settlement_snapshot_changed",
    });
  });
  it("fences the original caller across an await", async () => {
    const x = setup(),
      a = { ...actor };
    x.verifyLine.mockImplementation(async (_a, _h, l) => {
      a.n3Token = "different";
      return { kind: "confirmed", value: l };
    });
    expect(await loadFrozenSourceLeg(a, x.leg, x.deps)).toMatchObject({
      kind: "contradiction",
      code: "settlement_scope_mismatch",
    });
  });
  it("denies non-financial roles before reads", async () => {
    const x = setup();
    expect(
      await loadFrozenSourceLeg({ ...actor, role: "housekeeper" }, x.leg, x.deps),
    ).toMatchObject({ kind: "contradiction", code: "settlement_forbidden" });
    expect(x.readState).not.toHaveBeenCalled();
  });
});
