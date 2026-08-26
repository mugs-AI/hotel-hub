/**
 * WP1 CORRECTION 3 — a vacated room only becomes Dirty on positive proof.
 *
 * `approved` is NOT proof. The decision routine performs the physical room
 * change and records the request as `applied` with an `applied_at` in the same
 * transaction, so nothing short of a verified applied room_change — whose
 * reservation room has genuinely moved off the old room — may dirty a room that
 * the desk can still sell.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";
const OLD_ROOM = "44444444-4444-4444-8444-444444444444";
const NEW_ROOM = "99999999-9999-4999-8999-999999999999";
const OP = "55555555-5555-4555-8555-555555555555";
const HANDOFF = "66666666-6666-4666-8666-666666666666";
const RESERVATION = "77777777-7777-4777-8777-777777777777";
const OTHER_RESERVATION = "7777aaaa-7777-4777-8777-777777777777";
const RES_ROOM = "88888888-8888-4888-8888-888888888888";

type Row = Record<string, any>;

let pendingRows: Row[] = [];
let operationRows: Record<string, Row> = {};
let reservationRoomRows: Record<string, Row> = {};
let operationReadError = false;
const rpcCalls: { name: string; args: any }[] = [];
const rpcScript: Record<string, () => any> = {};

function tableStub(table: string) {
  const filters: Record<string, unknown> = {};
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return chain;
    },
    lt: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      if (table === "hotel_reservation_operation_requests" && operationReadError) {
        return { data: null, error: { message: "read failed" } };
      }
      const source = table === "hotel_reservation_rooms" ? reservationRoomRows : operationRows;
      const row = source[String(filters["id"])];
      // Tenant scoping is enforced by the query, exactly as in the database.
      if (!row || row.tenant_id !== filters["tenant_id"]) return { data: null, error: null };
      return { data: row, error: null };
    },
    then: (resolve: (v: any) => unknown) => {
      const rows =
        table === "hotel_housekeeping_handoffs" && filters["tenant_id"] === TENANT
          ? pendingRows
          : [];
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      const fn = rpcScript[name];
      if (!fn) return { data: null, error: { message: `unscripted ${name}` } };
      return fn();
    },
    from: (table: string) => tableStub(table),
  },
}));

const store = await import("@/lib/housekeeping-store.server");

function queueRow(overrides: Row = {}): Row {
  return {
    id: HANDOFF,
    hotel_room_id: OLD_ROOM,
    reservation_id: RESERVATION,
    actor_n3_user_key: "user-1",
    source: "room_change",
    operation_request_id: OP,
    attempts: 0,
    ...overrides,
  };
}

function operation(overrides: Row = {}): Row {
  return {
    tenant_id: TENANT,
    reservation_id: RESERVATION,
    operation_type: "room_change",
    state: "applied",
    applied_at: "2026-08-21T10:00:00Z",
    payload: { reservation_room_id: RES_ROOM },
    ...overrides,
  };
}

function movedReservationRoom(hotelRoomId = NEW_ROOM, overrides: Row = {}): Row {
  return {
    tenant_id: TENANT,
    reservation_id: RESERVATION,
    hotel_room_id: hotelRoomId,
    ...overrides,
  };
}

const vacates = () => rpcCalls.filter((c) => c.name === "hotelhub_hk_vacate_room_v2");

beforeEach(() => {
  pendingRows = [queueRow()];
  operationRows = {};
  reservationRoomRows = {};
  operationReadError = false;
  rpcCalls.length = 0;
  for (const key of Object.keys(rpcScript)) delete rpcScript[key];
  rpcScript["hotelhub_hk_vacate_room_v2"] = () => ({
    data: [{ out_applied: true, out_created: true }],
  });
  rpcScript["hotelhub_hk_cancel_handoff"] = () => ({ data: null });
  rpcScript["hotelhub_hk_fail_handoff"] = () => ({ data: null });
});

describe("WP1 Correction 3 — only a proven applied room change may dirty the old room", () => {
  it("A. proven applied move with the room actually changed: applied exactly once", async () => {
    operationRows[OP] = operation();
    reservationRoomRows[RES_ROOM] = movedReservationRoom();
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ attempted: 1, applied: 1, cancelled: 0, deferred: 0 });
    expect(vacates()).toHaveLength(1);
    expect(vacates()[0].args).toMatchObject({
      p_tenant_id: TENANT,
      p_hotel_room_id: OLD_ROOM,
      p_handoff_id: HANDOFF,
    });
  });

  it("B. approved is never proof: deferred, room stays sellable", async () => {
    operationRows[OP] = operation({ state: "approved", applied_at: null });
    reservationRoomRows[RES_ROOM] = movedReservationRoom();
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("C. applied with a null applied_at is not proof", async () => {
    operationRows[OP] = operation({ applied_at: null });
    reservationRoomRows[RES_ROOM] = movedReservationRoom();
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("D. applied but the reservation room still points at the old room is not proof", async () => {
    operationRows[OP] = operation();
    reservationRoomRows[RES_ROOM] = movedReservationRoom(OLD_ROOM);
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("E. an applied operation of another type is not proof", async () => {
    operationRows[OP] = operation({ operation_type: "late_checkout" });
    reservationRoomRows[RES_ROOM] = movedReservationRoom();
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("F. an applied operation for a different reservation is not proof", async () => {
    operationRows[OP] = operation({ reservation_id: OTHER_RESERVATION });
    reservationRoomRows[RES_ROOM] = movedReservationRoom(NEW_ROOM, {
      reservation_id: OTHER_RESERVATION,
    });
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("G. a malformed or missing reservation_room_id payload is not proof", async () => {
    for (const payload of [{}, { reservation_room_id: "not-a-uuid" }, { reservation_room_id: 7 }]) {
      rpcCalls.length = 0;
      pendingRows = [queueRow()];
      operationRows[OP] = operation({ payload });
      reservationRoomRows[RES_ROOM] = movedReservationRoom();
      const out = await store.reconcilePendingHandoffs(TENANT);
      expect(out).toMatchObject({ applied: 0, deferred: 1 });
      expect(vacates()).toHaveLength(0);
    }
  });

  it("G. an unknown reservation room is not proof", async () => {
    operationRows[OP] = operation();
    // No reservation-room row at all.
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("H. a rejected operation retires the queue row without dirtying the room", async () => {
    operationRows[OP] = operation({ state: "rejected", applied_at: null });
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 1 });
    expect(vacates()).toHaveLength(0);
    expect(rpcCalls.some((c) => c.name === "hotelhub_hk_cancel_handoff")).toBe(true);
  });

  it("I. a cancelled (failed/abandoned) operation retires the queue row, no Dirty", async () => {
    operationRows[OP] = operation({ state: "cancelled", applied_at: null });
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("J. a pending operation is deferred, never applied", async () => {
    operationRows[OP] = operation({ state: "pending", applied_at: null });
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("K. an unrecognised state is deferred, never applied", async () => {
    operationRows[OP] = operation({ state: "weird_state", applied_at: null });
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("K. an unreadable operation is deferred, never applied and never retired", async () => {
    operationRows[OP] = operation();
    reservationRoomRows[RES_ROOM] = movedReservationRoom();
    operationReadError = true;
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("L. cross-tenant: another property's proof leaks nothing and dirties nothing", async () => {
    operationRows[OP] = operation({ tenant_id: OTHER_TENANT });
    reservationRoomRows[RES_ROOM] = movedReservationRoom(NEW_ROOM, { tenant_id: OTHER_TENANT });
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out.applied).toBe(0);
    expect(vacates()).toHaveLength(0);

    // And a foreign tenant cannot even see this queue.
    rpcCalls.length = 0;
    const foreign = await store.reconcilePendingHandoffs(OTHER_TENANT);
    expect(foreign).toMatchObject({ attempted: 0, applied: 0 });
    expect(vacates()).toHaveLength(0);
  });

  it("M. the proven retry leaves the old room Dirty with DND cleared, exactly once", async () => {
    operationRows[OP] = operation();
    reservationRoomRows[RES_ROOM] = movedReservationRoom();
    pendingRows = [queueRow({ attempts: 4 })];
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out.applied).toBe(1);
    // hotelhub_hk_vacate_room_v2 sets condition=dirty, dnd_active=false and
    // writes history in one transaction; it must be invoked once, for the old
    // room, under this tenant.
    expect(vacates()).toHaveLength(1);
    expect(vacates()[0].args.p_hotel_room_id).toBe(OLD_ROOM);
    expect(vacates()[0].args.p_source).toBe("room_change");
  });

  it("N. a duplicate reconciliation is idempotent: no second history effect", async () => {
    operationRows[OP] = operation();
    reservationRoomRows[RES_ROOM] = movedReservationRoom();
    await store.reconcilePendingHandoffs(TENANT);
    expect(vacates()).toHaveLength(1);
    // The first pass closed the queue row.
    pendingRows = [];
    const second = await store.reconcilePendingHandoffs(TENANT);
    expect(second).toMatchObject({ attempted: 0, applied: 0 });
    expect(vacates()).toHaveLength(1);
  });

  it("source guard: `approved` is not treated as proof anywhere in the store", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "../housekeeping-store.server.ts"), "utf8");
    expect(src).not.toMatch(/\["applied",\s*"approved"\]/);
    expect(src).toMatch(/HANDOFF_PROVEN_OPERATION_STATE = "applied"/);
  });
});
