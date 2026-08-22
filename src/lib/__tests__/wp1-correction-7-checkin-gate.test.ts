/**
 * WP1 CORRECTION 7 — standard check-in goes through the same central readiness
 * path. A pending vacate handoff on an allocated room blocks the check-in, and
 * an unreadable handoff state fails CLOSED. In both cases the check-in RPC is
 * never called, so nothing half-applies.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";
const RESERVATION = "77777777-7777-4777-8777-777777777777";
const ROOM = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, any>;

const db: Record<string, Row[]> = {
  hotel_housekeeping_handoffs: [],
  hotel_room_housekeeping: [],
  hotel_reservation_rooms: [],
};
const errorTables = new Set<string>();
const rpcCalls: { name: string }[] = [];

function tableStub(table: string) {
  const eqs: Record<string, unknown> = {};
  let inFilter: { col: string; values: unknown[] } | null = null;
  const resolve = () => {
    if (errorTables.has(table)) return { data: null, error: { message: "boom" } };
    const rows = (db[table] ?? []).filter((row) => {
      for (const [col, val] of Object.entries(eqs)) if (row[col] !== val) return false;
      if (inFilter && !inFilter.values.includes(row[inFilter.col])) return false;
      return true;
    });
    return { data: rows, error: null };
  };
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      eqs[col] = val;
      return chain;
    },
    in: (col: string, values: unknown[]) => {
      inFilter = { col, values };
      return chain;
    },
    neq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      const out = resolve();
      if (out.error) return out;
      return { data: out.data?.[0] ?? null, error: null };
    },
    then: (fn: (v: any) => unknown) => Promise.resolve(resolve()).then(fn),
  };
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (name: string) => {
      rpcCalls.push({ name });
      return {
        data: [{ out_status: "checked_in", out_checked_in_at: null, out_updated_at: "now" }],
        error: null,
      };
    },
    from: (table: string) => tableStub(table),
  },
}));

const ops = await import("@/lib/reservation-operations.server");

beforeEach(() => {
  rpcCalls.length = 0;
  errorTables.clear();
  db.hotel_housekeeping_handoffs = [];
  db.hotel_room_housekeeping = [
    { tenant_id: TENANT, hotel_room_id: ROOM, condition: "ready", dnd_active: false },
  ];
  db.hotel_reservation_rooms = [
    {
      tenant_id: TENANT,
      reservation_id: RESERVATION,
      hotel_room_id: ROOM,
      allocation_status: "assigned",
    },
  ];
});

async function checkIn() {
  return ops.checkInReservation({
    tenantId: TENANT,
    reservationId: RESERVATION,
    actorN3UserKey: "user-1",
    expectedUpdatedAt: null,
  });
}

describe("Correction 7 — standard check-in and pending handoffs", () => {
  it("A. Ready + no DND but a pending handoff blocks; the check-in RPC never runs", async () => {
    db.hotel_housekeeping_handoffs = [
      { id: "h1", tenant_id: TENANT, hotel_room_id: ROOM, state: "pending", attempts: 0 },
    ];
    await expect(checkIn()).rejects.toMatchObject({ code: "handoff_pending" });
    expect(rpcCalls.filter((c) => c.name === "hotelhub_check_in_reservation")).toHaveLength(0);
  });

  it("F. a pending handoff past the retry budget still blocks", async () => {
    db.hotel_housekeeping_handoffs = [
      { id: "h1", tenant_id: TENANT, hotel_room_id: ROOM, state: "pending", attempts: 17 },
    ];
    await expect(checkIn()).rejects.toMatchObject({ code: "handoff_pending" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("D. an unreadable pending-handoff state fails closed; no check-in mutation", async () => {
    errorTables.add("hotel_housekeeping_handoffs");
    await expect(checkIn()).rejects.toMatchObject({ code: "readiness_read_failed" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("G/H/I. applied, cancelled and other-tenant handoffs do not block the check-in", async () => {
    db.hotel_housekeeping_handoffs = [
      { id: "h1", tenant_id: TENANT, hotel_room_id: ROOM, state: "applied", attempts: 1 },
      { id: "h2", tenant_id: TENANT, hotel_room_id: ROOM, state: "cancelled", attempts: 1 },
      { id: "h3", tenant_id: OTHER_TENANT, hotel_room_id: ROOM, state: "pending", attempts: 1 },
    ];
    await expect(checkIn()).resolves.toMatchObject({ status: "checked_in" });
    expect(rpcCalls.map((c) => c.name)).toContain("hotelhub_check_in_reservation");
  });
});
