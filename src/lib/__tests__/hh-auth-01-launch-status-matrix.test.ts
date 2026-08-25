/**
 * HH-AUTH-01 — launch failure status matrix.
 *
 * Proves that `performN3Launch` maps each BasicInfo outcome to a distinct
 * safe launch-error code, that a 403 denial creates no session and never
 * reaches tenant/user upsert, and that no upstream body or token material
 * leaks into responses or audit detail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// -------- session mock --------
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

// -------- audit mock --------
const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

// -------- identity store mock (must NOT be reached on 403) --------
const upsertCalls: string[] = [];
vi.mock("@/lib/tenant-store.server", () => ({
  upsertTenant: async () => {
    upsertCalls.push("upsertTenant");
    return {
      id: "tenant-1",
      n3TenantKey: "n3-tenant",
      tenantCode: "HOTEL",
      companyName: "Boutique Hotel",
    };
  },
  upsertUserDirectory: async () => {
    upsertCalls.push("upsertUserDirectory");
  },
}));

// -------- N3 gateway mock --------
type GatewayResult = { status: number; body: unknown } | { throws: string };
const gatewayQueue: GatewayResult[] = [];
const gatewayPaths: string[] = [];
vi.mock("@/lib/n3-gateway.server", () => ({
  callN3Path: async (_token: string, path: string) => {
    gatewayPaths.push(path);
    const next = gatewayQueue.shift();
    if (!next) throw new Error("no gateway response queued");
    if ("throws" in next) throw new Error(next.throws);
    return { status: next.status, body: next.body };
  },
}));

import { performN3Launch, SAFE_LAUNCH_ERROR_CODES, LAUNCH_ERROR_HEADER } from "@/lib/launch.server";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function token(claims: Record<string, unknown>): string {
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(claims)}.sig`;
}
const VALID = () => token({ sub: "u-1", email: "staff@hotel.test", exp: 4102444800 });
const EXPIRED = () => token({ sub: "u-1", exp: 1000 });

const BASIC_INFO_OK = {
  status: 200,
  body: {
    code: "0000",
    data: {
      tenantId: "n3-tenant",
      tenantCode: "HOTEL",
      companyName: "Boutique Hotel",
      email: "staff@hotel.test",
      userName: "staff",
    },
  },
};

beforeEach(() => {
  sessionState.data = {};
  sessionState.updates = 0;
  sessionState.cleared = 0;
  auditEvents.length = 0;
  upsertCalls.length = 0;
  gatewayQueue.length = 0;
  gatewayPaths.length = 0;
});

function code(res: Response): string | null {
  return res.headers.get(LAUNCH_ERROR_HEADER);
}

describe("HH-AUTH-01 — allowlisted codes", () => {
  it("includes n3_access_denied exactly once", () => {
    expect(SAFE_LAUNCH_ERROR_CODES.filter((c) => c === "n3_access_denied")).toHaveLength(1);
  });
});

describe("HH-AUTH-01 — BasicInfo status matrix", () => {
  it("locally expired JWT -> session_expired, no N3 call", async () => {
    const res = await performN3Launch(EXPIRED(), "/", "root");
    expect(code(res)).toBe("session_expired");
    expect(gatewayPaths).toHaveLength(0);
    expect(sessionState.updates).toBe(0);
    expect(sessionState.cleared).toBeGreaterThan(0);
  });

  it("BasicInfo 401 -> n3_rejected", async () => {
    gatewayQueue.push({ status: 401, body: { message: "upstream-secret-detail" } });
    const res = await performN3Launch(VALID(), "/", "root");
    expect(code(res)).toBe("n3_rejected");
    expect(await res.text()).not.toContain("upstream-secret-detail");
    expect(sessionState.updates).toBe(0);
  });

  it("BasicInfo 403 -> n3_access_denied, no session, no upsert, no /api/Users", async () => {
    gatewayQueue.push({ status: 403, body: { message: "upstream-secret-detail" } });
    const res = await performN3Launch(VALID(), "/", "root");
    expect(code(res)).toBe("n3_access_denied");
    expect(res.status).toBe(403);
    expect(sessionState.updates).toBe(0);
    expect(sessionState.data).toEqual({});
    expect(sessionState.cleared).toBeGreaterThan(0);
    expect(upsertCalls).toEqual([]);
    expect(gatewayPaths).toEqual(["/api/companyprofile/BasicInfo"]);

    const body = await res.text();
    expect(body).not.toContain("upstream-secret-detail");
    expect(body).not.toContain(VALID());

    const failures = auditEvents.filter((e) => e.eventType === "session.launch.failure");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.detail).toEqual({ source: "root", stage: "basicinfo", status: 403 });
  });

  it("BasicInfo 5xx and transport failure -> n3_unavailable / launch_failed, never n3_access_denied", async () => {
    gatewayQueue.push({ status: 500, body: {} });
    const five = await performN3Launch(VALID(), "/", "root");
    expect(code(five)).toBe("n3_unavailable");

    gatewayQueue.push({ throws: "network down" });
    const net = await performN3Launch(VALID(), "/", "root");
    expect(code(net)).toBe("launch_failed");
    expect(code(net)).not.toBe("n3_access_denied");
    expect(sessionState.updates).toBe(0);
  });

  it("malformed BasicInfo envelope stays fail-closed as n3_unavailable", async () => {
    gatewayQueue.push({ status: 200, body: { code: "9999", data: null } });
    const res = await performN3Launch(VALID(), "/", "root");
    expect(code(res)).toBe("n3_unavailable");
    expect(sessionState.updates).toBe(0);
  });

  it("BasicInfo success opens a session and reaches identity upsert", async () => {
    gatewayQueue.push(BASIC_INFO_OK);
    const res = await performN3Launch(VALID(), "/dashboard", "root");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard");
    expect(sessionState.updates).toBe(1);
    expect(upsertCalls).toContain("upsertTenant");
    expect(auditEvents.some((e) => e.eventType === "session.launch.success")).toBe(true);
  });
});
