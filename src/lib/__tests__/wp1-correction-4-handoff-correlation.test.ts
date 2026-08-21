/**
 * WP1 CORRECTION 4 — a queue row can never prove its own vacancy.
 *
 * Reconciliation only dirties an old room when the pending row is fully
 * correlated (room_change source, valid operation id, valid reservation id) AND
 * the authoritative operation + reservation-room rows positively prove the move
 * under exactly this tenant. Missing evidence defers; only `rejected` and
 * `cancelled` operations retire a durable row.
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
      const source = table === "hotel_reservation_rooms" ? reservationRoomRows : operationRows;
      const row = source[String(filters["id"])];
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

function reservationRoom(overrides: Row = {}): Row {
  return {
    tenant_id: TENANT,
    reservation_id: RESERVATION,
    hotel_room_id: NEW_ROOM,
    ...overrides,
  };
}

const vacates = () => rpcCalls.filter((c) => c.name === "hotelhub_hk_vacate_room_v2");
const cancels = () => rpcCalls.filter((c) => c.name === "hotelhub_hk_cancel_handoff");

beforeEach(() => {
  pendingRows = [queueRow()];
  operationRows = {};
  reservationRoomRows = {};
  rpcCalls.length = 0;
  for (const key of Object.keys(rpcScript)) delete rpcScript[key];
  rpcScript["hotelhub_hk_vacate_room_v2"] = () => ({
    data: [{ out_applied: true, out_created: true }],
  });
  rpcScript["hotelhub_hk_cancel_handoff"] = () => ({ data: null });
  rpcScript["hotelhub_hk_fail_handoff"] = () => ({ data: null });
});

describe("WP1 Correction 4 — uncorrelated queue rows can never dirty a room", () => {
  it("1. operation_request_id null: deferred, no vacate, no cancel", async () => {
    pendingRows = [queueRow({ operation_request_id: null })];
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
    expect(cancels()).toHaveLength(0);
  });

  it("2. operation_request_id malformed: deferred, no Dirty", async () => {
    for (const bad of ["not-a-uuid", "", 7]) {
      rpcCalls.length = 0;
      pendingRows = [queueRow({ operation_request_id: bad })];
      const out = await store.reconcilePendingHandoffs(TENANT);
      expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
      expect(vacates()).toHaveLength(0);
    }
  });

  it("3. handoff reservation_id null: deferred, no Dirty", async () => {
    operationRows[OP] = operation();
    reservationRoomRows[RES_ROOM] = reservationRoom();
    pendingRows = [queueRow({ reservation_id: null })];
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
    expect(cancels()).toHaveLength(0);
  });

  it("4. handoff reservation_id malformed: deferred, no Dirty", async () => {
    operationRows[OP] = operation();
    reservationRoomRows[RES_ROOM] = reservationRoom();
    pendingRows = [queueRow({ reservation_id: "nope" })];
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("5. source other than room_change: deferred, no Dirty", async () => {
    operationRows[OP] = operation();
    reservationRoomRows[RES_ROOM] = reservationRoom();
    for (const source of [null, "check_out", "manual"]) {
      rpcCalls.length = 0;
      pendingRows = [queueRow({ source })];
      const out = await store.reconcilePendingHandoffs(TENANT);
      expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
      expect(vacates()).toHaveLength(0);
      expect(cancels()).toHaveLength(0);
    }
  });

  it("6. correlated operation missing: deferred, never retired", async () => {
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
    expect(cancels()).toHaveLength(0);
  });

  it("7. operation belongs to another tenant (not visible): deferred, no Dirty", async () => {
    operationRows[OP] = operation({ tenant_id: OTHER_TENANT });
    reservationRoomRows[RES_ROOM] = reservationRoom({ tenant_id: OTHER_TENANT });
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
    expect(cancels()).toHaveLength(0);
  });

  it("8. operation reservation_id missing or mismatched: deferred, no Dirty", async () => {
    for (const reservation_id of [null, OTHER_RESERVATION]) {
      rpcCalls.length = 0;
      pendingRows = [queueRow()];
      operationRows[OP] = operation({ reservation_id });
      reservationRoomRows[RES_ROOM] = reservationRoom();
      const out = await store.reconcilePendingHandoffs(TENANT);
      expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
      expect(vacates()).toHaveLength(0);
    }
  });

  it("9. reservation_room in another tenant (not visible): deferred, no Dirty", async () => {
    operationRows[OP] = operation();
    reservationRoomRows[RES_ROOM] = reservationRoom({ tenant_id: OTHER_TENANT });
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("10. reservation_room reservation_id missing or mismatched: deferred, no Dirty", async () => {
    for (const reservation_id of [null, OTHER_RESERVATION]) {
      rpcCalls.length = 0;
      pendingRows = [queueRow()];
      operationRows[OP] = operation();
      reservationRoomRows[RES_ROOM] = reservationRoom({ reservation_id });
      const out = await store.reconcilePendingHandoffs(TENANT);
      expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
      expect(vacates()).toHaveLength(0);
    }
  });

  it("11. fully proven applied room_change applies exactly once via the atomic RPC", async () => {
    operationRows[OP] = operation();
    reservationRoomRows[RES_ROOM] = reservationRoom();
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ attempted: 1, applied: 1, cancelled: 0, deferred: 0 });
    expect(vacates()).toHaveLength(1);
    expect(vacates()[0].args).toMatchObject({
      p_tenant_id: TENANT,
      p_hotel_room_id: OLD_ROOM,
      p_handoff_id: HANDOFF,
      p_source: "room_change",
    });
  });

  it("12. rejected and cancelled operations retire safely without Dirty", async () => {
    for (const state of ["rejected", "cancelled"]) {
      rpcCalls.length = 0;
      pendingRows = [queueRow()];
      operationRows[OP] = operation({ state, applied_at: null });
      const out = await store.reconcilePendingHandoffs(TENANT);
      expect(out).toMatchObject({ applied: 0, cancelled: 1 });
      expect(vacates()).toHaveLength(0);
      expect(cancels()).toHaveLength(1);
    }
  });

  it("13. approved and pending remain deferred", async () => {
    for (const state of ["approved", "pending"]) {
      rpcCalls.length = 0;
      pendingRows = [queueRow()];
      operationRows[OP] = operation({ state, applied_at: null });
      reservationRoomRows[RES_ROOM] = reservationRoom();
      const out = await store.reconcilePendingHandoffs(TENANT);
      expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
      expect(vacates()).toHaveLength(0);
    }
  });

  it("14. duplicate reconciliation is idempotent", async () => {
    operationRows[OP] = operation();
    reservationRoomRows[RES_ROOM] = reservationRoom();
    await store.reconcilePendingHandoffs(TENANT);
    expect(vacates()).toHaveLength(1);
    pendingRows = [];
    const second = await store.reconcilePendingHandoffs(TENANT);
    expect(second).toMatchObject({ attempted: 0, applied: 0, cancelled: 0, deferred: 0 });
    expect(vacates()).toHaveLength(1);
  });
});
