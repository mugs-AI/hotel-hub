/**
 * WP1 CORRECTION 5 — the room-change decision route must fail CLOSED whenever
 * an authoritative server read it depends on is unreadable or missing, and it
 * must never destroy the durable handoff retry record on uncertainty.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "22222222-2222-4222-8222-222222222222";
const RESERVATION = "77777777-7777-4777-8777-777777777777";
const REQUEST = "55555555-5555-4555-8555-555555555555";
const RES_ROOM = "88888888-8888-4888-8888-888888888888";
const OLD_ROOM = "44444444-4444-4444-8444-444444444444";
const NEW_ROOM = "99999999-9999-4999-8999-999999999999";
const CLIENT_REQ = "11111111-1111-4111-8111-111111111111";
const HANDOFF = "66666666-6666-4666-8666-666666666666";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Outcome<T> = { status: "ok"; value: T } | { status: "missing" } | { status: "error" };

const state = {
  detail: { status: "ok", value: { operationType: "room_change", state: "pending", payload: {} } } as Outcome<any>,
  preRoom: { status: "ok", value: OLD_ROOM } as Outcome<string | null>,
  postRoom: { status: "ok", value: NEW_ROOM } as Outcome<string | null>,
  boundReservationId: RESERVATION as string | null,
  decisionResult: { requestId: REQUEST, state: "applied" } as any,
  enqueueThrows: false,
  enqueueReturns: HANDOFF as string | null,
};

const calls = {
  decide: [] as any[],
  apply: [] as any[],
  cancel: [] as any[],
  enqueue: [] as any[],
  reconcile: [] as any[],
};

vi.mock("@/lib/session-context.server", () => ({
  requirePermission: async () => ({
    ctx: { session: { tenantId: TENANT, n3UserKey: "user-1" } },
    decision: { ok: true },
  }),
}));

vi.mock("@/lib/audit.server", () => ({ logAudit: async () => {} }));

vi.mock("@/lib/reservations-store.server", () => ({
  isUuid: (v: unknown) => typeof v === "string" && UUID_RE.test(v),
}));

vi.mock("@/lib/reservation-operations.server", () => ({
  OperationError: class OperationError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  OPERATION_ERROR_CODES: new Set(["operation_decision_failed"]),
  destinationBlockerCode: (c: string) => `destination_${c}`,
  housekeepingCheckInBlocker: async () => null,
  getOperationRequestReservationId: async () => state.boundReservationId,
  readOperationRequestForHandoffOutcome: async () => state.detail,
  resolveReservationRoomHotelRoomId: async () => {
    // First call is pre-decision, later calls are post-decision.
    return calls.decide.length === 0 ? state.preRoom : state.postRoom;
  },
  decideOperation: async (input: any) => {
    calls.decide.push(input);
    return state.decisionResult;
  },
}));

vi.mock("@/lib/housekeeping-store.server", () => ({
  roomReadinessBlocker: async () => null,
  enqueueRoomHandoff: async (input: any) => {
    calls.enqueue.push(input);
    if (state.enqueueThrows) throw new Error("db down");
    return state.enqueueReturns;
  },
  applyRoomHandoff: async (input: any) => {
    calls.apply.push(input);
    return { applied: true, pending: false };
  },
  cancelRoomHandoff: async (...args: any[]) => {
    calls.cancel.push(args);
  },
  reconcilePendingHandoffs: async (...args: any[]) => {
    calls.reconcile.push(args);
  },
}));

const { handleOperationDecision } = await import(
  "@/routes/api/hotel/reservations.$id.operations.$requestId.decision"
);

function post(payload: Record<string, unknown> = {}) {
  return new Request("https://app.test/api/hotel/reservations/x/operations/y/decision", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve", clientRequestId: CLIENT_REQ, ...payload }),
  });
}

async function run(payload: Record<string, unknown> = {}) {
  const res = await handleOperationDecision({
    request: post(payload),
    params: { id: RESERVATION, requestId: REQUEST },
  });
  const body = await res.clone().json();
  return { res, body };
}

function roomChangeDetail(): Outcome<any> {
  return {
    status: "ok",
    value: {
      operationType: "room_change",
      state: "pending",
      payload: { to_hotel_room_id: NEW_ROOM, reservation_room_id: RES_ROOM },
    },
  };
}

beforeEach(() => {
  calls.decide = [];
  calls.apply = [];
  calls.cancel = [];
  calls.enqueue = [];
  calls.reconcile = [];
  state.detail = roomChangeDetail();
  state.preRoom = { status: "ok", value: OLD_ROOM };
  state.postRoom = { status: "ok", value: NEW_ROOM };
  state.boundReservationId = RESERVATION;
  state.decisionResult = { requestId: REQUEST, state: "applied" };
  state.enqueueThrows = false;
  state.enqueueReturns = HANDOFF;
});

describe("A/B — pre-decision operation detail read", () => {
  it("A. database read error fails closed and never decides", async () => {
    state.detail = { status: "error" };
    const { res, body } = await run();
    expect(res.status).toBe(503);
    expect(body.error).toBe("operation_read_failed");
    expect(calls.decide).toHaveLength(0);
  });

  it("B. operation missing after binding fails closed and never decides", async () => {
    state.detail = { status: "missing" };
    const { res, body } = await run();
    expect(res.status).toBe(404);
    expect(body.error).toBe("operation_not_found");
    expect(calls.decide).toHaveLength(0);
  });

  it("C. pending early_check_in with an unreadable detail applies nothing", async () => {
    state.detail = { status: "error" };
    const { res } = await run();
    expect(res.status).toBe(503);
    expect(calls.decide).toHaveLength(0);
    expect(calls.apply).toHaveLength(0);

    state.detail = { status: "missing" };
    const second = await run();
    expect(second.res.status).toBe(404);
    expect(calls.decide).toHaveLength(0);
    expect(calls.apply).toHaveLength(0);
  });

  it("still runs the readiness gate for a valid pending early_check_in", async () => {
    state.detail = {
      status: "ok",
      value: { operationType: "early_check_in", state: "pending", payload: {} },
    };
    const { res } = await run();
    expect(res.status).toBe(200);
    expect(calls.decide).toHaveLength(1);
  });
});

describe("D/E/F — pre-decision old-room resolution", () => {
  it("D. reservation_room read error fails closed before decideOperation", async () => {
    state.preRoom = { status: "error" };
    const { res, body } = await run();
    expect(res.status).toBe(503);
    expect(body.error).toBe("handoff_precheck_failed");
    expect(calls.decide).toHaveLength(0);
    expect(calls.enqueue).toHaveLength(0);
  });

  it("E. reservation_room missing fails closed before decideOperation", async () => {
    state.preRoom = { status: "missing" };
    const { res, body } = await run();
    expect(res.status).toBe(409);
    expect(body.error).toBe("reservation_room_unresolved");
    expect(calls.decide).toHaveLength(0);
  });

  it("E2. reservation_room resolved with no physical room fails closed", async () => {
    state.preRoom = { status: "ok", value: null };
    const { res, body } = await run();
    expect(res.status).toBe(409);
    expect(body.error).toBe("reservation_room_unresolved");
    expect(calls.decide).toHaveLength(0);
  });

  it("F. handoff enqueue failure keeps the 503 handoff_not_recorded behaviour", async () => {
    state.enqueueThrows = true;
    const { res, body } = await run();
    expect(res.status).toBe(503);
    expect(body.error).toBe("handoff_not_recorded");
    expect(calls.decide).toHaveLength(0);
  });
});

describe("G/H/I/J — post-decision uncertainty never destroys the retry record", () => {
  it("G. post-decision read error leaves the handoff pending, uncancelled, undirtied", async () => {
    state.postRoom = { status: "error" };
    const { res, body } = await run();
    expect(res.status).toBe(200);
    expect(calls.decide).toHaveLength(1);
    expect(calls.cancel).toHaveLength(0);
    expect(calls.apply).toHaveLength(0);
    expect(body.housekeepingHandoff).toEqual({ applied: false, pending: true });
  });

  it("H. post-decision association missing leaves the handoff pending", async () => {
    state.postRoom = { status: "missing" };
    const { body } = await run();
    expect(calls.cancel).toHaveLength(0);
    expect(calls.apply).toHaveLength(0);
    expect(body.housekeepingHandoff).toEqual({ applied: false, pending: true });
  });

  it("H2. applied result still pointing at the old room stays pending, not cancelled", async () => {
    state.postRoom = { status: "ok", value: OLD_ROOM };
    await run();
    expect(calls.cancel).toHaveLength(0);
    expect(calls.apply).toHaveLength(0);
  });

  it("I. positively moved room triggers the atomic vacate handoff", async () => {
    const { body } = await run();
    expect(calls.apply).toHaveLength(1);
    expect(calls.apply[0].roomId).toBe(OLD_ROOM);
    expect(calls.cancel).toHaveLength(0);
    expect(body.housekeepingHandoff).toEqual({ applied: true, pending: false });
  });

  it("J. positively non-applied result cancels the handoff idempotently and dirties nothing", async () => {
    state.decisionResult = { requestId: REQUEST, state: "rejected" };
    state.postRoom = { status: "ok", value: OLD_ROOM };
    await run();
    expect(calls.cancel).toHaveLength(1);
    expect(calls.apply).toHaveLength(0);
  });
});
