import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPermission } from "../rbac";
import * as contracts from "../settlement-contracts.server";
import {
  runSettlementStep,
  reconcileSettlement,
  readSettlementStatus,
} from "../settlement-coordinator.server";
import { coordinatorFixture, actor, intentId } from "./fixtures/settlement-coordinator";
import { billingJournalBoundTo } from "../n3-billing.server";
import { createSourceBillStore } from "../source-billing-store.server";
import { plan, request, saved, actor as sourceActor } from "./fixtures/source-billing";
import type { SettlementActor } from "../settlement-context.server";
const staff: SettlementActor = {
  ...actor,
  role: "front_desk",
  n3UserKey: "synthetic-front-desk",
  n3Token: "synthetic-staff-token",
};
const post = {
  action: "post_bill" as const,
  clientRequestId: "77777777-7777-4777-8777-777777777777",
  snapshotDigest: "d".repeat(64),
  expectedRevision: "0",
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T04:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function acceptSyntheticContracts() {
  vi.spyOn(contracts, "billingContractGate").mockImplementation((operation) => ({
    kind: "confirmed",
    value: {
      operation,
      evidenceHash: "a".repeat(64),
      concurrencyProofHash: "c".repeat(64),
      allocationMode: "preserve_existing",
      billTarget: "same_id_INV",
    },
  }));
}
function assertOwnToken(f: ReturnType<typeof coordinatorFixture>) {
  expect(f.fetch.mock.calls.length).toBeGreaterThan(0);
  for (const [, init] of f.fetch.mock.calls)
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${staff.n3Token}`);
}
describe("ordinary checkout uses current Front Desk authority", () => {
  it("permits checkout while keeping setup, overrides and reports Owner-only", () => {
    expect(hasPermission("front_desk", "hotel:checkout:write")).toBe(true);
    expect(hasPermission("housekeeper", "hotel:checkout:write")).toBe(false);
    for (const p of [
      "hotel:setup",
      "hotel:folio:adjust",
      "hotel:charges:manage",
      "hotel:financial_reports:view",
      "hotel:receipt_controls:approve",
    ] as const)
      expect(hasPermission("front_desk", p)).toBe(false);
  });
  it("posts, collects and closes using only the staff token and fresh proof", async () => {
    acceptSyntheticContracts();
    const f = coordinatorFixture();
    let v = await runSettlementStep(staff, post, f.deps);
    expect(v.blockers).toEqual([]);
    expect(v.allowedActions).toContain("apply_deposits");
    for (const action of ["apply_deposits", "receive_balance", "apply_balance", "close"] as const) {
      v = await runSettlementStep(
        staff,
        {
          action,
          intentId,
          expectedRevision: f.getIntent()!.revision,
          ...(action === "receive_balance"
            ? { selectedAccountId: f.snapshot.receipts[0].payments[0].accountId }
            : {}),
        },
        f.deps,
      );
      expect(v.blockers).toEqual([]);
    }
    expect(v.state).toBe("closed");
    expect(f.writes).toHaveLength(4);
    assertOwnToken(f);
  });
  it("resumes an Owner-created intent with fresh staff reads, without reposting", async () => {
    acceptSyntheticContracts();
    const f = coordinatorFixture();
    await runSettlementStep(actor, post, f.deps);
    const writes = f.writes.length;
    f.fetch.mockClear();
    const v = await reconcileSettlement(staff, intentId, f.deps);
    expect(v.blockers).toEqual([]);
    expect(v.allowedActions).toContain("apply_deposits");
    expect(f.writes).toHaveLength(writes);
    assertOwnToken(f);
  });
  it("does not promote real unaccepted contracts for staff", async () => {
    const f = coordinatorFixture();
    const v = await runSettlementStep(staff, post, f.deps);
    expect(v.blockers).toContain("n3_billing_contract_unverified");
    expect(f.writes).toHaveLength(0);
  });
  it.each([401, 403])(
    "denied upstream rights %s prevent resumed financial dispatch",
    async (status) => {
      acceptSyntheticContracts();
      const f = coordinatorFixture();
      await runSettlementStep(actor, post, f.deps);
      f.fetch.mockClear();
      f.fault.readStatus = status;
      const v = await runSettlementStep(
        staff,
        { action: "apply_deposits", intentId, expectedRevision: f.getIntent()!.revision },
        f.deps,
      );
      expect(v.blockers.length).toBeGreaterThan(0);
      expect(f.writes).toHaveLength(1);
      assertOwnToken(f);
      if (status === 401) expect(f.deps.invalidateSession).toHaveBeenCalled();
    },
  );
  it("a denied Create remains a durable attempt and cannot be posted again", async () => {
    acceptSyntheticContracts();
    const f = coordinatorFixture();
    f.fault.writeStatus = 403;
    const v = await runSettlementStep(staff, post, f.deps);
    expect(v.blockers.length).toBeGreaterThan(0);
    expect(f.getIntent()!.dispatches).toHaveLength(1);
    await runSettlementStep(staff, post, f.deps);
    expect(f.writes).toHaveLength(1);
  });
  it.each(["n3Token", "n3UserKey"] as const)(
    "missing %s denies before any N3 operation",
    async (field) => {
      acceptSyntheticContracts();
      const f = coordinatorFixture();
      const v = await runSettlementStep({ ...staff, [field]: "" }, post, f.deps);
      expect(v.blockers).toContain("settlement_forbidden");
      expect(f.fetch).not.toHaveBeenCalled();
      expect(f.writes).toHaveLength(0);
    },
  );
  it("a staff status GET does not persist proof or write", async () => {
    acceptSyntheticContracts();
    const f = coordinatorFixture();
    await runSettlementStep(actor, post, f.deps);
    const before = f.getIntent();
    await readSettlementStatus(staff, f.deps);
    expect(f.getIntent()).toEqual(before);
    expect(f.writes).toHaveLength(1);
  });
  it("never reuses Owner-read provenance for a staff caller", async () => {
    const { n3BillingClient } = await import("../n3-billing.server");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "0000", data: [] })),
    );
    const out = await n3BillingClient.readBillJournal(
      actor,
      "22222222-2222-4222-8222-222222222222",
    );
    expect(billingJournalBoundTo(out, actor, "22222222-2222-4222-8222-222222222222")).toBe(true);
    expect(billingJournalBoundTo(out, staff, "22222222-2222-4222-8222-222222222222")).toBe(false);
  });
  it("freezes an already-derived source plan as staff without changing payer authority", async () => {
    const p = plan();
    const store = createSourceBillStore(async () => ({ data: saved(p), error: null }));
    const got = await store.freeze(
      {
        ...sourceActor,
        ...staff,
        tenantId: sourceActor.tenantId,
        reservationId: sourceActor.reservationId,
      },
      p,
      request,
    );
    expect(got.plan.digest).toBe(p.digest);
  });
});
