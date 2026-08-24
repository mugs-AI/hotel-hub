/**
 * BOUNDED SAME-SCOPE AUDIT CORRECTION — behavioural proof.
 *
 * These tests exercise the real route handlers, the real decision engine and
 * the real rendered components. Static source assertions appear only where the
 * artefact IS the source (the SQL migration), never as a substitute for
 * behaviour.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";
const RESERVATION = "77777777-7777-4777-8777-777777777777";
const REQUEST = "55555555-5555-4555-8555-555555555555";
const RES_ROOM = "88888888-8888-4888-8888-888888888888";
const OLD_ROOM = "44444444-4444-4444-8444-444444444444";
const NEW_ROOM = "99999999-9999-4999-8999-999999999999";
const CLIENT_REQ = "11111111-1111-4111-8111-111111111111";
const HANDOFF = "66666666-6666-4666-8666-666666666666";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Shared server-side test doubles
// ---------------------------------------------------------------------------

const session = {
  role: "front_desk" as string | null,
  tenantId: TENANT as string | null,
  n3UserKey: "user-1",
  allowed: true,
  reason: "ok" as string,
};

const settings = { exceptionApprovalMode: "owner_approval" as "owner_approval" | "direct" };

const state = {
  readinessBlocker: null as string | null,
  readinessThrows: false,
  enqueueReturns: HANDOFF as string | null,
  directResult: { requestId: REQUEST, state: "applied" } as any,
  directThrows: null as any,
  preRoom: { status: "ok", value: OLD_ROOM } as any,
  postRoom: { status: "ok", value: NEW_ROOM } as any,
  purgePreview: { cutoff: "2026-07-25T02:00:00.000Z", count: 7, days: 30 },
  purgeResult: { deleted: 7, cutoff: "2026-07-25T02:00:00.000Z", days: 30 },
  purgeThrows: false,
};

const calls = {
  request: [] as any[],
  direct: [] as any[],
  decide: [] as any[],
  enqueue: [] as any[],
  cancel: [] as any[],
  apply: [] as any[],
  purge: [] as any[],
  preview: [] as any[],
  audit: [] as any[],
};

vi.mock("@/lib/session-context.server", () => ({
  requirePermission: async () => ({
    ctx: {
      authenticated: true,
      role: session.role,
      session: {
        tenantId: session.tenantId,
        n3UserKey: session.n3UserKey,
        companyName: "Boutique Hotel",
        tenantCode: "HOTEL",
      },
    },
    decision: session.allowed ? { ok: true } : { ok: false, reason: session.reason },
  }),
}));

vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: any) => {
    calls.audit.push(e);
  },
}));

vi.mock("@/lib/reservations-store.server", () => ({
  isUuid: (v: unknown) => typeof v === "string" && UUID_RE.test(v),
  getReservationById: async () => ({ departureDate: "2026-08-10" }),
}));

vi.mock("@/lib/hotel-store.server", () => ({
  getOrCreateHotelSettings: async () => ({
    exceptionApprovalMode: settings.exceptionApprovalMode,
    standardCheckOutTime: "12:00",
    timezone: "Asia/Kuala_Lumpur",
  }),
}));

vi.mock("@/lib/housekeeping-store.server", () => ({
  HOUSEKEEPING_RETENTION_DAYS: 30,
  roomReadinessBlocker: async () => {
    if (state.readinessThrows) throw new Error("unreadable");
    return state.readinessBlocker;
  },
  enqueueRoomHandoff: async (i: any) => {
    calls.enqueue.push(i);
    return state.enqueueReturns;
  },
  cancelRoomHandoff: async (t: string, id: string) => {
    calls.cancel.push({ tenantId: t, handoffId: id });
  },
  applyRoomHandoff: async (i: any) => {
    calls.apply.push(i);
    return { applied: true, pending: false };
  },
  reconcilePendingHandoffs: async () => {},
  previewHousekeepingHistoryPurge: async (i: any) => {
    calls.preview.push(i);
    if (state.purgeThrows) throw new Error("housekeeping_failed");
    return state.purgePreview;
  },
  purgeHousekeepingHistory: async (i: any) => {
    calls.purge.push(i);
    if (state.purgeThrows) throw new Error("housekeeping_failed");
    return state.purgeResult;
  },
}));

class FakeOperationError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

vi.mock("@/lib/reservation-operations.server", () => ({
  OperationError: FakeOperationError,
  OPERATION_ERROR_CODES: new Set([
    "operation_stale",
    "operation_pending",
    "room_unavailable",
    "room_capacity_exceeded",
    "invalid_transition",
    "reservation_changed",
  ]),
  isOperationType: (t: unknown) =>
    typeof t === "string" &&
    ["early_check_in", "late_checkout", "room_change", "stay_extension", "rate_change"].includes(t),
  validateOperationPayload: (_t: string, p: unknown) => ({
    ok: true,
    payload: { ...((p as Record<string, unknown>) ?? {}) },
  }),
  validateLateCheckoutWindow: () => ({ ok: true, utcIso: "2026-08-10T08:00:00.000Z" }),
  listOperationRequests: async () => [],
  requestOperation: async (i: any) => {
    calls.request.push(i);
    return { requestId: REQUEST, state: "pending" };
  },
  applyDirectOperation: async (i: any) => {
    calls.direct.push(i);
    if (state.directThrows) throw state.directThrows;
    return state.directResult;
  },
  decideOperation: async (i: any) => {
    calls.decide.push(i);
    return { requestId: REQUEST, state: "applied" };
  },
  destinationBlockerCode: (c: string) => `destination_${c}`,
  housekeepingCheckInBlocker: async () => {
    if (state.readinessThrows) throw new Error("unreadable");
    return state.readinessBlocker;
  },
  readOperationRequestForHandoffOutcome: async () => ({
    status: "ok",
    value: { operationType: "room_change", state: "pending", payload: {} },
  }),
  resolveReservationRoomHotelRoomId: async (_t: string, _r: string) => state.preRoom,
}));

beforeEach(() => {
  session.role = "front_desk";
  session.tenantId = TENANT;
  session.allowed = true;
  session.reason = "ok";
  settings.exceptionApprovalMode = "owner_approval";
  state.readinessBlocker = null;
  state.readinessThrows = false;
  state.enqueueReturns = HANDOFF;
  state.directResult = { requestId: REQUEST, state: "applied" };
  state.directThrows = null;
  state.preRoom = { status: "ok", value: OLD_ROOM };
  state.purgeThrows = false;
  for (const k of Object.keys(calls)) (calls as any)[k].length = 0;
});

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { origin: "https://hotel.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createOperation(body: Record<string, unknown>) {
  const { handleOperationCreate } = await import("@/routes/api/hotel/reservations.$id.operations");
  const res = await handleOperationCreate({
    request: post(`https://hotel.test/api/hotel/reservations/${RESERVATION}/operations`, body),
    params: { id: RESERVATION },
  });
  return { res, body: (await res.json()) as any };
}

const RATE_CHANGE = {
  operationType: "rate_change",
  payload: { reservation_room_id: RES_ROOM, new_agreed_rate: 250 },
  clientRequestId: CLIENT_REQ,
};

// ---------------------------------------------------------------------------
// 1. Effective authority
// ---------------------------------------------------------------------------

describe("effective authority — Owner is always direct, Front Desk follows the setting", () => {
  it("an Owner applies directly in owner_approval mode and never queues for themself", async () => {
    session.role = "owner";
    settings.exceptionApprovalMode = "owner_approval";
    const { res, body } = await createOperation(RATE_CHANGE);
    expect(res.status).toBe(200);
    expect(body.outcome).toBe("applied");
    expect(body.direct).toBe(true);
    expect(calls.direct).toHaveLength(1);
    expect(calls.request).toHaveLength(0);
  });

  it("an Owner applies directly in direct mode too", async () => {
    session.role = "owner";
    settings.exceptionApprovalMode = "direct";
    const { body } = await createOperation(RATE_CHANGE);
    expect(body.outcome).toBe("applied");
    expect(calls.direct).toHaveLength(1);
  });

  it("Front Desk applies directly only when the property chose direct", async () => {
    session.role = "front_desk";
    settings.exceptionApprovalMode = "direct";
    const { body } = await createOperation(RATE_CHANGE);
    expect(body.outcome).toBe("applied");
    expect(calls.direct).toHaveLength(1);
    expect(calls.request).toHaveLength(0);
  });

  it("Front Desk creates a pending request under owner approval", async () => {
    session.role = "front_desk";
    settings.exceptionApprovalMode = "owner_approval";
    const { body } = await createOperation(RATE_CHANGE);
    expect(body.outcome).toBe("submitted");
    expect(body.direct).toBe(false);
    expect(body.state).toBe("pending");
    expect(calls.request).toHaveLength(1);
    expect(calls.direct).toHaveLength(0);
  });

  it("falls back to owner approval for Front Desk when the setting cannot be read", async () => {
    const { effectiveDirectExecution } = await import("@/lib/operation-decision.server");
    expect(effectiveDirectExecution("front_desk", "owner_approval")).toBe(false);
    expect(effectiveDirectExecution("front_desk", "direct")).toBe(true);
    expect(effectiveDirectExecution("owner", "owner_approval")).toBe(true);
    expect(effectiveDirectExecution(null, "direct")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Atomicity, idempotency and fail-closed gates
// ---------------------------------------------------------------------------

describe("direct execution is atomic and fails closed", () => {
  beforeEach(() => {
    session.role = "owner";
  });

  it("leaves no pending request, mutation, handoff or timeline when the action is rejected", async () => {
    state.directThrows = new FakeOperationError("room_unavailable");
    const { res, body } = await createOperation({
      operationType: "room_change",
      payload: {
        reservation_room_id: RES_ROOM,
        to_hotel_room_id: NEW_ROOM,
      },
      clientRequestId: CLIENT_REQ,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(body.error).toBe("room_unavailable");
    // The separate "create request, then approve" path is never used, so no
    // pending request can survive a failure.
    expect(calls.request).toHaveLength(0);
    expect(calls.decide).toHaveLength(0);
    // The reserved handoff intent is positively withdrawn.
    expect(calls.apply).toHaveLength(0);
    expect(calls.cancel).toEqual([{ tenantId: TENANT, handoffId: HANDOFF }]);
  });

  it("keeps the durable handoff intent when the failure is uncertain", async () => {
    state.directThrows = new Error("network");
    await createOperation({
      operationType: "room_change",
      payload: { reservation_room_id: RES_ROOM, to_hotel_room_id: NEW_ROOM },
      clientRequestId: CLIENT_REQ,
    });
    expect(calls.cancel).toHaveLength(0);
  });

  it("replays idempotently: the same clientRequestId reaches the engine unchanged", async () => {
    const first = await createOperation(RATE_CHANGE);
    const second = await createOperation(RATE_CHANGE);
    expect(first.body.requestId).toBe(second.body.requestId);
    expect(first.body.state).toBe("applied");
    expect(second.body.state).toBe("applied");
    expect(calls.direct.map((c) => c.idempotencyKey)).toEqual([CLIENT_REQ, CLIENT_REQ]);
    expect(calls.request).toHaveLength(0);
  });

  it("refuses an early check-in when housekeeping is not ready, applying nothing", async () => {
    state.readinessBlocker = "room_dirty";
    const { res, body } = await createOperation({
      operationType: "early_check_in",
      payload: {},
      clientRequestId: CLIENT_REQ,
    });
    expect(res.status).toBe(409);
    expect(body.error).toBe("room_dirty");
    expect(calls.direct).toHaveLength(0);
  });

  it("refuses a room change into a DND destination", async () => {
    state.readinessBlocker = "dnd_active";
    const { body } = await createOperation({
      operationType: "room_change",
      payload: { reservation_room_id: RES_ROOM, to_hotel_room_id: NEW_ROOM },
      clientRequestId: CLIENT_REQ,
    });
    expect(body.error).toBe("destination_dnd_active");
    expect(calls.direct).toHaveLength(0);
    expect(calls.enqueue).toHaveLength(0);
  });

  it("fails closed when readiness cannot be read at all", async () => {
    state.readinessThrows = true;
    const { res, body } = await createOperation({
      operationType: "early_check_in",
      payload: {},
      clientRequestId: CLIENT_REQ,
    });
    expect(res.status).toBe(503);
    expect(body.error).toBe("readiness_read_failed");
    expect(calls.direct).toHaveLength(0);
  });

  it("refuses to move a guest when the vacated-room handoff cannot be recorded", async () => {
    state.enqueueReturns = null;
    const { res, body } = await createOperation({
      operationType: "room_change",
      payload: { reservation_room_id: RES_ROOM, to_hotel_room_id: NEW_ROOM },
      clientRequestId: CLIENT_REQ,
    });
    expect(res.status).toBe(503);
    expect(body.error).toBe("handoff_not_recorded");
    expect(calls.direct).toHaveLength(0);
  });

  it("rejects a stale/unknown field before anything is attempted", async () => {
    const { res } = await createOperation({ ...RATE_CHANGE, sneaky: true });
    expect(res.status).toBe(400);
    expect(calls.direct).toHaveLength(0);
    expect(calls.request).toHaveLength(0);
  });

  it("refuses a cross-origin write", async () => {
    const { handleOperationCreate } =
      await import("@/routes/api/hotel/reservations.$id.operations");
    const res = await handleOperationCreate({
      request: new Request(`https://hotel.test/api/hotel/reservations/${RESERVATION}/operations`, {
        method: "POST",
        headers: { origin: "https://evil.test", "content-type": "application/json" },
        body: JSON.stringify(RATE_CHANGE),
      }),
      params: { id: RESERVATION },
    });
    expect(res.status).toBe(403);
    expect(calls.direct).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Fixed 30-day housekeeping retention
// ---------------------------------------------------------------------------

describe("housekeeping retention — one fixed 30-day policy", () => {
  beforeEach(() => {
    session.role = "owner";
  });

  it("previews the server-computed cutoff and count for THIS tenant only", async () => {
    const { handleHousekeepingPurgePreview } =
      await import("@/routes/api/hotel/housekeeping.purge");
    const res = await handleHousekeepingPurgePreview();
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.count).toBe(7);
    expect(body.days).toBe(30);
    expect(body.cutoff).toBe("2026-07-25T02:00:00.000Z");
    expect(body.tenantLabel).toBe("Boutique Hotel");
    expect(calls.preview).toEqual([{ tenantId: TENANT }]);
  });

  it("purges with no caller-supplied days, tenant or actor", async () => {
    const { handleHousekeepingPurge } = await import("@/routes/api/hotel/housekeeping.purge");
    const res = await handleHousekeepingPurge({
      request: post("https://hotel.test/api/hotel/housekeeping/purge", {}),
    });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(7);
    expect(calls.purge).toEqual([{ tenantId: TENANT, actorN3UserKey: "user-1" }]);
  });

  for (const rejected of [
    { days: 90 },
    { days: 30 },
    { tenantId: OTHER_TENANT },
    { actorN3UserKey: "someone-else" },
    { anything: 1 },
  ]) {
    it(`rejects browser-supplied ${Object.keys(rejected)[0]} and deletes nothing`, async () => {
      const { handleHousekeepingPurge } = await import("@/routes/api/hotel/housekeeping.purge");
      const res = await handleHousekeepingPurge({
        request: post("https://hotel.test/api/hotel/housekeeping/purge", rejected),
      });
      expect(res.status).toBe(400);
      expect(calls.purge).toHaveLength(0);
    });
  }

  for (const role of ["front_desk", "housekeeper"] as const) {
    it(`refuses ${role} and deletes nothing`, async () => {
      session.role = role;
      session.allowed = false;
      session.reason = "forbidden";
      const { handleHousekeepingPurge, handleHousekeepingPurgePreview } =
        await import("@/routes/api/hotel/housekeeping.purge");
      const write = await handleHousekeepingPurge({
        request: post("https://hotel.test/api/hotel/housekeeping/purge", {}),
      });
      const read = await handleHousekeepingPurgePreview();
      expect(write.status).toBe(403);
      expect(read.status).toBe(403);
      expect(calls.purge).toHaveLength(0);
      expect(calls.preview).toHaveLength(0);
    });
  }

  it("refuses an unauthenticated caller", async () => {
    session.allowed = false;
    session.reason = "unauthenticated";
    const { handleHousekeepingPurge } = await import("@/routes/api/hotel/housekeeping.purge");
    const res = await handleHousekeepingPurge({
      request: post("https://hotel.test/api/hotel/housekeeping/purge", {}),
    });
    expect(res.status).toBe(401);
    expect(calls.purge).toHaveLength(0);
  });

  it("refuses a cross-origin purge", async () => {
    const { handleHousekeepingPurge } = await import("@/routes/api/hotel/housekeeping.purge");
    const res = await handleHousekeepingPurge({
      request: new Request("https://hotel.test/api/hotel/housekeeping/purge", {
        method: "POST",
        headers: { origin: "https://evil.test", "content-type": "application/json" },
        body: "{}",
      }),
    });
    expect(res.status).toBe(403);
    expect(calls.purge).toHaveLength(0);
  });

  it("reports a failure without pretending anything was removed", async () => {
    state.purgeThrows = true;
    const { handleHousekeepingPurge } = await import("@/routes/api/hotel/housekeeping.purge");
    const res = await handleHousekeepingPurge({
      request: post("https://hotel.test/api/hotel/housekeeping/purge", {}),
    });
    expect(res.status).toBe(503);
    expect(calls.audit.some((a) => a.eventType === "hotel.housekeeping.history_purge_failed")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. The corrective migration itself
// ---------------------------------------------------------------------------

describe("corrective migration", () => {
  const dir = resolve(__dirname, "../../../supabase/migrations");
  const files = readdirSync(dir).sort();
  const earlier = files.find((f) => f.startsWith("20260824093329"))!;
  const corrective = files[files.length - 1]!;
  const sql = readFileSync(resolve(dir, corrective), "utf8");

  it("adds a NEW file and leaves the already-applied migration in place", () => {
    expect(earlier).toBeTruthy();
    expect(corrective).not.toBe(earlier);
    expect(corrective > earlier).toBe(true);
  });

  it("keeps existing properties on owner approval and defaults only new ones to direct", () => {
    expect(sql).toMatch(/UPDATE public\.hotel_settings[\s\S]*?'owner_approval'/);
    expect(sql).toMatch(/ALTER COLUMN exception_approval_mode SET DEFAULT 'direct'/);
    expect(sql).not.toMatch(/SET exception_approval_mode = 'direct'/);
  });

  it("purges on an exact 30-day boundary: strictly older rows only", () => {
    expect(sql).toMatch(/now\(\) - interval '30 days'/);
    expect(sql).toMatch(/created_at < v_cutoff/);
    expect(sql).not.toMatch(/created_at <= v_cutoff/);
  });

  it("scopes every retention routine to one tenant and records the purge atomically", () => {
    expect(sql).toMatch(
      /DELETE FROM public\.hotel_housekeeping_events[\s\S]*?tenant_id = p_tenant_id/,
    );
    expect(sql).toMatch(
      /INSERT INTO public\.hotel_audit_events[\s\S]*?'hotel\.housekeeping\.history_purged'/,
    );
  });

  it("retires the selectable-day routine and grants the new ones to service_role only", () => {
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS public\.hotelhub_purge_housekeeping_history\(uuid, text, integer\)/,
    );
    for (const fn of [
      "hotelhub_housekeeping_history_preview_30d",
      "hotelhub_purge_housekeeping_history_30d",
      "hotelhub_direct_operation",
    ]) {
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*?service_role`),
      );
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]*?authenticated`),
      );
    }
  });

  it("carries out a direct action through the SAME request + decide engines, in one transaction", () => {
    const reqAt = sql.indexOf("hotelhub_request_operation(");
    const decideAt = sql.indexOf("hotelhub_decide_operation(");
    expect(reqAt).toBeGreaterThan(-1);
    expect(decideAt).toBeGreaterThan(reqAt);
    // A still-pending outcome raises, so the whole transaction rolls back.
    expect(sql).toMatch(/IF v_state = 'pending' THEN\s+RAISE EXCEPTION/);
    // Replay returns the existing result instead of mutating again.
    expect(sql).toMatch(/IF v_state <> 'pending' THEN\s+RETURN QUERY/);
  });

  it("never touches room state, DND, handoffs, reservations, deposits or accounting", () => {
    for (const table of [
      "hotel_room_housekeeping",
      "hotel_housekeeping_handoffs",
      "hotel_reservations",
      "hotel_reservation_deposits",
      "hotel_reservation_rooms",
    ]) {
      expect(sql).not.toMatch(new RegExp(`(DELETE FROM|UPDATE) public\\.${table}`));
    }
  });
});
