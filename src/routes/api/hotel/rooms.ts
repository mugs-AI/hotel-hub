// GET  /api/hotel/rooms   — Owner + Front Desk (housekeeper excluded).
// POST /api/hotel/rooms   — Owner only. Body: { code, displayName?, roomType?, floor?, maxOccupancy?, baseRate? }
//                            Server verifies `code` against N3 stock list; room_number always = verified code.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { verifyN3StockByCode } from "@/lib/n3-gateway.server";
import { createRoom, listRooms } from "@/lib/hotel-store.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
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
  let verified;
  try {
    verified = await verifyN3StockByCode(ctx.session.n3Token, code);
  } catch {
    return deny(502, "n3_unavailable");
  }
  if (!verified) return deny(404, "stock_code_not_found_in_n3");

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() || null : null;
  const roomType =
    typeof body.roomType === "string" && body.roomType.trim() ? body.roomType.trim() : "standard";
  const floor = typeof body.floor === "string" ? body.floor.trim() || null : null;
  const maxOccupancy =
    typeof body.maxOccupancy === "number" && body.maxOccupancy >= 1 ? body.maxOccupancy : 2;
  const baseRate =
    typeof body.baseRate === "number" && body.baseRate >= 0 && Number.isFinite(body.baseRate)
      ? body.baseRate
      : 0;
  try {
    const room = await createRoom({
      tenantId: ctx.session.tenantId!,
      n3Stock: verified,
      displayName,
      roomType,
      floor,
      maxOccupancy,
      baseRate,
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
