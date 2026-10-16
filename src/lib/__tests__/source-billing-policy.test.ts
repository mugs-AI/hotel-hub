import { describe, expect, it } from "vitest";
import {
  prepareReservationPayer,
  readSourceBillingPolicy,
  type SourcePolicyDeps,
} from "../source-billing-policy.server";
import type { SourceBillingPolicy } from "../source-billing";
import type { SettlementActor } from "../settlement-context.server";

const sourceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const actor: SettlementActor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "front_desk",
  n3UserKey: "server-user",
  n3Token: "DO-NOT-SERIALIZE",
};
const policy: SourceBillingPolicy = {
  sourceId,
  version: "2",
  defaultCollectionMode: "source",
  allowedCollectionModes: ["guest", "source"],
  sourceCustomerId: 8,
  guestCustomerId: 7,
  guestDocumentTitle: "Agoda Sales",
  guestItemDescription: "Accommodation",
  showRoomPrices: false,
};
function deps(): SourcePolicyDeps {
  return {
    readPolicy: async () => ({ tenantId: actor.tenantId, active: true, policy }),
    readCustomer: async (_actor, id) => ({
      kind: "confirmed",
      value: { tenantId: actor.tenantId, customerId: id, active: true },
    }),
    readReservation: async () => ({
      tenantId: actor.tenantId,
      reservationId: actor.reservationId,
      sourceId,
      revision: "3",
      frozen: false,
      payer: null,
    }),
    now: () => new Date("2026-10-11T16:00:00Z"),
  };
}
describe("source payer preparation (no persistence or financial dispatch)", () => {
  it("agoda_permits_configured_guest_collect", async () => {
    const result = await prepareReservationPayer(actor, sourceId, "guest", "3", deps());
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") return;
    expect(result.value.collectionMode).toBe("guest");
    expect(result.value.confirmedBy).toBe("server-user");
    expect(result.value.confirmedAt).toBe("2026-10-11T16:00:00.000Z");
    expect(JSON.stringify(result)).not.toContain(actor.n3Token);
  });
  it("fails closed without installed current master readers", async () => {
    expect(await readSourceBillingPolicy(actor, sourceId)).toEqual({
      kind: "unavailable",
      code: "source_billing_setup_required",
    });
    expect(await prepareReservationPayer(actor, sourceId, "guest", "3")).toEqual({
      kind: "unavailable",
      code: "source_billing_setup_required",
    });
  });
  it.each([false, true])("inactive_wrong_tenant_customer_rejected (%s)", async (wrongTenant) => {
    const d = deps();
    d.readCustomer = async (_a, id) => ({
      kind: "confirmed",
      value: {
        tenantId: wrongTenant ? "other" : actor.tenantId,
        customerId: id,
        active: wrongTenant,
      },
    });
    expect(await readSourceBillingPolicy(actor, sourceId, d)).toEqual({
      kind: "contradiction",
      code: "source_customer_evidence_mismatch",
    });
  });
  it("rejects unavailable master evidence unchanged", async () => {
    const d = deps();
    d.readCustomer = async () => ({ kind: "unavailable", code: "n3_master_unverified" });
    expect(await readSourceBillingPolicy(actor, sourceId, d)).toEqual({
      kind: "unavailable",
      code: "n3_master_unverified",
    });
  });
  it("settings_change_does_not_reassign_existing_stay", async () => {
    const d = deps(),
      result = await prepareReservationPayer(actor, sourceId, "guest", "3", d);
    if (result.kind !== "confirmed") throw new Error("expected preparation");
    expect(Object.isFrozen(result.value.policy.allowedCollectionModes)).toBe(true);
    expect(result.value.policy).not.toBe(policy);
    const before = JSON.stringify(result.value);
    d.readPolicy = async () => ({
      tenantId: actor.tenantId,
      active: true,
      policy: { ...policy, sourceCustomerId: 9, version: "4" },
    });
    await readSourceBillingPolicy(actor, sourceId, d);
    expect(JSON.stringify(result.value)).toBe(before);
  });
  it("frontdesk_cannot_change_frozen_payer", async () => {
    const d = deps();
    d.readReservation = async () => ({
      tenantId: actor.tenantId,
      reservationId: actor.reservationId,
      sourceId,
      revision: "3",
      frozen: true,
      payer: null,
    });
    expect(await prepareReservationPayer(actor, sourceId, "guest", "3", d)).toEqual({
      kind: "contradiction",
      code: "source_payer_frozen",
    });
  });
  it("rejects cross-booking facts and stale revisions", async () => {
    expect(await prepareReservationPayer(actor, sourceId, "guest", "2", deps())).toEqual({
      kind: "contradiction",
      code: "source_payer_revision_conflict",
    });
    const d = deps();
    d.readReservation = async () => ({
      tenantId: "other",
      reservationId: actor.reservationId,
      sourceId,
      revision: "3",
      frozen: false,
      payer: null,
    });
    expect(await prepareReservationPayer(actor, sourceId, "guest", "3", d)).toEqual({
      kind: "contradiction",
      code: "source_payer_scope_mismatch",
    });
  });
  it("cannot infer or expand modes from a source label", async () => {
    const d = deps();
    d.readPolicy = async () => ({
      tenantId: actor.tenantId,
      active: true,
      policy: {
        ...policy,
        defaultCollectionMode: "guest",
        allowedCollectionModes: ["guest"],
        sourceCustomerId: null,
        guestDocumentTitle: "Website",
      },
    });
    expect((await prepareReservationPayer(actor, sourceId, "guest", "3", d)).kind).toBe(
      "confirmed",
    );
    expect(await prepareReservationPayer(actor, sourceId, "source", "3", d)).toEqual({
      kind: "contradiction",
      code: "source_collection_mode_not_allowed",
    });
  });
  it.each(["housekeeper"] as const)("rejects role %s before reading", async (role) => {
    let reads = 0;
    const d = deps();
    d.readPolicy = async () => {
      reads++;
      return null;
    };
    expect((await readSourceBillingPolicy({ ...actor, role }, sourceId, d)).kind).toBe(
      "contradiction",
    );
    expect(reads).toBe(0);
  });
  it("denies malformed policy and duplicated modes", async () => {
    const d = deps();
    d.readPolicy = async () => ({
      tenantId: actor.tenantId,
      active: true,
      policy: { ...policy, allowedCollectionModes: ["guest", "guest"], guestCustomerId: 7.5 },
    });
    expect(await readSourceBillingPolicy(actor, sourceId, d)).toEqual({
      kind: "contradiction",
      code: "invalid_source_billing_policy",
    });
  });
});
