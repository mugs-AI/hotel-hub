import { beforeEach, expect, it, vi } from "vitest";
const stub = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>>,
  rpc: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => {
      let tenant = "";
      const builder = {
        select: () => builder,
        eq: (_key: string, value: string) => {
          tenant = value;
          return builder;
        },
        maybeSingle: async () => ({ data: stub.rows[tenant] ?? null, error: null }),
      };
      return builder;
    },
    rpc: stub.rpc,
  },
}));
const { getHotelSettingsReadOnly, setPaymentAccountPreferences } =
  await import("@/lib/hotel-store.server");
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => {
  stub.rows = {
    first: {
      tenant_id: "first",
      currency: "MYR",
      payment_account_aliases: { [ID.toUpperCase()]: "Legacy QR" },
      payment_account_visibility: { [ID.toUpperCase()]: false },
    },
    second: { tenant_id: "second", currency: "MYR", payment_account_aliases: {} },
  };
  stub.rpc.mockReset();
  stub.rpc.mockReturnValue({ single: async () => ({ data: stub.rows.first, error: null }) });
});
it("canonicalizes legacy UUID preferences and isolates tenant reads", async () => {
  const first = await getHotelSettingsReadOnly("first");
  expect(first?.paymentAccountAliases).toEqual({ [ID]: "Legacy QR" });
  expect(first?.paymentAccountVisibility).toEqual({ [ID]: false });
  expect((await getHotelSettingsReadOnly("second"))?.paymentAccountVisibility).toEqual({});
  expect((await getHotelSettingsReadOnly("second"))?.paymentAccountAliases).toEqual({});
});
it("prefers an existing canonical key when legacy casing duplicates exist", async () => {
  stub.rows.first.payment_account_aliases = { [ID]: "Current QR", [ID.toUpperCase()]: "Old QR" };
  expect((await getHotelSettingsReadOnly("first"))?.paymentAccountAliases).toEqual({
    [ID]: "Current QR",
  });
});
it("sends only the edited account's preference to the tenant-scoped atomic RPC", async () => {
  await setPaymentAccountPreferences("first", ID.toUpperCase(), { show: false });
  expect(stub.rpc).toHaveBeenCalledWith("hotelhub_set_payment_account_preferences", {
    p_tenant_id: "first",
    p_account_id: ID,
    p_label: null,
    p_show: false,
  });
});
