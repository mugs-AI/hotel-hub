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
import type { N3MonthRow } from "../n3-month-receipts.server";

const T = "tenant-a";
const owner: ReceiptControlActor = {
  tenantId: T,
  n3UserKey: "u-owner",
  n3Token: "tok",
  role: "owner",
};
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
    paymentLines: d.paymentLines.map((l) => ({
      accountId: l.id,
      code: l.code,
      savedName: l.name,
      amountCents: Math.round(l.amount * 100),
    })),
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
    paymentLines: [
      { accountId: "acc-1", code: "310-000", savedName: "Maybank", amountCents: 8000 },
    ],
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
  /** Override the N3 month list; default derives from snaps' documentDate. */
  list?: (range: { startDate: string; endExclusive: string }) => N3MonthRow[];
};

function makeDeps(world: World) {
  const calls = {
    tenants: new Set<string>(),
    pages: 0,
    verify: 0,
    maxInFlight: 0,
    inFlight: 0,
    settings: 0,
    lists: 0 as number | undefined,
  };
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
    async depositPage(t, after, limit) {
      calls.pages++;
      if (world.failPageAt !== undefined && calls.pages >= world.failPageAt)
        throw new Error("page failed");
      const all = [...scope(t)].sort((a, b) => (a.id < b.id ? -1 : 1));
      return all.filter((d) => after === null || d.id > after).slice(0, limit);
    },
    async versions(t, ids) {
      calls.tenants.add(t);
      return world.installed === false
        ? null
        : world.versions.filter((v) => ids.includes(v.depositId));
    },
    async unresolved(_t, ids) {
      return world.unresolved.filter((id) => ids.includes(id));
    },
    async requests(_t, ids) {
      return ids.map((id) => ({
        id,
        requestedBy: "u-fd",
        approvedBy: "u-owner",
        reason: "Typo in amount",
      }));
    },
    async bookingRefs() {
      return new Map([["res-1", "BK261001001"]]);
    },
    async userLabels() {
      return new Map([
        ["u-fd", "Aina"],
        ["u-owner", "Owner Lim"],
      ]);
    },
    async revision() {
      return `${world.versions.length}`;
    },
    async listMonthReceipts(_a, range, skip, top) {
      calls.lists = (calls.lists ?? 0) + 1;
      const rows =
        world.list?.(range) ??
        [...(world.deposits.get(T) ?? [])].flatMap((d): N3MonthRow[] => {
          const s = world.snaps.get(d.id);
          const date = s && !(s instanceof ReceiptControlError) ? s.documentDate : "2026-10-01";
          return date >= range.startDate && date < range.endExclusive
            ? [
                {
                  id: d.n3ReceiptId,
                  docDate: date,
                  docCode: d.n3DocCode ?? "",
                  referenceNo: null,
                  isCancelled: null,
                  customerCode: null,
                  currencyCode: null,
                },
              ]
            : [];
        });
      rows.sort((a, b) => (a.docDate < b.docDate ? 1 : a.docDate > b.docDate ? -1 : 0));
      return { count: rows.length, rows: rows.slice(skip, skip + top) };
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
    deposits: new Map([
      [T, deposits],
      ["tenant-b", [dep(999, { id: "other", amountCents: 999900 })]],
    ]),
    versions: [],
    unresolved: [],
    snaps: new Map(deposits.map((d) => [d.id, snap(d)])),
    ...extra,
  };
}

beforeEach(() => clearFinancialCache());

describe("readMonthlyFinancialDashboard", () => {
  it("receipt report uses verified receipt contact while retaining its creation amount", async () => {
    const d = dep(1, { customerLabel: "Alice" });
    const contact = { customerName: "Bob", remark1: "", remark2: "", remark3: "", remark4: "" };
    const w = world([d], {
      versions: [version(d, { amountCents: 5000, verifiedContact: contact })],
    });
    w.snaps.set(d.id, snap(d, { contact }));
    const { deps } = makeDeps(w);
    const report = await readReceiptReport(
      owner,
      validateReceiptReportFilter(
        new URLSearchParams(),
        financialMonth("2026-10", "Asia/Kuala_Lumpur"),
      ),
      deps,
    );
    expect(report.items[0]).toMatchObject({ customerLabel: "Bob", creationAmount: 50 });
  });
  it("denies non-Owners before any source read", async () => {
    const { deps, calls } = makeDeps(world([dep(1)]));
    for (const role of ["front_desk", "housekeeper"] as const)
      await expect(
        readMonthlyFinancialDashboard({ ...owner, role }, "2026-10", deps),
      ).rejects.toThrow("forbidden");
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
    // Every page is read; with no N3 date index every receipt must be re-read,
    // so above the cap the source is Unavailable (never a partial total).
    w.versions = many.map((d) => version(d, { amountCents: 100, versionNo: 1 }));
    const { deps, calls } = makeDeps(w);
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(calls.pages).toBe(2);
    expect(r.deposits).toMatchObject({ amount: null, status: "unavailable" });
    expect(calls.verify).toBe(0);
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
    w.snaps.set(d.id, snap(d, { documentState: "voided" }));
    w.versions = [
      version(d, { versionNo: 1, amountCents: 8000 }),
      version(d, {
        versionNo: 2,
        state: "voided",
        amountCents: 0,
        requestId: "req-2",
        verifiedAt: "2026-10-05T01:00:00Z",
      }),
    ];
    const { deps, calls } = makeDeps(w);
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(r.deposits.amount).toBe(0);
    expect(r.voids).toMatchObject({ amount: 80, count: 1 });
    expect(calls.verify).toBe(1); // stored versions are re-verified live
    const report = await readReceiptReport(
      owner,
      validateReceiptReportFilter(
        new URLSearchParams("tab=voided"),
        financialMonth("2026-10", "Asia/Kuala_Lumpur"),
      ),
      deps,
    );
    expect(report.items[0]).toMatchObject({
      amount: 80,
      creationAmount: 50,
      reason: "Typo in amount",
      requesterLabel: "Aina",
      approverLabel: "Owner Lim",
    });
  });

  it("void plus replacement: replacement receipt cannot be re-read, so Unavailable (stale, never trusted)", async () => {
    const d = dep(1);
    const w = world([d]);
    w.versions = [
      version(d, { versionNo: 1, state: "voided", amountCents: 0 }),
      version(d, {
        versionNo: 2,
        receiptId: rid(500),
        docCode: "OR2610/500",
        amountCents: 8000,
        replacementOf: d.n3ReceiptId,
      }),
    ];
    const { deps } = makeDeps(w);
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(r.deposits).toMatchObject({ amount: null, status: "unavailable" });
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
    await expect(readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(w).deps)).rejects.toThrow(
      "unauthorized",
    );
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

describe("monthly review 5a26829 fixes", () => {
  it("1. a receipt created long before the month but N3-dated inside it is counted", async () => {
    const d = dep(1, { createdAt: "2026-06-01T02:00:00Z" });
    const w = world([d]);
    w.snaps.set(d.id, snap(d, { documentDate: "2026-10-15" }));
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(w).deps);
    expect(r.deposits).toMatchObject({ amount: 50, status: "complete" });
  });
  it("1b. a receipt created in the month but N3-redated out of it is excluded", async () => {
    const d = dep(1);
    const w = world([d]);
    w.snaps.set(d.id, snap(d, { documentDate: "2026-12-01" }));
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(w).deps);
    expect(r.deposits).toMatchObject({ amount: 0, status: "complete" });
  });
  it("2. corrected receipts are re-verified live; external change after correction → Needs review", async () => {
    const d = dep(1);
    const w = world([d]);
    w.versions = [version(d, { versionNo: 1, amountCents: 8000 })];
    w.snaps.set(
      d.id,
      snap(d, {
        amountCents: 8000,
        paymentLines: [
          { accountId: "acc-1", code: "310-000", savedName: "Maybank", amountCents: 8000 },
        ],
      }),
    );
    const { deps, calls } = makeDeps(w);
    const ok = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(calls.verify).toBe(1);
    expect(ok.deposits).toMatchObject({ amount: 80, status: "complete" });
    clearFinancialCache();
    w.snaps.set(d.id, snap(d, { amountCents: 9000 }));
    const drift = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(drift.deposits.status).toBe("needs_review");
    clearFinancialCache();
    w.snaps.delete(d.id); // N3 unreadable → stale, Unavailable (never trusted)
    const stale = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(stale.deposits).toMatchObject({ amount: null, status: "unavailable" });
  });
  it("4. repeated corrections use the LATEST effective version's reason/approver", async () => {
    const d = dep(1);
    const w = world([d]);
    w.versions = [
      version(d, { versionNo: 1, amountCents: 8000, requestId: "req-1" }),
      version(d, {
        versionNo: 2,
        amountCents: 9000,
        requestId: "req-2",
        paymentLines: [
          { accountId: "acc-1", code: "310-000", savedName: "Maybank", amountCents: 9000 },
        ],
      }),
    ];
    w.snaps.set(
      d.id,
      snap(d, {
        amountCents: 9000,
        paymentLines: [
          { accountId: "acc-1", code: "310-000", savedName: "Maybank", amountCents: 9000 },
        ],
      }),
    );
    const { deps } = makeDeps(w);
    deps.requests = async (_t, ids) =>
      ids.map((id) => ({
        id,
        requestedBy: "u-fd",
        approvedBy: "u-owner",
        reason: id === "req-2" ? "Second fix" : "First fix",
      }));
    const report = await readReceiptReport(
      owner,
      validateReceiptReportFilter(
        new URLSearchParams(""),
        financialMonth("2026-10", "Asia/Kuala_Lumpur"),
      ),
      deps,
    );
    expect(report.items[0]).toMatchObject({ amount: 90, reason: "Second fix" });
  });
  it("5. external bank change at the same amount on an original → Needs review", async () => {
    const d = dep(1);
    const w = world([d]);
    w.snaps.set(
      d.id,
      snap(d, {
        paymentLines: [
          { accountId: "acc-OTHER", code: "320-000", savedName: "CIMB", amountCents: 5000 },
        ],
      }),
    );
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(w).deps);
    expect(r.deposits.status).toBe("needs_review");
  });
  it("6. a hanging source call is cut at the shared 40s deadline (real timers, no mirror)", async () => {
    vi.useFakeTimers();
    try {
      const { deps } = makeDeps(world([dep(1)]));
      let now = 0;
      deps.now = () => now;
      deps.versions = () => new Promise(() => {}); // DB never answers
      const p = readMonthlyFinancialDashboard(owner, "2026-10", deps);
      await vi.advanceTimersByTimeAsync(FINANCIAL_LIMITS.totalBudgetMs - 1);
      now = FINANCIAL_LIMITS.totalBudgetMs + 1;
      await vi.advanceTimersByTimeAsync(2);
      const r = await p;
      expect(r.deposits).toMatchObject({ amount: null, status: "unavailable" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("6b. slow sequential N3 checks cannot exceed the deadline; the signal is aborted", async () => {
    vi.useFakeTimers();
    try {
      const many = Array.from({ length: 9 }, (_, i) => dep(i + 1));
      const { deps } = makeDeps(world(many));
      let signal: AbortSignal | undefined;
      deps.verifyReceipt = (_a, _id, s) => {
        signal = s;
        return new Promise(() => {}); // each N3 GET hangs
      };
      const p = readMonthlyFinancialDashboard(owner, "2026-10", deps);
      await vi.advanceTimersByTimeAsync(FINANCIAL_LIMITS.totalBudgetMs + 10);
      const r = await p;
      expect(r.deposits.status).toBe("unavailable");
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pagedAll (PostgREST 1000-row ceiling)", () => {
  it("reads 2,350 rows across pages with an exact count", async () => {
    const { pagedAll } = await import("../financial-reporting-store.server");
    const data = Array.from({ length: 2350 }, (_, i) => ({ i }));
    const rows = await pagedAll(async (from, to) => ({
      data: data.slice(from, Math.min(to + 1, from + 1000)), // server caps at 1000
      error: null,
      count: data.length,
    }));
    expect(rows).toHaveLength(2350);
  });
  it("fails closed when the count is missing, changes mid-read, or the server truncates", async () => {
    const { pagedAll } = await import("../financial-reporting-store.server");
    await expect(pagedAll(async () => ({ data: [], error: null, count: null }))).rejects.toThrow();
    let n = 0;
    await expect(
      pagedAll(async () => ({ data: [{}, {}], error: null, count: n++ === 0 ? 4 : 5 }), 2),
    ).rejects.toThrow();
    await expect(
      pagedAll(async (from) => ({ data: from === 0 ? [{}, {}] : [], error: null, count: 3 }), 2),
    ).rejects.toThrow();
    expect(
      await pagedAll(async () => ({ data: null, error: { code: "42P01" }, count: null })),
    ).toBeNull();
  });
});

describe("finance client cache namespace", () => {
  it("purges finance snapshots cached for any other tenant/user/role", async () => {
    const { purgeForeignFinancialCache, financialKeys } =
      await import("../financial-reporting-client");
    const keys = [
      financialKeys.dashboard("t1|u1|owner", "2026-10"),
      financialKeys.dashboard("t2|u9|owner", "2026-10"),
      financialKeys.dashboard("session", "2026-10"),
    ];
    const removed: unknown[] = [];
    purgeForeignFinancialCache(
      {
        removeQueries: (f) => keys.forEach((k) => f.predicate({ queryKey: k }) && removed.push(k)),
      },
      "t1|u1|owner",
    );
    expect(removed).toEqual([keys[1], keys[2]]);
    const src = (await import("node:fs")).readFileSync(
      "src/lib/financial-reporting-client.ts",
      "utf8",
    );
    expect(src).not.toMatch(/tenantKey = "session"/);
  });
});

describe("N3 month-date discovery (sales-v1 ARReceipts/List docDate filter)", () => {
  const sept = (d: FinancialDeposit) => snap(d, { documentDate: "2026-09-15" });

  it(">100 lifetime HotelHub receipts with <100 in the selected month succeeds", async () => {
    const many = Array.from({ length: 150 }, (_, i) => dep(i + 1));
    const w = world(many);
    many.slice(10).forEach((d) => w.snaps.set(d.id, sept(d)));
    const { deps, calls } = makeDeps(w);
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(r.deposits).toMatchObject({ status: "complete", amount: 500 });
    expect(calls.verify).toBe(10);
  });

  it(">100 selected-month candidates is visibly Unavailable with no N3 detail reads", async () => {
    const many = Array.from({ length: FINANCIAL_LIMITS.verifyCap + 1 }, (_, i) => dep(i + 1));
    const { deps, calls } = makeDeps(world(many));
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(r.deposits.status).toBe("unavailable");
    expect(calls.verify).toBe(0);
  });

  it("a server that ignores the date filter is Unavailable, never a partial total", async () => {
    const d = dep(1);
    const w = world([d], {
      list: () => [
        {
          id: d.n3ReceiptId,
          docDate: "2026-10-02",
          docCode: "a",
          referenceNo: null,
          isCancelled: null,
          customerCode: null,
          currencyCode: null,
        },
        {
          id: rid(77),
          docDate: "2026-09-30",
          docCode: "b",
          referenceNo: null,
          isCancelled: null,
          customerCode: null,
          currencyCode: null,
        },
      ],
    });
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(w).deps);
    expect(r.deposits).toMatchObject({ status: "unavailable", amount: null });
  });

  it("count changing between pages, duplicates, truncation and wrong order fail closed", async () => {
    const many = Array.from({ length: 150 }, (_, i) => dep(i + 1));
    const rowsOf = (n: number) =>
      many.slice(0, n).map((d) => ({
        id: d.n3ReceiptId.toLowerCase(),
        docDate: "2026-10-05",
        docCode: d.n3DocCode!,
        referenceNo: null,
        isCancelled: null,
        customerCode: null,
        currencyCode: null,
      }));
    const cases: FinancialReportingDeps["listMonthReceipts"][] = [
      async (_a, _r, skip, top) => ({
        count: skip ? 151 : 150,
        rows: rowsOf(150).slice(skip, skip + top),
      }),
      async (_a, _r, _skip, top) => ({ count: 150, rows: rowsOf(150).slice(0, top) }), // repeats page 1
      async (_a, _r, skip, top) => ({ count: 150, rows: rowsOf(120).slice(skip, skip + top) }), // truncated
      async () => ({
        count: 2,
        rows: [
          { ...rowsOf(1)[0]!, docDate: "2026-10-01" },
          { ...rowsOf(2)[1]!, docDate: "2026-10-09" },
        ],
      }),
    ];
    for (const list of cases) {
      clearFinancialCache();
      const { deps, calls } = makeDeps(world(many));
      deps.listMonthReceipts = list;
      const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
      expect(r.deposits.status).toBe("unavailable");
      expect(calls.verify).toBe(0);
    }
  });

  it("a list failure is Unavailable; an expired session is unauthorized, not zero", async () => {
    const { MonthListError } = await import("../n3-month-receipts.server");
    const { deps } = makeDeps(world([dep(1)]));
    deps.listMonthReceipts = async () => {
      throw new MonthListError("n3_month_list_unavailable");
    };
    expect((await readMonthlyFinancialDashboard(owner, "2026-10", deps)).deposits.status).toBe(
      "unavailable",
    );
    clearFinancialCache();
    deps.listMonthReceipts = async () => {
      throw new MonthListError("unauthorized");
    };
    await expect(readMonthlyFinancialDashboard(owner, "2026-10", deps)).rejects.toThrow();
  });

  it("an old-created receipt N3-dated in the month is counted via the list", async () => {
    const d = dep(1, { createdAt: "2026-01-03T00:00:00Z" });
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(world([d])).deps);
    expect(r.deposits).toMatchObject({ status: "complete", amount: 50 });
  });

  it("non-HotelHub N3 receipts sharing the customer/bank/reference prefix are never counted", async () => {
    const d = dep(1);
    const w = world([d], {
      list: () => [
        {
          id: d.n3ReceiptId,
          docDate: "2026-10-03",
          docCode: "OR1",
          referenceNo: "HH-1",
          isCancelled: false,
          customerCode: "WALKIN",
          currencyCode: "MYR",
        },
        {
          id: rid(500),
          docDate: "2026-10-02",
          docCode: "OR2",
          referenceNo: "HH-500",
          isCancelled: false,
          customerCode: "WALKIN",
          currencyCode: "MYR",
        },
      ],
    });
    const { deps, calls } = makeDeps(w);
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(r.deposits).toMatchObject({ status: "complete", amount: 50 });
    expect(calls.verify).toBe(1);
  });

  it("list cancellation flag never confirms a void: an external cancel is Needs review", async () => {
    const d = dep(1);
    const w = world([d], {
      list: () => [
        {
          id: d.n3ReceiptId,
          docDate: "2026-10-03",
          docCode: "OR1",
          referenceNo: "HH-1",
          isCancelled: true,
          customerCode: null,
          currencyCode: "MYR",
        },
      ],
    });
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(w).deps);
    expect(r.deposits.status).toBe("needs_review");
    expect(r.voids.amount ?? 0).toBe(0);
  });

  it("a list row whose reference contradicts the saved receipt is Needs review", async () => {
    const d = dep(1);
    const w = world([d], {
      list: () => [
        {
          id: d.n3ReceiptId,
          docDate: "2026-10-03",
          docCode: "OR1",
          referenceNo: "OTHER",
          isCancelled: false,
          customerCode: null,
          currencyCode: "MYR",
        },
      ],
    });
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(w).deps);
    expect(r.deposits.status).toBe("needs_review");
  });

  it("end-exclusive leap-month boundary: 29 Feb counts, 1 Mar is excluded", async () => {
    const a = dep(1);
    const b = dep(2);
    const w = world([a, b]);
    w.snaps.set(a.id, snap(a, { documentDate: "2028-02-29" }));
    w.snaps.set(b.id, snap(b, { documentDate: "2028-03-01" }));
    const seen: Array<{ startDate: string; endExclusive: string }> = [];
    const { deps } = makeDeps(w);
    const base = deps.listMonthReceipts;
    deps.listMonthReceipts = (ac, range, s, t, sig) => (
      seen.push(range),
      base(ac, range, s, t, sig)
    );
    const r = await readMonthlyFinancialDashboard(owner, "2028-02", deps);
    expect(seen[0]).toEqual({ startDate: "2028-02-01", endExclusive: "2028-03-01" });
    expect(r.deposits).toMatchObject({ status: "complete", amount: 50 });
  });
});

describe("ARReceipts/List month query and strict page parsing", () => {
  it("builds a validated, encoded, stably ordered docDate query", async () => {
    const { docDateListPath } = await import("../n3-receipts.server");
    const p = docDateListPath({
      startDate: "2028-02-01",
      endExclusive: "2028-03-01",
      skip: 100,
      top: 100,
    });
    expect(decodeURIComponent(p)).toBe(
      "/api/ARReceipts/List?$filter=docDate ge 2028-02-01 and docDate lt 2028-03-01&$orderby=docDate desc,docCode desc&$skip=100&$top=100",
    );
    for (const bad of [
      { startDate: "2028-02-01' or 1 eq 1", endExclusive: "2028-03-01", skip: 0, top: 100 },
      { startDate: "2028-03-01", endExclusive: "2028-02-01", skip: 0, top: 100 },
      { startDate: "2028-02-01", endExclusive: "2028-03-01", skip: 0, top: 101 },
      { startDate: "2028-02-01", endExclusive: "2028-03-01", skip: 7, top: 100 },
    ])
      expect(() => docDateListPath(bad)).toThrow();
  });

  it("accepts only the official '0000' envelope with data.value + data.count", async () => {
    const { parseMonthPage } = await import("../n3-month-receipts.server");
    const row = {
      id: rid(1),
      docDate: "2026-10-03T00:00:00",
      docCode: "OR1",
      referenceNo: "HH-1",
      isCancelled: false,
      customerCode: "C",
      currencyCode: "MYR",
      netTotalAmount: 50,
      accountCode: "310",
    };
    const ok = (body: unknown) => ({ kind: "response" as const, status: 200, durationMs: 1, body });
    const page = parseMonthPage(
      ok({ code: "0000", success: true, data: { value: [row], count: 1 } }),
    );
    expect(page).toMatchObject({
      count: 1,
      rows: [{ docDate: "2026-10-03", referenceNo: "HH-1" }],
    });
    for (const body of [
      { code: "0", data: { value: [row], count: 1 } },
      { code: "0000", Code: "E001", data: { value: [row], count: 1 } },
      { code: "0000", data: { value: [row] } },
      { code: "0000", data: { value: [row], count: "1" } },
      { code: "0000", data: { value: [row], Value: [], count: 1 } },
      { code: "0000", data: { value: [{ ...row, docDate: "2026-02-30" }], count: 1 } },
      { code: "0000", data: { value: [{ ...row, id: "1" }], count: 1 } },
    ])
      expect(() => parseMonthPage(ok(body))).toThrow();
    expect(() =>
      parseMonthPage({ kind: "response", status: 401, durationMs: 1, body: {} }),
    ).toThrow("unauthorized");
  });
});

describe("review e220930: void-event month and single deadline", () => {
  it("September receipt corrected to 80, proven void confirmed in October, October list empty", async () => {
    const d = dep(1, { createdAt: "2026-09-10T02:00:00Z" });
    const w = world([d], { list: () => [] });
    w.snaps.set(d.id, snap(d, { documentState: "voided", documentDate: "2026-09-10" }));
    w.versions = [
      version(d, { versionNo: 1, amountCents: 8000, documentDate: "2026-09-10" }),
      version(d, {
        versionNo: 2,
        state: "voided",
        amountCents: 0,
        requestId: "req-2",
        documentDate: "2026-09-10",
        verifiedAt: "2026-10-05T01:00:00Z",
      }),
    ];
    const { deps } = makeDeps(w);
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(r.voids).toMatchObject({ amount: 80, count: 1 });
    expect(r.deposits.amount).toBe(0);
    const report = await readReceiptReport(
      owner,
      validateReceiptReportFilter(
        new URLSearchParams("tab=voided"),
        financialMonth("2026-10", "Asia/Kuala_Lumpur"),
      ),
      deps,
    );
    expect(report.items).toHaveLength(1);
    expect(report.items[0]).toMatchObject({ amount: 80 });
    expect(report.items[0]).toMatchObject({
      documentDate: "2026-10-05",
      n3DocumentDate: "2026-09-10",
    });
  });

  it("void verified late on 31 Oct UTC counts in November property-local month", async () => {
    const d = dep(1);
    const w = world([d], { list: () => [] });
    w.snaps.set(d.id, snap(d, { documentState: "voided", documentDate: "2026-09-10" }));
    w.versions = [
      version(d, {
        versionNo: 1,
        state: "voided",
        amountCents: 0,
        documentDate: "2026-09-10",
        verifiedAt: "2026-10-31T17:00:00Z",
      }),
    ];
    const oct = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(w).deps);
    expect(oct.voids.count ?? 0).toBe(0);
    clearFinancialCache();
    const nov = await readMonthlyFinancialDashboard(owner, "2026-11", makeDeps(w).deps);
    expect(nov.voids).toMatchObject({ count: 1, amount: 50 });
  });

  it("an unproven external cancel (no stored void version) is never a confirmed void", async () => {
    const d = dep(1);
    const w = world([d], {
      list: () => [
        {
          id: d.n3ReceiptId,
          docDate: "2026-10-03",
          docCode: "OR1",
          referenceNo: "HH-1",
          isCancelled: true,
          customerCode: null,
          currencyCode: "MYR",
        },
      ],
    });
    w.snaps.set(d.id, snap(d, { documentState: "voided", documentDate: "2026-10-03" }));
    const r = await readMonthlyFinancialDashboard(owner, "2026-10", makeDeps(w).deps);
    expect(r.voids.count ?? 0).toBe(0);
    expect(r.deposits.status).toBe("needs_review");
  });

  it("a never-resolving settings read returns Unavailable within the shared budget", async () => {
    const { deps, calls } = makeDeps(world([dep(1)]));
    deps.settings = () => new Promise(() => {});
    let t = 0;
    deps.now = () => t;
    vi.useFakeTimers();
    try {
      const p = readMonthlyFinancialDashboard(owner, "2026-10", deps);
      t = FINANCIAL_LIMITS.totalBudgetMs + 1;
      await vi.advanceTimersByTimeAsync(FINANCIAL_LIMITS.totalBudgetMs + 1);
      const r = await p;
      expect(r.deposits.status).toBe("unavailable");
      expect(r.voids.status).toBe("unavailable");
      expect(calls.verify).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("audit and user-label lookups are limited to selected candidates", async () => {
    const a = dep(1);
    const b = dep(2);
    const w = world([a, b]);
    w.snaps.set(b.id, snap(b, { documentDate: "2026-09-15" }));
    w.versions = [
      version(a, { requestId: "req-a" }),
      version(b, { requestId: "req-b", documentDate: "2026-09-15" }),
    ];
    const { deps } = makeDeps(w);
    const asked: string[][] = [];
    const base = deps.requests;
    deps.requests = (t, ids) => (asked.push(ids), base(t, ids));
    await readMonthlyFinancialDashboard(owner, "2026-10", deps);
    expect(asked.flat()).toEqual(["req-a"]);
  });
});
