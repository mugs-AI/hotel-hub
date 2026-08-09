// GET   /api/hotel/reservations/:id — Owner + Front Desk. Tenant-scoped detail.
// PATCH /api/hotel/reservations/:id — Owner + Front Desk. Atomic head + rooms
//   update with optimistic concurrency (expectedUpdatedAt).
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import {
  getReservationById,
  isIsoDate,
  isUuid,
  updateReservationAtomic,
  ReservationUpdateError,
  RESERVATION_UPDATE_ERROR_CODES,
} from "@/lib/reservations-store.server";
import { findBookingSourceByCode, isSourceCodeFormat } from "@/lib/booking-sources-store.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function toStrictInt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) return null;
  return v;
}

const ALLOWED_TOP = new Set([
  "expectedUpdatedAt",
  "bookingSource",
  "arrivalDate",
  "departureDate",
  "notes",
  "externalBookingReference",
  "rooms",
]);
const ALLOWED_ROOM = new Set([
  "id",
  "agreedRate",
  "adults",
  "children",
  "rateOverrideReason",
  "remark",
]);
function rejectUnknown(obj: Record<string, unknown>, allowed: ReadonlySet<string>): string | null {
  for (const k of Object.keys(obj)) if (!allowed.has(k)) return k;
  return null;
}

export async function handleReservationDetail({
  params,
}: {
  params: { id?: string };
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:reservations:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!isUuid(id)) return deny(400, "invalid_id");
  try {
    const res = await getReservationById(ctx.session.tenantId!, id);
    if (!res) return deny(404, "not_found");
    // Never expose the raw N3 user key to the browser — `createdByLabel`
    // carries the safe, directory-resolved display name instead.
    const { createdByN3UserKey: _omit, ...safe } = res;
    void _omit;
    // Server-derived edit capabilities (Run 5D2.5 §5). Advisory for the UI —
    // the write path re-derives and enforces the same policy.
    const { getOrCreateHotelSettings } = await import("@/lib/hotel-store.server");
    const { computeEditCapabilities } = await import("@/lib/reservation-edit-capabilities");
    const settings = await getOrCreateHotelSettings(ctx.session.tenantId!);
    const editCapabilities = computeEditCapabilities({
      role: ctx.role ?? null,
      status: res.status,
      postCheckInGuestEditPolicy: settings.postCheckInGuestEditPolicy,
      allowOwnerPrimaryGuestChangeAfterCheckIn:
        settings.allowOwnerPrimaryGuestChangeAfterCheckIn === true,
    });
    return Response.json(
      { reservation: safe, editCapabilities },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[reservation.detail] failed", (err as Error).message?.slice(0, 200));
    return deny(500, "reservation_detail_failed");
  }
}


/**
 * Run 5D2.6 §5 — full reservation update.
 *
 * Strict allow-list validation at top/room/guest level, then delegation to
 * `updateReservationFull` → `hotelhub_update_reservation_v2` (v2 ONLY).
 * Tenant, actor key, actor role and the fingerprint are derived server-side.
 * The browser-supplied capability hints are never trusted; the RPC re-derives
 * the guest-edit policy and enforces it atomically.
 */
export async function handleReservationPatch({
  request,
  params,
}: {
  request: Request;
  params: { id?: string };
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:reservations:edit");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!isUuid(id)) return deny(400, "invalid_id");

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return deny(400, "invalid_json");
  }

  const { normalizeFullUpdateBody, fullUpdateErrorStatus } = await import(
    "@/lib/reservation-full-update"
  );
  const normalized = normalizeFullUpdateBody(parsed);
  if (!normalized.ok) return deny(fullUpdateErrorStatus(normalized.code), normalized.code);

  const source = normalized.value.bookingSource;
  if (!isSourceCodeFormat(source)) return deny(400, "invalid_booking_source");

  try {
    const { updateReservationFull } = await import("@/lib/reservations-store.server");
    const result = await updateReservationFull({
      tenantId: ctx.session.tenantId!,
      reservationId: id,
      actorN3UserKey: ctx.session.n3UserKey,
      actorRole: ctx.role ?? "",
      payload: normalized.value,
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const code =
      err instanceof ReservationUpdateError ? err.code : "reservation_update_failed";
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.reservation.update_failed",
      // Safe counts + code only. No guest names, contact values or identities.
      detail: {
        reservationId: id,
        code,
        roomCount: normalized.value.rooms.length,
        guestCount: normalized.value.guests.length,
      },
    });
    return deny(fullUpdateErrorStatus(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id")({
  server: { handlers: { GET: handleReservationDetail, PATCH: handleReservationPatch } },
});

