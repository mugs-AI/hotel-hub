/**
 * WP1 CORRECTION 7 — early check-in approval and room-change destination
 * readiness both refuse before `decideOperation` when the room has an
 * unresolved pending vacate handoff, and fail CLOSED (503) when readiness
 * cannot be determined at all. No mutation is attempted or retried.
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

class OperationErrorStub extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
class HousekeepingErrorStub extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const state = {
  operationType: "room_change" as "room_change" | "early_check_in",
  destinationBlocker: null as string | null,
  destinationThrows: false,
  checkInBlocker: null as string | null,
  checkInThrows: false,
};

const calls = { decide: [] as any[], enqueue: [] as any[], apply: [] as any[] };

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
  OperationError: OperationErrorStub,
  OPERATION_ERROR_CODES: new Set(["operation_decision_failed", "readiness_read_failed"]),
  destinationBlockerCode: (c: string) => (c === "handoff_pending" ? c : `destination_${c}`),
  housekeepingCheckInBlocker: async () => {
    if (state.checkInThrows) throw new OperationErrorStub("readiness_read_failed");
    return state.checkInBlocker;
  },
  getOperationRequestReservationId: async () => RESERVATION,
  readOperationRequestForHandoffOutcome: async () => ({
    status: "ok",
    value: {
      operationType: state.operationType,
      state: "pending",
      payload: { to_hotel_room_id: NEW_ROOM, reservation_room_id: RES_ROOM },
    },
  }),
  resolveReservationRoomHotelRoomId: async () => ({ status: "ok", value: OLD_ROOM }),
  decideOperation: async (input: any) => {
    calls.decide.push(input);
    return { requestId: REQUEST, state: "applied" };
  },
}));

vi.mock("@/lib/housekeeping-store.server", () => ({
  HousekeepingError: HousekeepingErrorStub,
  roomReadinessBlocker: async () => {
    if (state.destinationThrows) throw new HousekeepingErrorStub("readiness_read_failed");
    return state.destinationBlocker;
  },
  enqueueRoomHandoff: async (input: any) => {
    calls.enqueue.push(input);
    return HANDOFF;
  },
  applyRoomHandoff: async (input: any) => {
    calls.apply.push(input);
    return { applied: true, pending: false };
  },
  cancelRoomHandoff: async () => true,
  reconcilePendingHandoffs: async () => {},
}));

const { handleOperationDecision } =
  await import("@/routes/api/hotel/reservations.$id.operations.$requestId.decision");

async function run() {
  const res = await handleOperationDecision({
    request: new Request("https://app.test/api/hotel/reservations/x/operations/y/decision", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", clientRequestId: CLIENT_REQ }),
    }),
    params: { id: RESERVATION, requestId: REQUEST },
  });
  return { res, body: await res.clone().json() };
}

beforeEach(() => {
  calls.decide = [];
  calls.enqueue = [];
  calls.apply = [];
  state.operationType = "room_change";
  state.destinationBlocker = null;
  state.destinationThrows = false;
  state.checkInBlocker = null;
  state.checkInThrows = false;
});

describe("Correction 7 — decision readiness fails closed on pending handoffs", () => {
  it("C. room-change destination with a pending handoff is refused before decideOperation", async () => {
    state.destinationBlocker = "handoff_pending";
    const { res, body } = await run();
    expect(res.status).toBe(409);
    expect(body.error).toBe("handoff_pending");
    expect(calls.decide).toHaveLength(0);
    expect(calls.enqueue).toHaveLength(0);
  });

  it("B. early check-in with a pending handoff is refused before decideOperation", async () => {
    state.operationType = "early_check_in";
    state.checkInBlocker = "handoff_pending";
    const { res, body } = await run();
    expect(res.status).toBe(409);
    expect(body.error).toBe("handoff_pending");
    expect(calls.decide).toHaveLength(0);
  });

  it("E. an unreadable readiness state fails closed (503) for the room-change destination", async () => {
    state.destinationThrows = true;
    const { res, body } = await run();
    expect(res.status).toBe(503);
    expect(body.error).toBe("readiness_read_failed");
    expect(calls.decide).toHaveLength(0);
    expect(calls.enqueue).toHaveLength(0);
  });

  it("E. an unreadable readiness state fails closed (503) for early check-in", async () => {
    state.operationType = "early_check_in";
    state.checkInThrows = true;
    const { res, body } = await run();
    expect(res.status).toBe(503);
    expect(body.error).toBe("readiness_read_failed");
    expect(calls.decide).toHaveLength(0);
  });

  it("a clear readiness result still proceeds to the decision", async () => {
    const { res } = await run();
    expect(res.status).toBe(200);
    expect(calls.decide).toHaveLength(1);
  });
});
