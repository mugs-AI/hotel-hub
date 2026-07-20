/**
 * Route + session security tests. Handlers are called directly with mocked
 * request objects. External surfaces (N3 HTTP, Supabase service-role
 * client, session cookie) are mocked so no live credentials are needed.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

// ---------- Shared mock state ----------
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

const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];

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

vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

const tenantStore = vi.hoisted(() => ({
  upsertTenant: vi.fn(),
  lookupRole: vi.fn(),
}));
vi.mock("@/lib/tenant-store.server", () => tenantStore);

const gateway = vi.hoisted(() => ({
  callN3Path: vi.fn(),
  runProbe: vi.fn(),
  isProbeName: (v: unknown): v is "companyprofile" | "customers" | "stocks" =>
    v === "companyprofile" || v === "customers" || v === "stocks",
  listProbes: () => [
    { name: "companyprofile", label: "", description: "" },
    { name: "customers", label: "", description: "" },
    { name: "stocks", label: "", description: "" },
  ],
  exchangeApiKey: vi.fn(),
}));
vi.mock("@/lib/n3-gateway.server", () => gateway);

beforeEach(() => {
  resetSession();
  auditEvents.length = 0;
  tenantStore.upsertTenant.mockClear();
  tenantStore.lookupRole.mockReset();
  tenantStore.lookupRole.mockResolvedValue({ status: "role_unassigned" });
  gateway.callN3Path.mockClear();
  gateway.runProbe.mockClear();
  gateway.exchangeApiKey.mockClear();
});

// ---------- performN3Launch ----------
describe("performN3Launch (shared handler for /?token= and /api/auth/launch)", () => {
  it("verifies via BasicInfo, opens a session, and redirects to a clean URL without echoing the token", async () => {
    const { performN3Launch } = await import("@/lib/launch.server");
    const res = await performN3Launch("eyJraWQiOiJ4In0.eyJzdWIiOiJ1c2VyLTEifQ.sig", "/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const body = await res.text();
    expect(body).toBe("");
    expect(body).not.toContain("eyJ");

    // Session updated with the token server-side only.
    const lastUpdate = sessionState.updated.at(-1)!;
    expect(lastUpdate.n3Token).toContain("eyJ");
    expect(lastUpdate.tenantId).toBe("tenant-uuid-1");
    expect(sessionState.updated).toHaveLength(1);
    expect(auditEvents.some((e) => e.eventType === "session.launch.success")).toBe(true);
    expect(gateway.callN3Path).toHaveBeenCalledWith(
      expect.stringContaining("eyJ"),
      "/api/companyprofile/BasicInfo",
    );
  });

  it("returns 401 when N3 rejects the token, does not open a session, and audits failure", async () => {
    gateway.callN3Path.mockResolvedValueOnce({ status: 401, body: null as unknown as { code: string; data: unknown }, durationMs: 1 });
    const { performN3Launch } = await import("@/lib/launch.server");
    const res = await performN3Launch("bad.token.sig", "/");
    expect(res.status).toBe(401);
    expect(sessionState.updated).toHaveLength(0);
    expect(auditEvents.some((e) => e.eventType === "session.launch.failure")).toBe(true);
  });

  it("preserves unrelated query params on the clean redirect target", async () => {
    const { performN3Launch, stripTokenFromUrl } = await import("@/lib/launch.server");
    const clean = stripTokenFromUrl(new URL("http://x.test/?token=abc&next=welcome&lang=en"));
    expect(clean).toBe("/?next=welcome&lang=en");
    const res = await performN3Launch("eyJ.a.b", clean);
    expect(res.headers.get("location")).toBe("/?next=welcome&lang=en");
  });
});

// ---------- /api/auth/connect ----------
describe("/api/auth/connect (Path B, dev-only)", () => {
  const OLD_ENV = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = OLD_ENV;
  });

  it("returns 404 in production and does not exchange the API key", async () => {
    process.env.NODE_ENV = "production";
    const { handleDevConnect } = await import("@/routes/api/auth/connect");
    const req = new Request("http://x.test/api/auth/connect", {
      method: "POST",
      body: JSON.stringify({ apiKey: "SECRET" }),
      headers: { "content-type": "application/json" },
    });
    const res = await handleDevConnect({ request: req });
    expect(res.status).toBe(404);
    expect(gateway.exchangeApiKey).not.toHaveBeenCalled();
  });
});

// ---------- /api/session/me ----------
describe("/api/session/me", () => {
  it("never returns the N3 token", async () => {
    resetSession({
      n3Token: "eyJ.NEVER.LEAK",
      n3TokenExpiration: null,
      n3TenantKey: "n3-tenant-1",
      tenantCode: "T-001",
      companyName: "Test Hotel",
      n3UserKey: "user-1",
      userEmail: "u@example.test",
      userName: "User One",
      tenantId: "tenant-uuid-1",
      createdAt: 1,
    });
    tenantStore.lookupRole.mockResolvedValueOnce({
      status: "assigned",
      role: "owner",
      isActive: true,
    });
    const { handleSessionMe } = await import("@/routes/api/session/me");
    const res = await handleSessionMe();
    const text = await res.text();
    expect(text).not.toContain("NEVER");
    expect(text).not.toContain("n3Token");
    const body = JSON.parse(text);
    expect(body.authenticated).toBe(true);
    expect(body.role).toBe("owner");
    expect(body.tenant.n3TenantKey).toBe("n3-tenant-1");
    expect(body.user.n3UserKey).toBe("user-1");
  });

  it("returns anonymous shape when no session is present", async () => {
    resetSession();
    const { handleSessionMe } = await import("@/routes/api/session/me");
    const res = await handleSessionMe();
    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

// ---------- /api/auth/logout ----------
describe("/api/auth/logout", () => {
  it("destroys the server session", async () => {
    resetSession({
      n3Token: "eyJ",
      tenantId: "tenant-uuid-1",
      n3UserKey: "u",
    });
    const { handleLogout } = await import("@/routes/api/auth/logout");
    const res = await handleLogout();
    expect(res.status).toBe(200);
    expect(sessionState.cleared).toBe(1);
    expect(sessionState.data).toEqual({});
    expect(auditEvents.some((e) => e.eventType === "session.destroyed")).toBe(true);
  });
});

// ---------- /api/n3/probe (metadata) ----------
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
  tenantStore.lookupRole.mockReset();
  if (role === null) {
    tenantStore.lookupRole.mockResolvedValue({ status: "role_unassigned" });
  } else {
    tenantStore.lookupRole.mockResolvedValue({ status: "assigned", role, isActive: true });
  }
}

describe("/api/n3/probe (metadata)", () => {
  it("requires n3:verify — front_desk gets 403", async () => {
    await seedAuthenticated("front_desk");
    const { handleProbeMetadata } = await import("@/routes/api/n3/probe/index");
    const res = await handleProbeMetadata();
    expect(res.status).toBe(403);
  });
  it("housekeeper gets 403", async () => {
    await seedAuthenticated("housekeeper");
    const { handleProbeMetadata } = await import("@/routes/api/n3/probe/index");
    expect((await handleProbeMetadata()).status).toBe(403);
  });
  it("role-unassigned gets 403", async () => {
    await seedAuthenticated(null);
    const { handleProbeMetadata } = await import("@/routes/api/n3/probe/index");
    expect((await handleProbeMetadata()).status).toBe(403);
  });
  it("unauthenticated gets 401", async () => {
    resetSession();
    const { handleProbeMetadata } = await import("@/routes/api/n3/probe/index");
    expect((await handleProbeMetadata()).status).toBe(401);
  });
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
});

// ---------- /api/n3/probe/:name (execute) ----------
describe("/api/n3/probe/:name (execute)", () => {
  it("unknown probe → 403", async () => {
    await seedAuthenticated("owner");
    const { handleProbeExecute } = await import("@/routes/api/n3/probe/$probe");
    const res = await handleProbeExecute({
      request: new Request("http://x.test/api/n3/probe/../secrets"),
      params: { probe: "../secrets" },
    });
    expect(res.status).toBe(403);
    expect(gateway.runProbe).not.toHaveBeenCalled();
  });

  it("POST → 405", async () => {
    await seedAuthenticated("owner");
    const { handleProbeExecute } = await import("@/routes/api/n3/probe/$probe");
    const res = await handleProbeExecute({
      request: new Request("http://x.test/api/n3/probe/customers", { method: "POST" }),
      params: { probe: "customers" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  it("rejects front_desk, housekeeper and role-unassigned with 403", async () => {
    const { handleProbeExecute } = await import("@/routes/api/n3/probe/$probe");
    for (const role of ["front_desk", "housekeeper", null] as const) {
      await seedAuthenticated(role);
      const res = await handleProbeExecute({
        request: new Request("http://x.test/api/n3/probe/customers"),
        params: { probe: "customers" },
      });
      expect(res.status, `role=${role}`).toBe(403);
    }
    expect(gateway.runProbe).not.toHaveBeenCalled();
  });

  it("N3 401 during a probe destroys the session", async () => {
    await seedAuthenticated("owner");
    gateway.runProbe.mockResolvedValueOnce({ status: 401, body: null as unknown as { code: string; data: never[] }, durationMs: 1 });
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

// ---------- Cross-tenant role isolation ----------
describe("lookupRole filters by tenant_id (cross-tenant isolation)", () => {
  it("issues a filtered query that would not return another tenant's assignment", async () => {
    vi.unmock("@/lib/tenant-store.server");
    vi.resetModules();

    const eqMock = vi.fn().mockReturnThis();
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: eqMock,
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    vi.doMock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: { from: () => chain },
    }));

    const { lookupRole } = await import("@/lib/tenant-store.server");
    const result = await lookupRole("tenant-A", "user-shared");
    expect(result).toEqual({ status: "role_unassigned" });
    // Both filters must be present: tenant_id AND n3_user_key. A row keyed
    // to tenant-B could never satisfy tenant_id=tenant-A.
    expect(eqMock).toHaveBeenCalledWith("tenant_id", "tenant-A");
    expect(eqMock).toHaveBeenCalledWith("n3_user_key", "user-shared");

    vi.doUnmock("@/integrations/supabase/client.server");
    vi.resetModules();
  });
});
