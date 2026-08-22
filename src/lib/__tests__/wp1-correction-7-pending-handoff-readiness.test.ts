/**
 * WP1 CORRECTION 7 — an unresolved pending vacate handoff makes a room unsafe
 * for a physical check-in, whatever its stored housekeeping condition says.
 *
 * These tests exercise the ONE server-authoritative readiness path
 * (`roomReadinessBlocker`) and the board, proving: pending blocks; attempts
 * beyond the retry budget still block; applied/cancelled do not block; every
 * read is positively tenant-scoped; a read failure fails CLOSED; and the board
 * counts ALL pending rows and surfaces `handoff_pending` per room.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";
const ROOM = "44444444-4444-4444-8444-444444444444";
const ROOM_B = "99999999-9999-4999-8999-999999999999";

type Row = Record<string, any>;

const db: Record<string, Row[]> = {
  hotel_housekeeping_handoffs: [],
  hotel_room_housekeeping: [],
  hotel_rooms: [],
  hotel_reservation_rooms: [],
};
const errorTables = new Set<string>();

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
    lt: () => chain,
    lte: () => chain,
    gte: () => chain,
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
    rpc: async () => ({ data: null, error: { message: "unscripted" } }),
    from: (table: string) => tableStub(table),
  },
}));

vi.mock("@/lib/tenant-store.server", () => ({
  resolveActorLabels: async () => new Map<string, string>(),
}));

const store = await import("@/lib/housekeeping-store.server");

function handoff(overrides: Row = {}): Row {
  return {
    id: "h1",
    tenant_id: TENANT,
    hotel_room_id: ROOM,
    state: "pending",
    attempts: 0,
    ...overrides,
  };
}

function readyRoom(roomId = ROOM, tenantId = TENANT): Row {
  return {
    tenant_id: tenantId,
    hotel_room_id: roomId,
    condition: "ready",
    dnd_active: false,
    dnd_set_at: null,
    last_action: null,
    last_actor_n3_user_key: null,
    last_transition_at: null,
  };
}

beforeEach(() => {
  db.hotel_housekeeping_handoffs = [];
  db.hotel_room_housekeeping = [readyRoom(ROOM), readyRoom(ROOM_B)];
  db.hotel_rooms = [
    {
      id: ROOM,
      tenant_id: TENANT,
      room_number: "101",
      display_name: null,
      n3_stock_name: null,
      room_type: "Deluxe",
      floor: "1",
      max_occupancy: 2,
      is_active: true,
    },
    {
      id: ROOM_B,
      tenant_id: TENANT,
      room_number: "102",
      display_name: null,
      n3_stock_name: null,
      room_type: "Deluxe",
      floor: "1",
      max_occupancy: 2,
      is_active: true,
    },
  ];
  db.hotel_reservation_rooms = [];
  errorTables.clear();
});

describe("Correction 7 — central readiness blocks on unresolved pending handoffs", () => {
  it("F/A. a Ready, non-DND room with a pending handoff is blocked (attempts 0 and >= 10)", async () => {
    for (const attempts of [0, 10, 25]) {
      db.hotel_housekeeping_handoffs = [handoff({ attempts })];
      await expect(store.roomReadinessBlocker(TENANT, [ROOM])).resolves.toBe("handoff_pending");
    }
  });

  it("G. an applied handoff does not block", async () => {
    db.hotel_housekeeping_handoffs = [handoff({ state: "applied", attempts: 3 })];
    await expect(store.roomReadinessBlocker(TENANT, [ROOM])).resolves.toBeNull();
  });

  it("H. a cancelled handoff does not block", async () => {
    db.hotel_housekeeping_handoffs = [handoff({ state: "cancelled" })];
    await expect(store.roomReadinessBlocker(TENANT, [ROOM])).resolves.toBeNull();
  });

  it("I. a pending handoff in tenant B cannot block the same room reference in tenant A", async () => {
    db.hotel_housekeeping_handoffs = [handoff({ tenant_id: OTHER_TENANT })];
    await expect(store.roomReadinessBlocker(TENANT, [ROOM])).resolves.toBeNull();
    const read = await store.readPendingHandoffRooms(TENANT, [ROOM]);
    expect(read.status).toBe("ok");
    expect(read.status === "ok" && read.total).toBe(0);
  });

  it("D/E. an unreadable pending-handoff state fails CLOSED before any mutation", async () => {
    errorTables.add("hotel_housekeeping_handoffs");
    await expect(store.roomReadinessBlocker(TENANT, [ROOM])).rejects.toMatchObject({
      code: "readiness_read_failed",
    });
    expect(store.statusForHousekeepingError("readiness_read_failed")).toBe(503);
    expect(store.statusForHousekeepingError("handoff_pending")).toBe(409);
  });

  it("read failure is never reported as 'no pending handoffs'", async () => {
    errorTables.add("hotel_housekeeping_handoffs");
    const read = await store.readPendingHandoffRooms(TENANT);
    expect(read.status).toBe("error");
  });

  it("a pending handoff on ANOTHER room does not block this room", async () => {
    db.hotel_housekeeping_handoffs = [handoff({ hotel_room_id: ROOM_B })];
    await expect(store.roomReadinessBlocker(TENANT, [ROOM])).resolves.toBeNull();
    await expect(store.roomReadinessBlocker(TENANT, [ROOM, ROOM_B])).resolves.toBe(
      "handoff_pending",
    );
  });
});

describe("Correction 7 — board pending count and per-room blockers", () => {
  const boardInput = {
    tenantId: TENANT,
    timezone: "Asia/Kuala_Lumpur",
    mode: "dedicated" as const,
    role: "owner" as const,
  };

  it("J. a Ready room with a pending handoff exposes handoff_pending in checkInBlockers", async () => {
    db.hotel_housekeeping_handoffs = [handoff()];
    const board = await store.getHousekeepingBoard(boardInput);
    const room = board.rooms.find((r) => r.roomId === ROOM)!;
    expect(room.condition).toBe("ready");
    expect(room.checkInBlockers).toContain("handoff_pending");
    const other = board.rooms.find((r) => r.roomId === ROOM_B)!;
    expect(other.checkInBlockers).not.toContain("handoff_pending");
  });

  it("K. pending count includes rows with attempts >= 10", async () => {
    db.hotel_housekeeping_handoffs = [
      handoff({ id: "h1", attempts: 0 }),
      handoff({ id: "h2", hotel_room_id: ROOM_B, attempts: 42 }),
      handoff({ id: "h3", state: "applied" }),
      handoff({ id: "h4", tenant_id: OTHER_TENANT }),
    ];
    const board = await store.getHousekeepingBoard(boardInput);
    expect(board.pendingHandoffs).toBe(2);
  });

  it("L. an unreadable pending-handoff state fails the board closed", async () => {
    errorTables.add("hotel_housekeeping_handoffs");
    await expect(store.getHousekeepingBoard(boardInput)).rejects.toMatchObject({
      code: "readiness_read_failed",
    });
  });

  it("10/11. handoff_pending is a blocker, not a housekeeping condition", async () => {
    db.hotel_housekeeping_handoffs = [handoff()];
    const board = await store.getHousekeepingBoard(boardInput);
    const room = board.rooms.find((r) => r.roomId === ROOM)!;
    expect(room.condition).toBe("ready");
    expect(["needs_attention", "in_progress", "ready", "not_set_up"]).toContain(room.group);
  });
});
