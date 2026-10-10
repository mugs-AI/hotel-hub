import type { BillToSaveResult, FolioBillTo } from "../hotel-change-controls";
import { describe, expect, it, vi } from "vitest";
import { createBillToService, validateBillToInput } from "../folio-bill-to-controls.server";
const actor = {
  tenantId: "tenant-A",
  n3UserKey: "staff",
  n3Token: "server-only",
  role: "front_desk" as const,
};
const original = { name: "Original", company: "", address: "", phone: "", email: "" };
const input = {
  original,
  billTo: { ...original, name: " Proposed " },
  expectedRevision: "0",
  clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reason: "company details",
};
function setup(on: boolean) {
  const rpc = vi.fn(
    async (_actor: unknown, data: Record<string, unknown>): Promise<BillToSaveResult> => ({
      outcome: on ? "pending" : "applied",
      billTo: on ? original : (data.billTo as FolioBillTo),
      effectiveRevision: on ? "0" : "1",
      pending: null,
    }),
  );
  const service = createBillToService({
    read: async () => ({ billTo: original, effectiveRevision: "0", pending: null }),
    reservation: async () => ({ status: "checked_in" }),
    save: rpc,
    decide: vi.fn(),
  });
  return { service, rpc };
}
describe("local bill-to control service", () => {
  it("rejects a first-edit fallback changed after the form opened, even at revision zero", async () => {
    const save = vi.fn();
    const service = createBillToService({
      reservation: async () => ({ status: "checked_in" }),
      read: async () => ({
        billTo: { ...original, address: "New address B" },
        effectiveRevision: "0",
        pending: null,
      }),
      save,
      decide: vi.fn(),
    });
    await expect(
      service.save(actor, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", input),
    ).rejects.toThrow("bill_to_changed");
    expect(save).not.toHaveBeenCalled();
  });
  it("keeps effective values until approval; OFF applies authorized local edits without N3", async () => {
    const on = setup(true);
    expect(
      (await on.service.save(actor, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", input)).billTo,
    ).toEqual(original);
    const off = setup(false);
    expect(
      (await off.service.save(actor, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", input)).outcome,
    ).toBe("applied");
    expect(off.rpc.mock.calls[0]![1]).toMatchObject({ original, billTo: { name: "Proposed" } });
  });
  it("denies Housekeeper before DB, checked-out stage and stale effective revision", async () => {
    const { service, rpc } = setup(false);
    await expect(
      service.save(
        { ...actor, role: "housekeeper" },
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        input,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.save(actor, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
        ...input,
        expectedRevision: "1",
      }),
    ).rejects.toMatchObject({ code: "bill_to_changed" });
    expect(rpc).not.toHaveBeenCalled();
    const locked = createBillToService({
      read: async () => ({ billTo: original, effectiveRevision: "0", pending: null }),
      reservation: async () => ({ status: "checked_out" }),
      save: rpc,
      decide: vi.fn(),
    });
    await expect(
      locked.save(actor, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", input),
    ).rejects.toMatchObject({ code: "bill_to_locked" });
  });
  it("validates exact nested contract, UUID, UTF16 bounds, trim and email", () => {
    expect(validateBillToInput(input).billTo.name).toBe("Proposed");
    for (const bad of [
      { ...input, billTo: { ...original, email: "invalid" } },
      { ...input, billTo: { ...original, name: "😀".repeat(81) } },
      { ...input, clientRequestId: "x" },
      { ...input, expectedRevision: 0 },
      { ...input, tenantId: "alien" },
    ])
      expect(() => validateBillToInput(bad)).toThrow();
  });
});
