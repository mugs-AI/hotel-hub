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
  allowedTransitions,
  boardGroup,
  canClearDnd,
  canSetDnd,
  checkInBlockers,
  isHousekeepingCondition,
  nextStepHint,
  type BoardGroup,
  type BootstrapCondition,
  type HousekeepingCondition,
  type HousekeepingTransition,
  type RoomOccupancy,
  type RoomTurnaroundState,
} from "./housekeeping";
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

export type HousekeepingBoardDTO = {
  propertyDate: string;
  timezone: string;
  mode: "simple" | "dedicated";
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
  mode: "simple" | "dedicated";
}): Promise<HousekeepingBoardDTO> {
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
      availableTransitions: allowedTransitions(state),
      canSetDnd: canSetDnd(state),
      canClearDnd: canClearDnd(state),
      checkInBlockers: checkInBlockers(state),
    };
  });

  return { propertyDate: today, timezone: input.timezone, mode: input.mode, rooms, counts };
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

export async function transitionRoom(input: {
  tenantId: string;
  roomId: string;
  actorN3UserKey: string;
  transition: HousekeepingTransition;
  note: string | null;
}): Promise<{
  previousCondition: HousekeepingCondition;
  condition: HousekeepingCondition;
  dndActive: boolean;
}> {
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
}): Promise<{ condition: HousekeepingCondition; dndActive: boolean }> {
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

/**
 * Vacated-room handoff: the guest has left this physical room, so it becomes
 * Dirty and any Do Not Disturb is cleared. Never fabricates a condition for a
 * room that was never initialised, and never throws into the caller's flow —
 * a housekeeping bookkeeping failure must not undo an approved room change.
 */
export async function vacateRoomSafely(input: {
  tenantId: string;
  roomId: string;
  actorN3UserKey: string;
  source: string;
}): Promise<{ applied: boolean }> {
  try {
    const sb = await admin();
    const res = await sb.rpc("hotelhub_hk_vacate_room", {
      p_tenant_id: input.tenantId,
      p_hotel_room_id: input.roomId,
      p_actor_n3_user_key: input.actorN3UserKey,
      p_source: input.source,
    });
    if (res.error) throw new Error(res.error.message);
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    return { applied: Boolean(row?.out_applied) };
  } catch (err) {
    console.error("[housekeeping] vacate handoff failed", (err as Error).message);
    return { applied: false };
  }
}
