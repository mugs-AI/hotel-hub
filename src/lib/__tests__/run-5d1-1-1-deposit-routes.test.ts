/**
 * Run 5D1.1.1 — deposit route behaviour for create-time N3 401, 403 and
 * sanitized denial auditing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

const destroyed: string[] = [];
let decisionOk = true;
vi.mock("@/lib/session-context.server", () => ({
  requirePermission: async () => ({
    ctx: {
      authenticated: true,
      session: {
        tenantId: "22222222-2222-4222-8222-222222222222",
        n3TenantKey: "tenant-key-1",
        n3UserKey: "user-1",
        n3Token: "tok",
      },
      role: "owner",
      roleStatus: "assigned",
    },
    decision: decisionOk ? { ok: true } : { ok: false, reason: "forbidden" },
  }),
  destroySession: async (reason: string) => {
    destroyed.push(reason);
  },
}));

let createBehaviour: () => never | Promise<unknown> = async () => ({ deposit: {} });
vi.mock("@/lib/deposits-store.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/deposits-store.server")>(
    "@/lib/deposits-store.server",
  );
  return {
    ...actual,
    isDepositWriteEnabled: () => true,
    createDeposit: async () => createBehaviour(),
    toDepositDTO: (d: unknown) => d,
  };
});

const { handleDepositCreate } = await import("@/routes/api/hotel/reservations.$id.deposits");
const { DepositError } = await import("@/lib/deposits-store.server");

const RES = "11111111-1111-4111-8111-111111111111";

function req() {
  return new Request("https://app.test/api/hotel/reservations/x/deposits", {
    method: "POST",
    headers: { origin: "https://app.test", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ amount: 100, clientRequestId: crypto.randomUUID() }),
  });
}

beforeEach(() => {
  auditEvents.length = 0;
  destroyed.length = 0;
  decisionOk = true;
});

describe("5D1.1.1 deposit create route", () => {
  it("destroys the session and returns sanitized 401 on a create-time N3 401", async () => {
    createBehaviour = () => {
      throw new DepositError("unauthorized");
    };
    const res = await handleDepositCreate({ request: req(), params: { id: RES } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(destroyed).toContain("n3_401");
    expect(auditEvents.some((e) => e.eventType === "session.n3_401")).toBe(true);
  });

  it("never returns 200 for a create-time N3 401", async () => {
    createBehaviour = () => {
      throw new DepositError("unauthorized");
    };
    const res = await handleDepositCreate({ request: req(), params: { id: RES } });
    expect(res.status).not.toBe(200);
  });

  it("does not destroy the session for a forbidden/unavailable N3 outcome", async () => {
    createBehaviour = () => {
      throw new DepositError("n3_preflight_unavailable");
    };
    const res = await handleDepositCreate({ request: req(), params: { id: RES } });
    expect(res.status).toBe(502);
    expect(destroyed).toHaveLength(0);
  });

  it("audits sanitized authorization denials", async () => {
    decisionOk = false;
    const res = await handleDepositCreate({ request: req(), params: { id: RES } });
    expect(res.status).toBe(403);
    const denial = auditEvents.find((e) => e.eventType === "hotel.deposit.denied");
    const detail = denial?.detail;
    expect(
      typeof detail === "object" && detail !== null && "reason" in detail
        ? (detail as { reason?: unknown }).reason
        : undefined,
    ).toBe("forbidden");
    expect(JSON.stringify(denial)).not.toContain("tok");
  });
});
