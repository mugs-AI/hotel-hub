import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: state }));
vi.mock("../reservations-store.server", async (original) => ({
  ...(await original<typeof import("../reservations-store.server")>()),
  getReservationById: async () => ({ status: "checked_in" }),
}));
import { readChangePolicy } from "../hotel-change-controls-store.server";
import { readBillTo } from "../folio-bill-to-controls.server";
const actor = { tenantId: "t", n3UserKey: "u", n3Token: "fixture", role: "owner" as const };
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
interface TestQuery {
  select(): TestQuery;
  eq(): TestQuery;
  in(): TestQuery;
  maybeSingle(): Promise<{ data: null; error: null }>;
}
const billTo = { name: "Guest", company: "", address: "", phone: "", email: "" };
beforeEach(() => {
  vi.clearAllMocks();
  state.from.mockImplementation(() => {
    const chain: TestQuery = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return chain;
  });
});
it("policy reader keeps decimal revisions above Number precision intact", async () => {
  state.rpc.mockResolvedValue({
    data: {
      revision: "9007199254740993",
      depositApprovalRequired: true,
      contactApprovalRequired: false,
    },
    error: null,
  });
  expect((await readChangePolicy("t"))?.revision).toBe("9007199254740993");
});
it("bill-to reader uses the lossless effective revision instead of a numeric table read", async () => {
  state.rpc.mockResolvedValue({
    data: { billTo, effectiveRevision: "9007199254740993" },
    error: null,
  });
  expect(await readBillTo(actor, id)).toMatchObject({
    billTo,
    effectiveRevision: "9007199254740993",
  });
});
it("numeric or malformed policy revision is unavailable", async () => {
  for (const revision of [9007199254740992, null, "01", "unknown"]) {
    state.rpc.mockResolvedValue({
      data: { revision, depositApprovalRequired: true, contactApprovalRequired: false },
      error: null,
    });
    await expect(readChangePolicy("t")).rejects.toMatchObject({
      code: "change_controls_unavailable",
    });
  }
});
