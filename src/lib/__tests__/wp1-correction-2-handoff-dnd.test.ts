/**
 * WP1 CORRECTION 2 — Do Not Disturb authority and fail-safe room-change handoff.
 *
 * Two guest-visible promises are locked here:
 *
 *   1. Do Not Disturb belongs to whoever is at the door. In a Dedicated
 *      property that includes the housekeeper; in a Simple front-desk property
 *      a housekeeper has no housekeeping authority at all.
 *   2. A guest is never moved out of a room unless the "this room is now
 *      dirty" instruction has first been written down somewhere durable — and
 *      that instruction is only ever carried out once the move is proven to
 *      have actually happened.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorize, type HotelRole } from "@/lib/rbac";

const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";
const ROOM = "44444444-4444-4444-8444-444444444444";
const OP = "55555555-5555-4555-8555-555555555555";
const HANDOFF = "66666666-6666-4666-8666-666666666666";

// ---------------------------------------------------------------------------
// Test doubles. The session, the tenant and the actor are always server-
// resolved: no test may inject them through a request body.
// ---------------------------------------------------------------------------

let currentRole: HotelRole = "housekeeper";
let currentMode: "simple" | "dedicated" = "dedicated";
let currentTenant = TENANT;

const audit: { eventType: string; detail: any }[] = [];

vi.mock("@/lib/audit.server", () => ({
  logAudit: async (e: { eventType: string; detail?: unknown }) => {
    audit.push({ eventType: e.eventType, detail: e.detail });
  },
}));

vi.mock("@/lib/session-context.server", () => ({
  requirePermission: async (permission: string) => ({
    ctx: {
      authenticated: true,
      session: { tenantId: currentTenant, n3UserKey: "user-1" },
      role: currentRole,
      roleStatus: "assigned",
    },
    decision: authorize(
      { hasSession: true, tenantId: currentTenant, role: currentRole },
      permission as never,
    ),
  }),
}));

vi.mock("@/lib/hotel-store.server", () => ({
  getHotelSettingsReadOnly: async () => ({
    housekeepingMode: currentMode,
    timezone: "Asia/Kuala_Lumpur",
  }),
}));

const dndCalls: any[] = [];
vi.mock("@/lib/housekeeping-store.server", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/housekeeping-store.server")>(
      "@/lib/housekeeping-store.server",
    );
  return {
    ...actual,
    setRoomDnd: async (input: any) => {
      dndCalls.push(input);
      return { roomId: input.roomId, condition: "ready", dndActive: input.active };
    },
  };
});

// A tiny scriptable stand-in for the admin database client. Only the shapes the
// store actually uses are supported, so a drift in usage fails loudly.
type RpcResult = { data?: any; error?: { message: string } };
const rpcScript: Record<string, () => RpcResult | Promise<RpcResult>> = {};
const rpcCalls: { name: string; args: any }[] = [];
let pendingRows: any[] = [];
let operationRows: Record<string, { tenant_id: string; state: string }> = {};

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
      const row = operationRows[String(filters["id"])];
      if (!row || row.tenant_id !== filters["tenant_id"]) return { data: null, error: null };
      return { data: { state: row.state }, error: null };
    },
    then: (resolve: (v: any) => unknown) => {
      const rows =
        table === "hotel_housekeeping_handoffs" && filters["tenant_id"] === currentTenant
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
      return await fn();
    },
    from: (table: string) => tableStub(table),
  },
}));

const { handleRoomAction } = await import("@/routes/api/hotel/housekeeping.rooms.$roomId");
const store = await import("@/lib/housekeeping-store.server");

function post(body: unknown): Request {
  return new Request("http://localhost:8080/api/hotel/housekeeping/rooms/" + ROOM, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:8080",
      host: "localhost:8080",
    },
    body: JSON.stringify(body),
  });
}

function dnd(active: boolean) {
  return handleRoomAction({ request: post({ action: "dnd", active }), params: { roomId: ROOM } });
}

beforeEach(() => {
  audit.length = 0;
  dndCalls.length = 0;
  rpcCalls.length = 0;
  pendingRows = [];
  operationRows = {};
  currentTenant = TENANT;
  for (const key of Object.keys(rpcScript)) delete rpcScript[key];
});

// ---------------------------------------------------------------------------
// 1. Do Not Disturb authority
// ---------------------------------------------------------------------------

describe("1. Do Not Disturb authority follows the property's workflow", () => {
  it("simple + housekeeper: refused (403) — there is no housekeeping team", async () => {
    currentMode = "simple";
    currentRole = "housekeeper";
    const res = await dnd(true);
    expect(res.status).toBe(403);
    expect(dndCalls).toHaveLength(0);
    await expect(res.json()).resolves.toMatchObject({ error: "not_permitted_in_mode" });
  });

  it("dedicated + housekeeper: may SET Do Not Disturb", async () => {
    currentMode = "dedicated";
    currentRole = "housekeeper";
    const res = await dnd(true);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ dndActive: true });
    expect(dndCalls[0]).toMatchObject({ active: true, tenantId: TENANT, roomId: ROOM });
    expect(audit.some((e) => e.eventType === "hotel.housekeeping.dnd_set")).toBe(true);
  });

  it("dedicated + housekeeper: may CLEAR Do Not Disturb", async () => {
    currentMode = "dedicated";
    currentRole = "housekeeper";
    const res = await dnd(false);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ dndActive: false });
    expect(audit.some((e) => e.eventType === "hotel.housekeeping.dnd_cleared")).toBe(true);
  });

  it("the desk and the owner keep Do Not Disturb in both workflows", async () => {
    for (const mode of ["simple", "dedicated"] as const) {
      for (const role of ["owner", "front_desk"] as const) {
        currentMode = mode;
        currentRole = role;
        expect((await dnd(true)).status).toBe(200);
      }
    }
  });

  it("cross-tenant: the room is always acted on under the session's own tenant", async () => {
    currentMode = "dedicated";
    currentRole = "housekeeper";
    // A caller trying to name another property is rejected outright — the
    // field does not exist in the contract.
    const res = await handleRoomAction({
      request: post({ action: "dnd", active: true, tenantId: OTHER_TENANT }),
      params: { roomId: ROOM },
    });
    expect(res.status).toBe(400);
    expect(dndCalls).toHaveLength(0);

    // And a legitimate call never carries anything but the session tenant.
    await dnd(true);
    expect(dndCalls[0].tenantId).toBe(TENANT);
    expect(dndCalls[0]).not.toHaveProperty("actorTenantId");
  });

  it("an unassigned role gets nothing", async () => {
    currentMode = "dedicated";
    currentRole = null as unknown as HotelRole;
    expect((await dnd(true)).status).toBe(403);
    expect(dndCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Fail-safe handoff durability
// ---------------------------------------------------------------------------

describe("2. The vacated-room instruction must be durable before the guest moves", () => {
  it("A. the enqueue fails closed instead of returning a silent null", async () => {
    rpcScript["hotelhub_hk_enqueue_handoff"] = () => ({ error: { message: "db down" } });
    await expect(
      store.enqueueRoomHandoff({
        tenantId: TENANT,
        roomId: ROOM,
        actorN3UserKey: "user-1",
        reservationId: null,
        operationRequestId: OP,
        source: "room_change",
      }),
    ).rejects.toMatchObject({ code: "handoff_not_recorded" });
  });

  it("A. an empty result is treated as no record at all", async () => {
    rpcScript["hotelhub_hk_enqueue_handoff"] = () => ({ data: [{}] });
    await expect(
      store.enqueueRoomHandoff({
        tenantId: TENANT,
        roomId: ROOM,
        actorN3UserKey: "user-1",
        reservationId: null,
        operationRequestId: OP,
        source: "room_change",
      }),
    ).rejects.toMatchObject({ code: "handoff_not_recorded" });
  });

  it("A. a durable id is returned on success", async () => {
    rpcScript["hotelhub_hk_enqueue_handoff"] = () => ({ data: [{ out_handoff_id: HANDOFF }] });
    await expect(
      store.enqueueRoomHandoff({
        tenantId: TENANT,
        roomId: ROOM,
        actorN3UserKey: "user-1",
        reservationId: null,
        operationRequestId: OP,
        source: "room_change",
      }),
    ).resolves.toBe(HANDOFF);
  });

  it("B. a recorded intent whose operation was rejected never dirties the room", async () => {
    pendingRows = [
      {
        id: HANDOFF,
        hotel_room_id: ROOM,
        actor_n3_user_key: "user-1",
        source: "room_change",
        operation_request_id: OP,
        attempts: 0,
      },
    ];
    operationRows[OP] = { tenant_id: TENANT, state: "rejected" };
    rpcScript["hotelhub_hk_cancel_handoff"] = () => ({ data: null });

    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 1 });
    expect(rpcCalls.some((c) => c.name === "hotelhub_hk_vacate_room_v2")).toBe(false);
  });

  it("B. an operation that no longer exists retires the queue row", async () => {
    pendingRows = [
      {
        id: HANDOFF,
        hotel_room_id: ROOM,
        actor_n3_user_key: "user-1",
        source: "room_change",
        operation_request_id: OP,
        attempts: 0,
      },
    ];
    rpcScript["hotelhub_hk_cancel_handoff"] = () => ({ data: null });
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out.cancelled).toBe(1);
    expect(rpcCalls.some((c) => c.name === "hotelhub_hk_vacate_room_v2")).toBe(false);
  });

  it("C. an undecided operation is deferred, not applied and not thrown away", async () => {
    pendingRows = [
      {
        id: HANDOFF,
        hotel_room_id: ROOM,
        actor_n3_user_key: "user-1",
        source: "room_change",
        operation_request_id: OP,
        attempts: 3,
      },
    ];
    operationRows[OP] = { tenant_id: TENANT, state: "pending" };
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ applied: 0, cancelled: 0, deferred: 1 });
    expect(rpcCalls.some((c) => c.name === "hotelhub_hk_vacate_room_v2")).toBe(false);
  });

  it("C. cancellation reports whether it was durably confirmed", async () => {
    rpcScript["hotelhub_hk_cancel_handoff"] = () => ({ error: { message: "db down" } });
    await expect(store.cancelRoomHandoff(TENANT, HANDOFF)).resolves.toBe(false);
    rpcScript["hotelhub_hk_cancel_handoff"] = () => ({ data: null });
    await expect(store.cancelRoomHandoff(TENANT, HANDOFF)).resolves.toBe(true);
    // Repeating it is harmless.
    await expect(store.cancelRoomHandoff(TENANT, HANDOFF)).resolves.toBe(true);
  });

  it("D. a completed move whose bookkeeping fails stays pending and retryable", async () => {
    rpcScript["hotelhub_hk_vacate_room_v2"] = () => ({ error: { message: "transient" } });
    rpcScript["hotelhub_hk_fail_handoff"] = () => ({ data: null });
    const res = await store.applyRoomHandoff({
      tenantId: TENANT,
      roomId: ROOM,
      actorN3UserKey: "user-1",
      source: "room_change",
      handoffId: HANDOFF,
    });
    expect(res).toMatchObject({ applied: false, pending: true });
    expect(rpcCalls.some((c) => c.name === "hotelhub_hk_fail_handoff")).toBe(true);
  });

  it("E. the retry dirties the old room exactly once for a proven move", async () => {
    pendingRows = [
      {
        id: HANDOFF,
        hotel_room_id: ROOM,
        actor_n3_user_key: "user-1",
        source: "room_change",
        operation_request_id: OP,
        attempts: 1,
      },
    ];
    operationRows[OP] = { tenant_id: TENANT, state: "applied" };
    rpcScript["hotelhub_hk_vacate_room_v2"] = () => ({
      data: [{ out_applied: true, out_created: true }],
    });

    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ attempted: 1, applied: 1 });
    const vacates = rpcCalls.filter((c) => c.name === "hotelhub_hk_vacate_room_v2");
    expect(vacates).toHaveLength(1);
    // A previously uninitialised room is set up as dirty rather than skipped.
    expect(vacates[0].args).toMatchObject({
      p_tenant_id: TENANT,
      p_hotel_room_id: ROOM,
      p_handoff_id: HANDOFF,
    });
  });

  it("F. a duplicate retry is idempotent: the queue is already empty", async () => {
    operationRows[OP] = { tenant_id: TENANT, state: "applied" };
    pendingRows = []; // the row was closed by the first successful pass
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out).toMatchObject({ attempted: 0, applied: 0 });
    expect(rpcCalls.some((c) => c.name === "hotelhub_hk_vacate_room_v2")).toBe(false);
  });

  it("G. one property can never reconcile another property's queue", async () => {
    pendingRows = [
      {
        id: HANDOFF,
        hotel_room_id: ROOM,
        actor_n3_user_key: "user-1",
        source: "room_change",
        operation_request_id: OP,
        attempts: 0,
      },
    ];
    operationRows[OP] = { tenant_id: TENANT, state: "applied" };
    rpcScript["hotelhub_hk_vacate_room_v2"] = () => ({ data: [{ out_applied: true }] });

    const out = await store.reconcilePendingHandoffs(OTHER_TENANT);
    expect(out).toMatchObject({ attempted: 0, applied: 0 });
    expect(rpcCalls.some((c) => c.name === "hotelhub_hk_vacate_room_v2")).toBe(false);
  });

  it("G. an operation belonging to another property proves nothing", async () => {
    pendingRows = [
      {
        id: HANDOFF,
        hotel_room_id: ROOM,
        actor_n3_user_key: "user-1",
        source: "room_change",
        operation_request_id: OP,
        attempts: 0,
      },
    ];
    operationRows[OP] = { tenant_id: OTHER_TENANT, state: "applied" };
    rpcScript["hotelhub_hk_cancel_handoff"] = () => ({ data: null });
    const out = await store.reconcilePendingHandoffs(TENANT);
    expect(out.applied).toBe(0);
    expect(rpcCalls.some((c) => c.name === "hotelhub_hk_vacate_room_v2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. The decision route refuses the move when the instruction cannot be stored
// ---------------------------------------------------------------------------

describe("3. The room change refuses to proceed without a durable instruction", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const src = readFileSync(
    resolve(__dirname, "../../routes/api/hotel/reservations.$id.operations.$requestId.decision.ts"),
    "utf8",
  );

  it("fails closed BEFORE the decision is taken", () => {
    const denyAt = src.indexOf('deny(503, "handoff_not_recorded")');
    const decideAt = src.indexOf("await decideOperation(");
    expect(denyAt).toBeGreaterThan(-1);
    expect(decideAt).toBeGreaterThan(denyAt);
  });

  it("never proceeds with a missing handoff id when a physical room is vacated", () => {
    expect(src).toMatch(/if \(!handoffId\) \{/);
    expect(src).toMatch(/hotel\.housekeeping\.handoff_not_recorded/);
  });
});
