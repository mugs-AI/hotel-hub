/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only housekeeping store (HotelHub WP1).
//
// Every write goes through a WP1-only SECURITY DEFINER routine that locks the
// room row, so two staff tapping the same room at the same time can never
// produce a wrong condition or a lost history entry. Tenant and actor always
// come from the trusted server session; this module never trusts the browser.
//
// Scope boundary: housekeeping ONLY. Nothing here touches N3, money,
// deposits, folios or reservation lifecycle state.

import {
  authorizedTransitions,
  boardGroup,
  canClearDnd,
  canSetDnd,
  canPerformTransition,
  checkInBlockers,
  housekeepingAuthority,
  isHousekeepingCondition,
  nextStepHint,
  type BoardGroup,
  type BootstrapCondition,
  type HousekeepingAuthority,
  type HousekeepingCondition,
  type HousekeepingMode,
  type HousekeepingTransition,
  type RoomOccupancy,
  type RoomTurnaroundState,
} from "./housekeeping";
import type { HotelRole } from "./rbac";
import { propertyTodayIso } from "./checkout-preview";
import { resolveActorLabels } from "./tenant-store.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** Stable, non-leaking error codes surfaced to the browser. */
export const HOUSEKEEPING_ERROR_CODES = new Set([
  "invalid_condition",
  "room_not_found",
  "housekeeping_not_initialized",
  "dnd_active",
  "illegal_transition",
  "room_not_occupied",
  "cleaning_in_progress",
  "housekeeping_failed",
  "validation_failed",
  "not_permitted_in_mode",
  "handoff_pending",
  "handoff_not_recorded",
]);

export class HousekeepingError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "HousekeepingError";
  }
}

/** Map the database's `HH1xx <code>` signal onto a stable browser code. */
export function mapHousekeepingRpcError(message: string | null | undefined): HousekeepingError {
  const msg = (message ?? "").toString();
  const hit = msg.match(/[a-z_]+/g)?.find((w) => HOUSEKEEPING_ERROR_CODES.has(w));
  return new HousekeepingError(hit ?? "housekeeping_failed");
}

export function statusForHousekeepingError(code: string): number {
  switch (code) {
    case "room_not_found":
      return 404;
    case "housekeeping_not_initialized":
    case "dnd_active":
    case "illegal_transition":
    case "room_not_occupied":
    case "cleaning_in_progress":
      return 409;
    case "invalid_condition":
    case "validation_failed":
      return 400;
    case "not_permitted_in_mode":
      return 403;
    default:
      return 500;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type HousekeepingRoomDTO = {
  roomId: string;
  roomLabel: string;
  roomNumber: string;
  floor: string | null;
  roomType: string;
  maxOccupancy: number;
  isActive: boolean;
  initialized: boolean;
  condition: HousekeepingCondition | null;
  dndActive: boolean;
  dndSetAt: string | null;
  lastAction: string | null;
  lastActorLabel: string | null;
  lastTransitionAt: string | null;
  occupancy: RoomOccupancy;
  occupancyReservationId: string | null;
  group: BoardGroup;
  nextStep: string;
  availableTransitions: HousekeepingTransition[];
  canSetDnd: boolean;
  canClearDnd: boolean;
  checkInBlockers: string[];
};

/** What THIS actor may do, decided by the server, mirrored to the UI. */
export type HousekeepingAuthorityDTO = {
  canViewBoard: boolean;
  canUseDedicatedWorkspace: boolean;
  canInitialize: boolean;
  canToggleDnd: boolean;
  canUpdate: boolean;
};

export type HousekeepingBoardDTO = {
  propertyDate: string;
  timezone: string;
  mode: HousekeepingMode;
  authority: HousekeepingAuthorityDTO;
  /** Vacated-room handoffs still awaiting bookkeeping (never silently lost). */
  pendingHandoffs: number;
  rooms: HousekeepingRoomDTO[];
  counts: Record<BoardGroup, number> & { dnd: number; uninitialized: number };
};

/** Room display-name precedence, unchanged from Rooms & Rates. */
function roomLabelOf(row: {
  display_name: string | null;
  n3_stock_name: string | null;
  room_number: string;
}): string {
  return row.display_name?.trim() || row.n3_stock_name?.trim() || row.room_number;
}

type OccupancyInfo = { occupancy: RoomOccupancy; reservationId: string | null };

/**
 * Derive today's occupancy per room from reservations. Checked-in stays win
 * over arrivals: a room someone is physically in must never be presented as
 * merely "arriving".
 */
async function occupancyByRoom(
  sb: any,
  tenantId: string,
  today: string,
): Promise<Map<string, OccupancyInfo>> {
  const res = await sb
    .from("hotel_reservation_rooms")
    .select(
      "hotel_room_id, arrival_date, departure_date, allocation_status, reservation_id, hotel_reservations!inner(id, status)",
    )
    .eq("tenant_id", tenantId)
    .neq("allocation_status", "released")
    .lte("arrival_date", today)
    .gte("departure_date", today);
  if (res.error) throw new HousekeepingError("housekeeping_failed");

  const map = new Map<string, OccupancyInfo>();
  for (const row of (res.data ?? []) as any[]) {
    const status = row.hotel_reservations?.status as string | undefined;
    if (status !== "checked_in" && status !== "confirmed" && status !== "tentative") continue;
    const isCheckedIn = status === "checked_in";
    const occupancy: RoomOccupancy = isCheckedIn
      ? row.departure_date === today
        ? "departing"
        : "occupied"
      : row.arrival_date === today
        ? "arriving"
        : "vacant";
    if (occupancy === "vacant") continue;
    const existing = map.get(row.hotel_room_id);
    // Checked-in truth beats a not-yet-arrived booking on the same room.
    if (existing && (existing.occupancy === "occupied" || existing.occupancy === "departing")) {
      continue;
    }
    map.set(row.hotel_room_id, { occupancy, reservationId: row.reservation_id });
  }
  return map;
}

export async function getHousekeepingBoard(input: {
  tenantId: string;
  timezone: string;
  mode: HousekeepingMode;
  role: HotelRole | null;
}): Promise<HousekeepingBoardDTO> {
  const authority = housekeepingAuthority(input.mode, input.role);
  const sb = await admin();
  const today = propertyTodayIso(input.timezone) ?? propertyTodayIso("Asia/Kuala_Lumpur")!;

  const roomsRes = await sb
    .from("hotel_rooms")
    .select(
      "id, room_number, display_name, n3_stock_name, room_type, floor, max_occupancy, is_active",
    )
    .eq("tenant_id", input.tenantId)
    .order("room_number");
  if (roomsRes.error) throw new HousekeepingError("housekeeping_failed");

  const hkRes = await sb
    .from("hotel_room_housekeeping")
    .select(
      "hotel_room_id, condition, dnd_active, dnd_set_at, last_action, last_actor_n3_user_key, last_transition_at",
    )
    .eq("tenant_id", input.tenantId);
  if (hkRes.error) throw new HousekeepingError("housekeeping_failed");

  const hkByRoom = new Map<string, any>();
  for (const row of (hkRes.data ?? []) as any[]) hkByRoom.set(row.hotel_room_id, row);

  const occupancy = await occupancyByRoom(sb, input.tenantId, today);
  const labels = await resolveActorLabels(
    input.tenantId,
    (hkRes.data ?? []).map((r: any) => r.last_actor_n3_user_key),
  );

  const counts = {
    needs_attention: 0,
    in_progress: 0,
    ready: 0,
    not_set_up: 0,
    dnd: 0,
    uninitialized: 0,
  };

  const rooms: HousekeepingRoomDTO[] = ((roomsRes.data ?? []) as any[]).map((r) => {
    const hk = hkByRoom.get(r.id);
    const condition = hk && isHousekeepingCondition(hk.condition) ? hk.condition : null;
    const occ = occupancy.get(r.id) ?? {
      occupancy: "vacant" as RoomOccupancy,
      reservationId: null,
    };
    const state: RoomTurnaroundState = {
      initialized: Boolean(hk),
      condition,
      dndActive: Boolean(hk?.dnd_active),
      occupancy: occ.occupancy,
      isActive: Boolean(r.is_active),
    };
    const group = boardGroup(state);
    counts[group] += 1;
    if (state.dndActive) counts.dnd += 1;
    if (!state.initialized) counts.uninitialized += 1;
    return {
      roomId: r.id,
      roomLabel: roomLabelOf(r),
      roomNumber: r.room_number,
      floor: r.floor ?? null,
      roomType: r.room_type,
      maxOccupancy: r.max_occupancy,
      isActive: Boolean(r.is_active),
      initialized: state.initialized,
      condition,
      dndActive: state.dndActive,
      dndSetAt: hk?.dnd_set_at ?? null,
      lastAction: hk?.last_action ?? null,
      lastActorLabel: hk?.last_actor_n3_user_key
        ? (labels.get(hk.last_actor_n3_user_key) ?? null)
        : null,
      lastTransitionAt: hk?.last_transition_at ?? null,
      occupancy: occ.occupancy,
      occupancyReservationId: occ.reservationId,
      group,
      nextStep: nextStepHint(state),
      // Server-authorised, not merely legal: the board can never offer a
      // button this actor is not allowed to press in this workflow.
      availableTransitions: authorizedTransitions(authority, state),
      canSetDnd: authority.canToggleDnd && canSetDnd(state),
      canClearDnd: authority.canToggleDnd && canClearDnd(state),
      checkInBlockers: checkInBlockers(state),
    };
  });

  return {
    propertyDate: today,
    timezone: input.timezone,
    mode: input.mode,
    authority: {
      canViewBoard: authority.canViewBoard,
      canUseDedicatedWorkspace: authority.canUseDedicatedWorkspace,
      canInitialize: authority.canInitialize,
      canToggleDnd: authority.canToggleDnd,
      canUpdate: authority.roleTransitions.length > 0,
    },
    pendingHandoffs: await countPendingHandoffs(input.tenantId),
    rooms,
    counts,
  };
}

export type HousekeepingEventDTO = {
  action: string;
  previousCondition: string | null;
  resultingCondition: string | null;
  dndBefore: boolean | null;
  dndAfter: boolean | null;
  actorLabel: string | null;
  source: string;
  note: string | null;
  createdAt: string;
};

export async function listRoomHistory(
  tenantId: string,
  roomId: string,
  limit = 50,
): Promise<HousekeepingEventDTO[]> {
  const sb = await admin();
  const res = await sb
    .from("hotel_housekeeping_events")
    .select(
      "action, previous_condition, resulting_condition, dnd_before, dnd_after, actor_n3_user_key, source, note, created_at",
    )
    .eq("tenant_id", tenantId)
    .eq("hotel_room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (res.error) throw new HousekeepingError("housekeeping_failed");
  const rows = (res.data ?? []) as any[];
  const labels = await resolveActorLabels(
    tenantId,
    rows.map((r) => r.actor_n3_user_key),
  );
  return rows.map((r) => ({
    action: r.action,
    previousCondition: r.previous_condition ?? null,
    resultingCondition: r.resulting_condition ?? null,
    dndBefore: r.dnd_before ?? null,
    dndAfter: r.dnd_after ?? null,
    actorLabel: r.actor_n3_user_key ? (labels.get(r.actor_n3_user_key) ?? null) : null,
    source: r.source,
    note: r.note ?? null,
    createdAt: r.created_at,
  }));
}

/**
 * Housekeeping state for a specific set of rooms, used by the check-in gate.
 * Returns `null` condition for rooms that were never initialised so callers
 * fail CLOSED rather than assuming a clean room.
 */
export async function readRoomStates(
  tenantId: string,
  roomIds: string[],
): Promise<Map<string, { condition: HousekeepingCondition | null; dndActive: boolean }>> {
  const out = new Map<string, { condition: HousekeepingCondition | null; dndActive: boolean }>();
  if (roomIds.length === 0) return out;
  const sb = await admin();
  const res = await sb
    .from("hotel_room_housekeeping")
    .select("hotel_room_id, condition, dnd_active")
    .eq("tenant_id", tenantId)
    .in("hotel_room_id", roomIds);
  if (res.error) throw new HousekeepingError("housekeeping_failed");
  for (const row of (res.data ?? []) as any[]) {
    out.set(row.hotel_room_id, {
      condition: isHousekeepingCondition(row.condition) ? row.condition : null,
      dndActive: Boolean(row.dnd_active),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writes — all atomic via WP1 SECURITY DEFINER routines
// ---------------------------------------------------------------------------

export async function initializeRoom(input: {
  tenantId: string;
  roomId: string;
  actorN3UserKey: string;
  condition: BootstrapCondition;
  source?: string;
}): Promise<{ condition: HousekeepingCondition; dndActive: boolean; created: boolean }> {
  const sb = await admin();
  const res = await sb.rpc("hotelhub_hk_initialize_room", {
    p_tenant_id: input.tenantId,
    p_hotel_room_id: input.roomId,
    p_actor_n3_user_key: input.actorN3UserKey,
    p_condition: input.condition,
    p_source: input.source ?? "owner_bootstrap",
  });
  if (res.error) throw mapHousekeepingRpcError(res.error.message);
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) throw new HousekeepingError("housekeeping_failed");
  return {
    condition: row.out_condition,
    dndActive: Boolean(row.out_dnd),
    created: Boolean(row.out_created),
  };
}

/**
 * Everything the mode-aware authority check needs about one room. Occupancy is
 * irrelevant to the cleaning lifecycle, so it is reported as vacant here.
 */
export async function readRoomAuthState(
  tenantId: string,
  roomId: string,
): Promise<RoomTurnaroundState> {
  const sb = await admin();
  const roomRes = await sb
    .from("hotel_rooms")
    .select("id, is_active")
    .eq("tenant_id", tenantId)
    .eq("id", roomId)
    .maybeSingle();
  if (roomRes.error) throw new HousekeepingError("housekeeping_failed");
  if (!roomRes.data) throw new HousekeepingError("room_not_found");

  const hkRes = await sb
    .from("hotel_room_housekeeping")
    .select("condition, dnd_active")
    .eq("tenant_id", tenantId)
    .eq("hotel_room_id", roomId)
    .maybeSingle();
  if (hkRes.error) throw new HousekeepingError("housekeeping_failed");
  const hk = hkRes.data as { condition: string | null; dnd_active: boolean } | null;
  return {
    initialized: Boolean(hk),
    condition: hk && isHousekeepingCondition(hk.condition) ? hk.condition : null,
    dndActive: Boolean(hk?.dnd_active),
    occupancy: "vacant",
    isActive: Boolean((roomRes.data as { is_active: boolean }).is_active),
  };
}

/**
 * Mode-aware transition guard. Runs on the SERVER before any write, so a
 * crafted request cannot borrow authority the property's workflow withholds.
 */
export async function assertTransitionAuthorized(input: {
  tenantId: string;
  roomId: string;
  authority: HousekeepingAuthority;
  transition: HousekeepingTransition;
}): Promise<void> {
  const state = await readRoomAuthState(input.tenantId, input.roomId);
  if (!state.initialized) throw new HousekeepingError("housekeeping_not_initialized");
  if (state.dndActive) throw new HousekeepingError("dnd_active");
  if (!input.authority.roleTransitions.includes(input.transition)) {
    throw new HousekeepingError("not_permitted_in_mode");
  }
  if (!canPerformTransition(input.authority, state, input.transition)) {
    // Legal-for-someone but not for this actor in this mode is a permission
    // refusal; otherwise the lifecycle itself rejects the shortcut.
    const legalForOwner = canPerformTransition(
      housekeepingAuthority(input.authority.mode, "owner"),
      state,
      input.transition,
    );
    throw new HousekeepingError(legalForOwner ? "not_permitted_in_mode" : "illegal_transition");
  }
}

export function assertDndAuthorized(authority: HousekeepingAuthority): void {
  if (!authority.canToggleDnd) throw new HousekeepingError("not_permitted_in_mode");
}

export async function transitionRoom(input: {
  tenantId: string;
  roomId: string;
  actorN3UserKey: string;
  transition: HousekeepingTransition;
  note: string | null;
  authority: HousekeepingAuthority;
}): Promise<{
  previousCondition: HousekeepingCondition;
  condition: HousekeepingCondition;
  dndActive: boolean;
}> {
  await assertTransitionAuthorized({
    tenantId: input.tenantId,
    roomId: input.roomId,
    authority: input.authority,
    transition: input.transition,
  });
  const sb = await admin();
  const res = await sb.rpc("hotelhub_hk_transition", {
    p_tenant_id: input.tenantId,
    p_hotel_room_id: input.roomId,
    p_actor_n3_user_key: input.actorN3UserKey,
    p_action: input.transition,
    p_note: input.note,
    p_source: "app",
  });
  if (res.error) throw mapHousekeepingRpcError(res.error.message);
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) throw new HousekeepingError("housekeeping_failed");
  return {
    previousCondition: row.out_previous,
    condition: row.out_condition,
    dndActive: Boolean(row.out_dnd),
  };
}

export async function setRoomDnd(input: {
  tenantId: string;
  roomId: string;
  actorN3UserKey: string;
  active: boolean;
  authority: HousekeepingAuthority;
}): Promise<{ condition: HousekeepingCondition; dndActive: boolean }> {
  assertDndAuthorized(input.authority);
  const sb = await admin();
  const res = await sb.rpc("hotelhub_hk_set_dnd", {
    p_tenant_id: input.tenantId,
    p_hotel_room_id: input.roomId,
    p_actor_n3_user_key: input.actorN3UserKey,
    p_active: input.active,
    p_source: "app",
  });
  if (res.error) throw mapHousekeepingRpcError(res.error.message);
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) throw new HousekeepingError("housekeeping_failed");
  return { condition: row.out_condition, dndActive: Boolean(row.out_dnd) };
}

// ---------------------------------------------------------------------------
// Vacated-room handoff (durable)
//
// When a guest is moved out of a room, that room is certainly not verified
// clean. The handoff is recorded BEFORE the room change is approved, applied
// atomically after it, and retried until it lands — it is never swallowed.
// ---------------------------------------------------------------------------

/**
 * Record the intent to dirty the room a guest is about to leave.
 *
 * This FAILS CLOSED. If the intent cannot be written durably the caller must
 * not proceed with the room change: a move applied without a recoverable
 * handoff leaves a bed that looks sellable and is not. There is no null
 * "best effort" result any more — either a durable id, or a thrown refusal.
 */
export async function enqueueRoomHandoff(input: {
  tenantId: string;
  roomId: string;
  actorN3UserKey: string;
  reservationId: string | null;
  operationRequestId: string | null;
  source: string;
}): Promise<string> {
  let handoffId: string | null = null;
  try {
    const sb = await admin();
    const res = await sb.rpc("hotelhub_hk_enqueue_handoff", {
      p_tenant_id: input.tenantId,
      p_hotel_room_id: input.roomId,
      p_actor_n3_user_key: input.actorN3UserKey,
      p_reservation_id: input.reservationId,
      p_operation_request_id: input.operationRequestId,
      p_source: input.source,
    });
    if (res.error) throw new Error(res.error.message);
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    handoffId = (row?.out_handoff_id as string | undefined) ?? null;
  } catch {
    throw new HousekeepingError("handoff_not_recorded");
  }
  if (!handoffId) throw new HousekeepingError("handoff_not_recorded");
  return handoffId;
}

/**
 * Withdraw a recorded intent. Idempotent: the routine only moves a row that is
 * still `pending`, so repeating it is harmless. Returns whether the withdrawal
 * was durably confirmed — an unconfirmed cancel is still safe because the
 * reconciler re-verifies the correlated operation before it ever dirties a room.
 */
export async function cancelRoomHandoff(tenantId: string, handoffId: string): Promise<boolean> {
  try {
    const sb = await admin();
    const res = await sb.rpc("hotelhub_hk_cancel_handoff", {
      p_tenant_id: tenantId,
      p_handoff_id: handoffId,
    });
    if (res?.error) throw new Error(res.error.message);
    return true;
  } catch (err) {
    console.error("[housekeeping] cancel handoff failed", (err as Error).message);
    return false;
  }
}

/**
 * Apply the handoff: room becomes Dirty, Do Not Disturb is cleared, history is
 * written and the queue row is closed — all in ONE database transaction. A
 * room that was never set up is set up as Dirty rather than skipped.
 *
 * Returns `applied: false` with `pending: true` when the bookkeeping could not
 * be completed, so the caller can report it instead of losing it. The queue row
 * stays pending and is retried on the next board read.
 */
export async function applyRoomHandoff(input: {
  tenantId: string;
  roomId: string;
  actorN3UserKey: string;
  source: string;
  handoffId: string | null;
}): Promise<{ applied: boolean; pending: boolean; created: boolean }> {
  try {
    const sb = await admin();
    const res = await sb.rpc("hotelhub_hk_vacate_room_v2", {
      p_tenant_id: input.tenantId,
      p_hotel_room_id: input.roomId,
      p_actor_n3_user_key: input.actorN3UserKey,
      p_source: input.source,
      p_handoff_id: input.handoffId,
    });
    if (res.error) throw new Error(res.error.message);
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    return {
      applied: Boolean(row?.out_applied),
      pending: !row?.out_applied && Boolean(input.handoffId),
      created: Boolean(row?.out_created),
    };
  } catch (err) {
    const message = (err as Error).message;
    console.error("[housekeeping] vacate handoff failed", message);
    if (input.handoffId) await failRoomHandoff(input.tenantId, input.handoffId, message);
    return { applied: false, pending: Boolean(input.handoffId), created: false };
  }
}

async function failRoomHandoff(
  tenantId: string,
  handoffId: string,
  message: string,
): Promise<void> {
  try {
    const sb = await admin();
    await sb.rpc("hotelhub_hk_fail_handoff", {
      p_tenant_id: tenantId,
      p_handoff_id: handoffId,
      p_error: message,
    });
  } catch {
    // Nothing further to do: the row is still pending and will be retried.
  }
}

export async function countPendingHandoffs(tenantId: string): Promise<number> {
  try {
    const sb = await admin();
    const res = await sb.rpc("hotelhub_hk_list_pending_handoffs", {
      p_tenant_id: tenantId,
      p_limit: 100,
    });
    if (res.error) return 0;
    return Array.isArray(res.data) ? res.data.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Operation states that MIGHT prove the guest moved. `applied` is the only
 * candidate: `hotelhub_decide_operation` performs the physical room change and
 * records `state='applied'` with `applied_at` in the same transaction, so an
 * `approved` row is NOT proof of anything and is only ever deferred.
 */
const HANDOFF_PROVEN_OPERATION_STATE = "applied";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Operation states that prove the move will never happen. */
const HANDOFF_ABANDONED_OPERATION_STATES = new Set(["rejected", "cancelled"]);

/**
 * Retry every handoff still waiting. Called on each board read and after each
 * room-change decision, so a transient failure self-heals without staff ever
 * having to know it happened.
 *
 * A pending row is NEVER applied on trust. The queue row itself proves nothing:
 * before the old room may be dirtied, the server re-reads the correlated
 * reservation operation AND the reservation-room association from authoritative
 * tenant-scoped tables and requires positive proof that this exact room_change
 * was applied and that the reservation room has actually moved off the old room.
 * An operation that was rejected, cancelled or has vanished retires the queue
 * row as `cancelled`. Anything unproven or unreadable stays pending.
 *
 * Every read and every write is scoped to `tenantId`, so one property can
 * never reconcile — or even observe — another property's queue.
 */
export async function reconcilePendingHandoffs(
  tenantId: string,
): Promise<{ attempted: number; applied: number; cancelled: number; deferred: number }> {
  let attempted = 0;
  let applied = 0;
  let cancelled = 0;
  let deferred = 0;
  try {
    const sb = await admin();
    const res = await sb
      .from("hotel_housekeeping_handoffs")
      .select(
        "id, hotel_room_id, reservation_id, actor_n3_user_key, source, operation_request_id, attempts",
      )
      .eq("tenant_id", tenantId)
      .eq("state", "pending")
      .lt("attempts", 10)
      .order("created_at", { ascending: true })
      .limit(20);
    if (res.error) return { attempted, applied, cancelled, deferred };

    for (const row of (res.data ?? []) as any[]) {
      const opId = row.operation_request_id as string | null;
      if (opId) {
        const verdict = await operationHandoffVerdict(sb, {
          tenantId,
          operationRequestId: opId,
          handoffReservationId: (row.reservation_id as string | null) ?? null,
          oldHotelRoomId: row.hotel_room_id as string,
        });
        if (verdict === "abandoned") {
          if (await cancelRoomHandoff(tenantId, row.id)) cancelled += 1;
          continue;
        }
        if (verdict !== "proven") {
          // Not proven (undecided, unreadable, or inconsistent): stay pending.
          deferred += 1;
          continue;
        }
      }
      attempted += 1;
      const result = await applyRoomHandoff({
        tenantId,
        roomId: row.hotel_room_id,
        actorN3UserKey: row.actor_n3_user_key,
        source: row.source ?? "room_change",
        handoffId: row.id,
      });
      if (result.applied) applied += 1;
    }
  } catch (err) {
    console.error("[housekeeping] reconcile failed", (err as Error).message);
  }
  return { attempted, applied, cancelled, deferred };
}

/**
 * Positive, fail-closed proof that a room_change physically happened.
 *
 * Requires, all from tenant-scoped authoritative rows and none of it from the
 * caller: the operation exists in this tenant, belongs to the same reservation
 * as the handoff, is exactly a `room_change`, is exactly `applied` with a
 * non-null `applied_at`, names a well-formed `reservation_room_id`, and that
 * reservation room still belongs to this tenant + reservation while now
 * pointing at a DIFFERENT physical room than the one being handed off.
 * Anything else is never "proven".
 */
async function operationHandoffVerdict(
  sb: any,
  input: {
    tenantId: string;
    operationRequestId: string;
    handoffReservationId: string | null;
    oldHotelRoomId: string;
  },
): Promise<"proven" | "abandoned" | "undecided"> {
  try {
    const res = await sb
      .from("hotel_reservation_operation_requests")
      .select("tenant_id, reservation_id, operation_type, state, applied_at, payload")
      .eq("tenant_id", input.tenantId)
      .eq("id", input.operationRequestId)
      .maybeSingle();
    // A read failure must not decide anything: leave the row pending.
    if (res.error) return "undecided";
    const op = res.data as {
      tenant_id?: string;
      reservation_id?: string;
      operation_type?: string;
      state?: string;
      applied_at?: string | null;
      payload?: Record<string, unknown> | null;
    } | null;
    // No such operation for this tenant — nothing proves a move happened.
    if (!op || !op.state) return "abandoned";
    if (op.tenant_id && op.tenant_id !== input.tenantId) return "abandoned";
    if (HANDOFF_ABANDONED_OPERATION_STATES.has(op.state)) return "abandoned";
    if (op.state !== HANDOFF_PROVEN_OPERATION_STATE) {
      // `approved`, `pending`, or an unrecognised state: defer, never dirty.
      return "undecided";
    }

    // From here on the row claims to be applied; every claim is verified.
    if (!op.applied_at) return "undecided";
    if (op.operation_type !== "room_change") return "undecided";
    if (input.handoffReservationId && op.reservation_id !== input.handoffReservationId) {
      return "undecided";
    }
    const payload = (op.payload ?? {}) as Record<string, unknown>;
    const rrid = payload["reservation_room_id"] ?? payload["reservationRoomId"];
    if (typeof rrid !== "string" || !UUID_RE.test(rrid)) return "undecided";

    const rr = await sb
      .from("hotel_reservation_rooms")
      .select("tenant_id, reservation_id, hotel_room_id")
      .eq("tenant_id", input.tenantId)
      .eq("id", rrid)
      .maybeSingle();
    if (rr.error) return "undecided";
    const link = rr.data as {
      tenant_id?: string;
      reservation_id?: string;
      hotel_room_id?: string;
    } | null;
    if (!link || !link.hotel_room_id) return "undecided";
    if (link.tenant_id && link.tenant_id !== input.tenantId) return "undecided";
    if (op.reservation_id && link.reservation_id !== op.reservation_id) return "undecided";
    if (link.hotel_room_id === input.oldHotelRoomId) return "undecided";
    return "proven";
  } catch {
    return "undecided";
  }
}


/**
 * Readiness gate for a destination room (early check-in, room change).
 * Fails CLOSED: an unknown condition is not a clean room. Returns the blocking
 * code or null.
 */
export async function roomReadinessBlocker(
  tenantId: string,
  roomIds: string[],
): Promise<string | null> {
  if (roomIds.length === 0) return null;
  const states = await readRoomStates(tenantId, roomIds);
  for (const roomId of roomIds) {
    const hk = states.get(roomId);
    const blockers = checkInBlockers({
      initialized: Boolean(hk),
      condition: hk?.condition ?? null,
      dndActive: Boolean(hk?.dndActive),
      occupancy: "vacant",
      isActive: true,
    });
    const blocking = blockers.find((b) => b !== "room_inactive");
    if (blocking) return blocking;
  }
  return null;
}
