/**
 * Milestone 1.0.2 — N3 master mapping + Rooms & Rates foundation.
 * Direct handler tests: mocks the shared session/audit/supabase/fetch
 * boundaries, exactly like `route-handlers.test.ts`.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// -------- session mock --------
type SessionState = {
  data: Record<string, unknown>;
  updated: Array<Record<string, unknown>>;
  cleared: number;
};
const sessionState: SessionState = { data: {}, updated: [], cleared: 0 };
function resetSession(initial: Record<string, unknown> = {}) {
  sessionState.data = { ...initial };
  sessionState.updated = [];
  sessionState.cleared = 0;
}
vi.mock("@/lib/session.server", () => ({
  getHotelSession: async () => ({
    get data() {
      return sessionState.data;
    },
    async update(next: Record<string, unknown>) {
      sessionState.data = { ...sessionState.data, ...next };
      sessionState.updated.push(next);
    },
    async clear() {
      sessionState.data = {};
      sessionState.cleared++;
    },
  }),
}));

// -------- audit mock --------
const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

// -------- supabase mock --------
type SupaResult = { data: unknown; error: unknown };
const supaQueue = new Map<string, SupaResult[]>();
const supaCalls: Array<{
  table: string;
  op: string;
  filters: Array<[string, unknown]>;
  payload?: unknown;
}> = [];
function supaEnqueue(table: string, r: SupaResult) {
  const a = supaQueue.get(table) ?? [];
  a.push(r);
  supaQueue.set(table, a);
}
function makeBuilder(table: string) {
  const filters: Array<[string, unknown]> = [];
  const info = { table, op: "select", filters, payload: undefined as unknown };
  supaCalls.push(info);
  const chain: Record<string, unknown> = {
    select: () => chain,
    upsert: (p: unknown) => {
      info.op = "upsert";
      info.payload = p;
      return chain;
    },
    insert: (p: unknown) => {
      info.op = "insert";
      info.payload = p;
      return chain;
    },
    update: (p: unknown) => {
      info.op = "update";
      info.payload = p;
      return chain;
    },
    delete: () => {
      info.op = "delete";
      return chain;
    },
    order: () => chain,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return chain;
    },
    single: async () => supaQueue.get(table)?.shift() ?? { data: null, error: null },
    maybeSingle: async () => supaQueue.get(table)?.shift() ?? { data: null, error: null },
    then: (resolve: (v: SupaResult) => unknown) =>
      resolve(supaQueue.get(table)?.shift() ?? { data: null, error: null }),
  };
  return chain;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}));

// -------- fetch mock --------
type FetchResp = { status: number; body: unknown };
const fetchQ: FetchResp[] = [];
const fetchCalls: Array<{ url: string }> = [];
function enqFetch(r: FetchResp) {
  fetchQ.push(r);
}
const origFetch = globalThis.fetch;
beforeEach(() => {
  resetSession();
  auditEvents.length = 0;
  supaQueue.clear();
  supaCalls.length = 0;
  fetchQ.length = 0;
  fetchCalls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url });
    const next = fetchQ.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

// -------- helpers --------
async function seedAuthed(role: "owner" | "front_desk" | "housekeeper" | null, tenantId = "T1") {
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
  supaEnqueue("hotel_user_roles", {
    data: role === null ? null : { role, is_active: true },
    error: null,
  });
}

// ================= Task 1: /api/auth/launch token-free failure =================
describe("/api/auth/launch fail-closed", () => {
  const RAW = "eyJraWQiOiJ4In0.PAYLOAD.SIG";
  it("N3 401 → 302 to /launch-error?code=n3_rejected without token in Location/body", async () => {
    enqFetch({ status: 401, body: {} });
    const { handleLaunch } = await import("@/routes/api/auth/launch");
    const res = await handleLaunch({
      request: new Request(`http://x.test/api/auth/launch?token=${encodeURIComponent(RAW)}`),
    });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toBe("/launch-error?code=n3_rejected");
    expect(loc).not.toContain(RAW);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toContain(RAW);
  });
  it("missing token → 302 /launch-error?code=launch_failed", async () => {
    const { handleLaunch } = await import("@/routes/api/auth/launch");
    const res = await handleLaunch({ request: new Request("http://x.test/api/auth/launch") });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/launch-error?code=launch_failed");
  });
});

// ================= Task 2/3: hotel settings + walk-in customer =================
describe("/api/hotel/settings", () => {
  it("front_desk can GET settings (read-only)", async () => {
    await seedAuthed("front_desk");
    supaEnqueue("hotel_settings", {
      data: {
        tenant_id: "T1",
        currency: "MYR",
        timezone: "Asia/Kuala_Lumpur",
        standard_check_in_time: "14:00",
        standard_check_out_time: "12:00",
        n3_walk_in_customer_id: null,
        n3_walk_in_customer_code: null,
        n3_walk_in_customer_name: null,
      },
      error: null,
    });
    const { handleGetSettings } = await import("@/routes/api/hotel/settings");
    const res = await handleGetSettings();
    expect(res.status).toBe(200);
  });
  it("housekeeper PATCH → 403", async () => {
    await seedAuthed("housekeeper");
    const { handlePatchSettings } = await import("@/routes/api/hotel/settings");
    const res = await handlePatchSettings({
      request: new Request("http://x.test/api/hotel/settings", {
        method: "PATCH",
        body: JSON.stringify({ currency: "MYR" }),
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe("/api/hotel/walk-in-customer", () => {
  it("front_desk POST → 403 without hitting N3", async () => {
    await seedAuthed("front_desk");
    const { handleSetWalkInCustomer } = await import("@/routes/api/hotel/walk-in-customer");
    const res = await handleSetWalkInCustomer({
      request: new Request("http://x.test/x", {
        method: "POST",
        body: JSON.stringify({ code: "700-W001" }),
      }),
    });
    expect(res.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });
  it("owner: verifies via N3 then persists ONLY N3-returned name/id", async () => {
    await seedAuthed("owner");
    // Verified production envelope shape.
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: {
          count: 2,
          value: [
            { id: "c-uuid-1", code: "700-W001", name: "Walk In Guest (verified)" },
            { id: "c-uuid-2", code: "700-OTHER", name: "Other" },
          ],
        },
      },
    });
    supaEnqueue("hotel_settings", {
      data: {
        tenant_id: "T1",
        currency: "MYR",
        timezone: "Asia/Kuala_Lumpur",
        standard_check_in_time: "14:00",
        standard_check_out_time: "12:00",
        n3_walk_in_customer_id: null,
        n3_walk_in_customer_code: null,
        n3_walk_in_customer_name: null,
      },
      error: null,
    });
    supaEnqueue("hotel_settings", {
      data: {
        tenant_id: "T1",
        currency: "MYR",
        timezone: "Asia/Kuala_Lumpur",
        standard_check_in_time: "14:00",
        standard_check_out_time: "12:00",
        n3_walk_in_customer_id: "c-uuid-1",
        n3_walk_in_customer_code: "700-W001",
        n3_walk_in_customer_name: "Walk In Guest (verified)",
      },
      error: null,
    });
    const { handleSetWalkInCustomer } = await import("@/routes/api/hotel/walk-in-customer");
    const res = await handleSetWalkInCustomer({
      request: new Request("http://x.test/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "700-W001", n3Id: "hacked", n3Name: "FAKE" }),
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.walkInCustomer.n3Id).toBe("c-uuid-1");
    expect(body.settings.walkInCustomer.n3Name).toBe("Walk In Guest (verified)");
    expect(auditEvents.some((e) => e.eventType === "hotel.walk_in_customer.mapped")).toBe(true);
  });
  it("owner: unknown/unverified code is refused (404) and nothing is persisted", async () => {
    await seedAuthed("owner");
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: { count: 1, value: [{ id: "x", code: "700-OTHER", name: "O" }] },
      },
    });
    const { handleSetWalkInCustomer } = await import("@/routes/api/hotel/walk-in-customer");
    const res = await handleSetWalkInCustomer({
      request: new Request("http://x.test/x", {
        method: "POST",
        body: JSON.stringify({ code: "700-FAKE" }),
      }),
    });
    expect(res.status).toBe(404);
    expect(supaCalls.filter((c) => c.table === "hotel_settings" && c.op === "update")).toHaveLength(
      0,
    );
  });
  it("owner: N3 401 during verification → 401 n3_unauthorized (never 404) and destroys session", async () => {
    await seedAuthed("owner");
    enqFetch({ status: 401, body: {} });
    const { handleSetWalkInCustomer } = await import("@/routes/api/hotel/walk-in-customer");
    const res = await handleSetWalkInCustomer({
      request: new Request("http://x.test/x", {
        method: "POST",
        body: JSON.stringify({ code: "700-W001" }),
      }),
    });
    expect(res.status).toBe(401);
    expect(sessionState.cleared).toBeGreaterThan(0);
    expect(auditEvents.some((e) => e.eventType === "session.n3_401")).toBe(true);
  });
});


// ================= Task 2/3/5: rooms =================
describe("/api/hotel/rooms POST", () => {
  it("housekeeper → 403", async () => {
    await seedAuthed("housekeeper");
    const { handleCreateRoom } = await import("@/routes/api/hotel/rooms");
    const res = await handleCreateRoom({
      request: new Request("http://x.test/x", {
        method: "POST",
        body: JSON.stringify({ code: "R101" }),
      }),
    });
    expect(res.status).toBe(403);
  });
  it("owner: room_number ALWAYS equals verified n3_stock_code (browser room_number ignored)", async () => {
    await seedAuthed("owner");
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: {
          count: 1,
          value: [{ id: "s1", code: "R-101", description: "Deluxe Twin", isActive: true }],
        },
      },
    });
    supaEnqueue("hotel_rooms", {
      data: {
        id: "room-uuid",
        tenant_id: "T1",
        n3_stock_id: "s1",
        n3_stock_code: "R-101",
        n3_stock_name: "Deluxe Twin",
        room_number: "R-101",
        display_name: null,
        room_type: "deluxe",
        floor: "1",
        max_occupancy: 2,
        base_rate: "180.00",
        is_active: true,
      },
      error: null,
    });
    const { handleCreateRoom } = await import("@/routes/api/hotel/rooms");
    const res = await handleCreateRoom({
      request: new Request("http://x.test/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "R-101",
          roomNumber: "PWN",
          n3StockCode: "PWN",
          baseRate: 180,
          roomType: "deluxe",
          floor: "1",
        }),
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.room.roomNumber).toBe("R-101");
    expect(body.room.n3StockCode).toBe("R-101");
    expect(body.room.baseRate).toBe(180);
    const insert = supaCalls.find((c) => c.table === "hotel_rooms" && c.op === "insert");
    expect(insert).toBeTruthy();
    expect((insert!.payload as Record<string, unknown>).room_number).toBe("R-101");
  });
  it("owner: duplicate stock mapping → 409", async () => {
    await seedAuthed("owner");
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: { count: 1, value: [{ id: "s1", code: "R-101", description: "T" }] },
      },
    });
    supaEnqueue("hotel_rooms", {
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });
    const { handleCreateRoom } = await import("@/routes/api/hotel/rooms");
    const res = await handleCreateRoom({
      request: new Request("http://x.test/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "R-101" }),
      }),
    });
    expect(res.status).toBe(409);
  });
  it("owner: unverified stock code → 404, no DB write", async () => {
    await seedAuthed("owner");
    enqFetch({ status: 200, body: { code: "0000", data: { count: 0, value: [] } } });
    const { handleCreateRoom } = await import("@/routes/api/hotel/rooms");
    const res = await handleCreateRoom({
      request: new Request("http://x.test/x", {
        method: "POST",
        body: JSON.stringify({ code: "GHOST" }),
      }),
    });
    expect(res.status).toBe(404);
    expect(supaCalls.some((c) => c.table === "hotel_rooms" && c.op === "insert")).toBe(false);
  });
  it("owner: N3 401 on stock verify → 401 n3_unauthorized (not 404)", async () => {
    await seedAuthed("owner");
    enqFetch({ status: 401, body: {} });
    const { handleCreateRoom } = await import("@/routes/api/hotel/rooms");
    const res = await handleCreateRoom({
      request: new Request("http://x.test/x", {
        method: "POST",
        body: JSON.stringify({ code: "R-101" }),
      }),
    });
    expect(res.status).toBe(401);
    expect(sessionState.cleared).toBeGreaterThan(0);
  });
});


describe("/api/hotel/rooms GET", () => {
  it("housekeeper → 403", async () => {
    await seedAuthed("housekeeper");
    const { handleListRooms } = await import("@/routes/api/hotel/rooms");
    expect((await handleListRooms()).status).toBe(403);
  });
  it("front_desk → 200 read-only", async () => {
    await seedAuthed("front_desk");
    supaEnqueue("hotel_rooms", { data: [], error: null });
    const { handleListRooms } = await import("@/routes/api/hotel/rooms");
    expect((await handleListRooms()).status).toBe(200);
  });
});

describe("hotel-store cross-tenant isolation", () => {
  it("updateRoom scopes by both tenant_id and id", async () => {
    supaEnqueue("hotel_rooms", {
      data: {
        id: "r1",
        tenant_id: "T1",
        n3_stock_id: "s",
        n3_stock_code: "R-101",
        n3_stock_name: null,
        room_number: "R-101",
        display_name: null,
        room_type: "standard",
        floor: null,
        max_occupancy: 2,
        base_rate: "50.00",
        is_active: true,
      },
      error: null,
    });
    const { updateRoom } = await import("@/lib/hotel-store.server");
    await updateRoom("T1", "r1", { baseRate: 99 });
    const call = supaCalls.find((c) => c.table === "hotel_rooms" && c.op === "update");
    expect(call?.filters).toEqual(
      expect.arrayContaining([
        ["tenant_id", "T1"],
        ["id", "r1"],
      ]),
    );
  });
});

// ================= Task 4: N3 list access =================
describe("/api/n3/customers", () => {
  it("owner: paginates & returns minimal shape with total/hasMore", async () => {
    await seedAuthed("owner");
    // Verified N3 production envelope (numeric ids, data.value/data.count).
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: {
          count: 1465,
          value: [
            { id: 250787, code: "703-H0007", name: "Hanabil Biz Online Centre" },
            { id: 250788, code: "700-A001", name: "Alpha" },
          ],
        },
      },
    });
    const { handleListCustomers } = await import("@/routes/api/n3/customers");
    const res = await handleListCustomers({
      request: new Request("http://x.test/api/n3/customers?top=25&skip=0"),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.top).toBe(25);
    expect(body.total).toBe(1465);
    expect(body.hasMore).toBe(true);
    // Numeric IDs are stringified.
    expect(body.items[0]).toEqual({
      id: "250787",
      code: "703-H0007",
      name: "Hanabil Biz Online Centre",
    });
    expect(fetchCalls[0].url).toContain("/api/customers/list?$top=25&$skip=0");
  });
  it("owner: last page → hasMore=false", async () => {
    await seedAuthed("owner");
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: { count: 1465, value: [{ id: 1, code: "Z-END", name: "End" }] },
      },
    });
    const { handleListCustomers } = await import("@/routes/api/n3/customers");
    const res = await handleListCustomers({
      request: new Request("http://x.test/api/n3/customers?top=25&skip=1464"),
    });
    const body = await res.json();
    expect(body.hasMore).toBe(false);
  });
  it("front_desk → 403", async () => {
    await seedAuthed("front_desk");
    const { handleListCustomers } = await import("@/routes/api/n3/customers");
    const res = await handleListCustomers({
      request: new Request("http://x.test/api/n3/customers"),
    });
    expect(res.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("/api/n3/stocks", () => {
  it("owner: verified stock envelope", async () => {
    await seedAuthed("owner");
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: {
          count: 554,
          value: [{ id: 153691, code: "365-Install", description: "Installation" }],
        },
      },
    });
    const { handleListStocks } = await import("@/routes/api/n3/stocks");
    const res = await handleListStocks({
      request: new Request("http://x.test/api/n3/stocks?top=25&skip=0"),
    });
    const body = await res.json();
    expect(body.total).toBe(554);
    expect(body.items[0]).toMatchObject({
      id: "153691",
      code: "365-Install",
      name: "Installation",
    });
  });
  it("survives non-array / unexpected N3 shapes without throwing", async () => {
    await seedAuthed("owner");
    enqFetch({ status: 200, body: { code: "0000", data: "not-an-array" } });
    const { handleListStocks } = await import("@/routes/api/n3/stocks");
    const res = await handleListStocks({ request: new Request("http://x.test/api/n3/stocks") });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(null);
    expect(body.hasMore).toBe(false);
  });
});

// ================= extractPage envelope contract =================
describe("extractPage envelope", () => {
  it("reads real data.value / data.count", async () => {
    const { extractPage } = await import("@/lib/n3-gateway.server");
    const p = extractPage({ code: "0000", data: { count: 1465, value: [{ id: 1 }] } });
    expect(p.total).toBe(1465);
    expect(p.items).toHaveLength(1);
  });
  it("casing-tolerant Value/Count fallback", async () => {
    const { extractPage } = await import("@/lib/n3-gateway.server");
    const p = extractPage({ code: "0000", data: { Count: 3, Value: [{ id: 1 }, { id: 2 }] } });
    expect(p.total).toBe(3);
    expect(p.items).toHaveLength(2);
  });
  it("compat items array", async () => {
    const { extractPage } = await import("@/lib/n3-gateway.server");
    const p = extractPage({ code: "0000", data: { items: [{ id: 1 }] } });
    expect(p.items).toHaveLength(1);
  });
  it("compat top-level array", async () => {
    const { extractPage } = await import("@/lib/n3-gateway.server");
    const p = extractPage({ code: "0000", data: [{ id: 1 }] });
    expect(p.items).toHaveLength(1);
    expect(p.total).toBe(null);
  });
  it("non-'0000' envelope code → empty page (not throw)", async () => {
    const { extractPage } = await import("@/lib/n3-gateway.server");
    const p = extractPage({ code: "9999", data: { count: 5, value: [{ id: 1 }] } });
    expect(p.items).toEqual([]);
    expect(p.total).toBe(null);
  });
  it("unexpected shape → empty, does not throw", async () => {
    const { extractPage } = await import("@/lib/n3-gateway.server");
    expect(extractPage(null)).toEqual({ items: [], total: null });
    expect(extractPage("garbage")).toEqual({ items: [], total: null });
    expect(extractPage({ data: 42 })).toEqual({ items: [], total: null });
  });
});

// ================= Verification pages past 500 records =================
describe("verifyN3CustomerByCode paging", () => {
  it("finds a customer after record 500 (contract cap must be well beyond 500)", async () => {
    await seedAuthed("owner");
    // Pages of MAX_TOP=100 each. Match at skip=500 (record #501).
    const total = 1465;
    for (let s = 0; s <= 500; s += 100) {
      const value =
        s === 500
          ? [{ id: 999, code: "703-H0007", name: "Hanabil Biz Online Centre" }]
          : Array.from({ length: 100 }, (_, i) => ({
              id: s + i + 1,
              code: `C-${s + i + 1}`,
              name: null,
            }));
      enqFetch({ status: 200, body: { code: "0000", data: { count: total, value } } });
    }
    const { verifyN3CustomerByCode } = await import("@/lib/n3-gateway.server");
    const r = await verifyN3CustomerByCode("tok", "703-H0007");
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.item.code).toBe("703-H0007");
  });
  it("genuine not-found scans until total is exhausted, then returns not_found", async () => {
    await seedAuthed("owner");
    const total = 250;
    // page1: 100 items, page2: 100 items, page3: 50 items. None match.
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: {
          count: total,
          value: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, code: `C-${i + 1}` })),
        },
      },
    });
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: {
          count: total,
          value: Array.from({ length: 100 }, (_, i) => ({ id: 100 + i + 1, code: `C-${100 + i + 1}` })),
        },
      },
    });
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: {
          count: total,
          value: Array.from({ length: 50 }, (_, i) => ({ id: 200 + i + 1, code: `C-${200 + i + 1}` })),
        },
      },
    });
    const { verifyN3CustomerByCode } = await import("@/lib/n3-gateway.server");
    const r = await verifyN3CustomerByCode("tok", "NOPE");
    expect(r.status).toBe("not_found");
    expect(fetchCalls).toHaveLength(3);
  });
  it("N3 401 mid-scan → unauthorized (never coerced to not_found)", async () => {
    await seedAuthed("owner");
    enqFetch({ status: 401, body: {} });
    const { verifyN3CustomerByCode } = await import("@/lib/n3-gateway.server");
    const r = await verifyN3CustomerByCode("tok", "703-H0007");
    expect(r.status).toBe("unauthorized");
  });
});


// ================= start.ts still N3-only =================
describe("start.ts regression", () => {
  it("still has functionMiddleware: [] and no attachSupabaseAuth", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const source = readFileSync(resolve(__dirname, "../../start.ts"), "utf8");
    expect(source).not.toMatch(/attachSupabaseAuth/);
    expect(source).toMatch(/functionMiddleware:\s*\[\s*\]/);
  });
});
