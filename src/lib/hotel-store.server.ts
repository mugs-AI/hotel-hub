/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only tenant-scoped store for hotel settings and rooms.
// All operations require an explicit tenantId and only run under the
// service-role client. Callers MUST enforce role/tenant server-side before
// calling any function here — this module never trusts request input.

export type HotelSettings = {
  tenantId: string;
  currency: string;
  timezone: string;
  standardCheckInTime: string;
  standardCheckOutTime: string;
  walkInCustomer: {
    n3Id: string;
    n3Code: string;
    n3Name: string | null;
  } | null;
};

export type HotelRoom = {
  id: string;
  tenantId: string;
  n3StockId: string;
  n3StockCode: string;
  n3StockName: string | null;
  roomNumber: string;
  displayName: string | null;
  roomType: string;
  floor: string | null;
  maxOccupancy: number;
  baseRate: number;
  isActive: boolean;
};

type SettingsRow = {
  tenant_id: string;
  currency: string;
  timezone: string;
  standard_check_in_time: string;
  standard_check_out_time: string;
  n3_walk_in_customer_id: string | null;
  n3_walk_in_customer_code: string | null;
  n3_walk_in_customer_name: string | null;
};

function toSettings(row: SettingsRow): HotelSettings {
  return {
    tenantId: row.tenant_id,
    currency: row.currency,
    timezone: row.timezone,
    standardCheckInTime: row.standard_check_in_time,
    standardCheckOutTime: row.standard_check_out_time,
    walkInCustomer:
      row.n3_walk_in_customer_id && row.n3_walk_in_customer_code
        ? {
            n3Id: row.n3_walk_in_customer_id,
            n3Code: row.n3_walk_in_customer_code,
            n3Name: row.n3_walk_in_customer_name,
          }
        : null,
  };
}

export async function getOrCreateHotelSettings(tenantId: string): Promise<HotelSettings> {
  const { supabaseAdmin: _sa } = await import("@/integrations/supabase/client.server");
  const supabaseAdmin = _sa as unknown as { from: (t: string) => any };
  const existing = await supabaseAdmin
    .from("hotel_settings" as never)
    .select(
      "tenant_id, currency, timezone, standard_check_in_time, standard_check_out_time, n3_walk_in_customer_id, n3_walk_in_customer_code, n3_walk_in_customer_name",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existing.error) throw new Error(`hotel_settings read failed: ${existing.error.message}`);
  if (existing.data) return toSettings(existing.data as SettingsRow);
  const inserted = await supabaseAdmin
    .from("hotel_settings" as never)
    .insert({ tenant_id: tenantId } as never)
    .select(
      "tenant_id, currency, timezone, standard_check_in_time, standard_check_out_time, n3_walk_in_customer_id, n3_walk_in_customer_code, n3_walk_in_customer_name",
    )
    .single();
  if (inserted.error || !inserted.data) {
    throw new Error(`hotel_settings insert failed: ${inserted.error?.message ?? "unknown"}`);
  }
  return toSettings(inserted.data as SettingsRow);
}

export async function updateHotelSettings(
  tenantId: string,
  patch: Partial<{
    currency: string;
    timezone: string;
    standardCheckInTime: string;
    standardCheckOutTime: string;
  }>,
): Promise<HotelSettings> {
  await getOrCreateHotelSettings(tenantId); // ensure row exists
  const update: Record<string, unknown> = {};
  if (patch.currency) update.currency = patch.currency;
  if (patch.timezone) update.timezone = patch.timezone;
  if (patch.standardCheckInTime) update.standard_check_in_time = patch.standardCheckInTime;
  if (patch.standardCheckOutTime) update.standard_check_out_time = patch.standardCheckOutTime;
  const { supabaseAdmin: _sa } = await import("@/integrations/supabase/client.server");
  const supabaseAdmin = _sa as unknown as { from: (t: string) => any };
  const res = await supabaseAdmin
    .from("hotel_settings" as never)
    .update(update as never)
    .eq("tenant_id", tenantId)
    .select(
      "tenant_id, currency, timezone, standard_check_in_time, standard_check_out_time, n3_walk_in_customer_id, n3_walk_in_customer_code, n3_walk_in_customer_name",
    )
    .single();
  if (res.error || !res.data) {
    throw new Error(`hotel_settings update failed: ${res.error?.message ?? "unknown"}`);
  }
  return toSettings(res.data as SettingsRow);
}

export async function setWalkInCustomer(
  tenantId: string,
  customer: { n3Id: string; n3Code: string; n3Name: string | null },
): Promise<HotelSettings> {
  await getOrCreateHotelSettings(tenantId);
  const { supabaseAdmin: _sa } = await import("@/integrations/supabase/client.server");
  const supabaseAdmin = _sa as unknown as { from: (t: string) => any };
  const res = await supabaseAdmin
    .from("hotel_settings" as never)
    .update({
      n3_walk_in_customer_id: customer.n3Id,
      n3_walk_in_customer_code: customer.n3Code,
      n3_walk_in_customer_name: customer.n3Name,
    } as never)
    .eq("tenant_id", tenantId)
    .select(
      "tenant_id, currency, timezone, standard_check_in_time, standard_check_out_time, n3_walk_in_customer_id, n3_walk_in_customer_code, n3_walk_in_customer_name",
    )
    .single();
  if (res.error || !res.data) {
    throw new Error(`walk-in customer save failed: ${res.error?.message ?? "unknown"}`);
  }
  return toSettings(res.data as SettingsRow);
}

type RoomRow = {
  id: string;
  tenant_id: string;
  n3_stock_id: string;
  n3_stock_code: string;
  n3_stock_name: string | null;
  room_number: string;
  display_name: string | null;
  room_type: string;
  floor: string | null;
  max_occupancy: number;
  base_rate: string | number;
  is_active: boolean;
};

function toRoom(row: RoomRow): HotelRoom {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    n3StockId: row.n3_stock_id,
    n3StockCode: row.n3_stock_code,
    n3StockName: row.n3_stock_name,
    roomNumber: row.room_number,
    displayName: row.display_name,
    roomType: row.room_type,
    floor: row.floor,
    maxOccupancy: row.max_occupancy,
    baseRate: typeof row.base_rate === "string" ? Number(row.base_rate) : row.base_rate,
    isActive: row.is_active,
  };
}

const ROOM_COLS =
  "id, tenant_id, n3_stock_id, n3_stock_code, n3_stock_name, room_number, display_name, room_type, floor, max_occupancy, base_rate, is_active";

export async function listRooms(tenantId: string): Promise<HotelRoom[]> {
  const { supabaseAdmin: _sa } = await import("@/integrations/supabase/client.server");
  const supabaseAdmin = _sa as unknown as { from: (t: string) => any };
  const res = await supabaseAdmin
    .from("hotel_rooms" as never)
    .select(ROOM_COLS)
    .eq("tenant_id", tenantId)
    .order("n3_stock_code");
  if (res.error) throw new Error(`hotel_rooms list failed: ${res.error.message}`);
  return ((res.data ?? []) as RoomRow[]).map(toRoom);
}

export type CreateRoomInput = {
  tenantId: string;
  // Verified from N3 server-side; caller MUST pass values returned by
  // verifyN3StockByCode, never browser-supplied.
  n3Stock: { id: string; code: string; name: string | null };
  displayName?: string | null;
  roomType?: string;
  floor?: string | null;
  maxOccupancy?: number;
  baseRate?: number;
};

export async function createRoom(input: CreateRoomInput): Promise<HotelRoom> {
  const { supabaseAdmin: _sa } = await import("@/integrations/supabase/client.server");
  const supabaseAdmin = _sa as unknown as { from: (t: string) => any };
  const baseRate =
    typeof input.baseRate === "number" && input.baseRate >= 0 && Number.isFinite(input.baseRate)
      ? input.baseRate
      : 0;
  const maxOccupancy =
    typeof input.maxOccupancy === "number" && input.maxOccupancy >= 1
      ? Math.floor(input.maxOccupancy)
      : 2;
  const res = await supabaseAdmin
    .from("hotel_rooms" as never)
    .insert({
      tenant_id: input.tenantId,
      n3_stock_id: input.n3Stock.id,
      n3_stock_code: input.n3Stock.code,
      n3_stock_name: input.n3Stock.name,
      // room_number ALWAYS equals the verified N3 stock code. Browser
      // input for room_number is not accepted anywhere in this module.
      room_number: input.n3Stock.code,
      display_name: input.displayName ?? null,
      room_type: input.roomType ?? "standard",
      floor: input.floor ?? null,
      max_occupancy: maxOccupancy,
      base_rate: baseRate,
      is_active: true,
    } as never)
    .select(ROOM_COLS)
    .single();
  if (res.error || !res.data) {
    // Postgres unique violation → duplicate mapping.
    const msg = res.error?.message ?? "unknown";
    if (/duplicate|unique/i.test(msg)) {
      throw new Error("This N3 stock code is already mapped to a room for your hotel.");
    }
    throw new Error(`room create failed: ${msg}`);
  }
  return toRoom(res.data as RoomRow);
}

export async function updateRoom(
  tenantId: string,
  roomId: string,
  patch: Partial<{
    displayName: string | null;
    roomType: string;
    floor: string | null;
    maxOccupancy: number;
    baseRate: number;
    isActive: boolean;
  }>,
): Promise<HotelRoom> {
  const update: Record<string, unknown> = {};
  if ("displayName" in patch) update.display_name = patch.displayName;
  if (patch.roomType) update.room_type = patch.roomType;
  if ("floor" in patch) update.floor = patch.floor;
  if (typeof patch.maxOccupancy === "number" && patch.maxOccupancy >= 1) {
    update.max_occupancy = Math.floor(patch.maxOccupancy);
  }
  if (
    typeof patch.baseRate === "number" &&
    Number.isFinite(patch.baseRate) &&
    patch.baseRate >= 0
  ) {
    update.base_rate = patch.baseRate;
  }
  if (typeof patch.isActive === "boolean") update.is_active = patch.isActive;
  const { supabaseAdmin: _sa } = await import("@/integrations/supabase/client.server");
  const supabaseAdmin = _sa as unknown as { from: (t: string) => any };
  const res = await supabaseAdmin
    .from("hotel_rooms" as never)
    .update(update as never)
    .eq("tenant_id", tenantId)
    .eq("id", roomId)
    .select(ROOM_COLS)
    .single();
  if (res.error || !res.data) {
    throw new Error(`room update failed: ${res.error?.message ?? "not found"}`);
  }
  return toRoom(res.data as RoomRow);
}

/**
 * Remove a room mapping. In this milestone there are no reservations yet,
 * so a mapping is always safe to delete; if callers ever add a reservation
 * FK, this must switch to a soft-delete + reference check.
 */
export async function deleteRoom(tenantId: string, roomId: string): Promise<void> {
  const { supabaseAdmin: _sa } = await import("@/integrations/supabase/client.server");
  const supabaseAdmin = _sa as unknown as { from: (t: string) => any };
  const res = await supabaseAdmin
    .from("hotel_rooms" as never)
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", roomId);
  if (res.error) throw new Error(`room delete failed: ${res.error.message}`);
}
