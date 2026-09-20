// GET  /api/hotel/rooms   — Owner + Front Desk (housekeeper excluded).
// POST /api/hotel/rooms   — Owner only. Body: { code, displayName?, roomType?, floor?, maxOccupancy?, baseRate? }
//                            Server verifies `code` against N3 stock list; room_number always = verified code.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission, destroySession } from "@/lib/session-context.server";
import { verifyN3StockByCode, type N3StockSummary } from "@/lib/n3-gateway.server";
import { createRoom, listRooms } from "@/lib/hotel-store.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export type RoomImportSeed = {
  displayName: string;
  roomType: string;
  floor: string;
  maxOccupancy: number;
  baseRate: number;
};

export type RoomImportSeedResult =
  { ok: true; value: RoomImportSeed } | { ok: false; code: string };

/**
 * Translate only server-verified N3 Stock Master values into the opening HH
 * room values. Missing or non-numeric Group/Class data fails closed so a bad
 * N3 master can never become a plausible-looking local default.
 */
export function roomImportSeed(stock: N3StockSummary): RoomImportSeedResult {
  const displayName = stock.name?.trim() ?? "";
  if (!displayName) return { ok: false, code: "n3_stock_name_missing" };
  const roomType = stock.category?.trim() ?? "";
  if (!roomType) return { ok: false, code: "n3_stock_category_missing" };

  const rawFloor = stock.group?.trim() ?? "";
  if (!/^-?\d+$/.test(rawFloor)) {
    return { ok: false, code: "n3_stock_group_must_be_numeric" };
  }
  const floorNumber = Number(rawFloor);
  if (!Number.isSafeInteger(floorNumber)) {
    return { ok: false, code: "n3_stock_group_must_be_numeric" };
  }

  const rawCapacity = stock.stockClass?.trim() ?? "";
  if (!/^\d+$/.test(rawCapacity)) {
    return { ok: false, code: "n3_stock_class_must_be_positive_integer" };
  }
  const maxOccupancy = Number(rawCapacity);
  if (!Number.isSafeInteger(maxOccupancy) || maxOccupancy < 1) {
    return { ok: false, code: "n3_stock_class_must_be_positive_integer" };
  }

  if (stock.listPrice === null || !Number.isFinite(stock.listPrice) || stock.listPrice < 0) {
    return { ok: false, code: "n3_stock_list_price_invalid" };
  }

  return {
    ok: true,
    value: {
      displayName,
      roomType,
      floor: String(floorNumber),
      maxOccupancy,
      baseRate: stock.listPrice,
    },
  };
}

export async function handleListRooms(): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:rooms:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const rooms = await listRooms(ctx.session.tenantId!);
  return Response.json({ rooms }, { headers: { "cache-control": "no-store" } });
}

export async function handleCreateRoom({ request }: { request: Request }): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return deny(400, "invalid_json");
  }
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) return deny(400, "code_required");
  let result;
  try {
    result = await verifyN3StockByCode(ctx.session.n3Token, code);
  } catch {
    return deny(502, "n3_unavailable");
  }
  if (result.status === "unauthorized") {
    await destroySession("n3_401");
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "session.n3_401",
      detail: { endpoint: "stocks/list", origin: "room_create" },
    });
    return deny(401, "n3_unauthorized");
  }
  if (result.status === "unavailable") return deny(502, "n3_unavailable");
  if (result.status === "limit_reached") return deny(504, "n3_verification_limit_reached");
  if (result.status === "not_found") return deny(404, "stock_code_not_found_in_n3");
  const verified = result.item;
  const seed = roomImportSeed(verified);
  if (!seed.ok) return deny(422, seed.code);
  try {
    const room = await createRoom({
      tenantId: ctx.session.tenantId!,
      n3Stock: verified,
      ...seed.value,
    });
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.room.created",
      detail: { roomId: room.id, stockCode: room.n3StockCode },
    });
    return Response.json({ room }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const msg = (err as Error).message ?? "save_failed";
    if (/already mapped/i.test(msg)) return deny(409, "duplicate_stock_mapping");
    console.error("[rooms] create failed", msg.slice(0, 200));
    return deny(500, "save_failed");
  }
}

export const Route = createFileRoute("/api/hotel/rooms")({
  server: {
    handlers: {
      GET: handleListRooms,
      POST: handleCreateRoom,
    },
  },
});
