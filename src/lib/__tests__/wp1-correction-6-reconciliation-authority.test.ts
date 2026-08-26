/**
 * WP1 CORRECTION 6 — after a decision error leaves a durable handoff pending,
 * reconciliation is the final authority: it re-reads the authoritative
 * operation state and only positive `applied` proof dirties the old room.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "22222222-2222-4222-8222-222222222222";
const OLD_ROOM = "44444444-4444-4444-8444-444444444444";
const NEW_ROOM = "99999999-9999-4999-8999-999999999999";
const OP = "55555555-5555-4555-8555-555555555555";
const HANDOFF = "66666666-6666-4666-8666-666666666666";
const RESERVATION = "77777777-7777-4777-8777-777777777777";
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

const vacates = () => rpcCalls.filter((c) => c.name === "hotelhub_hk_vacate_room_v2");
const cancels = () => rpcCalls.filter((c) => c.name === "hotelhub_hk_cancel_handoff");

beforeEach(() => {
  pendingRows = [queueRow()];
  operationRows = {};
  reservationRoomRows = {
    [RES_ROOM]: { tenant_id: TENANT, reservation_id: RESERVATION, hotel_room_id: NEW_ROOM },
  };
  rpcCalls.length = 0;
  for (const key of Object.keys(rpcScript)) delete rpcScript[key];
  rpcScript["hotelhub_hk_vacate_room_v2"] = () => ({
    data: [{ out_applied: true, out_created: true }],
  });
  rpcScript["hotelhub_hk_cancel_handoff"] = () => ({ data: null });
  rpcScript["hotelhub_hk_fail_handoff"] = () => ({ data: null });
});

describe("Correction 6 — reconciliation after an uncertain decision", () => {
  it("9. operation still pending/approved/unknown/missing: no Dirty, deferred", async () => {
    for (const st of ["pending", "approved", "mystery"]) {
      rpcCalls.length = 0;
      operationRows = { [OP]: operation({ state: st, applied_at: null }) };
      const out = await store.reconcilePendingHandoffs(TENANT);
      expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
      expect(vacates()).toHaveLength(0);
      expect(cancels()).toHaveLength(0);
    }
    rpcCalls.length = 0;
    operationRows = {};
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
    expect(vacates()).toHaveLength(0);
  });

  it("10. authoritative applied proof dirties the old room exactly once", async () => {
    operationRows = { [OP]: operation() };
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 1, deferred: 0 });
    expect(vacates()).toHaveLength(1);
    expect(vacates()[0]!.args.p_hotel_room_id ?? vacates()[0]!.args["p_room_id"]).toBe(OLD_ROOM);
  });

  it("11. rejected/cancelled operations retire the row safely without Dirty", async () => {
    for (const st of ["rejected", "cancelled"]) {
      rpcCalls.length = 0;
      operationRows = { [OP]: operation({ state: st, applied_at: null }) };
      const out = await store.reconcilePendingHandoffs(TENANT);
      expect(out).toMatchObject({ applied: 0, cancelled: 1, deferred: 0 });
      expect(vacates()).toHaveLength(0);
      expect(cancels()).toHaveLength(1);
    }
  });
});
