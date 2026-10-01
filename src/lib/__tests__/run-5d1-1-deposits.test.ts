/**
 * Run 5D1.1 — deposit safety corrections.
 *
 * Proves: RBAC split (Owner creates, Front Desk views, Housekeeper neither),
 * fail-closed preflight (zero N3 create calls), idempotency, GET-only
 * recovery of interrupted `submitting` rows, definite N3 401 handling and a
 * label-only confirmation preview.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasPermission } from "@/lib/rbac";
import type { N3Outcome, N3ReceiptsClient } from "@/lib/n3-receipts.server";

// ---------- audit sink ----------
const auditEvents: Array<{ eventType: string; detail?: unknown }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

// ---------- hotel settings ----------
const visibility = vi.hoisted(() => ({
  value: {} as Record<string, boolean>,
  aliases: {} as Record<string, string>,
}));
vi.mock("@/lib/hotel-store.server", () => ({
  getOrCreateHotelSettings: async () => ({
    currency: "MYR",
    paymentAccountAliases: visibility.aliases,
    paymentAccountVisibility: visibility.value,
    walkInCustomer: { n3Id: "1", n3Code: "WALKIN", n3Name: "Walk In Guest" },
  }),
}));

// ---------- supabaseAdmin stub ----------
type Row = Record<string, unknown>;
type QueryResult = { data: Row | null; error: { code: string } | null };
type MockBuilder = {
  select(): MockBuilder;
  eq(column: string, value: unknown): MockBuilder;
  order(): MockBuilder;
  insert(row: Row): MockBuilder;
  update(patch: Row): MockBuilder;
  maybeSingle(): Promise<QueryResult>;
  then<T = QueryResult>(resolve?: (result: QueryResult) => T | PromiseLike<T>): Promise<T>;
};
const tables: Record<string, Row[]> = { hotel_reservations: [], hotel_reservation_deposits: [] };

function makeBuilder(table: string): MockBuilder {
  const filters: Array<[string, unknown]> = [];
  let mode: "select" | "insert" | "update" = "select";
  let payload: Row | null = null;
  const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
  const builder: MockBuilder = {
    select() {
      return builder;
    },
    eq(k: string, v: unknown) {
      filters.push([k, v]);
      return builder;
    },
    order() {
      return builder;
    },
    insert(row: Row) {
      mode = "insert";
      payload = row;
      return builder;
    },
    update(patch: Row) {
      mode = "update";
      payload = patch;
      return builder;
    },
    async maybeSingle() {
      return builder.then();
    },
    then<T = QueryResult>(resolve?: (result: QueryResult) => T | PromiseLike<T>): Promise<T> {
      let result: QueryResult;
      if (mode === "insert") {
        const rows = tables[table]!;
        const dup = rows.some(
          (r) =>
            payload!["idempotency_key"] && r["idempotency_key"] === payload!["idempotency_key"],
        );
        if (dup) {
          result = { data: null, error: { code: "23505" } };
        } else {
          const row: Row = {
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            ...payload,
          };
          rows.push(row);
          result = { data: row, error: null };
        }
      } else if (mode === "update") {
        const row = tables[table]!.find(match);
        if (row) Object.assign(row, payload);
        result = { data: row ?? null, error: null };
      } else {
        const rows = tables[table]!.filter(match);
        result = { data: rows[0] ?? null, error: null };
      }
      return resolve ? Promise.resolve(resolve(result)) : (Promise.resolve(result) as Promise<T>);
    },
  };
  return builder;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => makeBuilder(t) },
}));

const {
  classifyPreflight,
  classifyCreateOutcome,
  createDeposit,
  buildDepositPreview,
  buildDepositPayload,
  parseDepositAccount,
  parseNewReceiptDefaults,
  reconcileDeposit,
  isRecoverableDepositStatus,
  DepositError,
  validatePaymentChoices,
  listEligiblePaymentAccounts,
  verifyReceiptDetail,
  verifyReceiptJournal,
  matchExistingReceipt,
  toDepositDTO,
} = await import("@/lib/deposits-store.server");

// ---------- N3 fake ----------
const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const ENV = {
  HOTELHUB_N3_DEPOSIT_WRITES_ENABLED: "true",
  HOTELHUB_N3_DEPOSIT_WRITE_TENANT_ALLOWLIST: "tenant-key-1",
};
const TENANT = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function accountResult(overrides: Record<string, unknown> = {}) {
  return {
    kind: "response" as const,
    status: 200,
    body: {
      code: "0000",
      success: true,
      data: {
        id: ACCOUNT_ID,
        code: "700-0310",
        name: "Maybank Current",
        accountType: { typeCode: "BCA", name: "Current Assets" },
        specialCode: "BAC",
        currencyId: 1,
        isActive: true,
        hasChildren: false,
        ...overrides,
      },
    },
  };
}

function newDefaults() {
  return {
    kind: "response" as const,
    status: 200,
    body: {
      code: "0000",
      success: true,
      data: {
        id: "rcpt-new",
        docType: "AROR",
        currencyRate: 1,
        accountId: ACCOUNT_ID,
        accountCode: "700-0310",
        accountName: "Maybank Current",
        currencyId: 1,
        docDate: "2026-01-01",
        currencyCode: "MYR",
      },
    },
  };
}

/** Only the fields the deposit store reads; `durationMs` is irrelevant here. */
type TestOutcome =
  | { kind: "response"; status: number; body: unknown; durationMs?: number }
  | { kind: "transport_error"; reason: "timeout" | "network" | "too_large"; durationMs?: number };

function makeN3(
  overrides: Partial<
    Record<"getNew" | "getAccountById" | "listByReference" | "create", TestOutcome>
  > = {},
) {
  const calls = { getNew: 0, getAccountById: 0, listByReference: 0, create: 0 };
  const client = {
    async getNew(): Promise<TestOutcome> {
      calls.getNew++;
      return overrides.getNew ?? newDefaults();
    },
    async getAccountById(): Promise<TestOutcome> {
      calls.getAccountById++;
      return overrides.getAccountById ?? accountResult();
    },
    async listByReference(): Promise<TestOutcome> {
      calls.listByReference++;
      return (
        overrides.listByReference ?? {
          kind: "response",
          status: 200,
          body: { code: "0000", success: true, data: { value: [] } },
        }
      );
    },
    async create(): Promise<TestOutcome> {
      calls.create++;
      return overrides.create ?? { kind: "transport_error", reason: "timeout" };
    },
  };
  // Partial double: only the methods exercised by these tests are provided.
  return { client: client as unknown as N3ReceiptsClient, calls };
}

function baseInput(clientRequestId: string) {
  return {
    tenantId: TENANT,
    n3TenantKey: "tenant-key-1",
    reservationId: RESERVATION_ID,
    actorN3UserKey: "user-1",
    n3Token: "tok",
    amount: 100,
    clientRequestId,
    paymentLines: [{ accountId: ACCOUNT_ID, amount: 100 }],
  };
}

beforeEach(() => {
  visibility.value = {};
  visibility.aliases = {};
  auditEvents.length = 0;
  tables.hotel_reservation_deposits = [];
  tables.hotel_reservations = [
    {
      id: RESERVATION_ID,
      tenant_id: TENANT,
      booking_reference: "BK-0001",
      status: "confirmed",
      currency: "MYR",
    },
  ];
});

describe("payment method visibility", () => {
  it("keeps the display name when a verified N3 ID uses uppercase letters", async () => {
    visibility.aliases[ACCOUNT_ID] = "QR DuitNow";
    const { client } = makeN3({ getAccountById: accountResult({ id: ACCOUNT_ID.toUpperCase() }) });
    const preview = await buildDepositPreview(baseInput(crypto.randomUUID()), {
      n3: client,
      env: ENV,
    });
    expect(preview.accountLabel).toBe("QR DuitNow (700-0310)");
  });
  it("blocks hidden account IDs before claiming a new deposit or calling N3", async () => {
    visibility.value[ACCOUNT_ID] = false;
    const { client, calls } = makeN3();
    const input = baseInput(crypto.randomUUID());
    input.paymentLines[0]!.accountId = ACCOUNT_ID.toUpperCase();
    await expect(createDeposit(input, { n3: client, env: ENV })).rejects.toMatchObject({
      code: "payment_method_hidden",
    });
    expect(calls.getNew).toBe(0);
    expect(calls.create).toBe(0);
    expect(tables.hotel_reservation_deposits).toHaveLength(0);
  });

  it("blocks a confirmation preview for a hidden method", async () => {
    visibility.value[ACCOUNT_ID] = false;
    const { client, calls } = makeN3();
    await expect(
      buildDepositPreview(baseInput(crypto.randomUUID()), { n3: client, env: ENV }),
    ).rejects.toMatchObject({ code: "payment_method_hidden" });
    expect(calls.getNew).toBe(0);
  });

  it("preserves the original idempotent result and account snapshot after hiding", async () => {
    const { client, calls } = makeN3();
    const input = baseInput(crypto.randomUUID());
    const original = await createDeposit(input, { n3: client, env: ENV });
    const stored = JSON.stringify(tables.hotel_reservation_deposits);
    visibility.value[ACCOUNT_ID] = false;
    const replay = await createDeposit(input, { n3: client, env: ENV });
    expect(replay).toEqual({ deposit: original.deposit, reused: true });
    expect(JSON.stringify(tables.hotel_reservation_deposits)).toBe(stored);
    expect(calls.create).toBe(1);
  });
});

describe("N3 Cloud receipt contract and Deposit To account", () => {
  it("requires distinct positive account lines whose cents total the receipt", () => {
    const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(
      validatePaymentChoices(100.01, [
        { accountId: ACCOUNT_ID, amount: 60.01 },
        { accountId: second, amount: 40 },
      ]),
    ).toHaveLength(2);
    for (const lines of [
      [
        { accountId: ACCOUNT_ID, amount: 60 },
        { accountId: second, amount: 40 },
      ],
      [
        { accountId: ACCOUNT_ID, amount: 60.01 },
        { accountId: ACCOUNT_ID, amount: 40 },
      ],
      [
        { accountId: ACCOUNT_ID, amount: 60.001 },
        { accountId: second, amount: 40.009 },
      ],
    ])
      expect(() => validatePaymentChoices(100.01, lines)).toThrowError("invalid_payment_lines");
  });

  it("forms one split AR receipt with exact bank/cash amounts and no header account", () => {
    const defaults = parseNewReceiptDefaults(newDefaults() as N3Outcome)!;
    const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const payload = buildDepositPayload({
      defaults,
      customerId: "1",
      amount: 150,
      referenceNo: "HH-0123456789abcdef01234567",
      description: "DEPOSIT",
      docDate: "2026-09-27",
      paymentLines: [
        { id: ACCOUNT_ID, code: "700-0310", name: "Maybank", kind: "bank", amount: 70 },
        { id: second, code: "700-0400", name: "Cash", kind: "cash", amount: 80 },
      ],
    });
    expect(payload).toMatchObject({
      docType: "AROR",
      totalAmount: 150,
      isMultiPayment: true,
      multiPayments: [
        { accountId: ACCOUNT_ID, amount: 70 },
        { accountId: second, amount: 80 },
      ],
      knockoff: [],
    });
    expect(payload).not.toHaveProperty("accountId");
  });

  it("only offers active Current Assets bank/cash leaf accounts in receipt currency", async () => {
    const row = accountResult().body.data;
    const accounts = await listEligiblePaymentAccounts(
      {
        listPaymentAccounts: async () => ({
          kind: "response",
          status: 200,
          durationMs: 1,
          body: {
            code: "0000",
            success: true,
            data: {
              value: [
                row,
                { ...row, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", specialCode: "DAC" },
                { ...row, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", specialCode: "CAC" },
              ],
            },
          },
        }),
      } as unknown as N3ReceiptsClient,
      "token",
      "1",
    );
    expect(accounts.map((a) => a.kind)).toEqual(["bank", "cash"]);
  });

  it("accepts the verified Value casing but still rejects a malformed account page", async () => {
    const row = accountResult().body.data;
    const stub = (body: unknown) =>
      ({
        listPaymentAccounts: async () => ({ kind: "response", status: 200, durationMs: 1, body }),
      }) as unknown as N3ReceiptsClient;
    const accounts = await listEligiblePaymentAccounts(
      stub({ code: "0000", data: { Value: [row] } }),
      "token",
      "1",
    );
    expect(accounts).toHaveLength(1);
    await expect(
      listEligiblePaymentAccounts(stub({ code: "0000", data: { Value: {} } }), "token", "1"),
    ).rejects.toMatchObject({ code: "n3_deposit_account_unavailable" });
  });

  it("sends a numeric customer/currency and top-level total without details", () => {
    const defaults = parseNewReceiptDefaults(newDefaults() as N3Outcome);
    expect(defaults).not.toBeNull();
    const payload = buildDepositPayload({
      defaults: defaults!,
      customerId: "1",
      amount: 100.01,
      referenceNo: "HH-0123456789abcdef01234567",
      description: "HOTELHUB DEPOSIT BK-1",
      docDate: "2026-09-26",
    });
    expect(payload).toMatchObject({
      customerId: 1,
      currencyId: 1,
      accountId: ACCOUNT_ID,
      totalAmount: 100.01,
      knockoff: [],
    });
    expect(payload).not.toHaveProperty("details");
    expect(payload).not.toHaveProperty("paymentAmount");
  });

  it("accepts only active Current Assets leaf bank or cash special accounts", () => {
    expect(parseDepositAccount(accountResult() as N3Outcome, ACCOUNT_ID, "1")?.kind).toBe("bank");
    expect(
      parseDepositAccount(accountResult({ specialCode: "CAC" }) as N3Outcome, ACCOUNT_ID, "1")
        ?.kind,
    ).toBe("cash");
    for (const fields of [
      { accountType: { typeCode: "EXP" } },
      { specialCode: "DAC" },
      { isActive: false },
      { hasChildren: true },
      { currencyId: 2 },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    ]) {
      expect(parseDepositAccount(accountResult(fields) as N3Outcome, ACCOUNT_ID, "1")).toBeNull();
    }
    expect(
      parseDepositAccount(
        {
          kind: "response",
          status: 200,
          body: { ...accountResult().body, code: "E001" },
        } as N3Outcome,
        ACCOUNT_ID,
        "1",
      ),
    ).toBeNull();
  });

  it("blocks N3 Create when Deposit To cannot be verified", async () => {
    const { client, calls } = makeN3({ getAccountById: accountResult({ specialCode: "DAC" }) });
    await expect(
      createDeposit(baseInput(crypto.randomUUID()), { n3: client, env: ENV }),
    ).rejects.toMatchObject({
      code: "n3_deposit_account_invalid",
    });
    expect(calls.create).toBe(0);
    expect(tables.hotel_reservation_deposits).toHaveLength(0);
  });

  it("does not treat HTTP 200 plus a non-success business code as posted", () => {
    const outcome = {
      kind: "response",
      status: 200,
      body: { code: "E001", success: true, data: { id: ACCOUNT_ID, docCode: "OR-1" } },
    } as N3Outcome;
    expect(
      classifyCreateOutcome(outcome, {
        customerId: "1",
        referenceNo: "HH-0123456789abcdef01234567",
        amount: 100,
      }).verdict,
    ).toBe("unknown");
    expect(
      classifyPreflight(
        {
          kind: "response",
          status: 200,
          body: { code: "E001", data: { value: [] } },
        } as N3Outcome,
        {
          customerId: "1",
          referenceNo: "HH-0123456789abcdef01234567",
          amount: 100,
          currencyId: "1",
        },
      ).kind,
    ).toBe("unavailable");
  });
});

describe("5D1.1 RBAC", () => {
  it("Owner may view and create deposits", () => {
    expect(hasPermission("owner", "hotel:deposits:view")).toBe(true);
    expect(hasPermission("owner", "hotel:deposits:create")).toBe(true);
  });
  it("Front desk may view but never create", () => {
    expect(hasPermission("front_desk", "hotel:deposits:view")).toBe(true);
    expect(hasPermission("front_desk", "hotel:deposits:create")).toBe(false);
  });
  it("Housekeeper has neither permission", () => {
    expect(hasPermission("housekeeper", "hotel:deposits:view")).toBe(false);
    expect(hasPermission("housekeeper", "hotel:deposits:create")).toBe(false);
  });
});

describe("5D1.1 preflight fail-closed", () => {
  const expected = {
    customerId: "1",
    referenceNo: "HH-ABC",
    amount: 100,
    currencyId: "1",
  };

  it("transport failure is unavailable", () => {
    expect(
      classifyPreflight({ kind: "transport_error", reason: "timeout" } as N3Outcome, expected).kind,
    ).toBe("unavailable");
  });
  it("5xx is unavailable", () => {
    expect(
      classifyPreflight({ kind: "response", status: 503, body: {} } as N3Outcome, expected).kind,
    ).toBe("unavailable");
  });
  it("401 is unauthorized", () => {
    expect(
      classifyPreflight({ kind: "response", status: 401, body: {} } as N3Outcome, expected).kind,
    ).toBe("unauthorized");
  });
  it("unreadable (non-list) body is unavailable, not zero-match", () => {
    expect(
      classifyPreflight(
        { kind: "response", status: 200, body: { data: {} } } as N3Outcome,
        expected,
      ).kind,
    ).toBe("unavailable");
  });
  it("readable empty page is a zero match", () => {
    expect(
      classifyPreflight(
        { kind: "response", status: 200, body: { code: "0000", data: { value: [] } } } as N3Outcome,
        expected,
      ).kind,
    ).toBe("none");
  });

  it("makes ZERO N3 create calls when the preflight is unreadable", async () => {
    const { client, calls } = makeN3({
      listByReference: { kind: "response", status: 200, body: { data: {} } },
    });
    const { deposit } = await createDeposit(baseInput(crypto.randomUUID()), {
      n3: client,
      env: ENV,
    });
    expect(calls.create).toBe(0);
    expect(deposit.status).toBe("failed");
    expect(deposit.lastErrorCode).toBe("n3_preflight_unavailable");
  });

  it("makes ZERO N3 create calls when the preflight transport fails", async () => {
    const { client, calls } = makeN3({
      listByReference: { kind: "transport_error", reason: "timeout" },
    });
    const { deposit } = await createDeposit(baseInput(crypto.randomUUID()), {
      n3: client,
      env: ENV,
    });
    expect(calls.create).toBe(0);
    expect(deposit.status).toBe("failed");
  });

  it("a definite N3 401 during preflight throws unauthorized and makes no create call", async () => {
    const { client, calls } = makeN3({
      listByReference: { kind: "response", status: 401, body: {} },
    });
    await expect(
      createDeposit(baseInput(crypto.randomUUID()), { n3: client, env: ENV }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(calls.create).toBe(0);
  });
});

describe("5D1.1 idempotency", () => {
  it("the same client request id causes at most one N3 create", async () => {
    const { client, calls } = makeN3({
      create: {
        kind: "response",
        status: 200,
        body: { code: "0000", data: { id: "r1", docNo: "OR-1" } },
      },
    });
    const id = crypto.randomUUID();
    await createDeposit(baseInput(id), { n3: client, env: ENV });
    const second = await createDeposit(baseInput(id), { n3: client, env: ENV });
    expect(second.reused).toBe(true);
    expect(calls.create).toBe(1);
    expect(toDepositDTO(second.deposit).clientRequestId).toBe(id);
  });

  it("concurrent duplicates still result in one N3 create", async () => {
    const { client, calls } = makeN3({
      create: {
        kind: "response",
        status: 200,
        body: { code: "0000", data: { id: "r1", docNo: "OR-1" } },
      },
    });
    const id = crypto.randomUUID();
    await Promise.all([
      createDeposit(baseInput(id), { n3: client, env: ENV }),
      createDeposit(baseInput(id), { n3: client, env: ENV }).catch(() => null),
    ]);
    expect(calls.create).toBeLessThanOrEqual(1);
  });
});

describe("5D1.1 recovery", () => {
  it("submitting and unknown are recoverable; posted and failed are not", () => {
    expect(isRecoverableDepositStatus("submitting")).toBe(true);
    expect(isRecoverableDepositStatus("unknown")).toBe(true);
    expect(isRecoverableDepositStatus("posted")).toBe(false);
    expect(isRecoverableDepositStatus("failed")).toBe(false);
  });

  it("an interrupted submitting row reconciles GET-only and becomes unknown when unmatched", async () => {
    const depositId = "33333333-3333-4333-8333-333333333333";
    tables.hotel_reservation_deposits.push({
      id: depositId,
      tenant_id: TENANT,
      reservation_id: RESERVATION_ID,
      amount: 100,
      currency_code: "MYR",
      status: "submitting",
      n3_reference_no: "HH-XYZ",
      n3_customer_id: "1",
      created_by_n3_user_key: "user-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    const { client, calls } = makeN3();
    const out = await reconcileDeposit(
      {
        tenantId: TENANT,
        n3TenantKey: "tenant-key-1",
        reservationId: RESERVATION_ID,
        depositId,
        actorN3UserKey: "user-1",
        n3Token: "tok",
      },
      { n3: client },
    );
    expect(calls.create).toBe(0);
    expect(out.status).toBe("unknown");
  });

  it("a posted row cannot be reconciled", async () => {
    const depositId = "44444444-4444-4444-8444-444444444444";
    tables.hotel_reservation_deposits.push({
      id: depositId,
      tenant_id: TENANT,
      reservation_id: RESERVATION_ID,
      amount: 100,
      currency_code: "MYR",
      status: "posted",
      n3_reference_no: "HH-DONE",
      n3_customer_id: "cust-guid-1",
      created_by_n3_user_key: "user-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    await expect(
      reconcileDeposit(
        {
          tenantId: TENANT,
          n3TenantKey: "tenant-key-1",
          reservationId: RESERVATION_ID,
          depositId,
          actorN3UserKey: "user-1",
          n3Token: "tok",
        },
        { n3: makeN3().client },
      ),
    ).rejects.toBeInstanceOf(DepositError);
  });
});

describe("5D1.1 confirmation preview", () => {
  it("returns labels only and never internal ids, tokens or raw payloads", async () => {
    const { client, calls } = makeN3();
    const preview = await buildDepositPreview(
      {
        tenantId: TENANT,
        n3TenantKey: "tenant-key-1",
        reservationId: RESERVATION_ID,
        n3Token: "tok",
        amount: 100,
        paymentLines: [{ accountId: ACCOUNT_ID, amount: 100 }],
      },
      { n3: client, env: ENV },
    );
    expect(calls.create).toBe(0);
    expect(preview.bookingReference).toBe("BK-0001");
    expect(preview.customerLabel).toBe("Walk In Guest");
    expect(preview.accountLabel).toBe("Maybank Current (700-0310)");
    expect(preview.warning).toContain("real accounting document");
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain(ACCOUNT_ID);
    expect(serialized).not.toContain("tok");
  });
});

// ---------------------------------------------------------------------------
// Run 5D1.1.1 — create-time 401 and the 401 vs 403 distinction.
// ---------------------------------------------------------------------------

describe("5D1.1.1 create-time N3 401", () => {
  it("persists the ledger row as unknown, audits it and throws unauthorized", async () => {
    const id = crypto.randomUUID();
    const { client, calls } = makeN3({
      create: { kind: "response", status: 401, body: null },
    });
    await expect(createDeposit(baseInput(id), { n3: client, env: ENV })).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(calls.create).toBe(1);
    const row = tables.hotel_reservation_deposits[0]!;
    expect(row.status).toBe("unknown");
    expect(row.last_error_code).toBe("n3_unauthorized");
    expect(auditEvents.some((e) => e.eventType === "hotel.deposit.unknown")).toBe(true);
  });

  it("retrying the same client request id after relaunch makes zero additional creates", async () => {
    const id = crypto.randomUUID();
    const first = makeN3({ create: { kind: "response", status: 401, body: null } });
    await expect(
      createDeposit(baseInput(id), { n3: first.client, env: ENV }),
    ).rejects.toBeInstanceOf(DepositError);
    const second = makeN3();
    const out = await createDeposit(baseInput(id), { n3: second.client, env: ENV });
    expect(second.calls.create).toBe(0);
    expect(out.reused).toBe(true);
    expect(out.deposit.status).toBe("unknown");
  });

  it("the unknown row stays available for GET-only reconciliation", async () => {
    const id = crypto.randomUUID();
    const first = makeN3({ create: { kind: "response", status: 401, body: null } });
    await expect(
      createDeposit(baseInput(id), { n3: first.client, env: ENV }),
    ).rejects.toBeInstanceOf(DepositError);
    const row = tables.hotel_reservation_deposits[0]!;
    expect(isRecoverableDepositStatus(String(row["status"]))).toBe(true);
    const check = makeN3();
    await reconcileDeposit(
      {
        tenantId: TENANT,
        n3TenantKey: "tenant-key-1",
        reservationId: RESERVATION_ID,
        depositId: String(row["id"]),
        actorN3UserKey: "user-1",
        n3Token: "tok",
      },
      { n3: check.client },
    );
    expect(check.calls.create).toBe(0);
  });
});

describe("5D1.1.1 N3 403 is never session expiry", () => {
  it("preflight 403 is unavailable, not unauthorized", () => {
    const v = classifyPreflight({ kind: "response", status: 403, body: null } as N3Outcome, {
      customerId: "c",
      referenceNo: "HH-000000000000000000000000",
      amount: 1,
      currencyId: null,
    });
    expect(v.kind).toBe("unavailable");
  });

  it("preflight 403 fails closed with zero create calls and keeps the session", async () => {
    const { client, calls } = makeN3({
      listByReference: { kind: "response", status: 403, body: null },
    });
    const { deposit } = await createDeposit(baseInput(crypto.randomUUID()), {
      n3: client,
      env: ENV,
    });
    expect(calls.create).toBe(0);
    expect(deposit.status).toBe("failed");
  });

  it("create-time 403 is uncertain but does not throw unauthorized", async () => {
    const { client } = makeN3({ create: { kind: "response", status: 403, body: null } });
    const { deposit } = await createDeposit(baseInput(crypto.randomUUID()), {
      n3: client,
      env: ENV,
    });
    expect(deposit.status).toBe("unknown");
    expect(deposit.lastErrorCode).toBe("n3_forbidden");
  });

  it("preview 403 fails closed without unauthorized", async () => {
    const { client } = makeN3({ getNew: { kind: "response", status: 403, body: null } });
    await expect(
      buildDepositPreview(
        {
          tenantId: TENANT,
          n3TenantKey: "tenant-key-1",
          reservationId: RESERVATION_ID,
          n3Token: "tok",
          amount: 100,
          paymentLines: [{ accountId: ACCOUNT_ID, amount: 100 }],
        },
        { n3: client, env: ENV },
      ),
    ).rejects.toMatchObject({ code: "n3_defaults_unavailable" });
  });

  it("reconciliation 403 fails closed without unauthorized", async () => {
    tables.hotel_reservation_deposits.push({
      id: "33333333-3333-4333-8333-333333333333",
      tenant_id: TENANT,
      reservation_id: RESERVATION_ID,
      amount: 100,
      currency_code: "MYR",
      status: "unknown",
      n3_reference_no: "HH-0123456789abcdef01234567",
      n3_customer_id: "1",
      created_by_n3_user_key: "user-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    const { client, calls } = makeN3({
      listByReference: { kind: "response", status: 403, body: null },
    });
    await expect(
      reconcileDeposit(
        {
          tenantId: TENANT,
          n3TenantKey: "tenant-key-1",
          reservationId: RESERVATION_ID,
          depositId: "33333333-3333-4333-8333-333333333333",
          actorN3UserKey: "user-1",
          n3Token: "tok",
        },
        { n3: client },
      ),
    ).rejects.toMatchObject({ code: "n3_preflight_unavailable" });
    expect(calls.create).toBe(0);
  });
});

// The external N3 and database transports are doubles; createDeposit and
// reconcileDeposit remain real. Removing their read-back gates must fail these.
const RECEIPT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
function receiptReadbackN3(
  options: {
    detail?: Record<string, unknown>;
    journal?: unknown[];
    detailStatus?: number;
    journalStatus?: number;
    discoveryDuplicates?: boolean;
  } = {},
) {
  const base = makeN3();
  let payload: Record<string, unknown> = {};
  const calls = { create: 0, detail: 0, journal: 0, discovery: 0 };
  const saved = () => ({
    ...payload,
    id: RECEIPT_ID,
    docCode: "OR-100",
    docType: "AROR",
    customerId: 1,
    currencyId: 1,
    currencyCode: "MYR",
    totalAmount: 100,
    outstandingAmount: 100,
    accountId: ACCOUNT_ID,
    isMultiPayment: false,
    knockoff: [],
    ...options.detail,
  });
  const client = {
    ...base.client,
    create: async (_token: string, body: unknown): Promise<N3Outcome> => {
      calls.create++;
      payload = body as Record<string, unknown>;
      return {
        kind: "response",
        status: 200,
        durationMs: 1,
        body: { code: "0000", data: { id: RECEIPT_ID, docCode: "OR-100" } },
      };
    },
    getById: async (): Promise<N3Outcome> => {
      calls.detail++;
      return {
        kind: "response",
        status: options.detailStatus ?? 200,
        durationMs: 1,
        body: { code: "0000", data: saved() },
      };
    },
    getGLPosting: async (): Promise<N3Outcome> => {
      calls.journal++;
      return {
        kind: "response",
        status: options.journalStatus ?? 200,
        durationMs: 1,
        body: {
          code: "0000",
          data: options.journal ?? [
            { accountId: ACCOUNT_ID, accountCode: "700-0310", debit: 100, credit: 0 },
            { accountCode: "WALKIN", debit: 0, credit: 100 },
          ],
        },
      };
    },
    listByReference: async (_token: string, ref: string): Promise<N3Outcome> => {
      calls.discovery++;
      const rows = options.discoveryDuplicates
        ? [
            { ...saved(), referenceNo: ref },
            {
              ...saved(),
              referenceNo: ref,
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              docCode: "OR-101",
            },
          ]
        : [];
      return {
        kind: "response",
        status: 200,
        durationMs: 1,
        body: { code: "0000", data: { value: rows } },
      };
    },
  };
  return { client, calls };
}

describe("deposit financial read-back regression", () => {
  it("confirms only after exact detail and balanced journal are read", async () => {
    const { client, calls } = receiptReadbackN3();
    const out = await createDeposit(baseInput(crypto.randomUUID()), { n3: client, env: ENV });
    expect(out.deposit.status).toBe("posted");
    expect(calls).toMatchObject({ create: 1, detail: 1, journal: 1 });
  });

  it.each([
    ["wrong customer", { customerId: 2 }],
    ["wrong currency", { currencyId: 2 }],
    ["wrong currency code", { currencyCode: "USD" }],
    ["wrong account", { accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    ["wrong amount", { totalAmount: 99 }],
    ["wrong outstanding", { outstandingAmount: 90 }],
    ["void flag", { isVoided: true }],
    ["string cancel flag", { isCancelled: "true" }],
    ["cancelled status", { status: "Cancelled" }],
    ["allocated receipt", { knockoff: [{ docType: "INV", appliedAmount: 10 }] }],
  ])("keeps %s unknown, preserves the UUID, and never repeats Create", async (_name, detail) => {
    const { client, calls } = receiptReadbackN3({ detail });
    const request = baseInput(crypto.randomUUID());
    const out = await createDeposit(request, { n3: client, env: ENV });
    expect(out.deposit.status).toBe("unknown");
    expect(out.deposit.n3ReceiptId).toBe(RECEIPT_ID);
    expect(out.deposit.lastErrorCode).toBe("n3_receipt_readback_uncertain");
    await createDeposit(request, { n3: client, env: ENV });
    expect(calls.create).toBe(1);
    expect(calls.journal).toBe(0);
  });

  it("does not confirm a receipt whose journal is unbalanced", async () => {
    const { client, calls } = receiptReadbackN3({
      journal: [
        { accountId: ACCOUNT_ID, accountCode: "700-0310", debit: 99, credit: 0 },
        { accountCode: "WALKIN", debit: 0, credit: 100 },
      ],
    });
    const out = await createDeposit(baseInput(crypto.randomUUID()), { n3: client, env: ENV });
    expect(out.deposit.status).toBe("unknown");
    expect(out.deposit.lastErrorCode).toBe("n3_journal_readback_uncertain");
    expect(calls.create).toBe(1);
  });

  it.each(["detail", "journal"] as const)(
    "preserves unknown before revoking an expired %s read",
    async (read) => {
      const { client, calls } = receiptReadbackN3(
        read === "detail" ? { detailStatus: 401 } : { journalStatus: 401 },
      );
      await expect(
        createDeposit(baseInput(crypto.randomUUID()), { n3: client, env: ENV }),
      ).rejects.toMatchObject({ code: "unauthorized" });
      expect(tables.hotel_reservation_deposits[0]).toMatchObject({
        status: "unknown",
        n3_receipt_id: RECEIPT_ID,
      });
      expect(calls.create).toBe(1);
    },
  );

  it("blocks duplicate same-reference documents before Create", async () => {
    const { client, calls } = receiptReadbackN3({ discoveryDuplicates: true });
    const out = await createDeposit(baseInput(crypto.randomUUID()), { n3: client, env: ENV });
    expect(out.deposit.status).toBe("failed");
    expect(out.deposit.lastErrorCode).toBe("reference_conflict");
    expect(calls.create).toBe(0);
  });

  it("recovers by saved UUID using GET only after both financial checks pass", async () => {
    const fake = receiptReadbackN3({ journalStatus: 503 });
    const out = await createDeposit(baseInput(crypto.randomUUID()), { n3: fake.client, env: ENV });
    expect(out.deposit.status).toBe("unknown");
    fake.client.getGLPosting = receiptReadbackN3().client.getGLPosting;
    const recovered = await reconcileDeposit(
      {
        tenantId: TENANT,
        n3TenantKey: "tenant-key-1",
        reservationId: RESERVATION_ID,
        depositId: out.deposit.id,
        actorN3UserKey: "user-1",
        n3Token: "tok",
      },
      { n3: fake.client },
    );
    expect(recovered.status).toBe("posted");
    expect(fake.calls.create).toBe(1);
    expect(fake.calls.discovery).toBe(1);
    expect(fake.calls.detail).toBe(2);
  });
});

const postingExpectation = {
  identity: { n3ReceiptId: RECEIPT_ID, n3DocCode: "OR-100" },
  customerId: "1",
  customerCode: "WALKIN",
  referenceNo: "HH-0123456789abcdef01234567",
  currencyId: "1",
  currencyCode: "MYR",
  amount: 100,
  paymentLines: [
    { id: ACCOUNT_ID, code: "700-0310", name: "Maybank", kind: "bank" as const, amount: 100 },
  ],
};
const receiptDetail = {
  id: RECEIPT_ID,
  docCode: "OR-100",
  docType: "AROR",
  customerId: 1,
  referenceNo: "HH-0123456789abcdef01234567",
  currencyId: 1,
  currencyCode: "MYR",
  totalAmount: 100,
  outstandingAmount: 100,
  accountId: ACCOUNT_ID,
  isMultiPayment: false,
  knockoff: [],
};
const journalDetail = [
  { accountId: ACCOUNT_ID, accountCode: "700-0310", debit: 100, credit: 0 },
  { accountCode: "WALKIN", debit: 0, credit: 100 },
];
function n3Response(data: unknown, envelope: Record<string, unknown> = {}): N3Outcome {
  return {
    kind: "response",
    status: 200,
    durationMs: 1,
    body: { code: "0000", success: true, data, ...envelope },
  };
}

describe("deposit receipt evidence must agree", () => {
  it("rejects conflicting receipt account aliases", () => {
    expect(
      verifyReceiptDetail(
        n3Response({ ...receiptDetail, AccountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
        postingExpectation,
      ),
    ).toBe(false);
  });
  it("rejects malformed stored payment lines without throwing", () => {
    for (const line of [null, {}, { id: 1 }]) {
      const malformed = {
        ...postingExpectation,
        paymentLines: [line],
      } as unknown as typeof postingExpectation;
      expect(verifyReceiptDetail(n3Response(receiptDetail), malformed)).toBe(false);
      expect(verifyReceiptJournal(n3Response(journalDetail), malformed)).toBe(false);
    }
  });
  it("rejects conflicting journal identity or amount aliases", () => {
    for (const row of [
      { ...journalDetail[0], glAccountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { ...journalDetail[0], glAccountCode: "OTHER" },
      {
        ...journalDetail[0],
        account: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "OTHER" },
      },
      { ...journalDetail[0], debitAmount: 99 },
      { ...journalDetail[0], creditAmount: 50 },
    ])
      expect(verifyReceiptJournal(n3Response([row, journalDetail[1]]), postingExpectation)).toBe(
        false,
      );
  });
  it("rejects contradictory duplicate fields rather than accepting the first value", () => {
    expect(
      verifyReceiptDetail(
        n3Response({ ...receiptDetail, totalAmount: 100, netTotalAmount: 99 }),
        postingExpectation,
      ),
    ).toBe(false);
    expect(
      verifyReceiptDetail(
        n3Response({ ...receiptDetail, currency: { id: 2, code: "USD" } }),
        postingExpectation,
      ),
    ).toBe(false);
    expect(
      verifyReceiptDetail(
        n3Response({ ...receiptDetail, customer: { id: 2 } }),
        postingExpectation,
      ),
    ).toBe(false);
    expect(
      verifyReceiptDetail(
        n3Response({ ...receiptDetail, isCancelled: false, IsCancelled: true }),
        postingExpectation,
      ),
    ).toBe(false);
  });
  it("rejects contradictory envelope status even in alternate casing", () => {
    expect(
      verifyReceiptDetail(n3Response(receiptDetail, { Success: false }), postingExpectation),
    ).toBe(false);
    expect(
      verifyReceiptJournal(n3Response(journalDetail, { Success: false }), postingExpectation),
    ).toBe(false);
  });
  it("rejects non-finite or missing journal money, wrong banks and customer credits", () => {
    for (const rows of [
      [{ ...journalDetail[0], debit: NaN }, journalDetail[1]],
      [{ accountId: ACCOUNT_ID, debit: 100 }, journalDetail[1]],
      [
        { ...journalDetail[0], accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        journalDetail[1],
      ],
      [journalDetail[0], { ...journalDetail[1], accountCode: "OTHER" }],
      [...journalDetail, { accountCode: "EXTRA", debit: 0, credit: 0 }],
    ])
      expect(verifyReceiptJournal(n3Response(rows), postingExpectation)).toBe(false);
  });
  it("requires one unique exact-reference document with all identity fields", () => {
    for (const detail of [
      { ...receiptDetail, customerId: undefined },
      { ...receiptDetail, currencyId: undefined },
      { ...receiptDetail, currencyId: 2 },
    ])
      expect(matchExistingReceipt(n3Response({ value: [detail] }), postingExpectation)).toEqual({
        conflict: true,
      });
  });
  it("does not hide a duplicate reference behind conflicting field casing", () => {
    expect(
      matchExistingReceipt(
        n3Response({
          value: [
            receiptDetail,
            {
              ...receiptDetail,
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              referenceNo: "OTHER",
              ReferenceNo: postingExpectation.referenceNo,
            },
          ],
        }),
        postingExpectation,
      ),
    ).toEqual({ conflict: true });
  });
  it("checks each split debit and refuses duplicate or short-paid bank lines", () => {
    const bank2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const expected = {
      ...postingExpectation,
      paymentLines: [
        { ...postingExpectation.paymentLines[0], amount: 70 },
        { id: bank2, code: "700-0320", name: "Public Bank", kind: "bank" as const, amount: 30 },
      ],
    };
    const detail = {
      ...receiptDetail,
      isMultiPayment: true,
      multiPayments: [
        { accountId: ACCOUNT_ID, amount: 70 },
        { accountId: bank2, amount: 30 },
      ],
    };
    const journal = [
      { accountId: ACCOUNT_ID, accountCode: "700-0310", debit: 70, credit: 0 },
      { accountId: bank2, accountCode: "700-0320", debit: 30, credit: 0 },
      journalDetail[1],
    ];
    expect(verifyReceiptDetail(n3Response(detail), expected)).toBe(true);
    expect(verifyReceiptJournal(n3Response(journal), expected)).toBe(true);
    expect(
      verifyReceiptDetail(
        n3Response({
          ...detail,
          multiPayments: [detail.multiPayments[0], detail.multiPayments[0]],
        }),
        expected,
      ),
    ).toBe(false);
    expect(
      verifyReceiptDetail(
        n3Response({
          ...detail,
          multiPayments: [detail.multiPayments[0], { accountId: bank2, amount: 29 }],
        }),
        expected,
      ),
    ).toBe(false);
    expect(verifyReceiptJournal(n3Response([journal[0], journal[0], journal[2]]), expected)).toBe(
      false,
    );
    expect(
      verifyReceiptDetail(
        n3Response({
          ...detail,
          multiPayments: [
            { ...detail.multiPayments[0], AccountId: bank2 },
            detail.multiPayments[1],
          ],
        }),
        expected,
      ),
    ).toBe(false);
    expect(
      verifyReceiptDetail(
        n3Response({
          ...detail,
          multiPayments: [{ ...detail.multiPayments[0], Amount: 60 }, detail.multiPayments[1]],
        }),
        expected,
      ),
    ).toBe(false);
  });
});

describe("deposit currency must be proved before any financial side effect", () => {
  it("blocks a mismatched currency in the confirmation preview", async () => {
    const defaults = newDefaults();
    const { client } = makeN3({
      getNew: {
        ...defaults,
        body: {
          ...defaults.body,
          data: { ...defaults.body.data, currencyCode: "USD" },
        },
      },
    });
    await expect(
      buildDepositPreview(baseInput(crypto.randomUUID()), { n3: client, env: ENV }),
    ).rejects.toMatchObject({ code: "n3_defaults_invalid" });
  });
  it("never adopts a contradictory Create identity", () => {
    const outcome = n3Response({
      id: RECEIPT_ID,
      Id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      docCode: "OR-100",
    });
    expect(classifyCreateOutcome(outcome, postingExpectation).verdict).toBe("unknown");
  });
  it.each([undefined, "USD"])(
    "blocks missing or mismatched /New currency %s",
    async (currencyCode) => {
      const defaults = newDefaults();
      const { client, calls } = makeN3({
        getNew: {
          ...defaults,
          body: { ...defaults.body, data: { ...defaults.body.data, currencyCode } },
        },
      });
      await expect(
        createDeposit(baseInput(crypto.randomUUID()), { n3: client, env: ENV }),
      ).rejects.toMatchObject({ code: "n3_defaults_invalid" });
      expect(calls.create).toBe(0);
      expect(tables.hotel_reservation_deposits).toHaveLength(0);
    },
  );
});

describe("duplicate nested financial evidence", () => {
  it.each([
    { currency: { id: 1, code: "MYR" }, Currency: { id: 2, code: "USD" } },
    { customer: { id: 1 }, Customer: { id: 2 } },
  ])("rejects conflicting case-duplicate receipt objects %j", (fields) => {
    expect(
      verifyReceiptDetail(n3Response({ ...receiptDetail, ...fields }), postingExpectation),
    ).toBe(false);
  });
  it("rejects conflicting case-duplicate defaults currency before Create", async () => {
    const defaults = newDefaults();
    const { client, calls } = makeN3({
      getNew: {
        ...defaults,
        body: {
          ...defaults.body,
          data: {
            ...defaults.body.data,
            currency: { id: 1, code: "MYR" },
            Currency: { id: 2, code: "USD" },
          },
        },
      },
    });
    await expect(
      createDeposit(baseInput(crypto.randomUUID()), { n3: client, env: ENV }),
    ).rejects.toMatchObject({ code: "n3_defaults_invalid" });
    expect(calls.create).toBe(0);
  });
  it("rejects a conflicting duplicate split-payment array", () => {
    const bank2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const expected = {
      ...postingExpectation,
      paymentLines: [
        { ...postingExpectation.paymentLines[0], amount: 70 },
        { id: bank2, code: "700-0320", name: "Public Bank", kind: "bank" as const, amount: 30 },
      ],
    };
    const payments = [
      { accountId: ACCOUNT_ID, amount: 70 },
      { accountId: bank2, amount: 30 },
    ];
    expect(
      verifyReceiptDetail(
        n3Response({
          ...receiptDetail,
          isMultiPayment: true,
          multiPayments: payments,
          MultiPayments: [{ ...payments[0], amount: 69 }, payments[1]],
        }),
        expected,
      ),
    ).toBe(false);
  });
});

it("refuses a discovery identity with contradictory aliases", () => {
  expect(
    matchExistingReceipt(
      n3Response({ value: [{ ...receiptDetail, Id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }] }),
      postingExpectation,
    ),
  ).toEqual({ conflict: true });
});
