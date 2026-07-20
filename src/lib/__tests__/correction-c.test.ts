/**
 * Milestone 1.0.1 Correction C regression tests.
 * These lock in the specific defects called out in the correction brief so
 * they cannot silently return.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------- shared mocks (mirror route-handlers.test.ts) ----------------
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

const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

type SupabaseResult = { data: unknown; error: unknown };
const supabaseQueue = new Map<string, SupabaseResult[]>();
function supabaseEnqueue(table: string, result: SupabaseResult) {
  const arr = supabaseQueue.get(table) ?? [];
  arr.push(result);
  supabaseQueue.set(table, arr);
}
function makeBuilder(table: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    upsert: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    eq: () => chain,
    single: async () => supabaseQueue.get(table)?.shift() ?? { data: null, error: null },
    maybeSingle: async () => supabaseQueue.get(table)?.shift() ?? { data: null, error: null },
    then: (resolve: (v: SupabaseResult) => unknown) =>
      resolve(supabaseQueue.get(table)?.shift() ?? { data: null, error: null }),
  };
  return chain;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}));

type FetchResponse = { status: number; body: unknown; asText?: string };
const fetchQueue: FetchResponse[] = [];
const fetchCalls: Array<{ url: string }> = [];
function fetchEnqueue(r: FetchResponse) {
  fetchQueue.push(r);
}
const originalFetch = globalThis.fetch;
beforeEach(() => {
  resetSession();
  auditEvents.length = 0;
  supabaseQueue.clear();
  fetchQueue.length = 0;
  fetchCalls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url });
    const next = fetchQueue.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    if (next.asText !== undefined) {
      return new Response(next.asText, {
        status: next.status,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function seedAuthenticatedOwner(overrides: Partial<Record<string, unknown>> = {}) {
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
    ...overrides,
  });
  supabaseEnqueue("hotel_user_roles", { data: { role: "owner", is_active: true }, error: null });
}

// ============= Task 1 — N3-only identity =============
describe("Task 1: Supabase Auth is not registered in start.ts", () => {
  it("does not import attachSupabaseAuth and registers empty functionMiddleware", () => {
    const source = readFileSync(resolve(__dirname, "../../start.ts"), "utf8");
    expect(source).not.toMatch(/attachSupabaseAuth/);
    expect(source).toMatch(/functionMiddleware:\s*\[\s*\]/);
  });
});

// ============= Task 2 — Fail-closed root token handling =============
describe("Task 2: performN3Launch is fail-closed", () => {
  it("clears any pre-existing session when N3 rejects the token (401)", async () => {
    resetSession({
      n3Token: "old.token.sig",
      tenantId: "tenant-uuid-1",
      n3UserKey: "user-1",
    });
    fetchEnqueue({ status: 401, body: {} });
    const { performN3Launch } = await import("@/lib/launch.server");
    const res = await performN3Launch("eyJ.new.sig", "/");
    expect(res.status).toBe(401);
    expect(sessionState.cleared).toBeGreaterThanOrEqual(1);
    expect(sessionState.data).toEqual({});
  });

  it("never echoes the token in the response body on failure", async () => {
    fetchEnqueue({ status: 401, body: {} });
    const { performN3Launch } = await import("@/lib/launch.server");
    const raw = "eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIG";
    const res = await performN3Launch(raw, "/");
    const text = await res.text();
    expect(text).not.toContain(raw);
    expect(text).not.toContain("PAYLOAD");
  });
});

// ============= Task 3 — Doubled email defect =============
describe("Task 3: doubled email input collapses to one address", () => {
  it("literal LKS.MUGS@GMAIL.COMLKS.MUGS@GMAIL.COM → LKS.MUGS@GMAIL.COM", async () => {
    const { pickAuthoritativeEmail, normalizeEmail, normalizeBasicInfo } = await import(
      "@/lib/n3-basicinfo"
    );
    expect(normalizeEmail("LKS.MUGS@GMAIL.COMLKS.MUGS@GMAIL.COM")).toBe("LKS.MUGS@GMAIL.COM");
    expect(
      pickAuthoritativeEmail({ Email: "LKS.MUGS@GMAIL.COMLKS.MUGS@GMAIL.COM" }, {}),
    ).toBe("LKS.MUGS@GMAIL.COM");
    const info = normalizeBasicInfo({ Email: "LKS.MUGS@GMAIL.COMLKS.MUGS@GMAIL.COM" });
    expect(info.userEmail).toBe("LKS.MUGS@GMAIL.COM");
  });

  it("trims surrounding whitespace", async () => {
    const { normalizeEmail } = await import("@/lib/n3-basicinfo");
    expect(normalizeEmail("  a@b.co  ")).toBe("a@b.co");
  });

  it("rejects garbage that does not resolve to a valid email", async () => {
    const { normalizeEmail } = await import("@/lib/n3-basicinfo");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("abcabc")).toBeNull();
  });
});

// ============= Task 4 — Session expiry =============
describe("Task 4: verified JWT exp is enforced", () => {
  function makeJwt(payload: Record<string, unknown>): string {
    const b64 = (s: string) =>
      Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    return `${b64('{"alg":"none"}')}.${b64(JSON.stringify(payload))}.sig`;
  }

  it("launch rejects a JWT whose exp is already in the past and clears any prior session", async () => {
    resetSession({ n3Token: "prev", tenantId: "tenant-uuid-1", n3UserKey: "u" });
    const expiredJwt = makeJwt({ sub: "user-1", exp: Math.floor(Date.now() / 1000) - 60 });
    const { performN3Launch } = await import("@/lib/launch.server");
    const res = await performN3Launch(expiredJwt, "/");
    expect(res.status).toBe(401);
    expect(fetchCalls).toHaveLength(0);
    expect(sessionState.cleared).toBeGreaterThanOrEqual(1);
    expect(auditEvents.some((e) => e.eventType === "session.launch.failure")).toBe(true);
  });

  it("readRequestContext destroys an expired session cookie", async () => {
    resetSession({
      n3Token: "eyJ.tok.en",
      n3TokenExpiration: new Date(Date.now() - 60_000).toISOString(),
      n3TenantKey: "n3-tenant-1",
      tenantCode: "T",
      companyName: "T",
      n3UserKey: "u",
      userEmail: "u@x.co",
      userName: "u",
      tenantId: "tenant-uuid-1",
      createdAt: 1,
    });
    const { readRequestContext } = await import("@/lib/session-context.server");
    const ctx = await readRequestContext();
    expect(ctx.authenticated).toBe(false);
    expect(sessionState.cleared).toBe(1);
  });
});

// ============= Task 5 — Probe hardening =============
describe("Task 5: probe execute authorizes BEFORE disclosing allowlist", () => {
  it("unauthenticated caller with a bogus probe name gets 401 with no allowlist", async () => {
    resetSession();
    const { handleProbeExecute } = await import("@/routes/api/n3/probe/$probe");
    const res = await handleProbeExecute({
      request: new Request("http://x.test/api/n3/probe/../secrets"),
      params: { probe: "../secrets" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).not.toHaveProperty("allowed");
    expect(JSON.stringify(body)).not.toMatch(/companyprofile|customers|stocks/);
  });

  it("front_desk caller with a bogus probe name gets 403 with no allowlist", async () => {
    resetSession({
      n3Token: "eyJ",
      tenantId: "tenant-uuid-1",
      n3UserKey: "u",
      n3TenantKey: "n3-tenant-1",
      tenantCode: "T",
      companyName: "T",
      userEmail: "u@x.co",
      userName: "u",
      createdAt: 1,
    });
    supabaseEnqueue("hotel_user_roles", {
      data: { role: "front_desk", is_active: true },
      error: null,
    });
    const { handleProbeExecute } = await import("@/routes/api/n3/probe/$probe");
    const res = await handleProbeExecute({
      request: new Request("http://x.test/api/n3/probe/../secrets"),
      params: { probe: "../secrets" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/companyprofile|customers|stocks/);
  });

  it("hides upstream non-JSON/HTML error bodies (e.g. stack trace pages)", async () => {
    seedAuthenticatedOwner();
    fetchEnqueue({ status: 502, asText: "<html><body>UPSTREAM STACK TRACE secret=abc</body></html>", body: null });
    const { handleProbeExecute } = await import("@/routes/api/n3/probe/$probe");
    const res = await handleProbeExecute({
      request: new Request("http://x.test/api/n3/probe/customers"),
      params: { probe: "customers" },
    });
    expect(res.status).toBe(200); // gateway responds 200 with sanitized metadata
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/STACK TRACE|secret=abc|<html>/);
    expect(body.status).toBe(502);
  });

  it("truncates an oversized upstream JSON body to metadata only", async () => {
    seedAuthenticatedOwner();
    const huge = { data: "x".repeat(200_000) };
    fetchEnqueue({ status: 200, body: huge });
    const { handleProbeExecute } = await import("@/routes/api/n3/probe/$probe");
    const res = await handleProbeExecute({
      request: new Request("http://x.test/api/n3/probe/customers"),
      params: { probe: "customers" },
    });
    const body = await res.json();
    expect(body.bodyKind).toBe("truncated");
    expect(JSON.stringify(body).length).toBeLessThan(2_000);
  });

  it("preserves a successful Owner-only JSON payload", async () => {
    seedAuthenticatedOwner();
    fetchEnqueue({ status: 200, body: { code: "0000", data: { CompanyName: "Ok" } } });
    const { handleProbeExecute } = await import("@/routes/api/n3/probe/$probe");
    const res = await handleProbeExecute({
      request: new Request("http://x.test/api/n3/probe/companyprofile"),
      params: { probe: "companyprofile" },
    });
    const body = await res.json();
    expect(body.status).toBe(200);
    expect(body.bodyKind).toBe("json");
    expect((body.body as { data: { CompanyName: string } }).data.CompanyName).toBe("Ok");
  });
});
