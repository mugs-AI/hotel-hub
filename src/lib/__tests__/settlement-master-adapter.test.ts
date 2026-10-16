import { describe, expect, it } from "vitest";
import {
  parseObservedSettlementMaster,
  verifySettlementCustomerActivity,
  verifyObservedStockUom,
} from "../settlement-master-adapter.server";
const accountId = "11111111-1111-6111-f111-111111111111";
const account = { id: accountId, code: "400-001", isActive: true };
const body = (data: unknown) => ({ code: "0000", data });
const stock = () => ({
  id: 101,
  code: "ROOM-101",
  isActive: true,
  accountPresetId: 9,
  accountPreset: { id: 9, cashSalesAccount: account },
  uoms: [{ id: 201, stockId: 101, code: "ROOM", isActive: true, rate: 1 }],
});
describe("observed N3 billing master shapes, without posting authority", () => {
  it("projects the observed stock's own revenue account and UOM relationship", () => {
    expect(parseObservedSettlementMaster("stock", 101, body(stock()))).toMatchObject({
      kind: "confirmed",
      value: {
        kind: "stock",
        id: 101,
        code: "ROOM-101",
        active: true,
        revenueAccountId: accountId,
        uoms: [{ id: 201, stockId: 101, rate: 1 }],
        postingAuthority: false,
      },
    });
  });
  it("projects the observed customer status without inventing active enum semantics", () => {
    expect(
      parseObservedSettlementMaster(
        "customer",
        71,
        body({
          id: 71,
          code: "700-C001",
          status: 2,
          currencyId: 1,
          currency: { id: 1, code: "MYR" },
          controlAccountId: accountId,
          controlAccount: account,
        }),
      ),
    ).toMatchObject({
      kind: "confirmed",
      value: { status: 2, currencyId: 1, controlAccountId: accountId, postingAuthority: false },
    });
  });
  it("does not reinterpret a decimal tax fraction as percentage points", () => {
    expect(
      parseObservedSettlementMaster(
        "tax",
        3,
        body({
          id: 3,
          code: "SST8%",
          rate: 0.08,
          isOutputTax: true,
          isActive: true,
          postingAccountId: accountId,
          postingAccount: account,
        }),
      ),
    ).toMatchObject({
      kind: "confirmed",
      value: { rate: 0.08, postingAccountId: accountId, postingAuthority: false },
    });
  });
  it("projects account type without declaring an EXP account revenue", () => {
    const result = parseObservedSettlementMaster(
      "account",
      accountId.toUpperCase(),
      body({
        ...account,
        currencyId: 1,
        currency: { id: 1, code: "MYR" },
        accountTypeId: accountId,
        accountType: { id: accountId, typeCode: "EXP" },
      }),
    );
    expect(result).toMatchObject({
      kind: "confirmed",
      value: { kind: "account", typeCode: "EXP", postingAuthority: false },
    });
    if (result.kind === "confirmed") expect(result.value).not.toHaveProperty("revenueAccountId");
  });
  it("requires exact stock membership when verifying a separately captured UOM", () => {
    expect(
      verifyObservedStockUom(
        body(stock()),
        body({ id: 201, stockId: 101, code: "ROOM", rate: 1, isActive: true }),
        101,
        201,
      ),
    ).toMatchObject({ kind: "confirmed" });
    expect(
      verifyObservedStockUom(
        body(stock()),
        body({ id: 201, stockId: 102, code: "ROOM", rate: 1, isActive: true }),
        101,
        201,
      ),
    ).toMatchObject({ kind: "contradiction", code: "master_relationship_mismatch" });
  });
  it("refuses contradictory customer and tax account identities", () => {
    for (const kind of ["customer", "tax"] as const) {
      const data =
        kind === "customer"
          ? {
              id: 71,
              code: "C1",
              status: 1,
              currencyId: 1,
              currency: { id: 1, code: "MYR" },
              controlAccountId: accountId,
              controlAccount: { ...account, id: "22222222-2222-4222-8222-222222222222" },
            }
          : {
              id: 71,
              code: "T1",
              rate: 0.08,
              isActive: true,
              isOutputTax: true,
              postingAccountId: accountId,
              postingAccount: { ...account, id: "22222222-2222-4222-8222-222222222222" },
            };
      expect(parseObservedSettlementMaster(kind, 71, body(data))).toMatchObject({
        kind: "contradiction",
        code: "master_relationship_mismatch",
      });
    }
  });
  it.each([false, "[redacted_boolean]", undefined])(
    "refuses inactive or unproven stock %s",
    (active) => {
      expect(
        parseObservedSettlementMaster("stock", 101, body({ ...stock(), isActive: active })).kind,
      ).not.toBe("confirmed");
    },
  );
  it.each(["[redacted_number]", undefined])("refuses missing customer status %s", (status) => {
    expect(
      parseObservedSettlementMaster(
        "customer",
        71,
        body({
          id: 71,
          code: "C1",
          status,
          currencyId: 1,
          currency: { id: 1, code: "MYR" },
          controlAccountId: accountId,
          controlAccount: account,
        }),
      ),
    ).toMatchObject({ kind: "unavailable" });
  });
  it.each([0, -1, Infinity, "1"])("refuses invalid UOM conversion %s", (rate) => {
    expect(
      parseObservedSettlementMaster(
        "uom",
        201,
        body({ id: 201, stockId: 101, code: "ROOM", isActive: true, rate }),
      ).kind,
    ).not.toBe("confirmed");
  });
  it("refuses wrong requested ID and contradictory UOM copies", () => {
    expect(parseObservedSettlementMaster("stock", 102, body(stock()))).toMatchObject({
      kind: "contradiction",
      code: "master_identity_mismatch",
    });
    const s = stock();
    s.uoms.push({ ...s.uoms[0], rate: 2 });
    expect(parseObservedSettlementMaster("stock", 101, body(s)).kind).not.toBe("confirmed");
  });
  it("projects the reviewed local MYR currency without granting posting authority", () => {
    expect(
      parseObservedSettlementMaster(
        "currency",
        1,
        body({ id: 1, code: "MYR", local: true, defaultSalesRate: 1, defaultPurchaseRate: 1 }),
      ),
    ).toMatchObject({
      kind: "confirmed",
      value: {
        id: 1,
        code: "MYR",
        local: true,
        salesRate: 1,
        purchaseRate: 1,
        postingAuthority: false,
      },
    });
  });
  it.each([
    { id: 2 },
    { local: false },
    { local: "true" },
    { defaultSalesRate: "1" },
    { defaultPurchaseRate: 0 },
    { code: "USD" },
  ])("refuses unsupported or conflicting local currency %j", (change) => {
    expect(
      parseObservedSettlementMaster(
        "currency",
        1,
        body({
          id: 1,
          code: "MYR",
          local: true,
          defaultSalesRate: 1,
          defaultPurchaseRate: 1,
          ...change,
        }),
      ).kind,
    ).not.toBe("confirmed");
  });
  it("rejects malformed envelopes and strips personal/unknown fields", () => {
    expect(
      parseObservedSettlementMaster("stock", 101, { code: "FAIL", data: stock() }),
    ).toMatchObject({ kind: "unavailable" });
    const r = parseObservedSettlementMaster(
      "stock",
      101,
      body({ ...stock(), name: "Private Guest", token: "secret", currencyId: 999 }),
    );
    expect(r.kind).toBe("confirmed");
    expect(JSON.stringify(r)).not.toMatch(/Private Guest|secret|currencyId/);
  });
});

describe("complete paired observations", () => {
  it("refuses a missing stock preset scalar", () => {
    const d: Record<string, unknown> = stock();
    delete d.accountPresetId;
    expect(parseObservedSettlementMaster("stock", 101, body(d))).toMatchObject({
      kind: "unavailable",
    });
  });
  it("requires the observed account currency graph", () => {
    const d = {
      ...account,
      currencyId: 1,
      accountTypeId: accountId,
      accountType: { id: accountId, typeCode: "EXP" },
    };
    expect(parseObservedSettlementMaster("account", accountId, body(d))).toMatchObject({
      kind: "unavailable",
    });
  });
  it("refuses contradictory account currency identity", () => {
    const d = {
      ...account,
      currencyId: 1,
      currency: { id: 2, code: "MYR" },
      accountTypeId: accountId,
      accountType: { id: accountId, typeCode: "EXP" },
    };
    expect(parseObservedSettlementMaster("account", accountId, body(d))).toMatchObject({
      kind: "contradiction",
    });
  });
});

describe("documented N3 debtor activity", () => {
  it("accepts only documented ACTIVE=0 and rejects non-active states", () => {
    expect(verifySettlementCustomerActivity(0)).toEqual({ kind: "confirmed", value: true });
    for (const status of [1, 2, 3])
      expect(verifySettlementCustomerActivity(status)).toEqual({
        kind: "contradiction",
        code: "master_customer_not_active",
      });
    for (const status of [undefined, null, "0", true, 4, -1, 0.5])
      expect(verifySettlementCustomerActivity(status)).toEqual({
        kind: "unavailable",
        code: "master_customer_status_unproven",
      });
  });
});
