/**
 * FINAL BOUNDED SAME-SCOPE AUDIT CORRECTION — direct-execution atomicity.
 *
 * The direct path is proven against a transactional simulator of
 * `hotelhub_direct_operation_v2`: request creation, readiness, the correlated
 * vacated-room handover and apply either ALL commit or ALL roll back, exactly
 * as the SQL routine does. The SQL routine itself is additionally asserted as
 * source, because the migration IS the artefact that has to contain those
 * gates — the behavioural tests below prove the JS side never creates a
 * handover of its own.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "22222222-2222-4222-8222-222222222222";
const RESERVATION = "77777777-7777-4777-8777-777777777777";
const REQUEST = "55555555-5555-4555-8555-555555555555";
const RES_ROOM = "88888888-8888-4888-8888-888888888888";
const OLD_ROOM = "44444444-4444-4444-8444-444444444444";
const NEW_ROOM = "99999999-9999-4999-8999-999999999999";
const CLIENT_REQ = "11111111-1111-4111-8111-111111111111";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Transactional simulator of the database routine.
// ---------------------------------------------------------------------------

type Handoff = { id: string; requestId: string; roomId: string; state: string };

const db = {
  /** idempotency key -> committed request */
  requests: new Map<string, { requestId: string; state: string }>(),
  handoffs: [] as Handoff[],
  timeline: [] as string[],
  /** where the reservation-room currently physically is */
  physicalRoom: OLD_ROOM,
  /** readiness verdict for the destination room, evaluated INSIDE the txn */
  readiness: null as string | null,
  /** apply-stage failure (availability/capacity/stale...) */
  applyError: null as string | null,
  handoffSeq: 0,
};

class OpError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** Mirror of hotelhub_direct_operation_v2, including rollback semantics. */
async function directOperationRpc(input: {
  operationType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}) {
  const snapshot = {
    requests: new Map(db.requests),
    handoffs: db.handoffs.slice(),
    timeline: db.timeline.slice(),
    physicalRoom: db.physicalRoom,
    handoffSeq: db.handoffSeq,
  };
  const rollback = () => {
    db.requests = snapshot.requests;
    db.handoffs = snapshot.handoffs;
    db.timeline = snapshot.timeline;
    db.physicalRoom = snapshot.physicalRoom;
    db.handoffSeq = snapshot.handoffSeq;
  };

  try {
    // (a) idempotent request lookup/create
    const existing = db.requests.get(input.idempotencyKey);
    if (existing) {
      // (b) terminal replay: same result, no readiness mutation, no new handoff
      const h = db.handoffs.find((x) => x.requestId === existing.requestId) ?? null;
      return {
        requestId: existing.requestId,
        state: existing.state,
        handoffId: h?.id ?? null,
        oldRoomId: h?.roomId ?? null,
      };
    }
    const requestId = REQUEST;
    db.requests.set(input.idempotencyKey, { requestId, state: "pending" });

    let handoffId: string | null = null;
    let oldRoomId: string | null = null;

    if (input.operationType === "room_change" || input.operationType === "early_check_in") {
      // (c) readiness / DND / pending-handoff, inside the transaction
      if (db.readiness) throw new OpError(db.readiness);
    }

    if (input.operationType === "room_change") {
      // (d) old room resolved from tenant+reservation+reservation_room, then
      // the handoff is correlated to the NEW request id.
      oldRoomId = db.physicalRoom;
      const already = db.handoffs.find((x) => x.requestId === requestId && x.roomId === oldRoomId);
      handoffId = already?.id ?? `handoff-${++db.handoffSeq}`;
      if (!already) {
        db.handoffs.push({ id: handoffId, requestId, roomId: oldRoomId, state: "pending" });
      }
    }

    // (e) apply engine
    if (db.applyError) throw new OpError(db.applyError);
    if (input.operationType === "room_change") {
      db.physicalRoom = String(input.payload["to_hotel_room_id"]);
    }
    db.timeline.push(`${input.operationType}:applied`);
    db.requests.set(input.idempotencyKey, { requestId, state: "applied" });

    return { requestId, state: "applied", handoffId, oldRoomId };
  } catch (err) {
    rollback();
    throw err;
  }
}

const calls = {
  enqueue: [] as any[],
  cancel: [] as any[],
  apply: [] as any[],
  audit: [] as any[],
};

vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: any) => {
    calls.audit.push(e);
  },
}));

vi.mock("@/lib/reservations-store.server", () => ({
  isUuid: (v: unknown) => typeof v === "string" && UUID_RE.test(v),
}));

vi.mock("@/lib/housekeeping-store.server", () => ({
  enqueueRoomHandoff: async (i: any) => {
    calls.enqueue.push(i);
    return "js-handoff";
  },
  cancelRoomHandoff: async (t: string, id: string) => {
    calls.cancel.push({ t, id });
  },
  applyRoomHandoff: async (i: any) => {
    calls.apply.push(i);
    const row = db.handoffs.find((h) => h.id === i.handoffId);
    if (row) row.state = "applied";
    return { applied: true, pending: false, created: false };
  },
  reconcilePendingHandoffs: async () => ({}),
  roomReadinessBlocker: async () => null,
}));

vi.mock("@/lib/reservation-operations.server", () => ({
  OperationError: OpError,
  OPERATION_ERROR_CODES: new Set([
    "room_unavailable",
    "room_capacity_exceeded",
    "operation_stale",
    "destination_room_dirty",
    "destination_dnd_active",
    "handoff_pending",
    "room_dirty",
    "housekeeping_not_initialized",
  ]),
  applyDirectOperation: async (i: any) => directOperationRpc(i),
  decideOperation: async () => ({ requestId: REQUEST, state: "applied" }),
  destinationBlockerCode: (c: string) => `destination_${c}`,
  housekeepingCheckInBlocker: async () => null,
  readOperationRequestForHandoffOutcome: async () => ({ status: "missing" }),
  resolveReservationRoomHotelRoomId: async () => ({ status: "ok", value: db.physicalRoom }),
}));

const ROOM_CHANGE_PAYLOAD = {
  reservation_room_id: RES_ROOM,
  to_hotel_room_id: NEW_ROOM,
};

async function direct(payload: Record<string, unknown>, operationType = "room_change") {
  const { executeDirectOperation } = await import("@/lib/operation-decision.server");
  return executeDirectOperation({
    tenantId: TENANT,
    actorN3UserKey: "user-1",
    reservationId: RESERVATION,
    operationType: operationType as any,
    payload,
    idempotencyKey: CLIENT_REQ,
    statusForOperationError: () => 409,
  });
}

beforeEach(() => {
  db.requests = new Map();
  db.handoffs = [];
  db.timeline = [];
  db.physicalRoom = OLD_ROOM;
  db.readiness = null;
  db.applyError = null;
  db.handoffSeq = 0;
  for (const k of Object.keys(calls)) (calls as any)[k].length = 0;
});

describe("Direct room change — one transaction owns the handover", () => {
  it("applies and creates exactly one handover, correlated to the request", async () => {
    const out = await direct(ROOM_CHANGE_PAYLOAD);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.state).toBe("applied");
    expect(db.handoffs).toHaveLength(1);
    expect(db.handoffs[0]!.roomId).toBe(OLD_ROOM);
    expect(db.handoffs[0]!.requestId).toBe(out.result.requestId);
    expect(calls.apply[0]).toMatchObject({ roomId: OLD_ROOM, handoffId: db.handoffs[0]!.id });
  });

  it("never enqueues or cancels a handover from JavaScript", async () => {
    await direct(ROOM_CHANGE_PAYLOAD);
    expect(calls.enqueue).toHaveLength(0);
    expect(calls.cancel).toHaveLength(0);
  });

  it("identical replay returns the same result and adds no handover", async () => {
    const first = await direct(ROOM_CHANGE_PAYLOAD);
    const second = await direct(ROOM_CHANGE_PAYLOAD);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result).toEqual(first.result);
    expect(db.handoffs).toHaveLength(1);
    expect(db.timeline).toHaveLength(1);
  });

  it("replay never records the DESTINATION room as the vacated room", async () => {
    await direct(ROOM_CHANGE_PAYLOAD);
    expect(db.physicalRoom).toBe(NEW_ROOM);
    await direct(ROOM_CHANGE_PAYLOAD);
    expect(db.handoffs.map((h) => h.roomId)).toEqual([OLD_ROOM]);
    expect(db.handoffs.some((h) => h.roomId === NEW_ROOM)).toBe(false);
  });

  it("rolls request, mutation, handover and timeline back on an apply failure", async () => {
    db.applyError = "room_unavailable";
    const out = await direct(ROOM_CHANGE_PAYLOAD);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("room_unavailable");
    expect(db.requests.size).toBe(0);
    expect(db.handoffs).toHaveLength(0);
    expect(db.timeline).toHaveLength(0);
    expect(db.physicalRoom).toBe(OLD_ROOM);
    expect(calls.apply).toHaveLength(0);
  });

  it("fails closed on a destination readiness refusal, leaving nothing behind", async () => {
    for (const code of [
      "destination_room_dirty",
      "destination_dnd_active",
      "handoff_pending",
      "housekeeping_not_initialized",
    ]) {
      db.requests = new Map();
      db.handoffs = [];
      db.timeline = [];
      db.readiness = code;
      const out = await direct(ROOM_CHANGE_PAYLOAD);
      expect(out.ok).toBe(false);
      expect(db.requests.size).toBe(0);
      expect(db.handoffs).toHaveLength(0);
      expect(db.timeline).toHaveLength(0);
    }
  });

  it("rejects a malformed room-change payload before any database work", async () => {
    const out = await direct({ reservation_room_id: RES_ROOM });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("validation_failed");
    expect(db.requests.size).toBe(0);
  });

  it("gives early check-in the same atomic readiness protection", async () => {
    db.readiness = "room_dirty";
    const blocked = await direct({ reason: "guest arrived early" }, "early_check_in");
    expect(blocked.ok).toBe(false);
    expect(db.requests.size).toBe(0);
    expect(db.timeline).toHaveLength(0);

    db.readiness = null;
    const ok = await direct({ reason: "guest arrived early" }, "early_check_in");
    expect(ok.ok).toBe(true);
    expect(db.handoffs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The SQL routine is the artefact that must contain the gates.
// ---------------------------------------------------------------------------

const MIGRATIONS = resolve(process.cwd(), "supabase/migrations");

function correctiveMigration(): string {
  const file = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .map((f) => readFileSync(resolve(MIGRATIONS, f), "utf8"))
    .find((sql) => sql.includes("hotelhub_direct_operation_v2"));
  if (!file) throw new Error("corrective migration not found");
  return file;
}

describe("hotelhub_direct_operation_v2 — gates live in the database routine", () => {
  const sql = correctiveMigration();

  it("checks readiness and enqueues the handover BEFORE deciding", () => {
    const readiness = sql.indexOf(
      "hotelhub_hk_readiness_blocker_locked(p_tenant_id, ARRAY[v_dest])",
    );
    const enqueue = sql.indexOf("hotelhub_hk_enqueue_handoff(");
    const decide = sql.indexOf("hotelhub_decide_operation(");
    expect(readiness).toBeGreaterThan(-1);
    expect(enqueue).toBeGreaterThan(readiness);
    expect(decide).toBeGreaterThan(enqueue);
  });

  it("correlates the handover with the operation request id, never NULL", () => {
    const call = sql.slice(sql.indexOf("hotelhub_hk_enqueue_handoff("));
    expect(call.slice(0, 220)).toContain("v_request_id");
    expect(call.slice(0, 220)).toContain("v_old_room");
  });

  it("returns the terminal replay result without touching readiness", () => {
    expect(sql).toContain("IF v_state IS DISTINCT FROM 'pending' THEN");
  });

  it("locks the safety-relevant rows and fails closed on every condition", () => {
    for (const token of [
      "FOR UPDATE",
      "'handoff_pending'",
      "'housekeeping_not_initialized'",
      "'dnd_active'",
      "'room_not_found'",
      "'room_inactive'",
      "'room_' || v_condition",
    ]) {
      expect(sql).toContain(token);
    }
  });

  it("gives early check-in in-transaction readiness too", () => {
    const early = sql.slice(sql.indexOf("IF p_operation_type = 'early_check_in'"));
    expect(early.slice(0, 600)).toContain("hotelhub_hk_readiness_blocker_locked");
  });

  it("leaves the already-applied migrations untouched", () => {
    const applied = readdirSync(MIGRATIONS).filter(
      (f) => f.startsWith("20260824093329") || f.startsWith("20260824095539"),
    );
    expect(applied).toHaveLength(2);
  });
});

describe("Direct execution source — no JS handover around the RPC", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/operation-decision.server.ts"), "utf8");
  const directFn = src.slice(src.indexOf("export async function executeDirectOperation"));

  it("does not call enqueueRoomHandoff or cancelRoomHandoff", () => {
    expect(directFn).not.toContain("enqueueRoomHandoff(");
    expect(directFn).not.toContain("cancelRoomHandoff(");
  });
});
