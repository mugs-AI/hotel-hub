import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "owner" as "owner" | "front_desk",
  authenticated: true,
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  rpc: vi.fn(),
}));
vi.mock("../session-context.server", () => ({
  requirePermission: async (permission: string) => ({
    ctx: { role: state.role, session: { tenantId: state.tenantId, n3UserKey: "fixture-user" } },
    decision: !state.authenticated
      ? { ok: false, reason: "unauthenticated" }
      : permission === "hotel:setup" && state.role !== "owner"
        ? { ok: false, reason: "forbidden" }
        : { ok: true },
  }),
}));
vi.mock("../operation-controls.server", async (load) => {
  const real = await load<typeof import("../operation-controls.server")>();
  return {
    ...real,
    liveOperationControlsStore: () => real.createOperationControlsStore(state.rpc),
  };
});
import {
  handleGetOperationControls,
  handlePatchOperationControls,
} from "../../routes/api/hotel/operation-controls";
function request(body: unknown, origin = "https://hh.example.test") {
  return new Request("https://hh.example.test/api/hotel/operation-controls", {
    method: "PATCH",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
describe("operation settings HTTP authority", () => {
  beforeEach(() => {
    state.role = "owner";
    state.authenticated = true;
    state.rpc.mockReset();
    state.rpc.mockImplementation(async (name) => ({
      data: {
        tenantId: state.tenantId,
        rateChangeEnabled: name === "hh_operation_controls_read",
        revision: name === "hh_operation_controls_read" ? "0" : "1",
        available: true,
      },
      error: null,
    }));
  });
  it("Front Desk reads policy but cannot update it", async () => {
    state.role = "front_desk";
    expect((await handleGetOperationControls()).status).toBe(200);
    state.rpc.mockClear();
    expect(
      (
        await handlePatchOperationControls({
          request: request({ rateChangeEnabled: false, expectedRevision: "0" }),
        })
      ).status,
    ).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("Owner update uses server tenant and actor, not supplied scope", async () => {
    const response = await handlePatchOperationControls({
      request: request({ rateChangeEnabled: false, expectedRevision: "0" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      controls: { rateChangeEnabled: false, revision: "1" },
    });
    expect(state.rpc).toHaveBeenCalledWith(
      "hh_operation_controls_update",
      expect.objectContaining({ p_tenant_id: state.tenantId, p_actor_n3_user_key: "fixture-user" }),
    );
  });
  it("rejects cross-origin, unknown scope and malformed booleans before mutation", async () => {
    expect(
      (
        await handlePatchOperationControls({
          request: request(
            { rateChangeEnabled: false, expectedRevision: "0" },
            "https://alien.example.test",
          ),
        })
      ).status,
    ).toBe(403);
    for (const body of [
      { rateChangeEnabled: "false", expectedRevision: "0" },
      { rateChangeEnabled: false, expectedRevision: "0", tenantId: "alien" },
    ])
      expect((await handlePatchOperationControls({ request: request(body) })).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("returns 401 without a read for an ended session", async () => {
    state.authenticated = false;
    expect((await handleGetOperationControls()).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
