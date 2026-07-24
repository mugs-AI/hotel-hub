// GET /api/hotel/reservation-calendar — Owner + Front Desk.
// Read-only room-planning view: rooms × dates with allocation blocks.
//
// Query:
//   startDate=YYYY-MM-DD  (defaults to today in Asia/Kuala_Lumpur)
//   days=7|14|30           (defaults to 14)
//
// Response DTO intentionally excludes tenant IDs, N3 tokens, guest email,
// mobile, identity, and audit data. It contains only the fields the
// planning grid renders.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { isIsoDate } from "@/lib/reservations-store.server";

const ALLOWED_DAYS = new Set([7, 14, 30]);

function todayKlIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

async function admin() {
  const mod = await import("@/integrations/supabase/client.server");
  return mod.supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (
        cols: string,
      ) => {
        eq: (
          k: string,
          v: unknown,
        ) => {
          in: (k: string, v: unknown[]) => Promise<{ data: unknown[]; error: { message: string } | null }>;
        } & Promise<{ data: unknown[]; error: { message: string } | null }>;
      };
    };
  };
}

export type CalendarRoom = {
  hotelRoomId: string;
  roomNumber: string;
  displayName: string | null;
  n3StockName: string | null;
  roomType: string;
  floor: string | null;
  isActive: boolean;
};
export type CalendarAllocation = {
  reservationId: string;
  bookingReference: string;
  hotelRoomId: string;
  primaryGuestName: string | null;
  arrivalDate: string;
  departureDate: string;
  reservationStatus: string;
  allocationStatus: string;
};
export type CalendarResponse = {
  rangeStart: string;
  rangeEndExclusive: string;
  rooms: CalendarRoom[];
  allocations: CalendarAllocation[];
};

function naturalRoomSort(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const aNum = Number.isFinite(na);
  const bNum = Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  return a.localeCompare(b);
}

export async function handleCalendar({ request }: { request: Request }): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:reservations:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const tenantId = ctx.session.tenantId!;
  const url = new URL(request.url);
  const startRaw = url.searchParams.get("startDate");
  const daysRaw = url.searchParams.get("days");
  const startDate = startRaw && startRaw.length > 0 ? startRaw : todayKlIso();
  if (!isIsoDate(startDate)) return deny(400, "invalid_start_date");
  const days = daysRaw === null || daysRaw === "" ? 14 : Number(daysRaw);
  if (!ALLOWED_DAYS.has(days)) return deny(400, "invalid_days");
  const rangeEndExclusive = addDaysIso(startDate, days);

  try {
    const sb = (await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as {
      from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    // Active rooms.
    const roomsRes = await sb
      .from("hotel_rooms")
      .select("id, room_number, display_name, n3_stock_name, room_type, floor, is_active")
      .eq("tenant_id", tenantId);
    if (roomsRes.error) throw new Error(`rooms read failed: ${roomsRes.error.message}`);
    const allRooms = (roomsRes.data ?? []) as Array<{
      id: string;
      room_number: string;
      display_name: string | null;
      n3_stock_name: string | null;
      room_type: string;
      floor: string | null;
      is_active: boolean;
    }>;

    // Overlapping allocations [arrival, departure).
    // Overlap: arrival_date < rangeEndExclusive AND departure_date > startDate.
    const allocRes = await sb
      .from("hotel_reservation_rooms")
      .select(
        "reservation_id, hotel_room_id, arrival_date, departure_date, allocation_status",
      )
      .eq("tenant_id", tenantId)
      .lt("arrival_date", rangeEndExclusive)
      .gt("departure_date", startDate);
    if (allocRes.error) throw new Error(`allocations read failed: ${allocRes.error.message}`);
    const allocs = (allocRes.data ?? []) as Array<{
      reservation_id: string;
      hotel_room_id: string;
      arrival_date: string;
      departure_date: string;
      allocation_status: string;
    }>;

    const reservationIds = Array.from(new Set(allocs.map((a) => a.reservation_id)));
    let reservationMap = new Map<
      string,
      { bookingReference: string; status: string }
    >();
    if (reservationIds.length > 0) {
      const resRes = await sb
        .from("hotel_reservations")
        .select("id, booking_reference, status")
        .eq("tenant_id", tenantId)
        .in("id", reservationIds);
      if (resRes.error) throw new Error(`reservations read failed: ${resRes.error.message}`);
      for (const r of (resRes.data ?? []) as Array<{
        id: string;
        booking_reference: string;
        status: string;
      }>) {
        reservationMap.set(r.id, { bookingReference: r.booking_reference, status: r.status });
      }
      // Filter out any allocation whose reservation is not visible in this tenant.
      const visible = new Set(reservationMap.keys());
      const filtered = allocs.filter((a) => visible.has(a.reservation_id));
      allocs.length = 0;
      allocs.push(...filtered);
    } else {
      reservationMap = new Map();
    }

    // Primary guest names for visible reservations.
    const primaryMap = new Map<string, string | null>();
    if (reservationIds.length > 0) {
      const rgRes = await sb
        .from("hotel_reservation_guests")
        .select("reservation_id, is_primary, hotel_guests(full_name)")
        .eq("tenant_id", tenantId)
        .in("reservation_id", reservationIds);
      if (rgRes.error) throw new Error(`guest link read failed: ${rgRes.error.message}`);
      for (const g of (rgRes.data ?? []) as Array<{
        reservation_id: string;
        is_primary: boolean;
        hotel_guests?: { full_name?: string } | Array<{ full_name?: string }>;
      }>) {
        if (!g.is_primary) continue;
        const nested = Array.isArray(g.hotel_guests) ? g.hotel_guests[0] : g.hotel_guests;
        primaryMap.set(g.reservation_id, nested?.full_name ?? null);
      }
    }

    // Rooms: active + inactive rooms that have an overlapping allocation.
    const roomsWithAlloc = new Set(allocs.map((a) => a.hotel_room_id));
    const visibleRooms = allRooms
      .filter((r) => r.is_active || roomsWithAlloc.has(r.id))
      .sort((a, b) => naturalRoomSort(a.room_number, b.room_number));

    const rooms: CalendarRoom[] = visibleRooms.map((r) => ({
      hotelRoomId: r.id,
      roomNumber: r.room_number,
      roomType: r.room_type,
      floor: r.floor,
      isActive: r.is_active,
    }));

    const allocations: CalendarAllocation[] = allocs.map((a) => {
      const meta = reservationMap.get(a.reservation_id);
      return {
        reservationId: a.reservation_id,
        bookingReference: meta?.bookingReference ?? "",
        hotelRoomId: a.hotel_room_id,
        primaryGuestName: primaryMap.get(a.reservation_id) ?? null,
        arrivalDate: a.arrival_date,
        departureDate: a.departure_date,
        reservationStatus: meta?.status ?? "confirmed",
        allocationStatus: a.allocation_status,
      };
    });

    const body: CalendarResponse = {
      rangeStart: startDate,
      rangeEndExclusive,
      rooms,
      allocations,
    };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[reservation-calendar] failed", (err as Error).message?.slice(0, 200));
    return deny(500, "reservation_calendar_failed");
  }
}

export const Route = createFileRoute("/api/hotel/reservation-calendar")({
  server: {
    handlers: {
      GET: handleCalendar,
    },
  },
});
