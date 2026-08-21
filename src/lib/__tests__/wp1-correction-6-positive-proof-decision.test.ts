/**
 * WP1 CORRECTION 6 — a room may become Dirty ONLY on positive proof that the
 * correlated room_change is APPLIED and the authoritative post-decision
 * reservation_room read shows a physical move off the old room. A decision
 * error never cancels the durable handoff: an uncertain client result does not
 * prove the server transaction failed.
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
  postRoom: { status: "ok", value: NEW_ROOM } as Outcome<string | null>,
  preRoom: { status: "ok", value: OLD_ROOM } as Outcome<string | null>,
  decisionResult: { requestId: REQUEST, state: "applied" } as any,
  decisionThrows: false,
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
  getOperationRequestReservationId: async () => RESERVATION,
  readOperationRequestForHandoffOutcome: async () => ({
    status: "ok",
    value: {
      operationType: "room_change",
      state: "pending",
      payload: { to_hotel_room_id: NEW_ROOM, reservation_room_id: RES_ROOM },
    },
  }),
  resolveReservationRoomHotelRoomId: async () =>
    calls.decide.length === 0 ? state.preRoom : state.postRoom,
  decideOperation: async (input: any) => {
    calls.decide.push(input);
    if (state.decisionThrows) throw new Error("transport blew up");
    return state.decisionResult;
  },
}));

vi.mock("@/lib/housekeeping-store.server", () => ({
  roomReadinessBlocker: async () => null,
  enqueueRoomHandoff: async (input: any) => {
    calls.enqueue.push(input);
    return HANDOFF;
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

async function run() {
  const res = await handleOperationDecision({
    request: new Request("https://app.test/api/hotel/reservations/x/operations/y/decision", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", clientRequestId: CLIENT_REQ }),
    }),
    params: { id: RESERVATION, requestId: REQUEST },
  });
  const body = await res.clone().json();
  return { res, body };
}

beforeEach(() => {
  calls.decide = [];
  calls.apply = [];
  calls.cancel = [];
  calls.enqueue = [];
  calls.reconcile = [];
  state.preRoom = { status: "ok", value: OLD_ROOM };
  state.postRoom = { status: "ok", value: NEW_ROOM };
  state.decisionResult = { requestId: REQUEST, state: "applied" };
  state.decisionThrows = false;
});

describe("Correction 6 — immediate Dirty requires APPLIED plus a proven move", () => {
  it("1. applied + moved away dirties the old room exactly once", async () => {
    const { res, body } = await run();
    expect(res.status).toBe(200);
    expect(calls.apply).toHaveLength(1);
    expect(calls.apply[0].roomId).toBe(OLD_ROOM);
    expect(calls.cancel).toHaveLength(0);
    expect(body.housekeepingHandoff).toEqual({ applied: true, pending: false });
  });

  it("2. rejected + moved-away read never dirties; terminal cancellation only", async () => {
    state.decisionResult = { requestId: REQUEST, state: "rejected" };
    await run();
    expect(calls.apply).toHaveLength(0);
    expect(calls.cancel).toHaveLength(1);
  });

  it("3. cancelled + moved-away read never dirties; terminal cancellation only", async () => {
    state.decisionResult = { requestId: REQUEST, state: "cancelled" };
    await run();
    expect(calls.apply).toHaveLength(0);
    expect(calls.cancel).toHaveLength(1);
  });

  it("4. approved + moved away stays pending, never Dirty, never cancelled", async () => {
    state.decisionResult = { requestId: REQUEST, state: "approved" };
    const { body } = await run();
    expect(calls.apply).toHaveLength(0);
    expect(calls.cancel).toHaveLength(0);
    expect(body.housekeepingHandoff).toEqual({ applied: false, pending: true });
  });

  it("5. pending (and unknown) + moved away stays pending, never Dirty", async () => {
    for (const st of ["pending", "weird_unknown_state"]) {
      calls.apply = [];
      calls.cancel = [];
      state.decisionResult = { requestId: REQUEST, state: st };
      const { body } = await run();
      expect(calls.apply).toHaveLength(0);
      expect(calls.cancel).toHaveLength(0);
      expect(body.housekeepingHandoff).toEqual({ applied: false, pending: true });
    }
  });

  it("6. applied + post-read error stays pending, no cancel, no Dirty", async () => {
    state.postRoom = { status: "error" };
    const { body } = await run();
    expect(calls.apply).toHaveLength(0);
    expect(calls.cancel).toHaveLength(0);
    expect(body.housekeepingHandoff).toEqual({ applied: false, pending: true });
  });

  it("7. applied + post-read missing/null/still-old stays pending, no cancel, no Dirty", async () => {
    const cases: Outcome<string | null>[] = [
      { status: "missing" },
      { status: "ok", value: null },
      { status: "ok", value: OLD_ROOM },
    ];
    for (const post of cases) {
      calls.apply = [];
      calls.cancel = [];
      state.postRoom = post;
      const { body } = await run();
      expect(calls.apply).toHaveLength(0);
      expect(calls.cancel).toHaveLength(0);
      expect(body.housekeepingHandoff).toEqual({ applied: false, pending: true });
    }
  });
});

describe("Correction 6 — unknown decision results never cancel the durable intent", () => {
  it("8. decideOperation throwing after enqueue keeps the handoff, dirties nothing, fails the request", async () => {
    state.decisionThrows = true;
    const { res, body } = await run();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(body.error).toBe("operation_decision_failed");
    expect(calls.enqueue).toHaveLength(1);
    expect(calls.cancel).toHaveLength(0);
    expect(calls.apply).toHaveLength(0);
    // no automatic mutation retry
    expect(calls.decide).toHaveLength(1);
    expect(calls.reconcile).toHaveLength(0);
  });
});
