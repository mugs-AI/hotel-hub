// GET  /api/hotel/booking-sources         — any authenticated role may read
//                                            (Reservations dropdown needs it).
//                                            ?active=true filters to enabled.
// POST /api/hotel/booking-sources         — Owner only. Creates a source.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import {
  BOOKING_SOURCE_ERROR_CODES,
  BookingSourceError,
  createBookingSource,
  listBookingSources,
} from "@/lib/booking-sources-store.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function mapErrorStatus(code: string): number {
  if (code === "not_found") return 404;
  if (
    code === "duplicate_source_code" ||
    code === "duplicate_display_name" ||
    code === "duplicate_source"
  )
    return 409;
  if (code === "booking_source_create_failed" || code === "booking_source_update_failed") return 500;
  return 400;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function handleListBookingSources({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("app:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const url = new URL(request.url);
  const activeOnly = url.searchParams.get("active") === "true";
  try {
    const sources = await listBookingSources(ctx.session.tenantId!, { activeOnly });
    return Response.json(
      {
        sources: sources.map((s) => ({
          id: s.id,
          sourceCode: s.sourceCode,
          displayName: s.displayName,
          isActive: s.isActive,
          sortOrder: s.sortOrder,
          usedCount: s.usedCount,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[booking-sources.list] failed", (err as Error).message?.slice(0, 200));
    return deny(500, "booking_sources_list_failed");
  }
}

export async function handleCreateBookingSource({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return deny(400, "invalid_json");
  }
  if (!isPlainObject(parsed)) return deny(400, "invalid_body");
  const body = parsed as Record<string, unknown>;
  const displayName = body.displayName ?? body.display_name;
  const sourceCode = body.sourceCode ?? body.source_code;
  if (typeof displayName !== "string") return deny(400, "display_name_required");
  if (sourceCode !== undefined && sourceCode !== null && typeof sourceCode !== "string")
    return deny(400, "invalid_source_code");
  try {
    const source = await createBookingSource({
      tenantId: ctx.session.tenantId!,
      displayName,
      sourceCode: (sourceCode as string | undefined | null) ?? null,
    });
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.booking_source.created",
      detail: { id: source.id, sourceCode: source.sourceCode },
    });
    return Response.json({ source }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (err) {
    const code =
      err instanceof BookingSourceError && BOOKING_SOURCE_ERROR_CODES.has(err.code)
        ? err.code
        : "booking_source_create_failed";
    if (code === "booking_source_create_failed") {
      console.error(
        "[booking-sources.create] failed",
        (err as Error).message?.slice(0, 200),
      );
    }
    return deny(mapErrorStatus(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/booking-sources")({
  server: {
    handlers: {
      GET: handleListBookingSources,
      POST: handleCreateBookingSource,
    },
  },
});
