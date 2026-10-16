import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rawFixture from "./fixtures/receipt-single-payment-shape.json";
import { ReceiptControlError } from "../receipt-controls";
import type { HotelRole } from "../rbac";
import type { ChangePolicy } from "../hotel-change-controls";
import type { StoreDeps } from "../receipt-controls-store.server";
import type { ReceiptAutomationDb, AutomationRequestRow } from "../receipt-automation-store.server";
import type { ScopedDeposit } from "../receipt-controls-evidence.server";
import { readReceiptControlEvidence } from "../receipt-controls-evidence.server";
import { n3Receipts } from "../n3-receipts.server";
import { SCOPED_RECEIPT_UAT } from "../receipt-automation-gates.server";

// Acceptance of EXISTING production code, not live N3 acceptance. Only storage,
// session lookup and the external HTTP service are replaced. Real handlers,
// same-origin/body validation, creation, DTO capabilities, normal deps,
// coordinator, payload builder, journal parser and fixed N3 transport execute.
// Mutation sensitivity: changing Update to Create, omitting original binding,
// bypassing route-role/DTO-policy gates, accepting a corrupt detail, or resending an
// unknown attempt breaks the assertions below.
const state = vi.hoisted(() => ({
  role: "owner" as HotelRole,
  tenantId: "offline-tenant",
  n3TenantKey: "offline-test",
  base: null as StoreDeps | null,
  db: null as ReceiptAutomationDb | null,
  deposit: null as ScopedDeposit | null,
  row: null as AutomationRequestRow | null,
  policy: null as ChangePolicy | null,
  manualCreates: 0,
  afterReserve: null as (() => void) | null,
  beforeFinalValidation: null as (() => void) | null,
  freshCount: 0,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("../session-context.server", () => ({
  requirePermission: async (permission: string) => ({
    ctx: {
      role: state.role,
      session: { tenantId: state.tenantId, n3UserKey: state.role, n3Token: "offline-token" },
    },
    decision: {
      ok: state.role === "owner" || permission === "hotel:receipt_controls:request",
      reason: "forbidden",
    },
  }),
}));
vi.mock("../receipt-staff-authority.server", () => ({
  requireFreshReceiptActor: async (actor: { role: HotelRole; tenantId: string }) => {
    state.freshCount++;
    if (state.freshCount === 4) state.beforeFinalValidation?.();
    if (actor.role !== state.role || actor.tenantId !== state.tenantId)
      throw new ReceiptControlError("forbidden");
  },
}));
vi.mock("../audit.server", () => ({ logAudit: async () => {} }));
vi.mock("../receipt-alert-delivery.server", () => ({
  supabaseAlertDeliveryDb: () => ({}),
  deliverReceiptAlerts: async () => {},
}));
vi.mock("../receipt-controls-deps.server", () => ({
  defaultReceiptControlDeps: () => state.base!,
  loadDeposit: async () => state.deposit,
}));
vi.mock("../receipt-automation-store.server", () => ({
  supabaseReceiptAutomationDb: () => state.db!,
}));
vi.mock("../hotel-change-controls-store.server", () => ({
  readChangePolicy: async () => state.policy,
  requireFreshChangeOwner: async (actor: { role: HotelRole }) => {
    if (actor.role !== "owner") throw new ReceiptControlError("forbidden");
  },
  changeAdmin: async () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        maybeSingle: async () => ({
          error: null,
          data:
            table === "hotel_tenants"
              ? { n3_tenant_key: state.n3TenantKey }
              : state.row?.clientRequestId === filters.client_request_id
                ? { id: state.row!.id }
                : null,
        }),
      };
      return query;
    },
  }),
}));
import { Route as CreateRoute } from "../../routes/api/hotel/reservations.$id.deposits.$depositId.receipt-requests";
import { Route as DecisionRoute } from "../../routes/api/hotel/receipt-controls.$requestId.decision";
import { Route as CheckRoute } from "../../routes/api/hotel/receipt-controls.$requestId.check-result";

let reservationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let depositId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const clientRequestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let reference = "HH-0123456789abcdef01234567";
type Handler = (args: { request: Request; params: Record<string, string> }) => Promise<Response>;
type TestRoute = { options: { server: { handlers: Record<string, Handler> } } };
async function call(route: unknown, body: unknown, origin = "https://offline.invalid") {
  return (route as TestRoute).options.server.handlers.POST!({
    request: new Request("https://offline.invalid/api/hotel/receipt-test", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: reservationId, depositId, requestId },
  });
}
const createBody = (amount = 65) => ({
  clientRequestId,
  reason: "Disposable offline normal workflow acceptance",
  proposal: { kind: "correction", amount, accountId: rawFixture.accountId },
});
function fixture(
  options: {
    approval?: boolean;
    mode?: "success" | "lost" | "detail";
    scoped?: boolean;
    amount?: number;
  } = {},
) {
  let remote: Omit<typeof rawFixture, "referenceNo" | "remark3"> & {
    referenceNo: string;
    remark3: string | null;
  } = { ...structuredClone(rawFixture), referenceNo: reference };
  const traffic: Array<{ method: string; path: string; body?: typeof remote }> = [];
  if (options.scoped) {
    const scope = SCOPED_RECEIPT_UAT;
    remote.id = scope.receiptId;
    remote.docCode = scope.docCode;
    remote.docDate = scope.documentDate;
    remote.postDate = scope.documentDate;
    remote.taxDate = scope.documentDate;
    remote.customerId = Number(scope.customerId);
    remote.customer.id = Number(scope.customerId);
    remote.accountId = scope.accountId;
    remote.account.id = scope.accountId;
    remote.details[0]!.receiptId = scope.receiptId;
    remote.details[0]!.customerId = Number(scope.customerId);
    remote.details[0]!.customer.id = Number(scope.customerId);
  }
  if (options.scoped || options.amount !== undefined) {
    // Preserve the captured shape while setting every existing RM50 amount to
    // the selected synthetic starting amount; zero tax/charge fields stay zero.
    const setAmounts = (o: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(o)) {
        if (typeof value === "number" && value === 50) o[key] = options.amount ?? 70;
        else if (Array.isArray(value))
          value.forEach((v) => v && typeof v === "object" && setAmounts(v));
        else if (value && typeof value === "object") setAmounts(value as Record<string, unknown>);
      }
    };
    setAmounts(remote);
  }
  let effectiveCents = Math.round(remote.totalAmount * 100);
  let projections = 0;
  state.policy = {
    revision: "0",
    depositApprovalRequired: options.approval ?? false,
    contactApprovalRequired: false,
  };
  state.deposit = {
    id: depositId,
    reservationId,
    status: "posted",
    n3ReceiptId: remote.id,
    n3DocCode: remote.docCode,
    n3CustomerId: String(remote.customerId),
    n3CustomerCode: remote.customerCode,
    n3ReferenceNo: reference,
    currencyCode: "MYR",
    paymentLines: [
      {
        id: remote.accountId,
        code: remote.accountCode,
        name: "Offline bank",
        amount: remote.totalAmount,
      },
    ],
  };
  const copy = () => structuredClone(state.row!);
  state.db = {
    get: async () => (state.row ? copy() : null),
    create: async (actor, record, policy) => {
      state.row = {
        ...record,
        id: requestId,
        tenantId: actor.tenantId,
        kind: "correction",
        executionMode: "direct",
        generation: 2,
        state: "pending",
        version: 1,
        requestedBy: actor.n3UserKey,
        requestedAt: "2026-10-11T00:00:00Z",
        decidedBy: null,
        decidedAt: null,
        approvedBy: null,
        approvedAt: null,
        outcomeCode: null,
        automation: {
          generation: 2,
          policy,
          authorizationKind: null,
          authorizedAt: null,
          authorizedBy: null,
          categories: { deposit: true, contact: false },
        },
        attempt: null,
      };
      return copy();
    },
    authorize: async (_actor, _id, version, kind) => {
      if (state.row!.version !== version) throw new ReceiptControlError("version_conflict");
      if (kind === "direct_policy" && state.policy!.depositApprovalRequired)
        throw new ReceiptControlError("approval_required");
      state.row = {
        ...state.row!,
        state: "approved_awaiting_n3",
        version: version + 1,
        approvedAt: kind === "manual_approval" ? "now" : null,
        automation: {
          ...state.row!.automation!,
          authorizationKind: kind === "reject" ? null : kind,
          authorizedAt: "now",
          authorizedBy: "owner",
        },
      };
      return copy();
    },
    reserveDispatch: async (_actor, _id, version, payloadHash) => {
      if (state.row!.attempt) return { attempt: state.row!.attempt, dispatchGranted: false };
      if (state.row!.version !== version) throw new ReceiptControlError("version_conflict");
      state.row = {
        ...state.row!,
        state: "applying",
        version: version + 1,
        attempt: {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          claimedVersion: version + 1,
          payloadHash,
          phase: "reserved",
        },
      };
      state.afterReserve?.();
      return { attempt: state.row.attempt!, dispatchGranted: true };
    },
    hold: async (_actor, _id, _version, code) => {
      state.row = {
        ...state.row!,
        state: "needs_review",
        version: state.row!.version + 1,
        outcomeCode: code,
      };
      return copy();
    },
    settle: async (_actor, _id, _attempt, _claimed, version, result) => {
      if (state.row!.version !== version) throw new ReceiptControlError("claim_stale");
      if (result.kind === "verified") {
        effectiveCents = result.version.amountCents;
        projections++;
      }
      state.row = {
        ...state.row!,
        state: result.kind === "verified" ? "applied" : "needs_review",
        version: version + 1,
        attempt: {
          ...state.row!.attempt!,
          phase: result.kind === "verified" ? "confirmed" : "unknown",
        },
      };
      return copy();
    },
  };
  // Transaction behavior is simulated here. Native SQL concurrency/authorization
  // is separately covered by the existing PostgreSQL suite, not proven here.
  state.base = {
    db: {
      get: async () => (state.row ? copy() : null),
      create: async () => {
        state.manualCreates++;
        if (state.row) return copy();
        throw new Error("Unexpected manual request persistence");
      },
      decisions: async () => [],
      alerts: async () => [],
    } as unknown as StoreDeps["db"],
    readEvidence: (actor, id) =>
      readReceiptControlEvidence(actor, id, {
        loadDeposit: async () => state.deposit,
        n3: n3Receipts,
      }),
    walkInCustomerId: async () => String(remote.customerId),
    resolveAccount: async () => "Offline bank",
    labels: async () => new Map(),
    bookingRefs: async () => new Map([[reservationId, "BK-OFFLINE"]]),
    audit: async () => {},
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    // Never fall through to real network, even for unexpected URLs.
    expect(parsed.hostname).toBe("openapi.account.qne.cloud");
    const method = init.method!;
    if (method === "POST") {
      expect(parsed.pathname).toBe("/api/ARReceipts/Update");
      expect(parsed.searchParams.get("confirmedForBankRecon")).toBe("false");
      expect(parsed.searchParams.get("confirmedForKnockOff")).toBe("false");
      remote = JSON.parse(init.body as string) as typeof remote;
      traffic.push({ method, path: parsed.pathname, body: structuredClone(remote) });
      if (options.mode === "detail") remote.details[0]!.amount = 50;
      // Model the observed N3 single-payment behavior: child identity can change
      // while the SAME immutable parent receipt and preserved fields remain.
      remote.details[0]!.id = "66666666-6666-4666-8666-666666666666";
      if (options.mode === "lost") throw new TypeError("Synthetic lost reply after commit");
      return Response.json({ success: true, code: "0000", data: { id: remote.id } });
    }
    expect(method).toBe("GET");
    traffic.push({ method, path: parsed.pathname });
    if (parsed.pathname === "/api/AccountCodes/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
      return Response.json({
        success: true,
        code: "0000",
        data: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          code: "CASH-T",
          name: "Cash",
          accountType: { typeCode: "BCA" },
          specialCode: "CAC",
          isActive: true,
          hasChildren: false,
          currencyId: remote.currencyId,
        },
      });

    expect([`/api/ARReceipts/${remote.id}`, "/api/ARReceipts/GLPosting"]).toContain(
      parsed.pathname,
    );
    if (parsed.pathname.endsWith("GLPosting")) {
      expect(parsed.searchParams.get("key")).toBe(remote.id);
      return Response.json({
        success: true,
        code: "0000",
        data: [
          {
            docCode: null,
            referenceNo: reference,
            debit: remote.totalAmount,
            credit: 0,
            accountId: remote.accountId,
            account: remote.account,
          },
          {
            docCode: null,
            referenceNo: reference,
            debit: 0,
            credit: remote.totalAmount,
            accountId: null,
            account: null,
            customerId: remote.customerId,
            customer: remote.customer,
          },
        ],
      });
    }
    return Response.json({ success: true, code: "0000", data: remote });
  });
  return {
    traffic,
    posts: () => traffic.filter((r) => r.method === "POST"),
    projection: () => ({ effectiveCents, projections }),
    remote: () => remote,
  };
}
beforeEach(() => {
  state.role = "owner";
  state.tenantId = "offline-tenant";
  state.n3TenantKey = "offline-test";
  reservationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  depositId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  reference = "HH-0123456789abcdef01234567";
  state.row = null;
  state.manualCreates = 0;
  state.afterReserve = null;
  state.beforeFinalValidation = null;
  state.freshCount = 0;
  vi.stubEnv("HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED", "false");
  vi.stubEnv("HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT", "true");
  vi.stubEnv("HOTELHUB_RECEIPT_EXECUTION_BUDGET_MS", "10000");
  vi.stubEnv("HOTELHUB_N3_DEPOSIT_WRITES_ENABLED", "true");
  vi.stubEnv("HOTELHUB_N3_DEPOSIT_WRITE_TENANT_ALLOWLIST", "offline-test");
  vi.stubEnv("HOTELHUB_RECEIPT_EDIT_TENANT_ALLOWLIST", "offline-test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("ordinary receipt HTTP routes through normal fixed transport", () => {
  it.each([
    { before: 70, after: 60, approval: true },
    { before: 50, after: 51, approval: false },
  ])(
    "same-document source acceptance for $before → $after approval=$approval",
    async ({ before, after, approval }) => {
      const f = fixture({ approval, amount: before });
      state.role = "front_desk";
      const created = await call(CreateRoute, createBody(after));
      expect(created.status).toBe(201);
      if (approval) {
        expect((await created.json()).request.state).toBe("pending");
        expect(f.posts()).toHaveLength(0);
        state.role = "owner";
        expect(
          (await (await call(DecisionRoute, { expectedVersion: 1, decision: "approve" })).json())
            .outcome,
        ).toBe("applied");
      } else expect((await created.json()).outcome).toBe("applied");
      expect(f.posts()).toHaveLength(1);
      expect(f.posts()[0]!.body).toMatchObject({
        id: rawFixture.id,
        docCode: rawFixture.docCode,
        totalAmount: after,
      });
      expect(f.projection()).toEqual({ effectiveCents: after * 100, projections: 1 });
    },
  );

  it("approval-OFF saves single-payment33→30 and changed cash account in one verified Update", async () => {
    const f = fixture({ approval: false, amount: 33 });
    const body = createBody(30);
    body.proposal.accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const result = await call(CreateRoute, body);
    expect(await result.json()).toMatchObject({ outcome: "applied" });
    expect(f.posts()).toHaveLength(1);
    expect(f.posts()[0]!.body).toMatchObject({
      id: rawFixture.id,
      docCode: rawFixture.docCode,
      accountId: body.proposal.accountId,
      totalAmount: 30,
      accountCode: "CASH-T",
      details: [{ accountId: rawFixture.details[0]!.accountId, amount: 30 }],
    });
    expect(f.projection()).toEqual({ effectiveCents: 3000, projections: 1 });
    expect(state.manualCreates).toBe(0);
  });
  it("policy tightening during final fresh authority validation prevents Update", async () => {
    const f = fixture();
    state.beforeFinalValidation = () => {
      state.policy = { ...state.policy!, revision: "1", depositApprovalRequired: true };
    };
    const result = await call(CreateRoute, createBody());
    expect((await result.json()).outcome).toBe("needs_review");
    expect(f.posts()).toHaveLength(0);
    expect(f.projection()).toEqual({ effectiveCents: 5000, projections: 0 });
  });
  it("Owner policy-OFF Save change updates and independently verifies the SAME OR once", async () => {
    const f = fixture();
    const res = await call(CreateRoute, createBody());
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    expect(await res.json()).toMatchObject({
      outcome: "applied",
      code: "verified",
      request: { state: "applied" },
    });
    expect(f.projection()).toEqual({ effectiveCents: 6500, projections: 1 });
    expect(f.posts()).toHaveLength(1);
    expect(f.posts()[0]!.body).toMatchObject({
      id: rawFixture.id,
      docCode: rawFixture.docCode,
      referenceNo: reference,
      customerId: rawFixture.customerId,
      totalAmount: 65,
      isMultiPayment: false,
      email: rawFixture.email,
      address1: rawFixture.address1,
      details: [{ id: rawFixture.details[0]!.id, amount: 65, netAmount: 65 }],
    });
    const postIndex = f.traffic.findIndex((r) => r.method === "POST");
    expect(f.traffic.slice(postIndex + 1).map((r) => r.method)).toEqual(["GET", "GET", "GET"]);
    const replay = await call(CreateRoute, createBody());
    expect(replay.status).toBe(201);
    expect((await replay.json()).request.state).toBe("applied");
    expect(f.posts()).toHaveLength(1);
  });
  it.each(["owner", "front_desk"] as const)(
    "policy-ON %s request is pending until Owner approval",
    async (role) => {
      const f = fixture({ approval: true });
      state.role = role;
      expect((await call(CreateRoute, createBody())).status).toBe(201);
      expect(state.row!.state).toBe("pending");
      expect(f.posts()).toHaveLength(0);
      state.role = "owner";
      const approved = await call(DecisionRoute, { expectedVersion: 1, decision: "approve" });
      expect(approved.status).toBe(200);
      expect((await approved.json()).outcome).toBe("applied");
      expect(f.posts()).toHaveLength(1);
      expect(f.projection()).toEqual({ effectiveCents: 6500, projections: 1 });
      expect(state.row!.approvedAt).not.toBeNull();
    },
  );
  it("Front Desk policy-OFF Save executes same OR without Owner handoff", async () => {
    const f = fixture();
    state.role = "front_desk";
    const created = await call(CreateRoute, createBody());
    expect((await created.json()).request).toMatchObject({
      state: "applied",
      canApply: false,
      canApprove: false,
    });
    expect(f.projection()).toEqual({ effectiveCents: 6500, projections: 1 });
    const denied = await call(DecisionRoute, { expectedVersion: 1, decision: "approve" });
    expect(denied.status).toBe(403);
    expect(f.posts()).toHaveLength(1);
  });
  it("lost Update reply is held; repeated approval cannot resend and Check uses GET only", async () => {
    const f = fixture({ approval: true, mode: "lost" });
    await call(CreateRoute, createBody());
    const first = await call(DecisionRoute, { expectedVersion: 1, decision: "approve" });
    expect(await first.json()).toMatchObject({
      outcome: "needs_review",
      code: "n3_update_unknown",
    });
    expect(f.projection()).toEqual({ effectiveCents: 5000, projections: 0 });
    const repeated = await call(DecisionRoute, { expectedVersion: 1, decision: "approve" });
    expect(await repeated.json()).toMatchObject({
      outcome: "needs_review",
      code: "existing_attempt_check_result",
    });
    const before = f.traffic.length;
    const checked = await call(CheckRoute, {});
    expect(await checked.json()).toMatchObject({ outcome: "applied", code: "verified" });
    expect(f.traffic.slice(before).map((r) => r.method)).toEqual(["GET", "GET", "GET"]);
    expect(f.posts()).toHaveLength(1);
    expect(f.projection()).toEqual({ effectiveCents: 6500, projections: 1 });
    await call(CheckRoute, {});
    expect(f.projection().projections).toBe(1);
  });
  it("HTTP200 and balanced GL cannot override a corrupt payment detail", async () => {
    const f = fixture({ mode: "detail" });
    const result = await call(CreateRoute, createBody());
    expect(result.status).toBe(201);
    expect((await result.json()).outcome).toBe("needs_review");
    await call(CheckRoute, {});
    expect(f.posts()).toHaveLength(1);
    expect(f.projection()).toEqual({ effectiveCents: 5000, projections: 0 });
  });
  it("external edit after request blocks dispatch rather than overwriting it", async () => {
    const f = fixture({ approval: true });
    await call(CreateRoute, createBody());
    f.remote().remark3 = "Externally changed contact while request pending";
    const result = await call(DecisionRoute, { expectedVersion: 1, decision: "approve" });
    expect(await result.json()).toMatchObject({
      outcome: "needs_review",
      code: "n3_changed_since_request",
    });
    expect(f.posts()).toHaveLength(0);
  });
  it("preserves an external description change from the fresh pre-dispatch DTO", async () => {
    const f = fixture({ approval: true });
    await call(CreateRoute, createBody());
    f.remote().description = "Externally edited non-financial description";
    const result = await call(DecisionRoute, { expectedVersion: 1, decision: "approve" });
    expect((await result.json()).outcome).toBe("applied");
    expect(f.posts()[0]!.body!.description).toBe("Externally edited non-financial description");
    expect(f.remote().description).toBe("Externally edited non-financial description");
    expect(f.posts()).toHaveLength(1);
  });
  it("disabled runtime refuses approval and forged cross-site request never reaches N3", async () => {
    const f = fixture({ approval: true });
    await call(CreateRoute, createBody());
    vi.stubEnv("HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT", "false");
    const disabled = await call(DecisionRoute, { expectedVersion: 1, decision: "approve" });
    expect(disabled.status).toBe(409);
    expect(await disabled.json()).toEqual({ error: "automation_unavailable" });
    const before = f.traffic.length;
    expect((await call(CreateRoute, createBody(), "https://alien.invalid")).status).toBe(403);
    expect(f.traffic).toHaveLength(before);
    expect(f.posts()).toHaveLength(0);
  });
});

function scopedFixture(
  options: { approval?: boolean; mode?: "success" | "lost" | "detail"; amount?: number } = {},
) {
  const scope = SCOPED_RECEIPT_UAT;
  // Clock-only fake timers keep expiry deterministic; real execution timers run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T16:23:18+08:00"));
  state.tenantId = scope.tenantId;
  state.n3TenantKey = scope.n3TenantKey;
  reservationId = scope.reservationId;
  depositId = scope.depositId;
  reference = scope.reference;
  vi.stubEnv("HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT", "false");
  vi.stubEnv("HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED", "true");
  vi.stubEnv("HOTELHUB_N3_DEPOSIT_WRITE_TENANT_ALLOWLIST", scope.n3TenantKey);
  vi.stubEnv("HOTELHUB_RECEIPT_EDIT_TENANT_ALLOWLIST", scope.n3TenantKey);
  return fixture({ ...options, scoped: true });
}
const scopedBody = (amount = 85) => ({
  ...createBody(),
  proposal: { kind: "correction", amount, accountId: SCOPED_RECEIPT_UAT.accountId },
});
describe("dormant exact-receipt UAT through ordinary HTTP workflow", () => {
  it.each([
    [70, 85],
    [85, 70],
  ])("Owner Save verifies same receipt %i→%i while normal writer stays OFF", async (from, to) => {
    const f = scopedFixture({ amount: from });
    const res = await call(CreateRoute, scopedBody(to));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    expect(await res.json()).toMatchObject({ outcome: "applied", code: "verified" });
    expect(f.posts()).toHaveLength(1);
    expect(f.posts()[0]!.body).toMatchObject({
      id: SCOPED_RECEIPT_UAT.receiptId,
      docCode: SCOPED_RECEIPT_UAT.docCode,
      customerId: Number(SCOPED_RECEIPT_UAT.customerId),
      referenceNo: SCOPED_RECEIPT_UAT.reference,
      totalAmount: to,
    });
    expect(f.projection()).toEqual({ effectiveCents: to * 100, projections: 1 });
    expect(process.env.HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT).toBe("false");
  });
  it("Front Desk creates pending request, then only Owner approval dispatches", async () => {
    const f = scopedFixture({ approval: true });
    state.role = "front_desk";
    const created = await call(CreateRoute, scopedBody());
    expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
    expect((await created.json()).request).toMatchObject({
      state: "pending",
      canApply: false,
      canApprove: false,
    });
    expect(f.posts()).toHaveLength(0);
    state.role = "owner";
    expect((await call(DecisionRoute, { expectedVersion: 1, decision: "approve" })).status).toBe(
      200,
    );
    expect(f.posts()).toHaveLength(1);
    expect(f.projection().effectiveCents).toBe(8500);
  });
  it("rejects a wrong amount before saving a request or dispatching", async () => {
    const f = scopedFixture();
    const res = await call(CreateRoute, scopedBody(65));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "automation_unavailable" });
    expect(state.row).toBeNull();
    expect(f.posts()).toHaveLength(0);
  });
  it.each(["expiry", "disabled"])(
    "%s between request and approval blocks dispatch",
    async (mode) => {
      const f = scopedFixture({ approval: true });
      expect((await call(CreateRoute, scopedBody())).status).toBe(201);
      if (mode === "expiry") vi.setSystemTime(new Date(SCOPED_RECEIPT_UAT.expiresAt));
      else vi.stubEnv("HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED", "false");
      const res = await call(DecisionRoute, { expectedVersion: 1, decision: "approve" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "automation_unavailable" });
      expect(f.posts()).toHaveLength(0);
    },
  );
  it("lost reply recovers by GET after UAT is disabled, with no repeat Update", async () => {
    const f = scopedFixture({ mode: "lost" });
    const created = await call(CreateRoute, scopedBody());
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      outcome: "needs_review",
      code: "n3_update_unknown",
    });
    vi.stubEnv("HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED", "false");
    vi.setSystemTime(new Date(SCOPED_RECEIPT_UAT.expiresAt));
    const before = f.traffic.length;
    const checked = await call(CheckRoute, {});
    expect(checked.status).toBe(200);
    expect(await checked.json()).toMatchObject({ outcome: "applied", code: "verified" });
    expect(f.traffic.slice(before).every((r) => r.method === "GET")).toBe(true);
    expect(f.posts()).toHaveLength(1);
    expect(f.projection()).toEqual({ effectiveCents: 8500, projections: 1 });
  });
});

describe("scoped request creation and durable replay boundaries", () => {
  it.each(["expiry", "binding", "void"])(
    "new %s request for selected fixture cannot fall into manual creation",
    async (mode) => {
      const f = scopedFixture();
      if (mode === "expiry") vi.setSystemTime(new Date(SCOPED_RECEIPT_UAT.expiresAt));
      if (mode === "binding") state.deposit!.n3ReceiptId = rawFixture.id;
      const res = await call(
        CreateRoute,
        mode === "void" ? { ...scopedBody(), proposal: { kind: "void" } } : scopedBody(),
      );
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "automation_unavailable" });
      expect(state.manualCreates).toBe(0);
      expect(state.row).toBeNull();
      expect(f.posts()).toHaveLength(0);
    },
  );
  it.each(["pending", "applied", "unknown"])(
    "replays saved generation-2 %s after disable/expiry without changing workflow",
    async (status) => {
      const f = scopedFixture({
        approval: status === "pending",
        mode: status === "unknown" ? "lost" : "success",
      });
      expect((await call(CreateRoute, scopedBody())).status).toBe(201);
      const version = state.row!.version;
      vi.stubEnv("HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED", "false");
      vi.setSystemTime(new Date(SCOPED_RECEIPT_UAT.expiresAt));
      const before = f.traffic.length;
      const replay = await call(CreateRoute, scopedBody());
      expect(replay.status, JSON.stringify(await replay.clone().json())).toBe(201);
      expect((await replay.json()).request).toMatchObject({
        state: status === "unknown" ? "needs_review" : status,
        version,
        automation: { generation: 2 },
        canApply: false,
        canApprove: false,
        canCheckResult: status === "unknown",
      });
      expect(state.manualCreates).toBe(0);
      expect(f.traffic).toHaveLength(before);
    },
  );
  it("replays a saved generation-1 request while scoped lane is enabled, never upgrading it", async () => {
    const f = scopedFixture({ approval: true });
    await call(CreateRoute, scopedBody());
    state.row = { ...state.row!, generation: 1, executionMode: "manual", automation: null };
    const before = f.traffic.length;
    const replay = await call(CreateRoute, scopedBody());
    expect(replay.status).toBe(201);
    expect((await replay.json()).request).toMatchObject({
      state: "pending",
      executionMode: "manual",
      automation: null,
      canApply: false,
      canApprove: true,
      canCheckResult: false,
    });
    expect(state.row.generation).toBe(1);
    expect(f.traffic).toHaveLength(before);
    expect(f.posts()).toHaveLength(0);
  });
  it("second gate denies after durable reservation; replay cannot dispatch again", async () => {
    const f = scopedFixture();
    state.afterReserve = () => vi.stubEnv("HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED", "false");
    const result = await call(CreateRoute, scopedBody());
    expect(result.status).toBe(201);
    expect((await result.json()).outcome).toBe("needs_review");
    expect(state.row!.attempt).not.toBeNull();
    expect(f.posts()).toHaveLength(0);
    const replay = await call(CreateRoute, scopedBody());
    expect(replay.status).toBe(201);
    expect((await replay.json()).request.canCheckResult).toBe(true);
    expect(f.posts()).toHaveLength(0);
  });
});

describe("receipt POST replay body validation", () => {
  it("rejects an unknown field before replay lookup or any N3 read/write", async () => {
    const f = scopedFixture({ approval: true });
    await call(CreateRoute, scopedBody());
    const before = f.traffic.length;
    const res = await call(CreateRoute, { ...scopedBody(), extra: "not accepted" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
    expect(f.traffic).toHaveLength(before);
    expect(state.manualCreates).toBe(0);
    expect(f.posts()).toHaveLength(0);
  });
});
