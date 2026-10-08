import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runFinancialVerification, assertNoInternalOrSecretFields } from "../n3-financial.server";
import { handleFinancialVerification } from "../../routes/api/n3/financial-verification";
import { destroySession } from "../session-context.server";

const state = vi.hoisted(() => ({
  allowed: true,
  journalStatus: 200,
  page401: false,
  detail401: false,
}));
vi.mock("@/lib/session-context.server", () => ({
  requirePermission: vi.fn(async () => ({
    decision: state.allowed ? { ok: true } : { ok: false, reason: "forbidden" },
    ctx: {
      session: {
        n3Token: "synthetic-server-token",
        tenantId: "synthetic-internal-tenant",
        tenantCode: "TEST-COMPANY",
        companyName: "Synthetic test company",
        n3UserKey: "synthetic-owner",
      },
    },
  })),
  destroySession: vi.fn(),
}));
vi.mock("@/lib/audit.server", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/hotel-store.server", () => ({ getOrCreateHotelSettings: vi.fn(async () => ({})) }));

const id = "11111111-1111-4111-8111-111111111111";
const rows = {
  ar_receipts: {
    id,
    docCode: "OR-SYNTHETIC",
    docType: "AROR",
    docDate: "2026-09-26",
    customerCode: "SYNTHETIC-CUSTOMER",
    customerId: 7,
    netTotalAmount: 100,
    knockoff: [],
  },
  cash_sales: {
    id,
    docCode: "CS-SYNTHETIC",
    docDate: "2026-09-26",
    customerId: 7,
    customerCode: "SYNTHETIC-CUSTOMER",
    netTotalAmount: 100,
    outstandingAmount: 100,
    isPostToAR: true,
  },
  customer_refunds: {
    id,
    docCode: "RF-SYNTHETIC",
    docType: "RF",
    docDate: "2026-09-26",
    customerId: 7,
    customerCode: "SYNTHETIC-CUSTOMER",
    netTotalAmount: 40,
    knockoff: [],
    account: { id, code: "SYNTHETIC-CASH", name: "Cash" },
  },
  gl_accounts: {
    id,
    name: "Synthetic cash",
    code: "SYNTHETIC-CASH",
    specialCode: "CAC",
    isActive: true,
    hasChildren: false,
  },
};
function installFetch() {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = new URL(String(input));
    if (
      (state.page401 && Number(url.searchParams.get("$skip")) > 0) ||
      (state.detail401 && url.pathname === `/api/arreceipts/${id}`)
    )
      return new Response(null, { status: 401 });
    if (url.pathname.endsWith("/GLPosting"))
      return new Response(
        JSON.stringify({ code: "0000", data: [{ debit: 100, credit: 0, accountId: id }] }),
        { status: state.journalStatus },
      );
    const resource = url.pathname.toLowerCase().includes("arreceipts")
      ? "ar_receipts"
      : url.pathname.toLowerCase().includes("cashsales")
        ? "cash_sales"
        : url.pathname.toLowerCase().includes("customerrefunds")
          ? "customer_refunds"
          : "gl_accounts";
    const row = rows[resource];
    const list = url.pathname.endsWith("/list") || resource === "gl_accounts";
    // The observed RF list identifies the customer by code; its detail carries
    // the numeric customer ID. Keep those distinct wire contracts in the fixture.
    const listRow =
      resource === "customer_refunds"
        ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== "customerId"))
        : row;
    return new Response(
      JSON.stringify({
        code: "0000",
        data: list ? { value: [listRow], count: state.page401 ? 2 : 1 } : row,
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const input = {
  token: "synthetic-server-token",
  dateFrom: "2026-09-26",
  dateTo: "2026-09-27",
  tenant: { code: "TEST-COMPANY", name: "Synthetic test company" },
};
const request = (body: unknown) =>
  new Request("https://hotelhub.test/api/n3/financial-verification", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  state.allowed = true;
  state.journalStatus = 200;
  state.page401 = false;
  state.detail401 = false;
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

it.each(["page401", "detail401"] as const)(
  "suppresses journals and the bundle on observed %s",
  async (failure) => {
    state[failure] = true;
    const fetch = installFetch();
    const response = await handleFinancialVerification({
      request: request({
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        includeJournals: true,
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "n3_unauthorized" });
    expect(destroySession).toHaveBeenCalledWith("n3_401");
    expect(fetch.mock.calls.some(([url]) => String(url).includes("GLPosting"))).toBe(false);
  },
);

it("does not add journal calls to the original fast verification run", async () => {
  const fetch = installFetch();
  const { bundle } = await runFinancialVerification(input);
  expect(bundle).toMatchObject({ journalCapture: { status: "not_requested", performed: 0 } });
  expect(fetch.mock.calls.some(([url]) => String(url).includes("GLPosting"))).toBe(false);
});
it("captures journals only for accepted detail IDs and exports sanitized evidence", async () => {
  const fetch = installFetch();
  const { bundle } = await runFinancialVerification({ ...input, includeJournals: true });
  expect(bundle).toMatchObject({
    journalCapture: { status: "captured", performed: 3, captured: 3 },
  });
  expect(fetch.mock.calls.filter(([url]) => String(url).includes("GLPosting"))).toHaveLength(3);
  assertNoInternalOrSecretFields(bundle);
});
it("rejects malformed opt-in options without making any N3 request", async () => {
  const fetch = installFetch();
  const response = await handleFinancialVerification({
    request: request({
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      includeJournals: "true",
    }),
  });
  expect(response.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("enforces the permission decision before reading journals", async () => {
  state.allowed = false;
  const fetch = installFetch();
  expect(
    (await handleFinancialVerification({ request: request({ ...input, includeJournals: true }) }))
      .status,
  ).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
it("uses server session identity and discovered document IDs instead of browser overrides", async () => {
  const fetch = installFetch();
  const response = await handleFinancialVerification({
    request: request({
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      includeJournals: true,
      token: "browser-token",
      tenant: { code: "ALIEN" },
      documents: [{ id: "../../bad" }],
      endpoint: "https://example.test",
      method: "POST",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    tenant: { code: "TEST-COMPANY" },
    journalCapture: { captured: 3 },
  });
  for (const [, options] of fetch.mock.calls)
    expect(options).toMatchObject({
      method: "GET",
      headers: { authorization: "Bearer synthetic-server-token" },
    });
});
it("invalidates the session and returns no financial bundle on a journal-only 401", async () => {
  state.journalStatus = 401;
  installFetch();
  const response = await handleFinancialVerification({
    request: request({
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      includeJournals: true,
    }),
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "n3_unauthorized" });
  expect(destroySession).toHaveBeenCalledWith("n3_401");
});
