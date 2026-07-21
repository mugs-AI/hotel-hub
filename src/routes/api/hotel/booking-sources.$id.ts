// PATCH /api/hotel/booking-sources/:id — Owner only.
// Supports: rename, activate/deactivate, reorder (direction=up|down).
// source_code is immutable and never patched here.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import {
  BOOKING_SOURCE_ERROR_CODES,
  BookingSourceError,
  updateBookingSource,
} from "@/lib/booking-sources-store.server";
import { logAudit } from "@/lib/audit.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mapErrorStatus(code: string): number {
  if (code === "not_found") return 404;
  if (
    code === "duplicate_source_code" ||
    code === "duplicate_display_name" ||
    code === "duplicate_source"
  )
    return 409;
  if (code === "cannot_reorder") return 409;
  if (code === "booking_source_create_failed" || code === "booking_source_update_failed") return 500;
  return 400;
}

export async function handlePatchBookingSource({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  if (!UUID_RE.test(params.id)) return deny(400, "invalid_id");
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return deny(400, "invalid_json");
  }
  if (!isPlainObject(parsed)) return deny(400, "invalid_body");
  const body = parsed as Record<string, unknown>;

  const patch: {
    displayName?: string;
    isActive?: boolean;
    direction?: "up" | "down";
  } = {};
  if (typeof body.displayName === "string") patch.displayName = body.displayName;
  else if (typeof body.display_name === "string") patch.displayName = body.display_name;
  if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
  else if (typeof body.is_active === "boolean") patch.isActive = body.is_active;
  if (body.direction === "up" || body.direction === "down") patch.direction = body.direction;

  if (
    patch.displayName === undefined &&
    patch.isActive === undefined &&
    patch.direction === undefined
  ) {
    return deny(400, "no_valid_fields");
  }

  // Direction is exclusive of other patches — reorder ops don't rename/toggle.
  if (patch.direction && (patch.displayName !== undefined || patch.isActive !== undefined)) {
    return deny(400, "no_valid_fields");
  }

  try {
    const source = await updateBookingSource({
      tenantId: ctx.session.tenantId!,
      id: params.id,
      ...patch,
    });
    let eventType:
      | "hotel.booking_source.renamed"
      | "hotel.booking_source.activated"
      | "hotel.booking_source.deactivated"
      | "hotel.booking_source.reordered" = "hotel.booking_source.renamed";
    if (patch.direction) eventType = "hotel.booking_source.reordered";
    else if (patch.isActive === true) eventType = "hotel.booking_source.activated";
    else if (patch.isActive === false) eventType = "hotel.booking_source.deactivated";
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType,
      detail: { id: source.id, sourceCode: source.sourceCode },
    });
    return Response.json({ source }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const code =
      err instanceof BookingSourceError && BOOKING_SOURCE_ERROR_CODES.has(err.code)
        ? err.code
        : "booking_source_update_failed";
    if (code === "booking_source_update_failed") {
      console.error(
        "[booking-sources.patch] failed",
        (err as Error).message?.slice(0, 200),
      );
    }
    return deny(mapErrorStatus(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/booking-sources/$id")({
  server: {
    handlers: {
      PATCH: handlePatchBookingSource,
    },
  },
});
