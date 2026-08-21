// POST /api/hotel/housekeeping/rooms/:roomId — act on one room.
// GET  /api/hotel/housekeeping/rooms/:roomId — that room's history.
//
// One write endpoint with an explicit `action` discriminator. Each action is
// permission-gated separately: everyone operational may move the cleaning
// lifecycle, only the desk records a guest's Do Not Disturb, and only the
// Owner bootstraps a room that has never been tracked.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import { isUuid } from "@/lib/reservations-store.server";
import { deny, isSameOriginWrite, readJsonBody, rejectUnknown } from "@/lib/operations-api.server";
import { isBootstrapCondition, isHousekeepingTransition } from "@/lib/housekeeping";
import {
  HousekeepingError,
  initializeRoom,
  listRoomHistory,
  setRoomDnd,
  statusForHousekeepingError,
  transitionRoom,
} from "@/lib/housekeeping-store.server";

const ALLOWED = new Set(["action", "condition", "transition", "note", "active"]);

export async function handleRoomHistory({
  params,
}: {
  params: { roomId?: string };
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:housekeeping:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const roomId = params.roomId ?? "";
  if (!isUuid(roomId)) return deny(400, "invalid_id");
  try {
    const events = await listRoomHistory(ctx.session.tenantId!, roomId);
    return Response.json({ events }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const code = err instanceof HousekeepingError ? err.code : "housekeeping_failed";
    return deny(statusForHousekeepingError(code), code);
  }
}

export async function handleRoomAction({
  request,
  params,
}: {
  request: Request;
  params: { roomId?: string };
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "forbidden");
  const roomId = params.roomId ?? "";
  if (!isUuid(roomId)) return deny(400, "invalid_id");

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return deny(parsed.code === "body_too_large" ? 413 : 400, parsed.code);
  if (rejectUnknown(parsed.body, ALLOWED) !== null) return deny(400, "unknown_field");

  const action = parsed.body.action;
  const rawNote = parsed.body.note;
  if (rawNote !== undefined && rawNote !== null && typeof rawNote !== "string") {
    return deny(400, "validation_failed");
  }
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 300) || null : null;

  // Each action carries its own permission — never a single blanket gate.
  const permission =
    action === "initialize"
      ? "hotel:housekeeping:initialize"
      : action === "dnd"
        ? "hotel:housekeeping:dnd"
        : action === "transition"
          ? "hotel:housekeeping:update"
          : null;
  if (permission === null) return deny(400, "validation_failed");

  const { ctx, decision } = await requirePermission(permission);
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const tenantId = ctx.session.tenantId!;
  const actor = ctx.session.n3UserKey;

  try {
    if (action === "initialize") {
      const condition = parsed.body.condition;
      if (!isBootstrapCondition(condition)) return deny(400, "invalid_condition");
      const result = await initializeRoom({
        tenantId,
        roomId,
        actorN3UserKey: actor,
        condition,
      });
      if (result.created) {
        await logAudit({
          tenantId,
          n3UserKey: actor,
          eventType: "hotel.housekeeping.initialized",
          detail: { roomId, condition: result.condition },
        });
      }
      return Response.json(result, { headers: { "cache-control": "no-store" } });
    }

    if (action === "transition") {
      const transition = parsed.body.transition;
      if (!isHousekeepingTransition(transition)) return deny(400, "validation_failed");
      const result = await transitionRoom({
        tenantId,
        roomId,
        actorN3UserKey: actor,
        transition,
        note,
      });
      await logAudit({
        tenantId,
        n3UserKey: actor,
        eventType: "hotel.housekeeping.transitioned",
        detail: {
          roomId,
          transition,
          from: result.previousCondition,
          to: result.condition,
        },
      });
      return Response.json(result, { headers: { "cache-control": "no-store" } });
    }

    // action === "dnd"
    const active = parsed.body.active;
    if (typeof active !== "boolean") return deny(400, "validation_failed");
    const result = await setRoomDnd({ tenantId, roomId, actorN3UserKey: actor, active });
    await logAudit({
      tenantId,
      n3UserKey: actor,
      eventType: active ? "hotel.housekeeping.dnd_set" : "hotel.housekeeping.dnd_cleared",
      detail: { roomId, condition: result.condition },
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const code = err instanceof HousekeepingError ? err.code : "housekeeping_failed";
    await logAudit({
      tenantId,
      n3UserKey: actor,
      eventType: "hotel.housekeeping.action_failed",
      detail: { roomId, action, code },
    });
    return deny(statusForHousekeepingError(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/housekeeping/rooms/$roomId")({
  server: { handlers: { GET: handleRoomHistory, POST: handleRoomAction } },
});
