import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceiptVersionRow } from "../effective-receipts";
import {
  clearFinancialCache,
  FINANCIAL_LIMITS,
  readMonthlyFinancialDashboard,
  readReceiptReport,
  type FinancialDeposit,
  type FinancialReportingDeps,
} from "../financial-reporting-store.server";
import { financialMonth, validateReceiptReportFilter } from "../financial-reporting";
import { ReceiptControlError, type ReceiptSnapshot } from "../receipt-controls";
import type { ReceiptControlActor } from "../receipt-controls-evidence.server";

const T = "tenant-a";
const owner: ReceiptControlActor = { tenantId: T, n3UserKey: "u-owner", n3Token: "tok", role: "owner" };
const rid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function dep(n: number, over: Partial<FinancialDeposit> = {}): FinancialDeposit {
  return {
    id: `d${String(n).padStart(6, "0")}`,
    reservationId: "res-1",
    n3ReceiptId: rid(n),
    n3DocCode: `OR2610/${n}`,
    n3ReferenceNo: `HH-${n}`,
    customerLabel: "Walk-in",
    currency: "MYR",
    amountCents: 5000,
    paymentLines: [{ id: "acc-1", code: "310-000", name: "Maybank", amount: 50 }],
    createdAt: "2026-10-01T02:00:00Z",
    ...over,
  };
}
function snap(d: FinancialDeposit, over: Partial<ReceiptSnapshot> = {}): ReceiptSnapshot {
  return {
    receiptId: d.n3ReceiptId,
    docCode: d.n3DocCode!,
    documentDate: "2026-10-01",
    customerId: "c",
    currency: "MYR",
    amountCents: d.amountCents,
    paymentLines: [],
    contact: { customerName: "x", remark1: "", remark2: "", remark3: "", remark4: "" },
    documentState: "active",
    matchingState: "unmatched",
    journalExact: true,
    sourceFingerprint: "f",
    verifiedAt: "2026-10-02T00:00:00Z",
    ...over,
  };
}
function version(d: FinancialDeposit, over: Partial<ReceiptVersionRow>): ReceiptVersionRow {
  return {
    depositId: d.id,
    requestId: "req-1",
    versionNo: 1,
    state: "active",
    receiptId: d.n3ReceiptId,
    docCode: d.n3DocCode!,
    documentDate: "2026-10-01",
    currency: "MYR",
    amountCents: 8000,
    paymentLines: [{ accountId: "acc-1", code: "310-000", savedName: "Maybank", amountCents: 8000 }],
    replacementOf: null,
    verifiedAt: "2026-10-03T01:00:00Z",
    ...over,
  };
}

type World = {
  deposits: Map<string, FinancialDeposit[]>;
  versions: ReceiptVersionRow[];
  unresolved: string[];
  snaps: Map<string, ReceiptSnapshot | ReceiptControlError>;
  failPageAt?: number;
  installed?: boolean;
};

function makeDeps(world: World) {
  const calls = { tenants: new Set<string>(), pages: 0, verify: 0, maxInFlight: 0, inFlight: 0, settings: 0 };
  const scope = (t: string) => {
    calls.tenants.add(t);
    return world.deposits.get(t) ?? [];
  };
  const deps: FinancialReportingDeps = {
    async settings(t) {
      calls.tenants.add(t);
      calls.settings++;
      return { timezone: "Asia/Kuala_Lumpur", currency: "MYR" };
    },
    async depositPage(t, _w, after, limit) {
      calls.pages++;
      if (world.failPageAt !== undefined && calls.pages >= world.failPageAt) throw new Error("page failed");
      const all = [...scope(t)].sort((a, b) => (a.id < b.id ? -1 : 1));
      return all.filter((d) => after === null || d.id > after).slice(0, limit);
    },
    async depositsByIds(t, ids) {
      return scope(t).filter((d) => ids.includes(d.id));
    },
    async voidedDepositIds(t) {
      calls.tenants.add(t);
      if (world.installed === false) return null;
      return world.versions.filter((v) => v.state === "voided").map((v) => v.depositId);
    },
    async versions(t, ids) {
      calls.tenants.add(t);
      return world.installed === false ? null : world.versions.filter((v) => ids.includes(v.depositId));
    },
    async unresolved(_t, ids) {
      return world.unresolved.filter((id) => ids.includes(id));
    },
    async requests(_t, ids) {
      return ids.map((id) => ({ id, requestedBy: "u-fd", approvedBy: "u-owner", reason: "Typo in amount" }));
    },
    async bookingRefs() {
      return new Map([["res-1", "BK261001001"]]);
    },
    async userLabels() {
      return new Map([["u-fd", "Aina"], ["u-owner", "Owner Lim"]]);
    },
    async revision() {
      return `${world.versions.length}`;
    },
    async verifyReceipt(_a, id) {
      calls.verify++;
      calls.inFlight++;
      calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
      await new Promise((r) => setTimeout(r, 1));
      calls.inFlight--;
      const s = world.snaps.get(id);
      if (!s) throw new ReceiptControlError("n3_evidence_unavailable");
      if (s instanceof ReceiptControlError) throw s;
      return s;
    },
  };
  return { deps, calls };
}

function world(deposits: FinancialDeposit[], extra: Partial<World> = {}): World {
  return {
    deposits: new Map([[T, deposits], ["tenant-b", [dep(999, { id: "other", amountCents: 999900 })]]]),
    versions: [],
    unresolved: [],
    snaps: new Map(deposits.map((d) => [d.id, snap(d)])),
    ...extra,
  };
}

beforeEach(() => clearFinancialCache());

describe("readMonthlyFinancialDashboard", () => {
  it("denies non-Owners before any source read", async () => {
    const { deps, calls } = makeDeps(world([dep(1)]));
    for (const role of ["front_desk", "housekeeper"] as const)
      await expect(readMonthlyFinancialDashboard({ ...owner, role }, "2026-10", deps)).rejects.toThrow("forbidden");
    expect(calls.tenants.size).toBe(0);
  });

  it("reads only the server-authenticated tenant; sales/other collections Unavailable", async () => {
    const { deps, calls } = makeDeps(world([dep(1)]));
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect([...calls.tenants]).toEqual([T]);
    expect(r.deposits).toMatchObject({ amount: 50, status: "complete" });
    expect(r.sales.status).toBe("unavailable");
    expect(r.collections.status).toBe("unavailable");
  });

  it("pages past 500 local rows and includes every row", async () => {
    const many = Array.from({ length: 520 }, (_, i) => dep(i + 1, { amountCents: 100 }));
    const w = world(many);
    // Only 100 originals can be N3-checked per request; give them verified versions.
    w.versions = many.map((d) => version(d, { amountCents: 100, versionNo: 1 }));
    const { deps, calls } = makeDeps(w);
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(calls.pages).toBe(2);
    expect(r.deposits).toMatchObject({ amount: 520, count: 520, status: "complete" });
  });

  it("a page failure marks the source unavailable, never a partial total", async () => {
    const many = Array.from({ length: 520 }, (_, i) => dep(i + 1));
    const w = world(many, { failPageAt: 2 });
    const { deps } = makeDeps(w);
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(r.deposits).toMatchObject({ amount: null, status: "unavailable" });
  });

  it("more than the N3 check cap is Unavailable, not partial", async () => {
    const many = Array.from({ length: FINANCIAL_LIMITS.verifyCap + 1 }, (_, i) => dep(i + 1));
    const { deps, calls } = makeDeps(world(many));
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(r.deposits.status).toBe("unavailable");
    expect(r.deposits.explanation).toMatch(/too many/);
    expect(calls.verify).toBe(0);
  });

  it("runs at most three N3 checks at once", async () => {
    const many = Array.from({ length: 12 }, (_, i) => dep(i + 1));
    const { deps, calls } = makeDeps(world(many));
    await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(calls.verify).toBe(12);
    expect(calls.maxInFlight).toBeLessThanOrEqual(3);
  });

  it("stops starting N3 checks after the budget and reports Unavailable", async () => {
    const many = Array.from({ length: 6 }, (_, i) => dep(i + 1));
    const { deps } = makeDeps(world(many));
    let t = 0;
    deps.now = () => (t += 7_000);
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(r.deposits.status).toBe("unavailable");
  });

  it("an externally changed receipt is held Needs review", async () => {
    const d = dep(1);
    const w = world([d]);
    w.snaps.set(d.id, snap(d, { amountCents: 9000 }));
    const { deps } = makeDeps(w);
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(r.deposits.status).toBe("needs_review");
    const mismatch = world([d]);
    mismatch.snaps.set(d.id, new ReceiptControlError("n3_evidence_mismatch"));
    clearFinancialCache();
    const r2 = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(mismatch).deps);
    // No N3 date, so local creation time is never substituted.
    expect(r2.deposits).toMatchObject({ amount: null, status: "unavailable" });
  });

  it("uses the N3 document date, not the local creation date", async () => {
    const d = dep(1, { createdAt: "2026-09-30T23:00:00Z" });
    const w = world([d]);
    w.snaps.set(d.id, snap(d, { documentDate: "2026-09-30" }));
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(w).deps);
    expect(r.deposits.amount).toBe(0);
  });

  it("RM50 corrected to 80 then voided: deposits 0, void 80 in the void month", async () => {
    const d = dep(1);
    const w = world([d]);
    w.versions = [
      version(d, { versionNo: 1, amountCents: 8000 }),
      version(d, { versionNo: 2, state: "voided", amountCents: 0, requestId: "req-2", verifiedAt: "2026-10-05T01:00:00Z" }),
    ];
    const { deps, calls } = makeDeps(w);
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(r.deposits.amount).toBe(0);
    expect(r.voids).toMatchObject({ amount: 80, count: 1 });
    expect(calls.verify).toBe(0);
    const report = await readReceiptReport(
      owner,
      validateReceiptReportFilter(new URLSearchParams("tab=voided"), financialMonth("2026-10", "Asia/Kuala_Lumpur")),
      deps,
    );
    expect(report.items[0]).toMatchObject({ amount: 80, creationAmount: 50, reason: "Typo in amount", requesterLabel: "Aina", approverLabel: "Owner Lim" });
  });

  it("void plus replacement: one active contribution; original listed as voided with link", async () => {
    const d = dep(1);
    const w = world([d]);
    w.versions = [
      version(d, { versionNo: 1, state: "voided", amountCents: 0 }),
      version(d, { versionNo: 2, receiptId: rid(500), docCode: "OR2610/500", amountCents: 8000, replacementOf: d.n3ReceiptId }),
    ];
    const { deps } = makeDeps(w);
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(r.deposits).toMatchObject({ amount: 80, count: 1 });
    expect(r.voids.amount).toBe(50);
    const report = await readReceiptReport(owner, validateReceiptReportFilter(new URLSearchParams(""), financialMonth("2026-10", "Asia/Kuala_Lumpur")), deps);
    expect(report.total).toBe(2);
    expect(report.items.find((i) => i.status === "voided")?.replacementReceiptId).toBe(rid(500));
  });

  it("confirmed void + failed replacement + open request never resurrects RM50", async () => {
    const d = dep(1);
    const w = world([d], { unresolved: [] });
    w.versions = [version(d, { versionNo: 1, state: "voided", amountCents: 0 })];
    w.unresolved = [d.id];
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(w).deps);
    expect(r.deposits.amount).toBe(0);
    expect(r.voids.amount).toBe(50);
  });

  it("a confirmed empty month is 0; an inaccessible source is Unavailable", async () => {
    const empty = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(world([])).deps);
    expect(empty.deposits).toMatchObject({ amount: 0, status: "complete" });
    const { deps } = makeDeps(world([]));
    deps.depositPage = async () => {
      throw new Error("down");
    };
    clearFinancialCache();
    const down = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(down.deposits).toMatchObject({ amount: null, status: "unavailable" });
  });

  it("expired N3 session fails as unauthorized, not as zero", async () => {
    const d = dep(1);
    const w = world([d]);
    w.snaps.set(d.id, new ReceiptControlError("unauthorized"));
    await expect(readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(w).deps)).rejects.toThrow("unauthorized");
  });

  it("all four cards share one source batch; cache is keyed by revision", async () => {
    const d = dep(1);
    const w = world([d]);
    const { deps, calls } = makeDeps(w);
    await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(calls.pages).toBe(1);
    await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(calls.pages).toBe(1); // cached
    w.versions = [version(d, { versionNo: 1, state: "voided", amountCents: 0 })];
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(calls.pages).toBe(2); // new confirmed version busts the snapshot
    expect(r.deposits.amount).toBe(0);
  });

  it("never calls an N3 write", async () => {
    const spy = vi.fn();
    const { deps } = makeDeps(world([dep(1)]));
    (deps as unknown as { create: unknown }).create = spy;
    await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(spy).not.toHaveBeenCalled();
  });
});
