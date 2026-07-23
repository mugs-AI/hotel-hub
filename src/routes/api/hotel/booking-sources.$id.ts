// PATCH /api/hotel/booking-sources/:id — Owner only.
// Body allow-list: { displayName?, isActive?, move? }
//   - `move: "up" | "down"` — reorder (mutually exclusive with the others)
//   - unknown / snake_case / legacy `direction` are rejected.
// source_code is immutable and never accepted here.
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
  if (code === "booking_source_not_found") return 404;
  if (code === "source_name_exists" || code === "last_active_booking_source") return 409;
  if (code === "booking_source_create_failed" || code === "booking_source_update_failed")
    return 500;
  return 400;
}

const ALLOWED_PATCH_KEYS = new Set(["displayName", "isActive", "move"]);

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

  // Strict allow-list — rejects `direction`, snake_case, and everything else.
  for (const k of Object.keys(body)) {
    if (!ALLOWED_PATCH_KEYS.has(k)) return deny(400, "invalid_source_update");
  }

  const patch: {
    displayName?: string;
    isActive?: boolean;
    direction?: "up" | "down";
  } = {};
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string") return deny(400, "invalid_source_name");
    patch.displayName = body.displayName;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") return deny(400, "invalid_source_update");
    patch.isActive = body.isActive;
  }
  if (body.move !== undefined) {
    if (body.move !== "up" && body.move !== "down") return deny(400, "invalid_source_update");
    patch.direction = body.move;
  }

  if (
    patch.displayName === undefined &&
    patch.isActive === undefined &&
    patch.direction === undefined
  ) {
    return deny(400, "invalid_source_update");
  }

  // Reorder is exclusive of other patches.
  if (patch.direction && (patch.displayName !== undefined || patch.isActive !== undefined)) {
    return deny(400, "invalid_source_update");
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
      console.error("[booking-sources.patch] failed", (err as Error).message?.slice(0, 200));
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
