// GET /api/hotel/housekeeping — the room turnaround board.
//
// One board, served to both experiences. The response carries the property's
// housekeeping mode, THIS actor's authority in that mode, and the per-room
// allowed actions, so the Simple (Front Desk) surface and the Dedicated
// Housekeeping workspace can never disagree with the server about what a room
// can do next — or about who may do it.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { getHotelSettingsReadOnly } from "@/lib/hotel-store.server";
import {
  getHousekeepingBoard,
  HousekeepingError,
  reconcilePendingHandoffs,
  statusForHousekeepingError,
} from "@/lib/housekeeping-store.server";
import { housekeepingAuthority } from "@/lib/housekeeping";
import { deny } from "@/lib/operations-api.server";

export async function handleHousekeepingBoard(): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:housekeeping:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  try {
    // Read-only: a GET must never create a settings row as a side effect.
    const settings = await getHotelSettingsReadOnly(ctx.session.tenantId!);
    const mode = settings?.housekeepingMode ?? "simple";

    // The workflow the property runs narrows the static role matrix. A
    // housekeeper has no board at all in a simple front-desk property.
    const authority = housekeepingAuthority(mode, ctx.role);
    if (!authority.canViewBoard) return deny(403, "not_permitted_in_mode");

    // Self-healing: retry any vacated-room bookkeeping still outstanding
    // before reporting conditions, so the board is never quietly wrong.
    await reconcilePendingHandoffs(ctx.session.tenantId!);

    const board = await getHousekeepingBoard({
      tenantId: ctx.session.tenantId!,
      timezone: settings?.timezone ?? "Asia/Kuala_Lumpur",
      mode,
      role: ctx.role,
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
