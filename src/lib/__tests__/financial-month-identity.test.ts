import { describe, expect, it } from "vitest";
import { resolveFinancialMonth, type MonthSelection } from "../month-nav";
import { handleFinancialRequest } from "../financial-reporting-http.server";

const A = "tA:u1:owner";
const B = "tB:u2:owner";

describe("resolveFinancialMonth (mounted-session sequences)", () => {
  it("identity switch drops the previous identity's historical selection", () => {
    const sel: MonthSelection = { identity: A, month: "2026-07" };
    expect(resolveFinancialMonth(A, sel, "2026-10")).toBe("2026-07");
    expect(resolveFinancialMonth(B, sel, "2026-10")).toBe("2026-10");
    expect(resolveFinancialMonth(A.replace("owner", "manager"), sel, "2026-10")).toBe("2026-10");
  });
  it("Nov tenant → Oct tenant cannot keep or select future November", () => {
    const sel: MonthSelection = { identity: A, month: "2026-11" };
    expect(resolveFinancialMonth(A, sel, "2026-11")).toBe("2026-11");
    expect(resolveFinancialMonth(B, sel, "2026-10")).toBe("2026-10");
    // Even a same-identity selection is clamped to the fresh maximum.
    expect(resolveFinancialMonth(B, { identity: B, month: "2026-11" }, "2026-10")).toBe("2026-10");
  });
  it("property month rollover advances default; history kept for same identity", () => {
    expect(resolveFinancialMonth(A, null, "2026-10")).toBe("2026-10");
    expect(resolveFinancialMonth(A, null, "2026-11")).toBe("2026-11");
    expect(resolveFinancialMonth(A, { identity: A, month: "2026-09" }, "2026-11")).toBe("2026-09");
  });
  it("fails closed without identity or fresh metadata", () => {
    expect(resolveFinancialMonth(null, { identity: A, month: "2026-09" }, "2026-10")).toBeUndefined();
    expect(resolveFinancialMonth(A, null, undefined)).toBeUndefined();
    expect(resolveFinancialMonth(A, null, "garbage")).toBeUndefined();
  });
});

describe("GET /api/hotel/financial-period", () => {
  const actor = { tenantId: "t1", userId: "u1", role: "owner" } as never;
  const deps = (settings: () => Promise<unknown>, role = "owner") => ({
    actor: async () => ({ ok: true as const, actor: { ...(actor as object), role } as never }),
    data: () =>
      ({
        settings,
        now: () => Date.parse("2026-10-31T16:30:00Z"),
        n3: () => {
          throw new Error("must not call N3");
        },
      }) as never,
  });
  const req = (q = "") => new Request(`http://x/api/hotel/financial-period${q}`);
  it("returns property-local month from settings only (no N3)", async () => {
    const r = await handleFinancialRequest(
      req(),
      "period",
      deps(async () => ({ timezone: "Asia/Kuala_Lumpur", currency: "MYR" })),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ month: "2026-11" });
  });
  it("Owner-only, rejects params, unauthenticated 401", async () => {
    const ok = async () => ({ timezone: "UTC", currency: "MYR" });
    expect((await handleFinancialRequest(req(), "period", deps(ok, "manager"))).status).toBe(403);
    expect((await handleFinancialRequest(req("?month=2026-01"), "period", deps(ok))).status).toBe(400);
    const r = await handleFinancialRequest(req(), "period", {
      actor: async () => ({ ok: false as const, reason: "unauthenticated" as const }),
      data: () => ({}) as never,
    });
    expect(r.status).toBe(401);
  });
});
