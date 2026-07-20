// GET  /api/hotel/reservations — Owner + Front Desk. Tenant-scoped list.
// POST /api/hotel/reservations — Owner + Front Desk. Atomic create.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import {
  createReservationAtomic,
  isBookingSource,
  isIsoDate,
  listReservations,
  ReservationCreateError,
  RESERVATION_ERROR_CODES,
  type BookingSource,
} from "@/lib/reservations-store.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function handleListReservations({ request }: { request: Request }): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:reservations:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25), 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  const result = await listReservations({
    tenantId: ctx.session.tenantId!,
    bookingReference: url.searchParams.get("bookingReference") ?? undefined,
    guestName: url.searchParams.get("guestName") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    bookingSource: url.searchParams.get("bookingSource") ?? undefined,
    arrivalFrom: url.searchParams.get("arrivalFrom") ?? undefined,
    arrivalTo: url.searchParams.get("arrivalTo") ?? undefined,
    limit,
    offset,
  });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}

type IncomingRoom = {
  hotel_room_id?: unknown;
  hotelRoomId?: unknown;
  agreed_rate?: unknown;
  agreedRate?: unknown;
  adults?: unknown;
  children?: unknown;
  rate_override_reason?: unknown;
  rateOverrideReason?: unknown;
};
type IncomingGuest = {
  full_name?: unknown;
  fullName?: unknown;
  mobile?: unknown;
  email?: unknown;
  nationality?: unknown;
  notes?: unknown;
  is_primary?: unknown;
  isPrimary?: unknown;
};

export async function handleCreateReservation({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:reservations:create");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return deny(400, "invalid_json");
  }
  const source = body.bookingSource ?? body.booking_source;
  if (!isBookingSource(source)) return deny(400, "invalid_booking_source");
  const arrival = body.arrivalDate ?? body.arrival_date;
  const departure = body.departureDate ?? body.departure_date;
  if (
    !isIsoDate(arrival) ||
    !isIsoDate(departure) ||
    (departure as string) <= (arrival as string)
  ) {
    return deny(400, "invalid_stay_dates");
  }
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  const roomsRaw = Array.isArray(body.rooms) ? (body.rooms as IncomingRoom[]) : [];
  const guestsRaw = Array.isArray(body.guests) ? (body.guests as IncomingGuest[]) : [];
  if (roomsRaw.length === 0) return deny(400, "room_required");
  if (guestsRaw.length === 0) return deny(400, "guest_required");

  const rooms: Parameters<typeof createReservationAtomic>[0]["rooms"] = [];
  for (const r of roomsRaw) {
    const hotelRoomId = (r.hotelRoomId ?? r.hotel_room_id) as unknown;
    const agreed = Number(r.agreedRate ?? r.agreed_rate);
    const adults = Number(r.adults);
    const children = Number(r.children ?? 0);
    const reason =
      typeof (r.rateOverrideReason ?? r.rate_override_reason) === "string"
        ? ((r.rateOverrideReason ?? r.rate_override_reason) as string).trim() || null
        : null;
    if (typeof hotelRoomId !== "string" || hotelRoomId.length === 0)
      return deny(400, "room_required");
    if (!Number.isFinite(agreed) || agreed < 0) return deny(400, "invalid_rate");
    if (!Number.isFinite(adults) || adults < 1) return deny(400, "invalid_occupancy");
    if (!Number.isFinite(children) || children < 0) return deny(400, "invalid_occupancy");
    rooms.push({
      hotelRoomId,
      agreedRate: agreed,
      adults: Math.floor(adults),
      children: Math.floor(children),
      rateOverrideReason: reason,
    });
  }
  const guests: Parameters<typeof createReservationAtomic>[0]["guests"] = [];
  for (const g of guestsRaw) {
    const fullName = String(g.fullName ?? g.full_name ?? "").trim();
    if (!fullName) return deny(400, "guest_full_name_required");
    guests.push({
      fullName,
      mobile: typeof g.mobile === "string" ? g.mobile.trim() || null : null,
      email: typeof g.email === "string" ? g.email.trim() || null : null,
      nationality: typeof g.nationality === "string" ? g.nationality.trim() || null : null,
      notes: typeof g.notes === "string" ? g.notes.trim() || null : null,
      isPrimary: Boolean(g.isPrimary ?? g.is_primary),
    });
  }
  const primaryCount = guests.filter((g) => g.isPrimary).length;
  if (primaryCount === 0) return deny(400, "primary_guest_required");
  if (primaryCount > 1) return deny(400, "multiple_primary_guests");

  try {
    const result = await createReservationAtomic({
      tenantId: ctx.session.tenantId!,
      createdByN3UserKey: ctx.session.n3UserKey,
      bookingSource: source as BookingSource,
      arrivalDate: arrival as string,
      departureDate: departure as string,
      notes,
      rooms,
      guests,
    });
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.reservation.created",
      detail: {
        reservationId: result.reservationId,
        bookingReference: result.bookingReference,
        roomIds: rooms.map((r) => r.hotelRoomId),
        arrival,
        departure,
        source,
      },
    });
    for (const r of rooms) {
      if (r.rateOverrideReason) {
        await logAudit({
          tenantId: ctx.session.tenantId,
          n3UserKey: ctx.session.n3UserKey,
          eventType: "hotel.reservation.rate_overridden",
          detail: {
            reservationId: result.reservationId,
            bookingReference: result.bookingReference,
            hotelRoomId: r.hotelRoomId,
            agreedRate: r.agreedRate,
            reason: r.rateOverrideReason,
          },
        });
      }
    }
    return Response.json(
      {
        reservationId: result.reservationId,
        bookingReference: result.bookingReference,
        status: result.status,
        arrivalDate: arrival,
        departureDate: departure,
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const code =
      err instanceof ReservationCreateError && RESERVATION_ERROR_CODES.has(err.code)
        ? err.code
        : "reservation_create_failed";
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.reservation.create_failed",
      detail: { code, arrival, departure, source },
    });
    const status =
      code === "room_not_available"
        ? 409
        : code === "setup_incomplete"
          ? 409
          : code === "reservation_create_failed"
            ? 500
            : 400;
    return deny(status, code);
  }
}

export const Route = createFileRoute("/api/hotel/reservations")({
  server: {
    handlers: {
      GET: handleListReservations,
      POST: handleCreateReservation,
    },
  },
});
