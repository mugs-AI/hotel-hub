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

// ---------- audit sink ----------
const auditEvents: Array<{ eventType: string; detail?: any }> = [];
vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    auditEvents.push({ eventType: e.eventType, detail: e.detail });
  },
}));

// ---------- hotel settings ----------
vi.mock("@/lib/hotel-store.server", () => ({
  getOrCreateHotelSettings: async () => ({
    currency: "MYR",
    walkInCustomer: { n3Id: "cust-guid-1", n3Code: "WALKIN", n3Name: "Walk In Guest" },
  }),
}));

// ---------- supabaseAdmin stub ----------
type Row = Record<string, any>;
const tables: Record<string, Row[]> = { hotel_reservations: [], hotel_reservation_deposits: [] };

function makeBuilder(table: string) {
  const filters: Array<[string, any]> = [];
  let mode: "select" | "insert" | "update" = "select";
  let payload: Row | null = null;
  const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
  const builder: any = {
    select() {
      return builder;
    },
    eq(k: string, v: any) {
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
    then(resolve?: any) {
      let result: { data: any; error: any };
      if (mode === "insert") {
        const rows = tables[table]!;
        const dup = rows.some(
          (r) => payload!.idempotency_key && r.idempotency_key === payload!.idempotency_key,
        );
        if (dup) {
          result = { data: null, error: { code: "23505" } };
        } else {
          const row = {
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
      return resolve ? Promise.resolve(resolve(result)) : Promise.resolve(result);
    },
  };
  return builder;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => makeBuilder(t) },
}));

const {
  classifyPreflight,
  createDeposit,
  buildDepositPreview,
  reconcileDeposit,
  isRecoverableDepositStatus,
  DepositError,
} = await import("@/lib/deposits-store.server");

// ---------- N3 fake ----------
const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const ENV = {
  HOTELHUB_N3_DEPOSIT_WRITES_ENABLED: "true",
  HOTELHUB_N3_DEPOSIT_WRITE_TENANT_ALLOWLIST: "tenant-key-1",
};
const TENANT = "22222222-2222-4222-8222-222222222222";

function newDefaults() {
  return {
    kind: "response" as const,
    status: 200,
    body: {
      data: {
        id: "rcpt-new",
        accountId: "acc-guid-1",
        accountCode: "3000-000",
        accountName: "Maybank Current",
        currencyId: "cur-myr",
        docDate: "2026-01-01",
      },
    },
  };
}

function makeN3(overrides: Partial<Record<string, any>> = {}) {
  const calls = { getNew: 0, listByReference: 0, create: 0 };
  const client = {
    async getNew() {
      calls.getNew++;
      return overrides.getNew ?? newDefaults();
    },
    async listByReference() {
      calls.listByReference++;
      return overrides.listByReference ?? { kind: "response", status: 200, body: { data: { value: [] } } };
    },
    async create() {
      calls.create++;
      return overrides.create ?? { kind: "transport_error", reason: "timeout" };
    },
  } as any;
  return { client, calls };
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
  };
}

beforeEach(() => {
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
    customerId: "cust-guid-1",
    referenceNo: "HH-ABC",
    amount: 100,
    currencyId: "cur-myr",
  };

  it("transport failure is unavailable", () => {
    expect(
      classifyPreflight({ kind: "transport_error", reason: "timeout" } as any, expected).kind,
    ).toBe("unavailable");
  });
  it("5xx is unavailable", () => {
    expect(classifyPreflight({ kind: "response", status: 503, body: {} } as any, expected).kind).toBe(
      "unavailable",
    );
  });
  it("401 is unauthorized", () => {
    expect(classifyPreflight({ kind: "response", status: 401, body: {} } as any, expected).kind).toBe(
      "unauthorized",
    );
  });
  it("unreadable (non-list) body is unavailable, not zero-match", () => {
    expect(
      classifyPreflight({ kind: "response", status: 200, body: { data: {} } } as any, expected).kind,
    ).toBe("unavailable");
  });
  it("readable empty page is a zero match", () => {
    expect(
      classifyPreflight(
        { kind: "response", status: 200, body: { data: { value: [] } } } as any,
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
      create: { kind: "response", status: 200, body: { data: { id: "r1", docNo: "OR-1" } } },
    });
    const id = crypto.randomUUID();
    await createDeposit(baseInput(id), { n3: client, env: ENV });
    const second = await createDeposit(baseInput(id), { n3: client, env: ENV });
    expect(second.reused).toBe(true);
    expect(calls.create).toBe(1);
  });

  it("concurrent duplicates still result in one N3 create", async () => {
    const { client, calls } = makeN3({
      create: { kind: "response", status: 200, body: { data: { id: "r1", docNo: "OR-1" } } },
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
      n3_customer_id: "cust-guid-1",
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
      },
      { n3: client, env: ENV },
    );
    expect(calls.create).toBe(0);
    expect(preview.bookingReference).toBe("BK-0001");
    expect(preview.customerLabel).toBe("Walk In Guest");
    expect(preview.accountLabel).toBe("3000-000 — Maybank Current");
    expect(preview.warning).toContain("real accounting document");
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain("cust-guid-1");
    expect(serialized).not.toContain("acc-guid-1");
    expect(serialized).not.toContain("tok");
  });
});
