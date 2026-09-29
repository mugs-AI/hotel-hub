import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: true, called: 0, tenant: "tenant-A" }));
vi.mock("@/lib/session-context.server", () => ({
  requirePermission: async () => ({
    ctx: { session: { tenantId: state.tenant, n3Token: "secret-token" } },
    decision: state.allowed ? { ok: true } : { ok: false, reason: "forbidden" },
  }),
}));
vi.mock("@/lib/deposit-receipt.server", () => ({
  DepositReceiptError: class extends Error {
    code: string;
    status: number;
    constructor(code: string, status: number) {
      super(code);
      this.code = code;
      this.status = status;
    }
  },
  loadPrintableDepositReceipt: async (input: {
    tenantId: string;
    reservationId: string;
    depositId: string;
    n3Token: string;
  }) => {
    state.called++;
    expect(input).toEqual({
      tenantId: state.tenant,
      reservationId: RES,
      depositId: DEP,
      n3Token: "secret-token",
    });
    return { n3DocCode: "OR-100", amount: 250 };
  },
}));

const RES = "11111111-1111-4111-8111-111111111111";
const DEP = "22222222-2222-4222-8222-222222222222";
const { handleDepositReceipt } =
  await import("@/routes/api/hotel/reservations.$id.deposits.$depositId.receipt");

beforeEach(() => {
  state.allowed = true;
  state.called = 0;
});

describe("deposit receipt GET boundary", () => {
  it("passes only session tenant and token to the verified loader", async () => {
    const response = await handleDepositReceipt({ params: { id: RES, depositId: DEP } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ receipt: { n3DocCode: "OR-100", amount: 250 } });
    expect(state.called).toBe(1);
  });

  it("blocks forbidden role and malformed ids before any N3 read", async () => {
    state.allowed = false;
    expect((await handleDepositReceipt({ params: { id: RES, depositId: DEP } })).status).toBe(403);
    state.allowed = true;
    expect((await handleDepositReceipt({ params: { id: RES, depositId: "bad" } })).status).toBe(
      400,
    );
    expect(state.called).toBe(0);
  });
});
