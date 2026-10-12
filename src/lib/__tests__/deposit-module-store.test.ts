import { beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), tenant: "" }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: (key: string, tenant: string) => {
          if (key !== "tenant_id") throw new Error("unscoped read");
          io.tenant = tenant;
          return { maybeSingle: io.read };
        },
      }),
    }),
    rpc: io.save,
  },
}));
import {
  readDepositModulePolicy,
  updateDepositModulePolicy,
  assertRoomAdvanceCollectionEnabled,
} from "../deposit-module-policy.server";
const tenantId = "22222222-2222-4222-8222-222222222222";
const version = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => {
  vi.clearAllMocks();
  io.read.mockResolvedValue({ data: null, error: null });
});
it("defaults only an absent row/table and always scopes the read", async () => {
  expect(await readDepositModulePolicy(tenantId)).toMatchObject({
    available: true,
    policy: { roomAdvanceEnabled: true, securityDepositEnabled: false, version: "0" },
  });
  expect(io.tenant).toBe(tenantId);
  io.read.mockResolvedValue({ data: null, error: { code: "PGRST205" } });
  expect(await readDepositModulePolicy(tenantId)).toMatchObject({
    available: false,
    securityReady: false,
    policy: { roomAdvanceEnabled: true },
  });
});
it.each([{ code: "42501" }, { code: "network_error" }, { code: "PGRST204" }])(
  "does not turn %j into an enabled policy",
  async (error) => {
    io.read.mockResolvedValue({ data: null, error });
    await expect(assertRoomAdvanceCollectionEnabled(tenantId)).rejects.toThrow(
      "deposit_module_policy_unavailable",
    );
  },
);
it("rejects corrupt rows instead of defaulting enabled", async () => {
  io.read.mockResolvedValue({
    data: { room_advance_enabled: "true", security_deposit_enabled: false, version },
    error: null,
  });
  await expect(readDepositModulePolicy(tenantId)).rejects.toThrow(
    "deposit_module_policy_unavailable",
  );
});
it("disabled_module_direct_collect_denied", async () => {
  io.read.mockResolvedValue({
    data: {
      room_advance_enabled: false,
      security_deposit_enabled: false,
      security_module_ready: false,
      version,
    },
    error: null,
  });
  await expect(assertRoomAdvanceCollectionEnabled(tenantId)).rejects.toThrow(
    "room_advance_disabled",
  );
});
it("denies non-Owner before storage", async () => {
  await expect(
    updateDepositModulePolicy(
      { tenantId, userKey: "staff", role: "front_desk" },
      { roomAdvanceEnabled: false, securityDepositEnabled: false, version: "0" },
    ),
  ).rejects.toThrow("forbidden");
  expect(io.save).not.toHaveBeenCalled();
});
it("saves server actor and expected version through CAS", async () => {
  io.save.mockResolvedValue({
    data: {
      room_advance_enabled: false,
      security_deposit_enabled: false,
      security_module_ready: false,
      version,
    },
    error: null,
  });
  expect(
    await updateDepositModulePolicy(
      { tenantId, userKey: "owner", role: "owner" },
      { roomAdvanceEnabled: false, securityDepositEnabled: false, version: "0" },
    ),
  ).toMatchObject({ available: true, policy: { version, roomAdvanceEnabled: false } });
  expect(io.save).toHaveBeenCalledWith("hh_update_deposit_module_policy", {
    p_tenant: tenantId,
    p_actor: "owner",
    p_expected_version: "0",
    p_advance: false,
    p_security: false,
  });
});
it.each(["deposit_module_policy_conflict", "security_deposit_unavailable"])(
  "preserves %s without exposing raw database errors",
  async (code) => {
    io.save.mockResolvedValue({
      data: null,
      error: { message: code, code: "P0001", details: "private" },
    });
    await expect(
      updateDepositModulePolicy(
        { tenantId, userKey: "owner", role: "owner" },
        { roomAdvanceEnabled: true, securityDepositEnabled: false, version: "0" },
      ),
    ).rejects.toThrow(code);
  },
);
it("recognizes an installed security workflow for a tenant with no policy row", async () => {
  io.read.mockResolvedValue({ data: null, error: null });
  io.save.mockResolvedValue({ data: true, error: null });
  expect((await readDepositModulePolicy(tenantId)).securityReady).toBe(true);
});
it("advance authorization does not depend on the separate security installation RPC", async () => {
  io.read.mockResolvedValue({ data: null, error: null });
  io.save.mockImplementation(() => {
    throw new Error("security installation RPC unavailable");
  });
  await expect(assertRoomAdvanceCollectionEnabled(tenantId)).resolves.toBeUndefined();
  expect(io.save).not.toHaveBeenCalled();
});
