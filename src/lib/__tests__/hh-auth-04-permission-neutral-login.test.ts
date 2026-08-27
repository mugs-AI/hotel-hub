/**
 * HH-AUTH-04 — permission-neutral N3 login.
 *
 * Official contract used for launch/lifecycle validation:
 *   operationId `UserData_GetValue_GET`  —  GET /api/UserData?keys=<key>
 *   security: global Bearer only (no business-module permission), so any
 *   authenticated N3 user of the tenant can call it.
 *
 * These suites prove that ordinary assigned front-desk / housekeeping staff
 * can launch and keep working when Company Profile (BasicInfo) and the Users
 * directory both refuse them, while every authority failure still fails
 * closed and no token or upstream body ever escapes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------- session ----------------
const sessionState = { data: {} as Record<string, unknown>, updates: 0, cleared: 0 };
vi.mock("@/lib/session.server", () => ({
  getHotelSession: async () => ({
    get data() {
      return sessionState.data;
    },
    async update(next: Record<string, unknown>) {
      sessionState.data = { ...sessionState.data, ...next };
      sessionState.updates++;
    },
    async clear() {
      sessionState.data = {};
      sessionState.cleared++;
    },
  }),
}));

// ---------------- audit ----------------
const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

// ---------------- identity store ----------------
const upsertCalls: string[] = [];
vi.mock("@/lib/tenant-store.server", () => ({
  upsertTenant: async (input: { n3TenantKey: string }) => {
    upsertCalls.push("upsertTenant");
    return {
      id: "tenant-1",
      n3TenantKey: input.n3TenantKey,
      tenantCode: "HOTEL",
      companyName: "Boutique Hotel",
    };
  },
  upsertUserDirectory: async () => {
    upsertCalls.push("upsertUserDirectory");
  },
  lookupRole: async () => localRoleState,
}));

let localRoleState:
  | { status: "assigned"; role: "owner" | "front_desk" | "housekeeper"; isActive: boolean }
  | { status: "role_unassigned" } = { status: "role_unassigned" };

// ---------------- N3 gateway ----------------
type GatewayResult = { status: number; body: unknown } | { throws: string };
const gatewayPaths: string[] = [];
let neutralResult: GatewayResult = { status: 200, body: { success: true, code: "0000" } };
let usersResult: GatewayResult = { status: 403, body: { message: "no permission" } };
let basicInfoResult: GatewayResult = { status: 403, body: { message: "no permission" } };

vi.mock("@/lib/n3-gateway.server", () => ({
  callN3Path: async (_token: string, path: string) => {
    gatewayPaths.push(path);
    const r = path.startsWith("/api/UserData")
      ? neutralResult
      : path.toLowerCase().includes("companyprofile")
        ? basicInfoResult
        : usersResult;
    if ("throws" in r) throw new Error(r.throws);
    return { status: r.status, body: r.body };
  },
}));

import { performN3Launch, LAUNCH_ERROR_HEADER } from "@/lib/launch.server";
import { N3_NEUTRAL_VALIDATION_PATH } from "@/lib/n3-token-validation";
import { __resetNeutralValidationCache } from "@/lib/n3-token-validation.server";
import { __resetOwnershipCache } from "@/lib/n3-owner.server";
import { readRequestContext } from "@/lib/session-context.server";

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function token(claims: Record<string, unknown>): string {
  return `${b64url({ alg: "none" })}.${b64url(claims)}.SIGNATURE`;
}
const STAFF_TOKEN = () =>
  token({
    sub: "u-staff",
    tenantId: "n3-tenant",
    tenantCode: "HOTEL",
    email: "staff@hotel.test",
    name: "Staff",
    exp: 4102444800,
  });
const NO_TENANT_TOKEN = () => token({ sub: "u-staff", email: "staff@hotel.test", exp: 4102444800 });
const NO_SUB_TOKEN = () =>
  token({ tenantId: "n3-tenant", email: "staff@hotel.test", exp: 4102444800 });

function seedSession(overrides: Record<string, unknown> = {}) {
  sessionState.data = {
    n3Token: STAFF_TOKEN(),
    n3TokenExpiration: null,
    n3TenantKey: "n3-tenant",
    tenantCode: "HOTEL",
    companyName: null,
    n3UserKey: "u-staff",
    userEmail: "staff@hotel.test",
    userName: "Staff",
    tenantId: "tenant-1",
    createdAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  sessionState.data = {};
  sessionState.updates = 0;
  sessionState.cleared = 0;
  auditEvents.length = 0;
  upsertCalls.length = 0;
  gatewayPaths.length = 0;
  neutralResult = { status: 200, body: { success: true, code: "0000" } };
  usersResult = { status: 403, body: { message: "no permission" } };
  basicInfoResult = { status: 403, body: { message: "no permission" } };
  localRoleState = { status: "role_unassigned" };
  __resetNeutralValidationCache();
  __resetOwnershipCache();
});

describe("HH-AUTH-04 — staff launch is permission-neutral", () => {
  it.each(["front_desk", "housekeeper"] as const)(
    "an assigned %s launches when BasicInfo and /api/Users both return 403",
    async (role) => {
      localRoleState = { status: "assigned", role, isActive: true };
      const res = await performN3Launch(STAFF_TOKEN(), "/", "root");
      expect(res.status).toBe(302);
      expect(sessionState.updates).toBe(1);
      // Company Profile is never on the staff launch critical path.
      expect(gatewayPaths).toEqual([N3_NEUTRAL_VALIDATION_PATH]);
      expect(gatewayPaths.join(" ")).not.toContain("companyprofile");

      const ctx = await readRequestContext();
      expect(ctx.authenticated).toBe(true);
      if (!ctx.authenticated) return;
      expect(ctx.role).toBe(role);
      expect(ctx.roleReason).toBe("n3_users_forbidden_local_staff");
    },
  );

  it("no local assignment means role-unassigned, never implicit access", async () => {
    await performN3Launch(STAFF_TOKEN(), "/", "root");
    const ctx = await readRequestContext();
    expect(ctx.authenticated).toBe(true);
    if (!ctx.authenticated) return;
    expect(ctx.role).toBeNull();
    expect(ctx.roleStatus).toBe("role_unassigned");
  });

  it("a /api/Users 403 can never grant Owner", async () => {
    localRoleState = { status: "assigned", role: "owner", isActive: true };
    await performN3Launch(STAFF_TOKEN(), "/", "root");
    const ctx = await readRequestContext();
    expect(ctx.authenticated).toBe(true);
    if (!ctx.authenticated) return;
    expect(ctx.role).toBeNull();
  });

  it("a matched active N3 Owner stays Owner", async () => {
    usersResult = {
      status: 200,
      body: { code: "0000", data: [{ id: "u-staff", isOwner: true, isActive: true }] },
    };
    await performN3Launch(STAFF_TOKEN(), "/", "root");
    const ctx = await readRequestContext();
    expect(ctx.authenticated).toBe(true);
    if (!ctx.authenticated) return;
    expect(ctx.role).toBe("owner");
  });

  it("a former Owner without an explicit staff assignment has no access", async () => {
    usersResult = {
      status: 200,
      body: { code: "0000", data: [{ id: "u-staff", isOwner: false, isActive: true }] },
    };
    localRoleState = { status: "assigned", role: "owner", isActive: true };
    await performN3Launch(STAFF_TOKEN(), "/", "root");
    const ctx = await readRequestContext();
    expect(ctx.authenticated).toBe(true);
    if (!ctx.authenticated) return;
    expect(ctx.role).toBeNull();
    expect(ctx.roleReason).toBe("n3_owner_revoked");
  });

  it("an inactive matched N3 user is denied and the session is destroyed", async () => {
    usersResult = {
      status: 200,
      body: { code: "0000", data: [{ id: "u-staff", isOwner: false, isActive: false }] },
    };
    localRoleState = { status: "assigned", role: "front_desk", isActive: true };
    await performN3Launch(STAFF_TOKEN(), "/", "root");
    const before = sessionState.cleared;
    const ctx = await readRequestContext();
    expect(ctx.authenticated).toBe(false);
    expect(sessionState.cleared).toBeGreaterThan(before);
  });
});

describe("HH-AUTH-04 — neutral validation is authoritative and fails closed", () => {
  it.each([
    [{ status: 401, body: {} } as GatewayResult, "n3_rejected"],
    [{ status: 403, body: {} } as GatewayResult, "n3_access_denied"],
    [{ status: 500, body: {} } as GatewayResult, "n3_unavailable"],
    [{ throws: "network down" } as GatewayResult, "n3_unavailable"],
    [{ status: 200, body: { success: false, code: "9999" } } as GatewayResult, "n3_unavailable"],
    [{ status: 200, body: { code: "1234" } } as GatewayResult, "n3_unavailable"],
  ])("launch %#: an unaccepted token cannot create a session", async (result, expected) => {
    neutralResult = result;
    const res = await performN3Launch(STAFF_TOKEN(), "/", "root");
    expect(res.headers.get(LAUNCH_ERROR_HEADER)).toBe(expected);
    expect(sessionState.updates).toBe(0);
    expect(sessionState.data).toEqual({});
    expect(upsertCalls).toEqual([]);
  });

  it.each([
    { status: 401, body: {} } as GatewayResult,
    { status: 403, body: {} } as GatewayResult,
    { status: 503, body: {} } as GatewayResult,
    { throws: "timeout" } as GatewayResult,
    { status: 200, body: { success: false, code: "9999" } } as GatewayResult,
  ])("protected request %#: clears the session on authority failure", async (result) => {
    localRoleState = { status: "assigned", role: "front_desk", isActive: true };
    seedSession();
    neutralResult = result;
    const ctx = await readRequestContext();
    expect(ctx.authenticated).toBe(false);
    expect(sessionState.cleared).toBeGreaterThan(0);
    expect(sessionState.data).toEqual({});
    const destroyed = auditEvents.filter((e) => e.eventType === "session.destroyed");
    expect(destroyed.length).toBeGreaterThan(0);
    expect(JSON.stringify(destroyed)).not.toContain("SIGNATURE");
  });

  it("requires an immutable sub and a tenant; email cannot authorize", async () => {
    const noSub = await performN3Launch(NO_SUB_TOKEN(), "/", "root");
    expect(noSub.headers.get(LAUNCH_ERROR_HEADER)).toBe("identity_unavailable");
    expect(sessionState.updates).toBe(0);

    const noTenant = await performN3Launch(NO_TENANT_TOKEN(), "/", "root");
    expect(noTenant.headers.get(LAUNCH_ERROR_HEADER)).toBe("identity_unavailable");
    expect(sessionState.updates).toBe(0);
  });

  it("a cross-tenant local assignment cannot be used", async () => {
    localRoleState = { status: "role_unassigned" }; // no row for THIS tenant
    seedSession({ tenantId: "tenant-other" });
    const ctx = await readRequestContext();
    expect(ctx.authenticated).toBe(true);
    if (!ctx.authenticated) return;
    expect(ctx.role).toBeNull();
  });

  it("never leaks the token or an upstream body into responses, logs or audit", async () => {
    neutralResult = { status: 403, body: { message: "upstream-secret-detail" } };
    const raw = STAFF_TOKEN();
    const res = await performN3Launch(raw, "/", "root");
    const body = await res.text();
    expect(body).not.toContain(raw);
    expect(body).not.toContain("upstream-secret-detail");
    expect(res.headers.get("location")).toBeNull();
    const dump = JSON.stringify(auditEvents);
    expect(dump).not.toContain(raw);
    expect(dump).not.toContain("upstream-secret-detail");
  });
});

describe("HH-AUTH-04 audit correction — envelope and claim ambiguity fail closed", () => {
  it.each([
    ["bare 200 object", { status: 200, body: {} } as const],
    ["null body", { status: 200, body: null } as const],
    ["array body", { status: 200, body: [] } as const],
    ["unrelated payload", { status: 200, body: { value: "probe" } } as const],
    ["204 no body", { status: 204, body: null } as const],
    ["unsuccessful envelope", { status: 200, body: { code: "1001" } } as const],
    ["contradictory envelope", { status: 200, body: { code: "0000", success: false } } as const],
  ])("a 2xx without an explicitly successful envelope denies launch: %s", async (_l, result) => {
    neutralResult = result;
    localRoleState = { status: "assigned", role: "front_desk", isActive: true };
    const res = await performN3Launch(STAFF_TOKEN(), "/", "root");
    expect(res.headers.get(LAUNCH_ERROR_HEADER)).toBe("n3_unavailable");
    expect(sessionState.updates).toBe(0);
    expect(upsertCalls).toEqual([]);
  });

  it("an explicitly successful envelope still launches", async () => {
    neutralResult = { status: 200, body: { code: "0000", success: true, data: null } };
    localRoleState = { status: "assigned", role: "front_desk", isActive: true };
    const res = await performN3Launch(STAFF_TOKEN(), "/", "root");
    expect(res.status).toBe(302);
    expect(sessionState.updates).toBe(1);
  });

  it("a matching sub plus alternate immutable ID launches", async () => {
    localRoleState = { status: "assigned", role: "front_desk", isActive: true };
    const res = await performN3Launch(
      token({
        sub: "u-staff",
        userId: "u-staff",
        tenantId: "n3-tenant",
        exp: 4102444800,
      }),
      "/",
      "root",
    );
    expect(res.status).toBe(302);
    expect(sessionState.updates).toBe(1);
  });

  it("conflicting user-ID claims deny before any upsert or session", async () => {
    localRoleState = { status: "assigned", role: "front_desk", isActive: true };
    const res = await performN3Launch(
      token({ sub: "u-staff", userId: "u-other", tenantId: "n3-tenant", exp: 4102444800 }),
      "/",
      "root",
    );
    expect(res.headers.get(LAUNCH_ERROR_HEADER)).toBe("identity_unavailable");
    expect(upsertCalls).toEqual([]);
    expect(sessionState.updates).toBe(0);
    expect(JSON.stringify(auditEvents)).toContain("ambiguous_n3_user_key");
  });

  it("conflicting tenant-ID claims deny before any upsert or session", async () => {
    localRoleState = { status: "assigned", role: "front_desk", isActive: true };
    const res = await performN3Launch(
      token({ sub: "u-staff", tenantId: "n3-tenant", companyId: "other-tenant", exp: 4102444800 }),
      "/",
      "root",
    );
    expect(res.headers.get(LAUNCH_ERROR_HEADER)).toBe("identity_unavailable");
    expect(upsertCalls).toEqual([]);
    expect(sessionState.updates).toBe(0);
    expect(JSON.stringify(auditEvents)).toContain("ambiguous_n3_tenant_key");
  });
});
