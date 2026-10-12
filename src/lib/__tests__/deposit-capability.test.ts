import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "owner", enabled: true }));
vi.mock("@/lib/deposit-module-policy.server", () => ({
  readDepositModulePolicy: async () => ({
    policy: { roomAdvanceEnabled: state.enabled, securityDepositEnabled: false, version: "0" },
    available: true,
    securityReady: false,
  }),
}));
vi.mock("@/lib/session-context.server", () => ({
  requirePermission: async () => ({
    ctx: { role: state.role, session: { tenantId: "fixture", n3TenantKey: "sandbox" } },
    decision: { ok: true },
  }),
}));
vi.mock("@/lib/tenant-store.server", () => ({ resolveActorLabels: async () => new Map() }));
vi.mock("@/lib/hotel-store.server", () => ({
  getHotelSettingsReadOnly: async () => ({ currency: "MYR", paymentAccountAliases: {} }),
}));
vi.mock("@/lib/deposits-store.server", async (original) => ({
  ...(await original<object>()),
  listDeposits: async () => [],
}));
const { handleDepositsList } = await import("@/routes/api/hotel/reservations.$id.deposits");
afterEach(() => {
  vi.unstubAllEnvs();
  state.role = "owner";
  state.enabled = true;
});
async function capability() {
  vi.stubEnv("HOTELHUB_N3_DEPOSIT_WRITES_ENABLED", "true");
  vi.stubEnv("HOTELHUB_N3_DEPOSIT_WRITE_TENANT_ALLOWLIST", "sandbox");
  const result = await handleDepositsList({
    params: { id: "11111111-1111-4111-8111-111111111111" },
  });
  return (await result.json()).capability;
}
describe("deposit controls reflect server authority", () => {
  it("a disabled advance module hides creation even when N3 writes are allowed", async () => {
    state.enabled = false;
    expect(await capability()).toEqual({ canCreate: false, canSplit: false });
  });
  it("exposes single-account capability without offering an unverified split", async () => {
    vi.stubEnv("HOTELHUB_N3_MULTI_PAYMENT_WRITES_ENABLED", "false");
    expect(await capability()).toEqual({ canCreate: true, canSplit: false });
  });
  it("exposes split only when its separate existing gate is enabled", async () => {
    vi.stubEnv("HOTELHUB_N3_MULTI_PAYMENT_WRITES_ENABLED", "true");
    expect(await capability()).toEqual({ canCreate: true, canSplit: true });
  });
  it("never advertises a financial write to Front Desk", async () => {
    state.role = "front_desk";
    vi.stubEnv("HOTELHUB_N3_MULTI_PAYMENT_WRITES_ENABLED", "true");
    expect(await capability()).toEqual({ canCreate: false, canSplit: false });
  });
});
