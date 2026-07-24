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
    return Response.json({ reservation: res }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[reservation.detail] failed", (err as Error).message?.slice(0, 200));
    return deny(500, "reservation_detail_failed");
  }
}

export async function handleReservationPatch({
  request,
  params,
}: {
  request: Request;
  params: { id?: string };
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:reservations:create");
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
  if (!isPlainObject(parsed)) return deny(400, "invalid_body");
  const body = parsed as Record<string, unknown>;
  const unk = rejectUnknown(body, ALLOWED_TOP);
  if (unk !== null) return deny(400, "unknown_field");

  const expected = body.expectedUpdatedAt;
  if (typeof expected !== "string" || !expected) return deny(400, "stale_reservation");

  const source = body.bookingSource;
  if (typeof source !== "string" || !isSourceCodeFormat(source))
    return deny(400, "invalid_booking_source");
  const arrival = body.arrivalDate;
  const departure = body.departureDate;
  if (!isIsoDate(arrival) || !isIsoDate(departure) || departure <= arrival)
    return deny(400, "invalid_stay_dates");

  const notes =
    body.notes === undefined || body.notes === null
      ? null
      : typeof body.notes === "string"
        ? body.notes.trim() || null
        : null;
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string")
    return deny(400, "invalid_notes");

  const extRaw = body.externalBookingReference;
  let externalBookingReference: string | null = null;
  if (extRaw !== undefined && extRaw !== null && extRaw !== "") {
    if (typeof extRaw !== "string") return deny(400, "invalid_external_reference");
    const t = extRaw.trim();
    if (t.length > 100) return deny(400, "external_ref_too_long");
    externalBookingReference = t || null;
  }

  if (!Array.isArray(body.rooms)) return deny(400, "room_required");
  const rooms: Parameters<typeof updateReservationAtomic>[0]["rooms"] = [];
  for (const r of body.rooms as unknown[]) {
    if (!isPlainObject(r)) return deny(400, "invalid_room");
    const u = rejectUnknown(r as Record<string, unknown>, ALLOWED_ROOM);
    if (u !== null) return deny(400, "unknown_field");
    const rid = (r as Record<string, unknown>).id;
    if (!isUuid(rid)) return deny(400, "invalid_room_id");
    const agreed = (r as Record<string, unknown>).agreedRate;
    if (typeof agreed !== "number" || !Number.isFinite(agreed) || agreed < 0)
      return deny(400, "invalid_rate");
    const adults = toStrictInt((r as Record<string, unknown>).adults);
    if (adults === null || adults < 1) return deny(400, "invalid_occupancy");
    const childrenRaw = (r as Record<string, unknown>).children ?? 0;
    const children = toStrictInt(childrenRaw);
    if (children === null || children < 0) return deny(400, "invalid_occupancy");
    const reasonRaw = (r as Record<string, unknown>).rateOverrideReason;
    const reason = typeof reasonRaw === "string" ? reasonRaw.trim() || null : null;
    const remarkRaw = (r as Record<string, unknown>).remark;
    let remark: string | null = null;
    if (remarkRaw !== undefined && remarkRaw !== null && remarkRaw !== "") {
      if (typeof remarkRaw !== "string") return deny(400, "invalid_room");
      const t = remarkRaw.trim();
      if (t.length > 500) return deny(400, "room_remark_too_long");
      remark = t.length > 0 ? t : null;
    }
    rooms.push({
      id: rid as string,
      agreedRate: agreed,
      adults,
      children,
      rateOverrideReason: reason,
      remark,
    });
  }

  let sourceRow;
  try {
    sourceRow = await findBookingSourceByCode(ctx.session.tenantId!, source);
  } catch (err) {
    console.error("[reservation.patch] source lookup failed", (err as Error).message?.slice(0, 200));
    return deny(500, "reservation_update_failed");
  }
  if (!sourceRow || !sourceRow.isActive) return deny(400, "invalid_booking_source");

  try {
    const result = await updateReservationAtomic({
      tenantId: ctx.session.tenantId!,
      reservationId: id,
      actorN3UserKey: ctx.session.n3UserKey,
      expectedUpdatedAt: expected,
      bookingSource: source,
      arrivalDate: arrival,
      departureDate: departure,
      notes,
      externalBookingReference,
      rooms,
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const code =
      err instanceof ReservationUpdateError && RESERVATION_UPDATE_ERROR_CODES.has(err.code)
        ? err.code
        : "reservation_update_failed";
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.reservation.create_failed",
      detail: { operation: "update", reservationId: id, code },
    });
    const status =
      code === "stale_reservation"
        ? 409
        : code === "reservation_not_editable"
          ? 409
          : code === "not_found"
            ? 404
            : code === "reservation_update_failed"
              ? 500
              : 400;
    return deny(status, code);
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id")({
  server: { handlers: { GET: handleReservationDetail, PATCH: handleReservationPatch } },
});
