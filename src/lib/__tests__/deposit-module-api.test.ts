import { beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ permission: vi.fn(), read: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/session-context.server", () => ({
  requirePermission: io.permission,
  destroySession: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: io.read }) }) }),
    rpc: io.rpc,
  },
}));
import {
  handleDepositModulesGet,
  handleDepositModulesPatch,
} from "@/routes/api/hotel/deposit-modules";
const tenantId = "22222222-2222-4222-8222-222222222222";
const body = { roomAdvanceEnabled: false, securityDepositEnabled: false, version: "0" };
const patch = (
  payload: unknown = body,
  origin = "https://hotel.test",
  identity = `${tenantId}:owner:owner`,
) =>
  handleDepositModulesPatch({
    request: new Request("https://hotel.test/api/hotel/deposit-modules", {
      method: "PATCH",
      headers: { origin, "x-hotelhub-expected-identity": identity },
      body: JSON.stringify(payload),
    }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  io.permission.mockResolvedValue({
    decision: { ok: true },
    ctx: { role: "owner", session: { tenantId, n3UserKey: "owner" } },
  });
  io.read.mockResolvedValue({ data: null, error: null });
  io.rpc.mockResolvedValue({
    data: {
      room_advance_enabled: false,
      security_deposit_enabled: false,
      security_module_ready: false,
      version: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    error: null,
  });
});
it("a version-0 draft from a different property cannot save into the current session", async () => {
  const response = await patch(body, "https://hotel.test", "A:owner:owner");
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "deposit_module_identity_changed" });
  expect(io.rpc).not.toHaveBeenCalled();
});
it("reads unavailable installation without claiming the switch is live", async () => {
  io.read.mockResolvedValue({ data: null, error: { code: "42P01" } });
  const response = await handleDepositModulesGet();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ available: false, securityReady: false });
  expect(io.rpc).not.toHaveBeenCalled();
});
it("saves independent booleans with server tenant and actor", async () => {
  const response = await patch();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    policy: { roomAdvanceEnabled: false, securityDepositEnabled: false },
  });
  expect(io.rpc).toHaveBeenCalledWith("hh_update_deposit_module_policy", {
    p_tenant: tenantId,
    p_actor: "owner",
    p_expected_version: "0",
    p_advance: false,
    p_security: false,
  });
});
it.each(["front_desk", "housekeeper"])(
  "denies %s even if permission context is inconsistent",
  async (role) => {
    io.permission.mockResolvedValue({
      decision: { ok: true },
      ctx: { role, session: { tenantId, n3UserKey: "staff" } },
    });
    expect((await patch()).status).toBe(403);
    expect((await handleDepositModulesGet()).status).toBe(403);
    expect(io.rpc).not.toHaveBeenCalled();
  },
);
it("rejects cross-site before permission or persistence", async () => {
  expect((await patch(body, "https://other.test")).status).toBe(403);
  expect(io.permission).not.toHaveBeenCalled();
});
it.each([
  {},
  { ...body, tenantId: "fake" },
  { ...body, roomAdvanceEnabled: 0 },
  { ...body, refundEnabled: true },
])("rejects %j without saving", async (payload) => {
  expect((await patch(payload)).status).toBe(400);
  expect(io.rpc).not.toHaveBeenCalled();
});
it.each(["deposit_module_policy_conflict", "security_deposit_unavailable"])(
  "returns %s with actionable conflict status",
  async (code) => {
    io.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: code } });
    const response = await patch();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: code });
  },
);
it("does not disclose upstream errors", async () => {
  io.read.mockResolvedValue({ data: null, error: { message: "private connection secret" } });
  const response = await handleDepositModulesGet();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "deposit_module_policy_unavailable" });
});
