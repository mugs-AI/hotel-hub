import { describe, expect, it } from "vitest";
import { readInitialBookingPolicy } from "../initial-booking-payer.server";
import { actor, plan } from "./fixtures/source-billing";

describe("initial booking policy read", () => {
  const policy = plan().payer.policy;
  const row = { tenantId: actor.tenantId, sourceCode: "walk_in", required: true, policy };
  it("returns only scoped configuration, without saving a payer", async () => {
    const calls: string[] = [];
    const result = await readInitialBookingPolicy(
      { ...actor, reservationId: "" },
      "walk_in",
      async (name) => {
        calls.push(name);
        return { data: { ...row, token: "never returned" }, error: null };
      },
    );
    expect(result).toEqual(row);
    expect(calls).toEqual(["hh_source_billing_entry_get"]);
  });
  it("keeps legacy booking available only when the entry routine is absent", async () => {
    expect(
      await readInitialBookingPolicy(actor, "walk_in", async () => ({
        data: null,
        error: { code: "PGRST202", message: "Could not find public.hh_source_billing_entry_get" },
      })),
    ).toEqual({ tenantId: actor.tenantId, sourceCode: "walk_in", required: false, policy: null });
  });
  it.each(["42501", "XX000", "PGRST000"])(
    "does not treat %s as an uninstalled feature",
    async (code) => {
      await expect(
        readInitialBookingPolicy(actor, "walk_in", async () => ({ data: null, error: { code } })),
      ).rejects.toThrow("source_billing_setup_required");
    },
  );
  it("rejects another tenant's policy", async () => {
    await expect(
      readInitialBookingPolicy(actor, "walk_in", async () => ({
        data: { ...row, tenantId: "99999999-9999-4999-8999-999999999999" },
        error: null,
      })),
    ).rejects.toThrow("source_policy_scope_mismatch");
  });
  it("rejects an actor switch during the read", async () => {
    const a = { ...actor };
    await expect(
      readInitialBookingPolicy(a, "walk_in", async () => {
        a.n3UserKey = "different";
        return { data: row, error: null };
      }),
    ).rejects.toThrow("source_policy_scope_mismatch");
  });
  it("denies Housekeeping before any RPC", async () => {
    await expect(
      readInitialBookingPolicy({ ...actor, role: "housekeeper" }, "walk_in", async () => {
        throw Error("RPC must not run");
      }),
    ).rejects.toThrow("forbidden");
  });
});
