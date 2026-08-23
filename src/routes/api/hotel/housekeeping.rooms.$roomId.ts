// POST /api/hotel/housekeeping/rooms/:roomId — act on one room.
// GET  /api/hotel/housekeeping/rooms/:roomId — that room's history.
//
// One write endpoint with an explicit `action` discriminator. Each action is
// permission-gated separately AND narrowed by the property's housekeeping
// mode: the static role matrix is the outer gate, the active workflow decides
// what that role may actually do today.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import { isUuid } from "@/lib/reservations-store.server";
import { deny, isSameOriginWrite, readJsonBody, rejectUnknown } from "@/lib/operations-api.server";
import {
  housekeepingAuthority,
  isBootstrapCondition,
  isHousekeepingTransition,
} from "@/lib/housekeeping";
import { getHotelSettingsReadOnly } from "@/lib/hotel-store.server";
import {
  getHousekeepingRoomView,
  HousekeepingError,
  initializeRoom,
  listRoomHistory,
  setRoomDnd,
  statusForHousekeepingError,
  transitionRoom,
} from "@/lib/housekeeping-store.server";

/**
 * The authoritative post-write view of the ONE room that changed. The client
 * patches its board cache from this instead of waiting for a whole-board
 * refetch — the state still comes only from the server, never from a guess.
 * A read failure here never fails the write: the client simply resyncs.
 */
async function roomViewOrNull(input: {
  tenantId: string;
  timezone: string;
  mode: "simple" | "dedicated";
  role: Parameters<typeof housekeepingAuthority>[1];
  roomId: string;
}) {
  try {
    return await getHousekeepingRoomView(input);
  } catch {
    return null;
  }
}

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
    const settings = await getHotelSettingsReadOnly(ctx.session.tenantId!);
    const authority = housekeepingAuthority(settings?.housekeepingMode ?? "simple", ctx.role);
    if (!authority.canViewBoard) return deny(403, "not_permitted_in_mode");
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

  // Mode-aware authority. Enforced HERE, on the server, before any write.
  let authority;
  let timezone = "Asia/Kuala_Lumpur";
  try {
    const settings = await getHotelSettingsReadOnly(tenantId);
    timezone = settings?.timezone ?? timezone;
    authority = housekeepingAuthority(settings?.housekeepingMode ?? "simple", ctx.role);
  } catch {
    return deny(500, "housekeeping_failed");
  }
  if (!authority.canViewBoard) return deny(403, "not_permitted_in_mode");
  if (action === "dnd" && !authority.canToggleDnd) {
    await logAudit({
      tenantId,
      n3UserKey: actor,
      eventType: "hotel.housekeeping.action_denied",
      detail: { roomId, action, mode: authority.mode, reason: "not_permitted_in_mode" },
    });
    return deny(403, "not_permitted_in_mode");
  }
  if (action === "transition" && authority.roleTransitions.length === 0) {
    await logAudit({
      tenantId,
      n3UserKey: actor,
      eventType: "hotel.housekeeping.action_denied",
      detail: { roomId, action, mode: authority.mode, reason: "not_permitted_in_mode" },
    });
    return deny(403, "not_permitted_in_mode");
  }

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
      return Response.json(
        {
          ...result,
          room: await roomViewOrNull({
            tenantId,
            timezone,
            mode: authority.mode,
            role: ctx.role,
            roomId,
          }),
        },
        { headers: { "cache-control": "no-store" } },
      );
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
        authority,
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
          mode: authority.mode,
        },
      });
      return Response.json(
        {
          ...result,
          room: await roomViewOrNull({
            tenantId,
            timezone,
            mode: authority.mode,
            role: ctx.role,
            roomId,
          }),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    // action === "dnd"
    const active = parsed.body.active;
    if (typeof active !== "boolean") return deny(400, "validation_failed");
    const result = await setRoomDnd({
      tenantId,
      roomId,
      actorN3UserKey: actor,
      active,
      authority,
    });
    await logAudit({
      tenantId,
      n3UserKey: actor,
      eventType: active ? "hotel.housekeeping.dnd_set" : "hotel.housekeeping.dnd_cleared",
      detail: { roomId, condition: result.condition },
    });
    return Response.json(
      {
        ...result,
        room: await roomViewOrNull({
          tenantId,
          timezone,
          mode: authority.mode,
          role: ctx.role,
          roomId,
        }),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const code = err instanceof HousekeepingError ? err.code : "housekeeping_failed";
    await logAudit({
      tenantId,
      n3UserKey: actor,
      eventType:
        code === "not_permitted_in_mode"
          ? "hotel.housekeeping.action_denied"
          : "hotel.housekeeping.action_failed",
      detail: { roomId, action, code, mode: authority.mode },
    });
    return deny(statusForHousekeepingError(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/housekeeping/rooms/$roomId")({
  server: { handlers: { GET: handleRoomHistory, POST: handleRoomAction } },
});
