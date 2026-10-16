import { afterEach, describe, expect, it, vi } from "vitest";
import { readSettlementMaster, billingMasterBoundTo } from "../n3-billing.server";
import {
  createCurrentSettlementMasters,
  createSettlementMasterAdapter,
} from "../settlement-current-masters.server";
import { loadSettlementSnapshot, type SnapshotFacts } from "../settlement-snapshot.server";
import { settlementFixture } from "./fixtures/settlement";
import type { SettlementActor } from "../settlement-context.server";
import { billingContractGate } from "../settlement-contracts.server";
const ar = "11111111-1111-6111-f111-111111111111";
const income = "22222222-2222-6222-f222-222222222222";
const tax = "33333333-3333-6333-f333-333333333333";
const type = "44444444-4444-6444-f444-444444444444";
const actor: SettlementActor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  n3UserKey: "synthetic-staff",
  n3Token: "synthetic-session",
  role: "front_desk",
};
const currency = () => ({
  id: 1,
  code: "MYR",
  local: true,
  defaultSalesRate: 1,
  defaultPurchaseRate: 1,
});
const account = (id: string, code: string, typeCode: string) => ({
  id,
  code,
  isActive: true,
  currencyId: 1,
  currency: currency(),
  accountTypeId: type,
  accountType: { id: type, code: typeCode, typeCode },
});
function masters() {
  const accounts = {
    [ar]: account(ar, "AR", "BCA"),
    [income]: account(income, "SALES", "INC"),
    [tax]: account(tax, "SST", "BCL"),
  };
  return new Map<string, Record<string, unknown>>([
    ["/api/Currencies/1", currency()],
    [
      "/api/Customers/7",
      {
        id: 7,
        code: "WALKIN",
        status: 0,
        currencyId: 1,
        currency: currency(),
        controlAccountId: ar,
        controlAccount: accounts[ar],
      },
    ],
    [
      "/api/Stocks/101",
      {
        id: 101,
        code: "ROOM101",
        isActive: true,
        accountPresetId: 9,
        accountPreset: { id: 9, cashSalesAccount: accounts[income] },
        uoms: [{ id: 201, stockId: 101, code: "ROOM", rate: 1, isActive: true }],
      },
    ],
    ["/api/UOMs/201", { id: 201, stockId: 101, code: "ROOM", rate: 1, isActive: true }],
    [
      "/api/TaxCodes/8",
      {
        id: 8,
        code: "SVT8%",
        rate: 0.08,
        isActive: true,
        isOutputTax: true,
        postingAccountId: tax,
        postingAccount: accounts[tax],
      },
    ],
    ...Object.values(accounts).map(
      (a) => ["/api/AccountCodes/" + a.id, a] as [string, Record<string, unknown>],
    ),
  ]);
}
function harness() {
  const rows = masters();
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, init });
    const row = rows.get(path);
    return new Response(JSON.stringify({ code: row ? "0000" : "404", data: row ?? null }), {
      status: row ? 200 : 404,
    });
  });
  vi.stubGlobal("fetch", fetcher);
  return { rows, calls, fetcher };
}
function line() {
  return {
    ...settlementFixture().lines[0],
    uomId: 201,
    taxCents: 4000,
    totalCents: 54000,
    mappingEvidence: { token: "should-never-survive" },
  };
}
const header = { customerId: 7, currencyId: 1, currency: "MYR", currencyRate: 1 };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded fixed own-session N3 master transport", () => {
  it("uses fixed GETs and manual redirects, and binds evidence to kind, ID and caller", async () => {
    const h = harness();
    const out = await readSettlementMaster(actor, "currency", 1);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({
      path: "/api/Currencies/1",
      init: {
        method: "GET",
        redirect: "manual",
        headers: { Authorization: "Bearer synthetic-session" },
      },
    });
    expect(billingMasterBoundTo(out, actor, "currency", 1)).toBe(true);
    expect(billingMasterBoundTo(out, actor, "customer", 1)).toBe(false);
    expect(billingMasterBoundTo(out, { ...actor, n3Token: "other" }, "currency", 1)).toBe(false);
    expect(billingMasterBoundTo(structuredClone(out), actor, "currency", 1)).toBe(false);
  });
  it.each([
    ["currency", "../1"],
    ["account", 1],
    ["stock", 0],
    ["other", 1],
  ])("rejects invalid fixed master %s %s before network", async (kind, id) => {
    const h = harness();
    await expect(readSettlementMaster(actor, kind as never, id)).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });
  it("rejects denied role and absent credentials before network", async () => {
    const h = harness();
    for (const change of [{ role: "housekeeper" }, { n3Token: "" }, { n3Token: "x\r\ny" }])
      await expect(
        readSettlementMaster({ ...actor, ...change } as SettlementActor, "currency", 1),
      ).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });
  it("cannot mint master evidence from redirects or duplicate-key JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, { status: 302, headers: { location: "https://other.test" } }),
      ),
    );
    const redirect = await readSettlementMaster(actor, "currency", 1);
    expect(billingMasterBoundTo(redirect, actor, "currency", 1)).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"code":"0000","data":{"id":1,"id":2}}')),
    );
    const duplicate = await readSettlementMaster(actor, "currency", 1);
    expect(billingMasterBoundTo(duplicate, actor, "currency", 1)).toBe(false);
  });
});

describe("current accounting mapping graph", () => {
  it("verifies customer, local currency, exact UOM and all three independently read accounts", async () => {
    const h = harness(),
      reader = createCurrentSettlementMasters(actor);
    const result = await reader.verifyLine(actor, header, line());
    expect(result).toMatchObject({
      kind: "confirmed",
      value: {
        stockId: 101,
        mappingEvidence: {
          arAccountId: ar,
          arAccountCode: "AR",
          salesAccountId: income,
          salesAccountCode: "SALES",
          taxAccountId: tax,
          taxAccountCode: "SST",
          currencyId: 1,
          taxRateBp: 800,
        },
      },
    });
    expect(h.calls).toHaveLength(8);
    expect(h.calls.every((c) => c.init.method === "GET")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /synthetic-session|should-never-survive|controlAccount|defaultSalesRate/,
    );
    expect(billingContractGate("bill").kind).not.toBe("confirmed");
    expect(billingContractGate("deposit_allocation").kind).not.toBe("confirmed");
  });
  it("reuses evidence only within one bounded request, and never reprices a charge", async () => {
    const h = harness(),
      reader = createCurrentSettlementMasters(actor),
      charge = line();
    const before = structuredClone(charge);
    const first = await reader.verifyLine(actor, header, charge);
    const second = await reader.verifyLine(actor, header, charge);
    expect(first.kind).toBe("confirmed");
    expect(second).toEqual(first);
    expect(h.calls).toHaveLength(8);
    expect(charge).toEqual(before);
  });
  it.each([
    ["/api/Customers/7", { status: 1 }],
    ["/api/Stocks/101", { isActive: false }],
    ["/api/UOMs/201", { stockId: 102 }],
    ["/api/TaxCodes/8", { isOutputTax: false }],
    ["/api/AccountCodes/" + income, { isActive: false }],
    ["/api/AccountCodes/" + income, { accountType: { id: type, typeCode: "EXP" } }],
    ["/api/AccountCodes/" + tax, { accountType: { id: type, typeCode: "INC" } }],
    ["/api/AccountCodes/" + ar, { currencyId: 2, currency: { ...currency(), id: 2 } }],
    ["/api/AccountCodes/" + income, { code: "DIFFERENT" }],
    ["/api/Currencies/1", { defaultSalesRate: 2 }],
  ])("refuses inactive or contradictory graph %s %j", async (path, change) => {
    const h = harness();
    h.rows.set(path, { ...h.rows.get(path), ...change });
    expect(
      (await createCurrentSettlementMasters(actor).verifyLine(actor, header, line())).kind,
    ).not.toBe("confirmed");
  });
  it("refuses header currency or tax amount mismatch rather than silently changing the folio", async () => {
    harness();
    for (const change of [{ currency: "USD" }, { currencyId: 2 }, { currencyRate: 2 }])
      expect(
        (
          await createCurrentSettlementMasters(actor).verifyLine(
            actor,
            { ...header, ...change },
            line(),
          )
        ).kind,
      ).not.toBe("confirmed");
    expect(
      (
        await createCurrentSettlementMasters(actor).verifyLine(actor, header, {
          ...line(),
          taxCents: 3999,
          totalCents: 53999,
        })
      ).kind,
    ).not.toBe("confirmed");
  });
  it("allows only an Owner customer GET without booking scope, preserving all other master fences", async () => {
    const h = harness(),
      a = { ...actor, role: "owner" as const, reservationId: "" };
    expect(await createCurrentSettlementMasters(a).readCustomer(a, 7)).toMatchObject({
      kind: "confirmed",
      value: { customerId: 7 },
    });
    const reads = h.calls.length;
    await expect(readSettlementMaster(a, "stock", 101)).rejects.toThrow();
    await expect(
      readSettlementMaster({ ...a, role: "front_desk" }, "customer", 7),
    ).rejects.toThrow();
    expect(h.calls).toHaveLength(reads);
  });
  it("scopes source-customer activity to the own current session, not supplied status", async () => {
    const h = harness(),
      reader = createCurrentSettlementMasters(actor);
    expect(await reader.readCustomer(actor, 7)).toEqual({
      kind: "confirmed",
      value: { tenantId: actor.tenantId, customerId: 7, active: true },
    });
    const before = h.calls.length;
    for (const change of [
      { tenantId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      { reservationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      { n3UserKey: "different" },
      { n3Token: "other" },
      { role: "housekeeper" },
    ])
      expect(
        (await reader.readCustomer({ ...actor, ...change } as SettlementActor, 7)).kind,
      ).not.toBe("confirmed");
    expect(h.calls).toHaveLength(before);
  });
  it("stops all sibling reads after 401 even if body cancellation hangs", async () => {
    const h = harness(),
      ended = vi.fn(async () => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), {
            status: 401,
          }),
      ),
    );
    const reader = createCurrentSettlementMasters(actor, { invalidateSession: ended });
    expect(await reader.verifyLine(actor, header, line())).toMatchObject({
      kind: "unavailable",
      code: "n3_unauthorized",
    });
    expect(await reader.readCustomer(actor, 7)).toMatchObject({ code: "n3_unauthorized" });
    expect(ended).toHaveBeenCalledTimes(1);
    expect(h.calls).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects cached current evidence after its operation deadline", async () => {
    harness();
    vi.useFakeTimers();
    const reader = createCurrentSettlementMasters(actor);
    expect((await reader.readCustomer(actor, 7)).kind).toBe("confirmed");
    vi.setSystemTime(Date.now() + 30001);
    expect((await reader.readCustomer(actor, 7)).kind).not.toBe("confirmed");
  });
});

describe("current-master SnapshotDeps composition", () => {
  function facts(): SnapshotFacts {
    const { digest: _digest, ...s } = settlementFixture();
    return {
      ...s,
      totalCents: 54000,
      lines: [{ ...line(), status: "active", reversesLineId: null }],
      prepared: true,
      historyGap: false,
      reservationStatus: "checked_in",
      blockers: [],
      sourceVersions: [{ table: "hotel_folios", id: s.folioId, version: "1" }],
    };
  }
  it("feeds checked mappings into the immutable snapshot and independently verifies linked receipts", async () => {
    harness();
    const f = facts(),
      receiptCheck = vi.fn(async (_a, r) => ({ kind: "confirmed" as const, value: r }));
    const deps = createSettlementMasterAdapter(actor, {
      readFacts: async () => f,
      verifyReceipt: receiptCheck,
      now: () => new Date("2026-10-15T00:00:00Z"),
    });
    const result = await loadSettlementSnapshot(actor, deps);
    expect(result).toMatchObject({
      kind: "confirmed",
      value: { lines: [{ mappingEvidence: { salesAccountId: income } }] },
    });
    expect(receiptCheck).toHaveBeenCalledTimes(1);
    expect(f.lines[0].mappingEvidence).toEqual({ token: "should-never-survive" });
  });
  it("refuses another booking's facts before making N3 reads", async () => {
    const h = harness(),
      f = facts();
    f.reservationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const deps = createSettlementMasterAdapter(actor, {
      readFacts: async () => f,
      verifyReceipt: async (_a, r) => ({ kind: "confirmed", value: r }),
      now: () => new Date(),
    });
    expect((await loadSettlementSnapshot(actor, deps)).kind).not.toBe("confirmed");
    expect(h.calls).toHaveLength(0);
  });
  it("keeps missing receipt proof as unavailable even with valid current masters", async () => {
    harness();
    const deps = createSettlementMasterAdapter(actor, {
      readFacts: async () => facts(),
      verifyReceipt: async () => ({ kind: "unavailable", code: "receipt_proof_missing" }),
      now: () => new Date("2026-10-15T00:00:00Z"),
    });
    expect(await loadSettlementSnapshot(actor, deps)).toEqual({
      kind: "unavailable",
      code: "receipt_proof_missing",
    });
  });
});

describe("paired current account consistency", () => {
  it("refuses conflicting account currency code even when its numeric ID agrees", async () => {
    const h = harness();
    h.rows.set("/api/AccountCodes/" + income, {
      ...h.rows.get("/api/AccountCodes/" + income),
      currency: { ...currency(), code: "USD" },
    });
    expect(
      (await createCurrentSettlementMasters(actor).verifyLine(actor, header, line())).kind,
    ).not.toBe("confirmed");
  });
  it("refuses contradictory account type code copies", async () => {
    const h = harness();
    h.rows.set("/api/AccountCodes/" + income, {
      ...h.rows.get("/api/AccountCodes/" + income),
      accountType: { id: type, typeCode: "INC", code: "EXP" },
    });
    expect(
      (await createCurrentSettlementMasters(actor).verifyLine(actor, header, line())).kind,
    ).not.toBe("confirmed");
  });
  it("refuses late actor changes and expires cloned graph readers independently", async () => {
    const h = harness();
    const a = { ...actor },
      reader = createCurrentSettlementMasters(a);
    const promise = reader.verifyLine(a, header, line());
    a.n3Token = "changed-session";
    expect((await promise).kind).not.toBe("confirmed");
    expect(h.calls).toHaveLength(1);
    expect(new Headers(h.calls[0].init.headers).get("authorization")).toBe(
      "Bearer synthetic-session",
    );
  });
  it("returns unavailable rather than following a redirect or accepting an explicit failed envelope", async () => {
    for (const response of [
      new Response(null, { status: 302 }),
      new Response(
        JSON.stringify({ code: "0000", success: false, data: masters().get("/api/Customers/7") }),
      ),
    ]) {
      const f = vi.fn(async () => response.clone());
      vi.stubGlobal("fetch", f);
      expect((await createCurrentSettlementMasters(actor).readCustomer(actor, 7)).kind).not.toBe(
        "confirmed",
      );
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
});

describe("snapshot master freshness during receipt proof", () => {
  it("does not freeze expired master evidence after a slow independent receipt check", async () => {
    harness();
    vi.useFakeTimers();
    const { digest: _digest, ...s } = settlementFixture();
    const f: SnapshotFacts = {
      ...s,
      totalCents: 54000,
      lines: [{ ...line(), status: "active", reversesLineId: null }],
      prepared: true,
      historyGap: false,
      reservationStatus: "checked_in",
      blockers: [],
      sourceVersions: [{ table: "hotel_folios", id: s.folioId, version: "1" }],
    };
    const deps = createSettlementMasterAdapter(actor, {
      readFacts: async () => f,
      now: () => new Date(),
      verifyReceipt: async (_a, receipt) => {
        vi.setSystemTime(Date.now() + 30001);
        return { kind: "confirmed", value: receipt };
      },
    });
    expect((await loadSettlementSnapshot(actor, deps)).kind).not.toBe("confirmed");
  });
});

describe("review regression: nested accounting graph contradictions", () => {
  it.each(["customer", "stock", "tax"] as const)(
    "refuses conflicting nested currency/type on %s",
    async (kind) => {
      const h = harness();
      const path =
        kind === "customer"
          ? "/api/Customers/7"
          : kind === "stock"
            ? "/api/Stocks/101"
            : "/api/TaxCodes/8";
      const d = h.rows.get(path)!;
      const nested = (
        kind === "customer"
          ? d.controlAccount
          : kind === "stock"
            ? (d.accountPreset as Record<string, unknown>).cashSalesAccount
            : d.postingAccount
      ) as Record<string, unknown>;
      const conflicting = {
        ...nested,
        currencyId: 2,
        currency: { ...currency(), id: 2, code: "USD" },
        type: "EXP",
      };
      if (kind === "customer") d.controlAccount = conflicting;
      else if (kind === "stock")
        (d.accountPreset as Record<string, unknown>).cashSalesAccount = conflicting;
      else d.postingAccount = conflicting;
      // Standalone detail still says active MYR and the intended BCA/INC/BCL type.
      expect(
        (await createCurrentSettlementMasters(actor).verifyLine(actor, header, line())).kind,
      ).not.toBe("confirmed");
    },
  );
  it("refuses conflicting nested local currency rates", async () => {
    const h = harness(),
      stock = h.rows.get("/api/Stocks/101")!;
    const a = (stock.accountPreset as Record<string, unknown>).cashSalesAccount as Record<
      string,
      unknown
    >;
    a.currency = { ...currency(), defaultSalesRate: 2 };
    expect(
      (await createCurrentSettlementMasters(actor).verifyLine(actor, header, line())).kind,
    ).not.toBe("confirmed");
  });
});

describe("accounting consumer interface", () => {
  it("retains separate customer identity, AR GL and sales GL from the observed masters", async () => {
    harness();
    const r = await createCurrentSettlementMasters(actor).verifyLine(actor, header, line());
    expect(r).toMatchObject({
      kind: "confirmed",
      value: {
        mappingEvidence: {
          customerId: 7,
          customerCode: "WALKIN",
          arAccountId: ar,
          arAccountCode: "AR",
          salesAccountId: income,
          salesAccountCode: "SALES",
        },
      },
    });
  });
});

describe("production header and room-unit ports", () => {
  it("derives the local currency ID from this customer's current graph, never a guessed MYR ID", async () => {
    harness();
    expect(await createCurrentSettlementMasters(actor).readHeader(actor, 7, "MYR")).toEqual({
      kind: "confirmed",
      value: { customerId: 7, currencyId: 1, currency: "MYR", currencyRate: 1 },
    });
  });
  it("rejects a customer/currency mismatch", async () => {
    harness();
    expect((await createCurrentSettlementMasters(actor).readHeader(actor, 7, "USD")).kind).not.toBe(
      "confirmed",
    );
  });
  it("resolves only a single active base unit when no room unit was saved", async () => {
    harness();
    expect(await createCurrentSettlementMasters(actor).resolveRoomUom(actor, 101)).toEqual({
      kind: "confirmed",
      value: 201,
    });
  });
  it("requires a saved unit when the stock offers multiple active units", async () => {
    const f = harness();
    const stock = f.rows.get("/api/Stocks/101")!;
    (stock.uoms as unknown[]).push({
      id: 202,
      stockId: 101,
      code: "PACK",
      rate: 2,
      isActive: true,
    });
    expect(await createCurrentSettlementMasters(actor).resolveRoomUom(actor, 101)).toEqual({
      kind: "unavailable",
      code: "settlement_room_uom_required",
    });
  });
  it("never invents a base unit when the only unit converts quantity", async () => {
    const f = harness();
    const stock = f.rows.get("/api/Stocks/101")!;
    (stock.uoms as Array<Record<string, unknown>>)[0].rate = 2;
    expect((await createCurrentSettlementMasters(actor).resolveRoomUom(actor, 101)).kind).not.toBe(
      "confirmed",
    );
  });
});

describe("current billing customer contact snapshot", () => {
  it("projects only observed bounded contact fields and verifies local currency", async () => {
    const h = harness(),
      raw = h.rows.get("/api/Customers/7")!;
    Object.assign(raw, {
      name: "Synthetic Source",
      address1: "Line one",
      address2: "Line two",
      address3: null,
      address4: null,
      phoneNo1: "123",
      emailList: ["source@example.test"],
      notes: "private ignored data",
    });
    const reader = createCurrentSettlementMasters(actor);
    const r = await reader.readBillingCustomer(actor, 7, "MYR");
    expect(r).toEqual({
      kind: "confirmed",
      value: {
        tenantId: actor.tenantId,
        customerId: 7,
        currencyId: 1,
        currencyRate: 1,
        billTo: {
          name: "Synthetic Source",
          company: "",
          address: "Line one\nLine two",
          phone: "123",
          email: "source@example.test",
        },
      },
    });
    expect(JSON.stringify(r)).not.toContain("private ignored data");
  });
  it("does not fabricate missing customer contact names", async () => {
    harness();
    expect(
      await createCurrentSettlementMasters(actor).readBillingCustomer(actor, 7, "MYR"),
    ).toMatchObject({ kind: "unavailable", code: "master_customer_contact_unproven" });
  });
  it.each([
    { name: "x".repeat(161) },
    { address1: "x".repeat(601) },
    { phoneNo1: 100 },
    { emailList: ["a@example.test", "b@example.test"] },
    { emailList: ["invalid"] },
    { emailList: "a@example.test" },
  ])("refuses unsupported or oversized contact %j", async (change) => {
    const h = harness();
    Object.assign(h.rows.get("/api/Customers/7")!, { name: "Source", emailList: [] }, change);
    expect(
      await createCurrentSettlementMasters(actor).readBillingCustomer(actor, 7, "MYR"),
    ).toMatchObject({ kind: "unavailable", code: "master_customer_contact_unproven" });
  });
  it("supports observed nullable contact fields and an empty email list", async () => {
    const h = harness();
    Object.assign(h.rows.get("/api/Customers/7")!, {
      name: "Source",
      address1: null,
      address2: null,
      address3: null,
      address4: null,
      phoneNo1: null,
      emailList: [],
    });
    expect(
      await createCurrentSettlementMasters(actor).readBillingCustomer(actor, 7, "MYR"),
    ).toMatchObject({
      kind: "confirmed",
      value: { billTo: { name: "Source", address: "", phone: "", email: "" } },
    });
  });
});

describe("canonical allocation through current per-debtor graph", () => {
  async function composed() {
    const [
      { prepareSourceBill },
      { createChargeAttributionService },
      { plan },
      { snapshotDigest },
      { readSourceCheckout },
    ] = await Promise.all([
      import("../source-billing-preparation.server"),
      import("../charge-attribution.server"),
      import("./fixtures/source-billing"),
      import("../settlement-snapshot.server"),
      import("../source-billing-confirmation.server"),
    ]);
    const h = harness(),
      sourceAr = "55555555-5555-6555-f555-555555555555";
    h.rows.set("/api/AccountCodes/" + sourceAr, account(sourceAr, "SOURCE-AR", "BCA"));
    h.rows.set("/api/Customers/8", {
      ...h.rows.get("/api/Customers/7"),
      id: 8,
      code: "OTA",
      name: "Synthetic OTA",
      emailList: [],
      controlAccountId: sourceAr,
      controlAccount: h.rows.get("/api/AccountCodes/" + sourceAr),
    });
    const s = settlementFixture({
      lines: [
        { ...line(), mappingEvidence: { legacy: true } },
        {
          ...line(),
          localLineId: "33333333-3333-4333-8333-333333333333",
          kind: "add_on",
          unitCents: 1000,
          subtotalCents: 1000,
          taxCents: 80,
          totalCents: 1080,
          mappingEvidence: { legacy: true },
        },
      ],
      receipts: [],
      totalCents: 55080,
    });
    const { digest: _d, ...facts } = s;
    s.digest = snapshotDigest(facts);
    const payer = plan().payer;
    const attribution = createChargeAttributionService({
      rpc: async () => ({
        data: {
          tenantId: actor.tenantId,
          reservationId: actor.reservationId,
          payerRevision: "1",
          payer,
          record: null,
          frozen: false,
        },
        error: null,
      }),
      snapshot: async () => ({ kind: "confirmed", value: s }),
    });
    const prepare = () =>
      prepareSourceBill(actor, { attribution, masters: createCurrentSettlementMasters(actor) });
    return { h, sourceAr, prepare, readSourceCheckout };
  }
  it("issues separate source and guest AR evidence from exact own-session GETs; confirmation stays gated", async () => {
    const x = await composed(),
      r = await x.prepare();
    expect(r.kind).toBe("confirmed");
    if (r.kind !== "confirmed") return;
    expect(r.value.legs[0].snapshot.lines[0].mappingEvidence).toMatchObject({
      customerId: 8,
      customerCode: "OTA",
      arAccountId: x.sourceAr,
      arAccountCode: "SOURCE-AR",
    });
    expect(r.value.legs[1].snapshot.lines[0].mappingEvidence).toMatchObject({
      customerId: 7,
      customerCode: "WALKIN",
      arAccountId: ar,
      arAccountCode: "AR",
    });
    expect(r.value.totalCents).toBe(55080);
    expect(
      x.h.calls.every(
        (c) =>
          c.init.method === "GET" &&
          (c.init.headers as Record<string, string>).Authorization === "Bearer synthetic-session",
      ),
    ).toBe(true);
    const freeze = vi.fn();
    const view = await x.readSourceCheckout(actor, {
      prepare: x.prepare,
      readLegacy: async () => false,
      billing: {
        store: { read: async () => null, freeze } as never,
        legDeps: async () => {
          throw Error("no frozen leg");
        },
      },
    });
    expect(view.review?.legs.map((l) => l.customerId)).toEqual([8, 7]);
    expect(view.review?.canConfirm).toBe(false);
    expect(view.blockers.length).toBeGreaterThan(0);
    expect(freeze).not.toHaveBeenCalled();
  });
  it("denies wrong source control-account type rather than reusing guest AR evidence", async () => {
    const x = await composed();
    x.h.rows.set("/api/AccountCodes/" + x.sourceAr, account(x.sourceAr, "SOURCE-AR", "INC"));
    expect(await x.prepare()).toMatchObject({
      kind: "contradiction",
      code: "master_posting_account_mismatch",
    });
    expect(x.h.calls.some((c) => c.path === "/api/Customers/7")).toBe(false);
  });
});

it("shares the caller cancellation signal with current master reads", async () => {
  const h = harness(),
    controller = new AbortController();
  const options = {
    limit: {
      signal: controller.signal,
      deadlineAt: Date.now() + 10000,
      budget: { remainingBytes: 2000000 },
    },
  };
  const current = createCurrentSettlementMasters(actor, options);
  controller.abort();
  expect(await current.verifyLine(actor, header, line())).toMatchObject({ kind: "unavailable" });
  expect(h.calls).toHaveLength(0);
});
it("rechecks caller authorization before continuing a master graph", async () => {
  const h = harness();
  let authorized = true;
  h.fetcher.mockImplementationOnce(async (url, init) => {
    authorized = false;
    const path = new URL(String(url)).pathname;
    h.calls.push({ path, init: init ?? {} });
    return Response.json({ code: "0000", data: h.rows.get(path) });
  });
  const options = { authorize: async () => authorized };
  const current = createCurrentSettlementMasters(actor, options);
  expect(await current.verifyLine(actor, header, line())).toMatchObject({
    kind: "unavailable",
    code: "n3_session_expired",
  });
  expect(h.calls.map((x) => x.path)).toEqual(["/api/Customers/7"]);
});
