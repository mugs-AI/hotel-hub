/**
 * Route + session security tests. Handlers are called directly; the shared
 * lower boundaries are mocked so tests never hit the real N3 API or the
 * real Supabase project:
 *
 *   - `@/lib/session.server`             → in-memory cookie replacement
 *   - `@/lib/audit.server`               → in-memory audit sink
 *   - `@/integrations/supabase/client.server` → chainable stub of `supabaseAdmin`
 *   - global `fetch`                    → captured/canned N3 responses
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

// ---------- Session mock ----------
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

// ---------- Audit mock ----------
const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

// ---------- supabaseAdmin mock ----------
// Chainable per-call: each `.from(table)` returns a fresh builder configured
// via `supabaseNext(table, ...)`. Tests queue expected results.
type SupabaseResult = { data: unknown; error: unknown };
const supabaseQueue = new Map<string, SupabaseResult[]>();
const supabaseCalls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];

function supabaseEnqueue(table: string, result: SupabaseResult) {
  const arr = supabaseQueue.get(table) ?? [];
  arr.push(result);
  supabaseQueue.set(table, arr);
}
function makeBuilder(table: string) {
  const filters: Array<[string, unknown]> = [];
  const call = { table, filters };
  supabaseCalls.push(call);
  const chain: Record<string, unknown> = {
    select: () => chain,
    upsert: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return chain;
    },
    single: async () => (supabaseQueue.get(table)?.shift() ?? { data: null, error: null }),
    maybeSingle: async () =>
      supabaseQueue.get(table)?.shift() ?? { data: null, error: null },
    then: (resolve: (v: SupabaseResult) => unknown) =>
      resolve(supabaseQueue.get(table)?.shift() ?? { data: null, error: null }),
  };
  return chain;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}));

// ---------- fetch mock ----------
type FetchResponse = { status: number; body: unknown };
const fetchQueue: FetchResponse[] = [];
const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
function fetchEnqueue(r: FetchResponse) {
  fetchQueue.push(r);
}
const originalFetch = globalThis.fetch;
beforeEach(() => {
  resetSession();
  auditEvents.length = 0;
  supabaseQueue.clear();
  supabaseCalls.length = 0;
  fetchQueue.length = 0;
  fetchCalls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url, init });
    const next = fetchQueue.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------- Convenience seed helpers ----------
function seedTenantUpsert(overrides: Partial<Record<string, unknown>> = {}) {
  supabaseEnqueue("hotel_tenants", {
    data: {
      id: "tenant-uuid-1",
      n3_tenant_key: "n3-tenant-1",
      tenant_code: "T-001",
      company_name: "Test Hotel Sdn Bhd",
      ...overrides,
    },
    error: null,
  });
}
function seedRole(role: "owner" | "front_desk" | "housekeeper" | null) {
  supabaseEnqueue("hotel_user_roles", {
    data: role === null ? null : { role, is_active: true },
    error: null,
  });
}
function seedBasicInfoOK() {
  fetchEnqueue({
    status: 200,
    body: {
      code: "0000",
      data: {
        CompanyName: "Test Hotel",
        TenantId: "n3-tenant-1",
        TenantCode: "T-001",
        UserEmail: "u@example.test",
        UserName: "User One",
      },
    },
  });
}
async function seedAuthenticated(role: "owner" | "front_desk" | "housekeeper" | null) {
  resetSession({
    n3Token: "eyJ.tok.en",
    n3TokenExpiration: null,
    n3TenantKey: "n3-tenant-1",
    tenantCode: "T-001",
    companyName: "Test Hotel",
    n3UserKey: "user-1",
    userEmail: "u@example.test",
    userName: "User",
    tenantId: "tenant-uuid-1",
    createdAt: 1,
  });
  seedRole(role);
}

// ===================== performN3Launch =====================
describe("performN3Launch (shared handler for /?token= and /api/auth/launch)", () => {
  it("verifies via BasicInfo, opens a session, redirects clean, does not echo the token", async () => {
    seedBasicInfoOK();
    seedTenantUpsert();
    const { performN3Launch } = await import("@/lib/launch.server");
    const res = await performN3Launch(
      "eyJraWQiOiJ4In0.eyJzdWIiOiJ1c2VyLTEifQ.sig",
      "/",
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const body = await res.text();
    expect(body).toBe("");

    const lastUpdate = sessionState.updated.at(-1);
    expect(lastUpdate).toBeTruthy();
    expect((lastUpdate as { n3Token: string }).n3Token).toContain("eyJ");
    expect(sessionState.updated).toHaveLength(1);
    expect(auditEvents.some((e) => e.eventType === "session.launch.success")).toBe(true);
    expect(fetchCalls[0].url).toContain("/api/companyprofile/BasicInfo");
  });

  it("returns 401 when N3 rejects the token, does not open a session", async () => {
    fetchEnqueue({ status: 401, body: {} });
    const { performN3Launch } = await import("@/lib/launch.server");
    const res = await performN3Launch("bad.token.sig", "/");
    expect(res.status).toBe(401);
    expect(sessionState.updated).toHaveLength(0);
    expect(auditEvents.some((e) => e.eventType === "session.launch.failure")).toBe(true);
  });

  it("preserves unrelated query params on the clean redirect target", async () => {
    seedBasicInfoOK();
    seedTenantUpsert();
    const { performN3Launch, stripTokenFromUrl } = await import("@/lib/launch.server");
    const clean = stripTokenFromUrl(
      new URL("http://x.test/?token=abc&next=welcome&lang=en"),
    );
    expect(clean).toBe("/?next=welcome&lang=en");
    const res = await performN3Launch("eyJ.a.b", clean);
    expect(res.headers.get("location")).toBe("/?next=welcome&lang=en");
  });
});

// ===================== /api/auth/connect =====================
describe("/api/auth/connect (Path B, dev-only)", () => {
  const OLD_ENV = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = OLD_ENV;
  });
  it("returns 404 in production and never calls N3", async () => {
    process.env.NODE_ENV = "production";
    const { handleDevConnect } = await import("@/routes/api/auth/connect");
    const req = new Request("http://x.test/api/auth/connect", {
      method: "POST",
      body: JSON.stringify({ apiKey: "SECRET" }),
      headers: { "content-type": "application/json" },
    });
    const res = await handleDevConnect({ request: req });
    expect(res.status).toBe(404);
    expect(fetchCalls).toHaveLength(0);
  });
});

// ===================== /api/session/me =====================
describe("/api/session/me", () => {
  it("never returns the N3 token", async () => {
    await seedAuthenticated("owner");
    const { handleSessionMe } = await import("@/routes/api/session/me");
    const res = await handleSessionMe();
    const text = await res.text();
    expect(text).not.toContain("eyJ.tok.en");
    expect(text).not.toContain("n3Token");
    const body = JSON.parse(text);
    expect(body.authenticated).toBe(true);
    expect(body.role).toBe("owner");
    expect(body.tenant.n3TenantKey).toBe("n3-tenant-1");
    expect(body.user.n3UserKey).toBe("user-1");
  });

  it("returns anonymous shape when no session exists", async () => {
    resetSession();
    const { handleSessionMe } = await import("@/routes/api/session/me");
    const res = await handleSessionMe();
    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

// ===================== /api/auth/logout =====================
describe("/api/auth/logout", () => {
  it("destroys the server session", async () => {
    resetSession({ n3Token: "eyJ", tenantId: "tenant-uuid-1", n3UserKey: "u" });
    const { handleLogout } = await import("@/routes/api/auth/logout");
    const res = await handleLogout();
    expect(res.status).toBe(200);
    expect(sessionState.cleared).toBe(1);
    expect(sessionState.data).toEqual({});
    expect(auditEvents.some((e) => e.eventType === "session.destroyed")).toBe(true);
  });
});

// ===================== /api/n3/probe (metadata) =====================
describe("/api/n3/probe (metadata)", () => {
  it("owner receives the probe list", async () => {
    await seedAuthenticated("owner");
    const { handleProbeMetadata } = await import("@/routes/api/n3/probe/index");
    const res = await handleProbeMetadata();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.probes.map((p: { name: string }) => p.name).sort()).toEqual([
      "companyprofile",
      "customers",
      "stocks",
    ]);
  });
  it("front_desk → 403", async () => {
    await seedAuthenticated("front_desk");
    const { handleProbeMetadata } = await import("@/routes/api/n3/probe/index");
    expect((await handleProbeMetadata()).status).toBe(403);
  });
  it("housekeeper → 403", async () => {
    await seedAuthenticated("housekeeper");
    const { handleProbeMetadata } = await import("@/routes/api/n3/probe/index");
    expect((await handleProbeMetadata()).status).toBe(403);
  });
  it("role-unassigned → 403", async () => {
    await seedAuthenticated(null);
    const { handleProbeMetadata } = await import("@/routes/api/n3/probe/index");
    expect((await handleProbeMetadata()).status).toBe(403);
  });
  it("unauthenticated → 401", async () => {
    resetSession();
    const { handleProbeMetadata } = await import("@/routes/api/n3/probe/index");
    expect((await handleProbeMetadata()).status).toBe(401);
  });
});

// ===================== /api/n3/probe/:name (execute) =====================
describe("/api/n3/probe/:name (execute)", () => {
  it("unknown probe → 403 without any N3 call", async () => {
    await seedAuthenticated("owner");
    const { handleProbeExecute } = await import("@/routes/api/n3/probe/$probe");
    const res = await handleProbeExecute({
      request: new Request("http://x.test/api/n3/probe/../secrets"),
      params: { probe: "../secrets" },
    });
    expect(res.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });
  it("POST → 405 with Allow: GET", async () => {
    await seedAuthenticated("owner");
    const { handleProbeExecute } = await import("@/routes/api/n3/probe/$probe");
    const res = await handleProbeExecute({
      request: new Request("http://x.test/api/n3/probe/customers", { method: "POST" }),
      params: { probe: "customers" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });
  it("rejects front_desk / housekeeper / role-unassigned with 403", async () => {
    const { handleProbeExecute } = await import("@/routes/api/n3/probe/$probe");
    for (const role of ["front_desk", "housekeeper", null] as const) {
      await seedAuthenticated(role);
      const res = await handleProbeExecute({
        request: new Request("http://x.test/api/n3/probe/customers"),
        params: { probe: "customers" },
      });
      expect(res.status, `role=${role}`).toBe(403);
    }
    expect(fetchCalls).toHaveLength(0);
  });
  it("N3 401 during a probe destroys the session", async () => {
    await seedAuthenticated("owner");
    fetchEnqueue({ status: 401, body: {} });
    const { handleProbeExecute } = await import("@/routes/api/n3/probe/$probe");
    const res = await handleProbeExecute({
      request: new Request("http://x.test/api/n3/probe/customers"),
      params: { probe: "customers" },
    });
    expect(res.status).toBe(401);
    expect(sessionState.cleared).toBe(1);
    expect(auditEvents.some((e) => e.eventType === "session.n3_401")).toBe(true);
  });
});

// ===================== Cross-tenant role isolation =====================
describe("lookupRole cross-tenant isolation", () => {
  it("filters by both tenant_id AND n3_user_key so another tenant's row cannot authorize", async () => {
    // Seed a role belonging to tenant-B; we look it up as tenant-A.
    // The mock records the filters actually issued so we can assert them.
    supabaseEnqueue("hotel_user_roles", { data: null, error: null });
    const { lookupRole } = await import("@/lib/tenant-store.server");
    const result = await lookupRole("tenant-A", "user-shared");
    expect(result).toEqual({ status: "role_unassigned" });
    const call = supabaseCalls.find((c) => c.table === "hotel_user_roles");
    expect(call?.filters).toEqual(
      expect.arrayContaining([
        ["tenant_id", "tenant-A"],
        ["n3_user_key", "user-shared"],
      ]),
    );
  });
});
