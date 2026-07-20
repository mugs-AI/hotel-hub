/**
 * Milestone 1.0.1 Correction C.1 — Launch Recovery regression tests.
 * Locks in the specific defects from the C.1 brief.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------- shared mocks ----------------
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

type FetchResponse = { status: number; body: unknown };
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
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ================ Task 1 — normalizeEmail safety ================
describe("normalizeEmail (unknown-safe)", () => {
  it("collapses an array of two identical emails to one value", async () => {
    const { normalizeEmail } = await import("@/lib/n3-basicinfo");
    expect(normalizeEmail(["LKS.MUGS@GMAIL.COM", "LKS.MUGS@GMAIL.COM"])).toBe(
      "LKS.MUGS@GMAIL.COM",
    );
  });

  it("returns first valid email skipping empty/invalid entries", async () => {
    const { normalizeEmail } = await import("@/lib/n3-basicinfo");
    expect(normalizeEmail(["", " ", "nope", "ok@example.test"])).toBe("ok@example.test");
  });

  it("returns null and never throws for object/number/boolean/null/undefined", async () => {
    const { normalizeEmail } = await import("@/lib/n3-basicinfo");
    const shapes: unknown[] = [null, undefined, 42, true, false, {}, { email: "x@y.z" }, []];
    for (const s of shapes) {
      let threw = false;
      let out: string | null = "unset" as unknown as string;
      try {
        out = normalizeEmail(s);
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
      expect(out).toBeNull();
    }
  });
});

describe("normalizeBasicInfo (array-valued fields)", () => {
  it("handles profile Email as an array without concatenation", async () => {
    const { normalizeBasicInfo } = await import("@/lib/n3-basicinfo");
    const r = normalizeBasicInfo({
      TenantId: "t-1",
      CompanyName: "Test",
      Email: ["LKS.MUGS@GMAIL.COM", "LKS.MUGS@GMAIL.COM"],
    });
    expect(r.userEmail).toBe("LKS.MUGS@GMAIL.COM");
  });

  it("handles JWT email claim as an array", async () => {
    const { normalizeBasicInfo } = await import("@/lib/n3-basicinfo");
    const r = normalizeBasicInfo(
      { TenantId: "t-1", CompanyName: "Test" },
      { email: ["", "jwt@example.test"] },
    );
    expect(r.userEmail).toBe("jwt@example.test");
  });

  it("never throws on completely malformed BasicInfo", async () => {
    const { normalizeBasicInfo } = await import("@/lib/n3-basicinfo");
    let r: unknown;
    expect(() => {
      r = normalizeBasicInfo(42, { sub: 7 } as unknown as Record<string, unknown>);
    }).not.toThrow();
    expect(r).toBeTruthy();
  });
});

// ================ Task 2 — start.ts regression ================
describe("start.ts N3-only identity", () => {
  const source = readFileSync(resolve(__dirname, "../../start.ts"), "utf8");
  it("does not import or register attachSupabaseAuth", () => {
    expect(source).not.toMatch(/attachSupabaseAuth/);
  });
  it("functionMiddleware is exactly []", () => {
    expect(source).toMatch(/functionMiddleware:\s*\[\s*\]/);
  });
});

// ================ Task 3 — token-free redirect on failure ================
describe("handleRootLaunchRequest (root token safety)", () => {
  const RAW_TOKEN =
    "eyJhbGciOiJIUzI1NiJ9.SUPER-SECRET-PAYLOAD-DO-NOT-LEAK.SIGNATURESIGNATURESIGNATURE";

  it("successful array-email launch: verifies, upserts, opens session, token-free redirect", async () => {
    fetchEnqueue({
      status: 200,
      body: {
        code: "0000",
        data: {
          TenantId: "n3-tenant-1",
          TenantCode: "T-001",
          CompanyName: "Test Hotel",
          Email: ["LKS.MUGS@GMAIL.COM", "LKS.MUGS@GMAIL.COM"],
          UserName: "LKS",
        },
      },
    });
    supabaseEnqueue("hotel_tenants", {
      data: {
        id: "tenant-uuid-1",
        n3_tenant_key: "n3-tenant-1",
        tenant_code: "T-001",
        company_name: "Test Hotel",
      },
      error: null,
    });
    const { handleRootLaunchRequest } = await import("@/lib/launch.server");
    const res = await handleRootLaunchRequest(
      new Request(`http://x.test/?token=${encodeURIComponent(RAW_TOKEN)}`),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(302);
    const loc = res!.headers.get("location") ?? "";
    expect(loc).toBe("/");
    expect(loc).not.toContain(RAW_TOKEN);
    const body = await res!.text();
    expect(body).toBe("");
    expect(body).not.toContain(RAW_TOKEN);
    expect(sessionState.updated).toHaveLength(1);
    const stored = sessionState.updated[0] as { userEmail: string };
    expect(stored.userEmail).toBe("LKS.MUGS@GMAIL.COM");
  });

  it("N3 rejects → 302 to /launch-error?code=n3_rejected, no token anywhere", async () => {
    fetchEnqueue({ status: 401, body: {} });
    const { handleRootLaunchRequest } = await import("@/lib/launch.server");
    const res = await handleRootLaunchRequest(
      new Request(`http://x.test/?token=${encodeURIComponent(RAW_TOKEN)}`),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(302);
    const loc = res!.headers.get("location") ?? "";
    expect(loc).toBe("/launch-error?code=n3_rejected");
    expect(loc).not.toContain(RAW_TOKEN);
    expect(res!.headers.get("cache-control")).toBe("no-store");
    const body = await res!.text();
    expect(body).toBe("");
    expect(body).not.toContain(RAW_TOKEN);
    expect(sessionState.cleared).toBeGreaterThanOrEqual(1);
  });

  it("performN3Launch never leaks the token in body or Location on any failure branch", async () => {
    fetchEnqueue({ status: 500, body: {} });
    const { performN3Launch } = await import("@/lib/launch.server");
    const res = await performN3Launch(RAW_TOKEN, "/");
    const text = await res.text();
    expect(text).not.toContain(RAW_TOKEN);
    expect(res.headers.get("location") ?? "").not.toContain(RAW_TOKEN);
    expect(res.headers.get("x-hotelhub-error-code")).toBe("n3_unavailable");
  });

  it("ignores non-root paths and requests without a token", async () => {
    const { handleRootLaunchRequest } = await import("@/lib/launch.server");
    expect(await handleRootLaunchRequest(new Request("http://x.test/dashboard?token=abc"))).toBeNull();
    expect(await handleRootLaunchRequest(new Request("http://x.test/"))).toBeNull();
    expect(await handleRootLaunchRequest(new Request("http://x.test/?token="))).toBeNull();
  });
});
