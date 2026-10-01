import { beforeEach, describe, expect, it, vi } from "vitest";
import type { N3Outcome } from "@/lib/n3-receipts.server";

const stubs = vi.hoisted(() => ({
  permission: vi.fn(),
  getNew: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  audit: vi.fn(),
  expire: vi.fn(),
}));
vi.mock("@/lib/session-context.server", () => ({ requirePermission: stubs.permission }));
vi.mock("@/lib/audit.server", () => ({ logAudit: stubs.audit }));
vi.mock("@/lib/hotel-store.server", () => ({
  getHotelSettingsReadOnly: stubs.read,
  setPaymentAccountPreferences: stubs.save,
}));
vi.mock("@/lib/n3-receipts.server", async (original) => ({
  ...(await original<typeof import("@/lib/n3-receipts.server")>()),
  n3Receipts: {
    getNew: stubs.getNew,
    listPaymentAccounts: stubs.list,
    getAccountById: stubs.detail,
  },
}));
vi.mock("@/routes/api/hotel/reservations.$id.deposits", () => ({
  deny: (status: number, error: string) => Response.json({ error }, { status }),
  denyN3Unauthorized: () => {
    stubs.expire();
    return Response.json({ error: "unauthorized" }, { status: 401 });
  },
  isSameOriginWrite: (request: Request) => request.headers.get("origin") === "https://hotel.test",
}));
const { handlePaymentAccountsGet, handlePaymentAccountAliasPatch } =
  await import("@/routes/api/hotel/payment-accounts");
const { readPaymentAccountCurrency, parseNewReceiptDefaults } =
  await import("@/lib/deposits-store.server");
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT = "22222222-2222-4222-8222-222222222222";
const account = {
  id: ID,
  code: "700-0310",
  name: "Bank",
  accountType: { typeCode: "BCA" },
  specialCode: "BAC",
  currencyId: 1,
  isActive: true,
  hasChildren: false,
};
const response = (data: unknown): N3Outcome => ({
  kind: "response",
  status: 200,
  body: { code: "0000", data },
  durationMs: 0,
});
const patch = (body: unknown, origin = "https://hotel.test") =>
  handlePaymentAccountAliasPatch({
    request: new Request("https://hotel.test/api/hotel/payment-accounts", {
      method: "PATCH",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  stubs.permission.mockResolvedValue({
    decision: { ok: true },
    ctx: { session: { tenantId: TENANT, n3Token: "test-token", n3UserKey: "user" } },
  });
  stubs.getNew.mockResolvedValue(response({ currencyId: 1, accountId: null }));
  stubs.list.mockResolvedValue(response({ value: [account] }));
  stubs.detail.mockResolvedValue(response(account));
  stubs.read.mockResolvedValue({
    paymentAccountAliases: { [ID]: "QR DuitNow" },
    paymentAccountVisibility: { [ID]: false },
  });
  stubs.save.mockResolvedValue({
    paymentAccountAliases: {},
    paymentAccountVisibility: { [ID]: false },
  });
});
describe("Settings lookup versus receipt posting proof", () => {
  it("loads bank accounts without default account, receipt type, rate or currency code", async () => {
    const outcome = response({ currencyId: 1, accountId: null });
    expect(readPaymentAccountCurrency(outcome)).toEqual({ ok: true, currencyId: "1" });
    expect(parseNewReceiptDefaults(outcome)).toBeNull();
    const result = await handlePaymentAccountsGet();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      accounts: [
        { id: ID, code: "700-0310", name: "Bank", kind: "bank", label: "QR DuitNow", show: false },
      ],
    });
    expect(stubs.read).toHaveBeenCalledWith(TENANT);
    expect(stubs.save).not.toHaveBeenCalled();
  });
  it("shows existing methods by default", async () => {
    stubs.read.mockResolvedValue(null);
    expect((await (await handlePaymentAccountsGet()).json()).accounts[0].show).toBe(true);
  });
  it("uses canonical preferences when N3 returns an uppercase account ID", async () => {
    stubs.list.mockResolvedValue(response({ value: [{ ...account, id: ID.toUpperCase() }] }));
    const result = await handlePaymentAccountsGet();
    expect((await result.json()).accounts[0]).toMatchObject({ label: "QR DuitNow", show: false });
  });
  it.each([
    [{}, "n3_defaults_currency_missing"],
    [{ currencyId: 0 }, "n3_defaults_currency_invalid"],
    [{ currencyId: 1, CurrencyId: 2 }, "n3_defaults_currency_conflict"],
    [{ currencyId: 1, currency: { id: 2 } }, "n3_defaults_currency_conflict"],
    [
      { currencyId: 1, currencyCode: "MYR", Currency: { code: "USD" } },
      "n3_defaults_currency_conflict",
    ],
  ])("identifies an unsafe currency response: %j", async (data, error) => {
    stubs.getNew.mockResolvedValue(response(data));
    const result = await handlePaymentAccountsGet();
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error });
    expect(stubs.list).not.toHaveBeenCalled();
  });
  it.each([
    [response({ currencyId: 1 }), undefined],
    [{ kind: "transport_error", reason: "timeout", durationMs: 0 }, "n3_defaults_unavailable"],
    [
      {
        kind: "response",
        status: 200,
        body: { code: "E001", data: { currencyId: 1 } },
        durationMs: 0,
      },
      "n3_defaults_rejected",
    ],
    [
      {
        kind: "response",
        status: 200,
        body: { code: "0000", success: false, data: { currencyId: 1 } },
        durationMs: 0,
      },
      "n3_defaults_rejected",
    ],
  ])("requires declared-success defaults", (outcome, error) => {
    expect(readPaymentAccountCurrency(outcome as N3Outcome)).toEqual(
      error ? { ok: false, error } : { ok: true, currencyId: "1" },
    );
  });
  it.each([401, 403])("handles N3 %i consistently on GET and PATCH", async (status) => {
    stubs.getNew.mockResolvedValue({ kind: "response", status, body: {}, durationMs: 0 });
    for (const result of [
      await handlePaymentAccountsGet(),
      await patch({ accountId: ID, show: false }),
    ]) {
      expect(result.status).toBe(status);
      expect(await result.json()).toEqual({
        error: status === 401 ? "unauthorized" : "n3_receipt_access_denied",
      });
    }
    expect(stubs.expire).toHaveBeenCalledTimes(status === 401 ? 2 : 0);
    expect(stubs.save).not.toHaveBeenCalled();
  });
});
describe("Owner payment preferences", () => {
  it("saves Show using trusted tenant and canonical account ID without altering its name", async () => {
    const result = await patch({ accountId: ID.toUpperCase(), show: false });
    expect(result.status).toBe(200);
    expect(stubs.permission).toHaveBeenCalledWith("hotel:setup");
    expect(stubs.save).toHaveBeenCalledWith(TENANT, ID, { show: false });
  });
  it("retains the existing name-only request contract", async () => {
    expect((await patch({ accountId: ID, label: " QR " })).status).toBe(200);
    expect(stubs.save).toHaveBeenCalledWith(TENANT, ID, { label: "QR" });
  });
  it.each([
    { accountId: ID },
    { accountId: ID, show: "false" },
    { accountId: ID, show: false, tenantId: "other" },
    { accountId: ID, label: "<bad>" },
  ])("rejects invalid preferences %j", async (body) => {
    expect((await patch(body)).status).toBe(400);
    expect(stubs.save).not.toHaveBeenCalled();
    expect(stubs.getNew).not.toHaveBeenCalled();
  });
  it("denies cross-origin and unauthorized setup before N3", async () => {
    expect((await patch({ accountId: ID, show: false }, "https://other.test")).status).toBe(403);
    stubs.permission.mockResolvedValue({ decision: { ok: false, reason: "forbidden" } });
    expect((await patch({ accountId: ID, show: false })).status).toBe(403);
    expect(stubs.getNew).not.toHaveBeenCalled();
  });
  it("rejects inactive or foreign-currency accounts before saving", async () => {
    for (const fields of [{ isActive: false }, { currencyId: 2 }]) {
      stubs.detail.mockResolvedValue(response({ ...account, ...fields }));
      expect((await patch({ accountId: ID, show: false })).status).toBe(400);
    }
    expect(stubs.save).not.toHaveBeenCalled();
  });
});
