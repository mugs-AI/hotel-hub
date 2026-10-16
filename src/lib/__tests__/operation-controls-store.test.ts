import { describe, expect, it, vi } from "vitest";
import { createOperationControlsStore } from "../operation-controls.server";
const actor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  n3UserKey: "fixture-owner",
  role: "owner" as const,
};
const state = {
  tenantId: actor.tenantId,
  rateChangeEnabled: false,
  revision: "9007199254740993",
  available: true,
};
describe("reservation operation controls", () => {
  it("reads exact tenant policy and preserves a lossless revision", async () => {
    const rpc = vi.fn(async () => ({ data: state, error: null }));
    expect(await createOperationControlsStore(rpc).read(actor)).toEqual(state);
  });
  it("cannot turn a wrong tenant, malformed boolean or numeric revision into a policy", async () => {
    for (const data of [
      { ...state, tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { ...state, rateChangeEnabled: "false" },
      { ...state, revision: 1 },
    ]) {
      await expect(
        createOperationControlsStore(async () => ({ data, error: null })).read(actor),
      ).rejects.toMatchObject({ code: "operation_controls_unavailable" });
    }
  });
  it("only a named missing installation uses the compatible ON default", async () => {
    const missing = createOperationControlsStore(async () => ({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find function public.hh_operation_controls_read",
      },
    }));
    expect(await missing.read(actor)).toMatchObject({
      rateChangeEnabled: true,
      available: false,
      revision: null,
    });
    for (const error of [{ code: "503" }, { code: "PGRST202", message: "another missing RPC" }])
      await expect(
        createOperationControlsStore(async () => ({ data: null, error })).read(actor),
      ).rejects.toMatchObject({ code: "operation_controls_unavailable" });
  });
  it("saves only for Owner with exact version and returns the persisted result", async () => {
    const rpc = vi.fn(async () => ({
      data: { ...state, revision: "9007199254740994" },
      error: null,
    }));
    const store = createOperationControlsStore(rpc);
    await expect(
      store.update(
        { ...actor, role: "front_desk" },
        { rateChangeEnabled: false, expectedRevision: state.revision },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
    expect(
      (await store.update(actor, { rateChangeEnabled: false, expectedRevision: state.revision }))
        .revision,
    ).toBe("9007199254740994");
    expect(rpc).toHaveBeenCalledWith("hh_operation_controls_update", {
      p_tenant_id: actor.tenantId,
      p_actor_n3_user_key: actor.n3UserKey,
      p_expected_revision: state.revision,
      p_rate_change_enabled: false,
    });
  });
  it("rejects invalid patches before mutation and preserves a stale conflict", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "operation_controls_stale" } }));
    const store = createOperationControlsStore(rpc);
    for (const expectedRevision of ["-1", "01", "", "99999999999999999999999"])
      await expect(
        store.update(actor, { rateChangeEnabled: false, expectedRevision }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    expect(rpc).not.toHaveBeenCalled();
    await expect(
      store.update(actor, { rateChangeEnabled: false, expectedRevision: "1" }),
    ).rejects.toMatchObject({ code: "operation_controls_stale" });
  });
});
