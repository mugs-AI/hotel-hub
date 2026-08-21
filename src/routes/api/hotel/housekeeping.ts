// GET /api/hotel/housekeeping — the room turnaround board.
//
// One board, served to both experiences. The response already carries the
// property's housekeeping mode and the per-room allowed actions, so the
// Simple (Front Desk) surface and the Dedicated Housekeeping workspace can
// never disagree with the server about what a room can do next.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { getHotelSettingsReadOnly } from "@/lib/hotel-store.server";
import {
  getHousekeepingBoard,
  HousekeepingError,
  statusForHousekeepingError,
} from "@/lib/housekeeping-store.server";
import { deny } from "@/lib/operations-api.server";

export async function handleHousekeepingBoard(): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:housekeeping:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  try {
    // Read-only: a GET must never create a settings row as a side effect.
    const settings = await getHotelSettingsReadOnly(ctx.session.tenantId!);
    const board = await getHousekeepingBoard({
      tenantId: ctx.session.tenantId!,
      timezone: settings?.timezone ?? "Asia/Kuala_Lumpur",
      mode: settings?.housekeepingMode ?? "simple",
    });
    return Response.json(board, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const code = err instanceof HousekeepingError ? err.code : "housekeeping_failed";
    return deny(statusForHousekeepingError(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/housekeeping")({
  server: { handlers: { GET: handleHousekeepingBoard } },
});
