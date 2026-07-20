/**
 * Milestone 1.0.2 — Correction B
 * Global N3 search, full-list loader, controlled concurrency, and
 * result pagination.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// -------- session mock (same shape as milestone-1_0_2.test.ts) ------------
type SessionState = { data: Record<string, unknown>; cleared: number };
const sessionState: SessionState = { data: {}, cleared: 0 };
function resetSession(initial: Record<string, unknown> = {}) {
  sessionState.data = { ...initial };
  sessionState.cleared = 0;
}
vi.mock("@/lib/session.server", () => ({
  getHotelSession: async () => ({
    get data() {
      return sessionState.data;
    },
    async update(next: Record<string, unknown>) {
      sessionState.data = { ...sessionState.data, ...next };
    },
    async clear() {
      sessionState.data = {};
      sessionState.cleared++;
    },
  }),
}));

const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

type SupaResult = { data: unknown; error: unknown };
const supaQueue = new Map<string, SupaResult[]>();
function supaEnqueue(t: string, r: SupaResult) {
  const a = supaQueue.get(t) ?? [];
  a.push(r);
  supaQueue.set(t, a);
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        single: async () => supaQueue.get(t)?.shift() ?? { data: null, error: null },
        maybeSingle: async () => supaQueue.get(t)?.shift() ?? { data: null, error: null },
        then: (r: (v: SupaResult) => unknown) =>
          r(supaQueue.get(t)?.shift() ?? { data: null, error: null }),
      };
      return chain;
    },
  },
}));

// -------- fetch mock with concurrency tracking ---------------------------
type FetchResp = { status: number; body: unknown; delayMs?: number };
const fetchQ: FetchResp[] = [];
const fetchCalls: Array<{ url: string }> = [];
let concurrentActive = 0;
let concurrentMax = 0;

function enqFetch(r: FetchResp) {
  fetchQ.push(r);
}
const origFetch = globalThis.fetch;
beforeEach(() => {
  resetSession();
  auditEvents.length = 0;
  supaQueue.clear();
  fetchQ.length = 0;
  fetchCalls.length = 0;
  concurrentActive = 0;
  concurrentMax = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url });
    const next = fetchQ.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    concurrentActive++;
    if (concurrentActive > concurrentMax) concurrentMax = concurrentActive;
    await new Promise((r) => setTimeout(r, next.delayMs ?? 5));
    concurrentActive--;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

async function seedOwner(tenantId = "T1") {
  resetSession({
    n3Token: "eyJ.tok.en",
    n3TokenExpiration: null,
    n3TenantKey: "n3-T1",
    tenantCode: "T-001",
    companyName: "Hotel",
    n3UserKey: "u1",
    userEmail: "u@x.test",
    userName: "U",
    tenantId,
    createdAt: 1,
  });
  supaEnqueue("hotel_user_roles", { data: { role: "owner", is_active: true }, error: null });
}

function customerPage(from: number, count: number, total: number) {
  return {
    status: 200,
    body: {
      code: "0000",
      data: {
        count: total,
        value: Array.from({ length: count }, (_, i) => ({
          id: from + i, // numeric on purpose
          code: `C-${String(from + i).padStart(4, "0")}`,
          name: `Customer ${from + i}`,
        })),
      },
    },
  };
}
function stockPage(
  items: Array<{ id: number | string; code: string; description?: string }>,
  total: number,
) {
  return {
    status: 200,
    body: { code: "0000", data: { count: total, value: items } },
  };
}

// ================= Pure search helpers =================
describe("normalizeSearchText / matchesQuery", () => {
  it("walk-in matches WALK IN CUSTOMER", async () => {
    const { matchesQuery } = await import("@/lib/n3-gateway.browser");
    expect(matchesQuery("walk-in", "700-W001", "WALK IN CUSTOMER")).toBe(true);
  });
  it("walk in matches WALK-IN CUSTOMER", async () => {
    const { matchesQuery } = await import("@/lib/n3-gateway.browser");
    expect(matchesQuery("walk in", "700-W001", "WALK-IN CUSTOMER")).toBe(true);
  });
  it("exact customer code 700-W001 matches", async () => {
    const { matchesQuery } = await import("@/lib/n3-gateway.browser");
    expect(matchesQuery("700-W001", "700-W001", "Walk In Guest")).toBe(true);
  });
  it("all query words must exist somewhere", async () => {
    const { matchesQuery } = await import("@/lib/n3-gateway.browser");
    expect(matchesQuery("deluxe suite", "R-100", "Deluxe Twin")).toBe(false);
    expect(matchesQuery("deluxe twin", "R-100", "Deluxe Twin")).toBe(true);
  });
  it("empty query matches everything", async () => {
    const { matchesQuery } = await import("@/lib/n3-gateway.browser");
    expect(matchesQuery("   ", "X", "Y")).toBe(true);
  });
});

// ================= paginate + pageWindow =================
describe("paginate", () => {
  it("supports page sizes 10/20/30/40/50", async () => {
    const { paginate, PAGE_SIZE_OPTIONS } = await import("@/lib/search-pagination");
    expect(PAGE_SIZE_OPTIONS).toEqual([10, 20, 30, 40, 50]);
    const items = Array.from({ length: 55 }, (_, i) => i);
    for (const sz of PAGE_SIZE_OPTIONS) {
      const p = paginate(items, 1, sz);
      expect(p.pageItems.length).toBe(Math.min(sz, 55));
    }
  });
  it("uses filtered count, not source total", async () => {
    const { paginate } = await import("@/lib/search-pagination");
    const items = Array.from({ length: 2 }, (_, i) => i);
    const p = paginate(items, 1, 20);
    expect(p.from).toBe(1);
    expect(p.to).toBe(2);
    expect(p.totalPages).toBe(1);
  });
  it("clamps out-of-range page number", async () => {
    const { paginate } = await import("@/lib/search-pagination");
    const items = Array.from({ length: 30 }, (_, i) => i);
    const p = paginate(items, 999, 10);
    expect(p.page).toBe(3);
    expect(p.pageItems[0]).toBe(20);
  });
});

// ================= listAllN3Customers — merge, concurrency, dedupe =========
describe("listAllN3Customers", () => {
  it("merges every N3 page (1465 records, 15 pages of 100)", async () => {
    // 15 pages: 14 full (100) + 1 partial (65)
    for (let i = 0; i < 14; i++) enqFetch(customerPage(i * 100 + 1, 100, 1465));
    enqFetch(customerPage(1401, 65, 1465));
    const { listAllN3Customers } = await import("@/lib/n3-gateway.server");
    const r = await listAllN3Customers("tok");
    expect(r.pagesFetched).toBe(15);
    expect(r.total).toBe(1465);
    expect(r.items.length).toBe(1465);
    // Numeric IDs are stringified
    expect(r.items[0].id).toBe("1");
    expect(typeof r.items[0].id).toBe("string");
  });

  it("never exceeds 3 concurrent N3 requests", async () => {
    for (let i = 0; i < 10; i++) enqFetch(customerPage(i * 100 + 1, 100, 1000));
    const { listAllN3Customers } = await import("@/lib/n3-gateway.server");
    await listAllN3Customers("tok");
    expect(concurrentMax).toBeGreaterThan(1);
    expect(concurrentMax).toBeLessThanOrEqual(3);
  });

  it("deduplicates by id (fallback code) after merge", async () => {
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: {
          count: 200,
          value: [
            { id: 1, code: "A", name: "A" },
            { id: 2, code: "B", name: "B" },
          ],
        },
      },
    });
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: {
          count: 200,
          value: [
            { id: 2, code: "B", name: "B-dup" }, // duplicate id
            { id: 3, code: "C", name: "C" },
          ],
        },
      },
    });
    const { listAllN3Customers } = await import("@/lib/n3-gateway.server");
    // Force pageSize path: total=200 → remaining=[100] (one more page after first)
    const r = await listAllN3Customers("tok");
    const ids = r.items.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("2");
  });

  it("partial page failure throws N3ListError('incomplete') — never partial success", async () => {
    enqFetch(customerPage(1, 100, 500)); // page 1 ok
    enqFetch(customerPage(101, 100, 500)); // page 2 ok
    enqFetch({ status: 500, body: {} }); // page 3 fails
    enqFetch(customerPage(301, 100, 500)); // page 4 ok
    enqFetch(customerPage(401, 100, 500)); // page 5 ok
    const { listAllN3Customers, N3ListError } = await import("@/lib/n3-gateway.server");
    await expect(listAllN3Customers("tok")).rejects.toBeInstanceOf(N3ListError);
  });

  it("N3 401 on first page throws unauthorized (endpoint destroys session)", async () => {
    enqFetch({ status: 401, body: {} });
    const { listAllN3Customers, N3ListError } = await import("@/lib/n3-gateway.server");
    await expect(listAllN3Customers("tok")).rejects.toMatchObject({ code: "unauthorized" });
    // Verify N3ListError is thrown
    try {
      await listAllN3Customers("tok");
    } catch (e) {
      expect(e).toBeInstanceOf(N3ListError);
    }
  });

  it("finds a record positioned after source record 500 via global search", async () => {
    // 15 pages. Put target at index 700.
    const total = 1465;
    for (let i = 0; i < 14; i++) {
      const from = i * 100 + 1;
      if (from <= 700 && 700 < from + 100) {
        // Rewrite this page so record 700 has our target code
        const vals = Array.from({ length: 100 }, (_, k) => ({
          id: from + k,
          code: from + k === 700 ? "703-H0007" : `C-${from + k}`,
          name: from + k === 700 ? "Hanabil Biz Online Centre" : `n${from + k}`,
        }));
        enqFetch({ status: 200, body: { code: "0000", data: { count: total, value: vals } } });
      } else {
        enqFetch(customerPage(from, 100, total));
      }
    }
    enqFetch(customerPage(1401, 65, total));
    const { listAllN3Customers, matchesQuery } = await import("@/lib/n3-gateway.server");
    const r = await listAllN3Customers("tok");
    const hits = r.items.filter((c) => matchesQuery("hanabil", c.code, c.name));
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].code).toBe("703-H0007");
  });
});

// ================= listAllN3Stocks — finds record after first page =========
describe("listAllN3Stocks — 'room' after first page", () => {
  it("finds 'room' matches beyond page 1", async () => {
    // Page 1: no 'room' matches. Page 2: contains a room.
    enqFetch(
      stockPage(
        Array.from({ length: 100 }, (_, i) => ({
          id: i + 1,
          code: `S-${i + 1}`,
          description: "widget",
        })),
        150,
      ),
    );
    enqFetch(
      stockPage(
        Array.from({ length: 50 }, (_, i) => ({
          id: 101 + i,
          code: i === 25 ? "R-501" : `S-${101 + i}`,
          description: i === 25 ? "Deluxe Room" : "widget",
        })),
        150,
      ),
    );
    const { listAllN3Stocks, matchesQuery } = await import("@/lib/n3-gateway.server");
    const r = await listAllN3Stocks("tok");
    const hits = r.items.filter((s) => matchesQuery("room", s.code, s.name));
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((s) => s.code === "R-501")).toBe(true);
  });
});

// ================= /api/n3/customers/all endpoint ==========================
describe("/api/n3/customers/all endpoint", () => {
  it("owner: returns full list and total, no fetch on 'search' (endpoint has no search param)", async () => {
    await seedOwner();
    enqFetch(customerPage(1, 100, 150));
    enqFetch(customerPage(101, 50, 150));
    const { handleListAllCustomers } = await import("@/routes/api/n3/customers.all");
    const res = await handleListAllCustomers();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(150);
    expect(body.total).toBe(150);
    // Endpoint fetches N3 exactly once per call (2 pages here) — client
    // searches happen in memory and never trigger further fetches.
    expect(fetchCalls.length).toBe(2);
  });
  it("N3 401 → 401 n3_unauthorized + session destroyed + audit", async () => {
    await seedOwner();
    enqFetch({ status: 401, body: {} });
    const { handleListAllCustomers } = await import("@/routes/api/n3/customers.all");
    const res = await handleListAllCustomers();
    expect(res.status).toBe(401);
    expect(sessionState.cleared).toBeGreaterThan(0);
    expect(auditEvents.some((e) => e.eventType === "session.n3_401")).toBe(true);
  });
  it("front_desk → 403 without hitting N3", async () => {
    resetSession({
      n3Token: "t",
      tenantId: "T1",
      n3TenantKey: "k",
      n3UserKey: "u",
    });
    supaEnqueue("hotel_user_roles", { data: { role: "front_desk", is_active: true }, error: null });
    const { handleListAllCustomers } = await import("@/routes/api/n3/customers.all");
    const res = await handleListAllCustomers();
    expect(res.status).toBe(403);
    expect(fetchCalls.length).toBe(0);
  });
});

// ================= start.ts regression (Correction B keeps it) =============
describe("start.ts regression (Correction B)", () => {
  it("still has functionMiddleware: [] and no attachSupabaseAuth", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const source = readFileSync(resolve(__dirname, "../../start.ts"), "utf8");
    expect(source).not.toMatch(/attachSupabaseAuth/);
    expect(source).toMatch(/functionMiddleware:\s*\[\s*\]/);
  });
});
