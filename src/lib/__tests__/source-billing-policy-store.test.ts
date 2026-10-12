import { describe, expect, it, vi } from "vitest";
import {
  createSourcePolicyStore,
  type SourcePolicyRpc,
} from "../source-billing-policy-store.server";
import type { SettlementActor } from "../settlement-context.server";
import type { SourceBillingPolicy } from "../source-billing";
const actor: SettlementActor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "owner",
  n3UserKey: "owner",
  n3Token: "SECRET_SERVER_TOKEN",
};
const sourceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const policy: SourceBillingPolicy = {
  sourceId,
  version: "1",
  defaultCollectionMode: "source",
  allowedCollectionModes: ["guest", "source"],
  sourceCustomerId: 8,
  guestCustomerId: 7,
  guestDocumentTitle: "Synthetic source",
  guestItemDescription: "Accommodation",
  showRoomPrices: false,
};
function setup() {
  const rpc = vi.fn<SourcePolicyRpc>(async (name: string, args: Record<string, unknown>) => {
    if (name === "hh_source_billing_policy_get")
      return { data: { tenantId: actor.tenantId, active: true, policy }, error: null };
    if (name === "hh_source_billing_reservation_get")
      return {
        data: {
          tenantId: actor.tenantId,
          reservationId: actor.reservationId,
          sourceId,
          revision: "0",
          updatedAt: "2026-10-12T00:00:00.000Z",
          frozen: false,
          payer: null,
        },
        error: null,
      };
    if (name === "hh_source_billing_policy_put")
      return { data: { ...policy, version: "2" }, error: null };
    if (name === "hh_source_billing_payer_confirm")
      return {
        data: {
          tenantId: actor.tenantId,
          reservationId: actor.reservationId,
          sourceId,
          revision: "1",
          updatedAt: "2026-10-12T00:00:01.000Z",
          payer: {
            policy,
            collectionMode: args.p_mode,
            confirmedBy: actor.n3UserKey,
            confirmedAt: "2026-10-12T00:00:01.000Z",
          },
        },
        error: null,
      };
    throw new Error("unknown RPC " + name);
  });
  const customer = vi.fn(async (_actor: SettlementActor, id: number) => ({
    kind: "confirmed" as const,
    value: { tenantId: actor.tenantId, customerId: id, active: true },
  }));
  return { rpc, customer, store: createSourcePolicyStore(rpc, customer) };
}
describe("trusted source policy persistence adapter", () => {
  it("verifies both exact current customers before Owner save and serializes no token", async () => {
    const f = setup();
    expect(await f.store.update(actor, { sourceId, expectedVersion: "1", policy })).toEqual({
      kind: "confirmed",
      value: { ...policy, version: "2" },
    });
    expect(f.customer.mock.calls.map((c) => c[1])).toEqual([7, 8]);
    const writes = f.rpc.mock.calls.filter((c) => c[0] === "hh_source_billing_policy_put");
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toMatchObject({
      p_tenant: actor.tenantId,
      p_source: sourceId,
      p_actor: "owner",
      p_role: "owner",
      p_expected_version: "1",
    });
    expect(JSON.stringify(writes)).not.toContain(actor.n3Token);
  });
  it("returns durable SQL-stamped payer rather than prepared in-memory time", async () => {
    const f = setup();
    const result = await f.store.confirm(actor, "guest", "0");
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") return;
    expect(result.value.payer.confirmedAt).toBe("2026-10-12T00:00:01.000Z");
    expect(result.value.revision).toBe("1");
    const write = f.rpc.mock.calls.find((c) => c[0] === "hh_source_billing_payer_confirm")!;
    expect(write[1]).toMatchObject({
      p_reservation: actor.reservationId,
      p_source: sourceId,
      p_expected_revision: "0",
      p_policy_version: "1",
      p_reservation_updated_at: "2026-10-12T00:00:00.000Z",
    });
    expect(Object.keys(write[1])).not.toContain("confirmedAt");
    expect(JSON.stringify(write)).not.toContain(actor.n3Token);
  });
  it("Front Desk cannot change source policy", async () => {
    const f = setup();
    expect(
      await f.store.update(
        { ...actor, role: "front_desk" },
        { sourceId, expectedVersion: "1", policy },
      ),
    ).toEqual({ kind: "contradiction", code: "source_billing_forbidden" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("default master registry blocks update and confirm without any write", async () => {
    const f = setup(),
      store = createSourcePolicyStore(f.rpc);
    expect(await store.update(actor, { sourceId, expectedVersion: "1", policy })).toEqual({
      kind: "unavailable",
      code: "n3_source_customer_master_contract_unverified",
    });
    expect(await store.confirm(actor, "guest", "0")).toEqual({
      kind: "unavailable",
      code: "n3_source_customer_master_contract_unverified",
    });
    expect(f.rpc.mock.calls.filter((c) => /put|confirm/.test(c[0]))).toHaveLength(0);
  });
  it("wrong-current-customer evidence refuses before persistence", async () => {
    const f = setup();
    const store = createSourcePolicyStore(f.rpc, async (_a, id) => ({
      kind: "confirmed",
      value: { tenantId: "other", customerId: id, active: true },
    }));
    expect((await store.update(actor, { sourceId, expectedVersion: "1", policy })).kind).toBe(
      "contradiction",
    );
    expect(f.rpc.mock.calls.filter((c) => /put|confirm/.test(c[0]))).toHaveLength(0);
  });
  it("missing schema gives setup-required and never uses a legacy settings writer", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "PGRST202", message: "function absent" },
    }));
    const store = createSourcePolicyStore(rpc);
    expect(await store.confirm(actor, "guest", "0")).toEqual({
      kind: "unavailable",
      code: "source_billing_setup_required",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("safe SQL conflicts are preserved without retrying save", async () => {
    const f = setup();
    const base = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name, args) =>
      name === "hh_source_billing_payer_confirm"
        ? { data: null, error: { message: "source_payer_revision_conflict" } }
        : base(name, args),
    );
    expect(await f.store.confirm(actor, "guest", "0")).toEqual({
      kind: "contradiction",
      code: "source_payer_revision_conflict",
    });
    expect(f.rpc.mock.calls.filter((c) => c[0].endsWith("confirm"))).toHaveLength(1);
  });
  it("saved result cannot impersonate another tenant or actor", async () => {
    const f = setup();
    const base = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name, args) => {
      const result = await base(name, args);
      if (name === "hh_source_billing_payer_confirm")
        return {
          ...result,
          data: { ...(result.data as Record<string, unknown>), tenantId: "other" },
        };
      return result;
    });
    expect(await f.store.confirm(actor, "guest", "0")).toEqual({
      kind: "unavailable",
      code: "source_billing_save_unverified",
    });
  });
  it("expected version mismatch is rejected before reading or saving", async () => {
    const f = setup();
    expect((await f.store.update(actor, { sourceId, expectedVersion: "2", policy })).kind).toBe(
      "contradiction",
    );
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
