// PATCH  /api/hotel/rooms/:id — Owner. Update room_type, floor, max_occupancy, base_rate, is_active, display_name.
// DELETE /api/hotel/rooms/:id — Owner. Removes the mapping (no reservations exist yet in this milestone).
// room_number and n3_stock_code are IMMUTABLE from this endpoint.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { deleteRoom, updateRoom } from "@/lib/hotel-store.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function handlePatchRoom({
  request,
  params,
}: {
  request: Request;
  params: { id?: string };
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!id) return deny(400, "id_required");
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return deny(400, "invalid_json");
  }
  const patch: Parameters<typeof updateRoom>[2] = {};
  if ("displayName" in body) {
    patch.displayName =
      typeof body.displayName === "string" ? body.displayName.trim() || null : null;
  }
  if (typeof body.roomType === "string" && body.roomType.trim())
    patch.roomType = body.roomType.trim();
  if ("floor" in body)
    patch.floor = typeof body.floor === "string" ? body.floor.trim() || null : null;
  if (typeof body.maxOccupancy === "number" && body.maxOccupancy >= 1) {
    patch.maxOccupancy = body.maxOccupancy;
  }
  if (typeof body.baseRate === "number" && body.baseRate >= 0 && Number.isFinite(body.baseRate)) {
    patch.baseRate = body.baseRate;
  }
  if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
  try {
    const room = await updateRoom(ctx.session.tenantId!, id, patch);
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: patch.isActive === false ? "hotel.room.deactivated" : "hotel.room.updated",
      detail: { roomId: room.id, fields: Object.keys(patch) },
    });
    return Response.json({ room }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return deny(404, (err as Error).message ?? "not_found");
  }
}

export async function handleDeleteRoom({ params }: { params: { id?: string } }): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!id) return deny(400, "id_required");
  try {
    await deleteRoom(ctx.session.tenantId!, id);
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.room.deactivated",
      detail: { roomId: id, mode: "deleted" },
    });
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return deny(500, (err as Error).message ?? "delete_failed");
  }
}

export const Route = createFileRoute("/api/hotel/rooms/$id")({
  server: {
    handlers: {
      PATCH: handlePatchRoom,
      DELETE: handleDeleteRoom,
    },
  },
});
