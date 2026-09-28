import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allowed: true,
  reason: "role_denied",
  saved: [] as Array<[string, string, string]>,
  savedUser: [] as Array<[string, string, string]>,
  directoryName: "N3 Owner",
  n3Calls: 0,
  upstreamStatus: 200,
  upstreamBody: {
    code: "0000",
    data: {
      TenantId: "n3-tenant-1",
      TenantCode: "9AC-0D9-2F1",
      CompanyName: "MUGS AI LAB TEST SDN. BHD.",
    },
  } as unknown,
}));

vi.mock("@/lib/session-context.server", () => ({
  requirePermission: async () => ({
    ctx: {
      session: {
        n3Token: "server-only-token",
        tenantId: "hotel-tenant-1",
        n3TenantKey: "n3-tenant-1",
        tenantCode: "9AC-0D9-2F1",
        n3UserKey: "owner-1",
      },
    },
    decision: state.allowed ? { ok: true } : { ok: false, reason: state.reason },
  }),
  destroySession: async () => {},
}));
vi.mock("@/lib/n3-gateway.server", () => ({
  callN3Path: async () => {
    state.n3Calls++;
    return { status: state.upstreamStatus, body: state.upstreamBody, durationMs: 1 };
  },
}));
vi.mock("@/lib/jwt-claims.server", () => ({
  decodeJwtClaims: () => ({ tenantId: "n3-tenant-1" }),
}));
vi.mock("@/lib/n3-owner.server", () => ({
  readN3Users: async () => ({
    status: "ok",
    users: [
      { id: "someone-else", userName: "Wrong User" },
      { id: "owner-1", userName: state.directoryName },
    ],
  }),
}));
vi.mock("@/lib/tenant-store.server", () => ({
  saveTenantCompanyName: async (tenant: string, key: string, name: string) => {
    state.saved.push([tenant, key, name]);
  },
  saveUserDisplayName: async (tenant: string, user: string, name: string) => {
    state.savedUser.push([tenant, user, name]);
  },
}));
vi.mock("@/lib/audit.server", () => ({ logAudit: async () => {} }));

const { handleRefreshCompanyName } = await import("@/routes/api/hotel/company-name.refresh");
const request = (origin = "https://hotel.example") =>
  new Request("https://hotel.example/api/hotel/company-name/refresh", {
    method: "POST",
    headers: { origin },
  });

beforeEach(() => {
  state.allowed = true;
  state.reason = "role_denied";
  state.n3Calls = 0;
  state.saved = [];
  state.savedUser = [];
  state.directoryName = "N3 Owner";
  state.upstreamStatus = 200;
  state.upstreamBody = {
    code: "0000",
    data: {
      TenantId: "n3-tenant-1",
      TenantCode: "9AC-0D9-2F1",
      CompanyName: "MUGS AI LAB TEST SDN. BHD.",
    },
  };
});

describe("Owner-only N3 company display sync", () => {
  it("rejects cross-site writes and non-Owners before touching N3", async () => {
    expect(
      (await handleRefreshCompanyName({ request: request("https://other.example") })).status,
    ).toBe(403);
    state.allowed = false;
    expect((await handleRefreshCompanyName({ request: request() })).status).toBe(403);
    expect(state.n3Calls).toBe(0);
    expect(state.saved).toEqual([]);
  });

  it("persists only the N3 name for the exact session tenant", async () => {
    const res = await handleRefreshCompanyName({ request: request() });
    expect(res.status).toBe(200);
    expect(await res.clone().text()).not.toContain("server-only-token");
    expect(await res.json()).toEqual({ companyName: "MUGS AI LAB TEST SDN. BHD." });
    expect(state.saved).toEqual([["hotel-tenant-1", "n3-tenant-1", "MUGS AI LAB TEST SDN. BHD."]]);
    expect(state.savedUser).toEqual([["hotel-tenant-1", "owner-1", "N3 Owner"]]);
  });

  it("refuses a conflicting N3 tenant and missing name without writing", async () => {
    state.upstreamBody = { code: "0000", data: { TenantId: "other-tenant", CompanyName: "Wrong" } };
    expect((await handleRefreshCompanyName({ request: request() })).status).toBe(409);
    state.upstreamBody = { code: "0000", data: { TenantId: "n3-tenant-1" } };
    expect((await handleRefreshCompanyName({ request: request() })).status).toBe(502);
    expect(state.saved).toEqual([]);
    expect(state.savedUser).toEqual([]);
  });

  it("never uses another N3 user's name or an email as the header name", async () => {
    state.directoryName = "owner@example.com";
    const res = await handleRefreshCompanyName({ request: request() });
    expect(res.status).toBe(200);
    expect(state.savedUser).toEqual([]);
  });

  it("keeps a Company Profile 403 optional for the caller", async () => {
    state.upstreamStatus = 403;
    const res = await handleRefreshCompanyName({ request: request() });
    expect(await res.json()).toEqual({ error: "n3_company_profile_forbidden" });
    expect(state.saved).toEqual([]);
  });
});
