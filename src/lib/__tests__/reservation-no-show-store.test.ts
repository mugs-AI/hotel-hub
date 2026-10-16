import { describe, expect, it, vi } from "vitest";
import { createNoShowStore } from "../reservation-no-show.server";
const actor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  n3UserKey: "fixture-staff",
  role: "front_desk" as const,
};
const input = {
  reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  clientRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  expectedUpdatedAt: "2026-10-13T00:00:00.123456Z",
  reason: "Guest did not arrive",
};
const outcome = {
  reservationId: input.reservationId,
  status: "no_show",
  updatedAt: "2026-10-14T01:00:00Z",
  releasedRoomIds: ["11111111-1111-4111-8111-111111111111"],
  accountingReviewRequired: true,
};
describe("no-show server authority", () => {
  it("uses trusted scope and preserves the exact revision", async () => {
    const rpc = vi.fn(async () => ({ data: outcome, error: null }));
    expect(await createNoShowStore(rpc).mark(actor, input)).toEqual(outcome);
    expect(rpc).toHaveBeenCalledWith("hh_mark_reservation_no_show", {
      p_tenant_id: actor.tenantId,
      p_reservation_id: input.reservationId,
      p_actor_n3_user_key: actor.n3UserKey,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_client_request_id: input.clientRequestId,
      p_reason: input.reason,
    });
  });
  it.each(["housekeeper", null])("refuses %s before database work", async (role) => {
    const rpc = vi.fn();
    await expect(
      createNoShowStore(rpc).mark({ ...actor, role: role as null }, input),
    ).rejects.toThrow("forbidden");
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...outcome, reservationId: "alien" },
    { ...outcome, status: "checked_in" },
    { ...outcome, releasedRoomIds: ["alien"] },
    { ...outcome, updatedAt: null },
    { ...outcome, accountingReviewRequired: null },
  ])(
    "does not return malformed or foreign outcomes",
    async (data) =>
      await expect(
        createNoShowStore(async () => ({ data, error: null })).mark(actor, input),
      ).rejects.toThrow("no_show_unavailable"),
  );
  it("returns safe known conflicts but hides raw database details", async () => {
    await expect(
      createNoShowStore(async () => ({
        data: null,
        error: { message: "reservation_changed" },
      })).mark(actor, input),
    ).rejects.toThrow("reservation_changed");
    await expect(
      createNoShowStore(async () => ({
        data: null,
        error: { message: "private database detail" },
      })).mark(actor, input),
    ).rejects.toThrow("no_show_unavailable");
  });
});
