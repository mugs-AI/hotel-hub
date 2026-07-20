/**
 * Milestone 1.0.2 — UX Patch C regression tests.
 *
 * Locks in:
 *  - "OCC." column removed / "MAX GUESTS" heading + tooltip rendered
 *  - "Maximum guests" accessible label in edit mode
 *  - Already-mapped N3 Stock Codes: disabled, "Added" text, "Mapped" badge,
 *    case-insensitive + trimmed comparison, click cannot invoke onPick
 *  - Adding/removing rooms updates the mapped Set
 *  - Server duplicate protection still returns 409 (unique constraint path)
 *  - Global N3 search still calls /api/n3/{kind}/all and filters in memory
 *  - src/start.ts remains N3-only with functionMiddleware: []
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMappedStockSet,
  isStockMapped,
  normalizeStockCode,
  selectIfAllowed,
} from "@/lib/room-picker";

const ROOMS_RATES_SRC = readFileSync(resolve(__dirname, "../../routes/rooms-rates.tsx"), "utf8");
const START_SRC = readFileSync(resolve(__dirname, "../../start.ts"), "utf8");
const GATEWAY_SRC = readFileSync(resolve(__dirname, "../n3-gateway.server.ts"), "utf8");

// ---------- Task 1: OCC. → MAX GUESTS ----------
describe("Rooms table heading", () => {
  it("no longer renders the ambiguous OCC. heading", () => {
    expect(ROOMS_RATES_SRC).not.toMatch(/>\s*Occ\.\s*</);
    expect(ROOMS_RATES_SRC).not.toMatch(/>\s*OCC\.\s*</);
  });

  it("renders a Max guests heading with the explanatory tooltip", () => {
    // JSX text is 'Max guests'; CSS uppercase renders it as MAX GUESTS in the browser.
    expect(ROOMS_RATES_SRC).toMatch(/Max guests/);
    expect(ROOMS_RATES_SRC).toMatch(/Maximum number of guests allowed to stay in this room\./);
    // The heading uses the tooltip constant on a <th title=...> element.
    expect(ROOMS_RATES_SRC).toMatch(/<th[^>]*title=\{MAX_GUESTS_TOOLTIP\}[^>]*>\s*Max guests/);
    // The <th> in question still lives inside an `uppercase` <tr>, so the
    // rendered heading text is MAX GUESTS.
    expect(ROOMS_RATES_SRC).toMatch(/text-xs uppercase/);
  });

  it("edit mode input for max_occupancy has an accessible 'Maximum guests' label", () => {
    expect(ROOMS_RATES_SRC).toMatch(/aria-label="Maximum guests"/);
    // Still enforces minimum 1
    expect(ROOMS_RATES_SRC).toMatch(/min=\{1\}/);
  });

  it("does not rename the max_occupancy database column", () => {
    // We keep the API field name.
    expect(ROOMS_RATES_SRC).toMatch(/maxOccupancy: Number\(occ\)/);
  });
});

// ---------- Task 2: mapped-set helpers ----------
describe("buildMappedStockSet / isStockMapped", () => {
  it("normalises trims and case", () => {
    expect(normalizeStockCode("  R-101  ")).toBe("r-101");
    expect(normalizeStockCode("r-101")).toBe("r-101");
    expect(normalizeStockCode(null)).toBe("");
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    const mapped = buildMappedStockSet([{ n3StockCode: "R-101" }, { n3StockCode: "  r-102 " }]);
    expect(isStockMapped("r-101", mapped)).toBe(true);
    expect(isStockMapped("R-102", mapped)).toBe(true);
    expect(isStockMapped(" r-102 ", mapped)).toBe(true);
    expect(isStockMapped("R-999", mapped)).toBe(false);
  });

  it("selectIfAllowed cannot invoke onPick for a mapped code", () => {
    const mapped = buildMappedStockSet([{ n3StockCode: "R-101" }]);
    const spy = vi.fn();
    const picked = selectIfAllowed({ code: "r-101" }, mapped, spy);
    expect(picked).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("selectIfAllowed calls onPick for an unmapped code", () => {
    const mapped = buildMappedStockSet([{ n3StockCode: "R-101" }]);
    const spy = vi.fn();
    const picked = selectIfAllowed({ code: "R-999" }, mapped, spy);
    expect(picked).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("adding a room updates the mapped state (new code now blocks selection)", () => {
    const before = buildMappedStockSet([{ n3StockCode: "R-101" }]);
    expect(isStockMapped("R-102", before)).toBe(false);
    const after = buildMappedStockSet([{ n3StockCode: "R-101" }, { n3StockCode: "R-102" }]);
    expect(isStockMapped("r-102", after)).toBe(true);
  });

  it("removing a room makes the stock code selectable again", () => {
    const before = buildMappedStockSet([{ n3StockCode: "R-101" }, { n3StockCode: "R-102" }]);
    expect(isStockMapped("R-102", before)).toBe(true);
    const after = buildMappedStockSet([{ n3StockCode: "R-101" }]);
    expect(isStockMapped("R-102", after)).toBe(false);
  });
});

// ---------- Task 2: picker UI wiring ----------
describe("N3 stock picker UI", () => {
  it("passes disabledCodes built from current tenant rooms to the stocks picker", () => {
    expect(ROOMS_RATES_SRC).toMatch(
      /kind="stocks"[\s\S]{0,120}disabledCodes=\{buildMappedStockSet\(rooms\)\}/,
    );
  });

  it("renders Added text and Mapped badge and disables the button for mapped rows", () => {
    expect(ROOMS_RATES_SRC).toMatch(/\{mapped \? "Added" : "Select"\}/);
    expect(ROOMS_RATES_SRC).toMatch(/>\s*Mapped\s*</);
    expect(ROOMS_RATES_SRC).toMatch(/disabled=\{mapped\}/);
    expect(ROOMS_RATES_SRC).toMatch(/title=\{mapped \? MAPPED_STOCK_TOOLTIP : undefined\}/);
    expect(ROOMS_RATES_SRC).toMatch(/This N3 Stock Code is already mapped to a room\./);
  });

  it("does NOT hide mapped rows from search results (they are just disabled)", () => {
    // The mapping loop always renders every filtered row; no `if (mapped) return null;`
    expect(ROOMS_RATES_SRC).not.toMatch(/if \(mapped\)\s*return null/);
  });
});

// ---------- Task 3.10: global N3 search still loads the full dataset ----------
describe("Global N3 search preserved", () => {
  it("still calls /api/n3/${kind}/all and filters in memory with matchesQuery", () => {
    expect(ROOMS_RATES_SRC).toMatch(/`\/api\/n3\/\$\{kind\}\/all`/);
    expect(ROOMS_RATES_SRC).toMatch(/matchesQuery\(query, r\.code, r\.name\)/);
  });

  it("gateway still exposes listAllN3Stocks with paged multi-request coverage", () => {
    expect(GATEWAY_SRC).toMatch(/export function listAllN3Stocks/);
  });
});

// ---------- Task 3.11: start.ts stays N3-only ----------
describe("src/start.ts", () => {
  it("does not import attachSupabaseAuth and registers empty functionMiddleware", () => {
    expect(START_SRC).not.toMatch(/attachSupabaseAuth/);
    expect(START_SRC).toMatch(/functionMiddleware:\s*\[\s*\]/);
  });
});

// ---------- Task 3.9: server duplicate protection still returns 409 ----------
// Mirrors the mock setup used by milestone-1_0_2.test.ts so this test file is
// self-contained and does not depend on other files' mocks running first.

type SessionState = {
  data: Record<string, unknown>;
  cleared: number;
};
const sessionState: SessionState = { data: {}, cleared: 0 };
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

vi.mock("@/lib/audit.server", () => ({ logAudit: async () => {} }));

type SupaResult = { data: unknown; error: unknown };
const supaQueue = new Map<string, SupaResult[]>();
function supaEnqueue(table: string, r: SupaResult) {
  const a = supaQueue.get(table) ?? [];
  a.push(r);
  supaQueue.set(table, a);
}
function makeBuilder(table: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    upsert: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    order: () => chain,
    eq: () => chain,
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

type FetchResp = { status: number; body: unknown };
const fetchQ: FetchResp[] = [];
function enqFetch(r: FetchResp) {
  fetchQ.push(r);
}
const origFetch = globalThis.fetch;

beforeEach(() => {
  sessionState.data = {};
  sessionState.cleared = 0;
  supaQueue.clear();
  fetchQ.length = 0;
  globalThis.fetch = (async () => {
    const next = fetchQ.shift();
    if (!next) throw new Error("Unexpected fetch");
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("POST /api/hotel/rooms — server duplicate protection", () => {
  it("still returns HTTP 409 when the unique constraint fires (client UX is not the guard)", async () => {
    sessionState.data = {
      n3Token: "eyJ.tok.en",
      n3TokenExpiration: null,
      n3TenantKey: "n3-T1",
      tenantCode: "T-001",
      companyName: "Hotel",
      n3UserKey: "u1",
      userEmail: "u@x.test",
      userName: "U",
      tenantId: "T1",
      createdAt: 1,
    };
    supaEnqueue("hotel_user_roles", {
      data: { role: "owner", is_active: true },
      error: null,
    });
    // Verified stock code exists in N3
    enqFetch({
      status: 200,
      body: {
        code: "0000",
        data: { count: 1, value: [{ id: "s1", code: "R-101", description: "Deluxe" }] },
      },
    });
    // Unique-constraint violation from the DB
    supaEnqueue("hotel_rooms", {
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });
    const { handleCreateRoom } = await import("@/routes/api/hotel/rooms");
    const res = await handleCreateRoom({
      request: new Request("http://x.test/api/hotel/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "R-101" }),
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("duplicate_stock_mapping");
  });
});
