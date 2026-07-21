// GET /api/hotel/availability?arrival=YYYY-MM-DD&departure=YYYY-MM-DD[&adults=&children=]
// Owner + Front Desk. Returns local HotelHub rooms free of any blocking
// reserved/occupied allocation in the requested half-open date range.
// Never calls N3.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { checkAvailability, isIsoDate } from "@/lib/reservations-store.server";
import { logAudit } from "@/lib/audit.server";

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Strict non-negative integer parse for availability query params.
 * Rejects empty strings, decimals ("1.5"), non-numeric text, `NaN`,
 * `Infinity`, and negatives. `null` (param absent) returns `null`.
 */
export function parseOptionalNonNegInt(raw: string | null): number | null | "invalid" {
  if (raw === null) return null;
  if (raw === "") return "invalid";
  if (!/^\d+$/.test(raw)) return "invalid";
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return "invalid";
  return n;
}

export async function handleAvailability({ request }: { request: Request }): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:reservations:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const url = new URL(request.url);
  const arrival = url.searchParams.get("arrival") ?? "";
  const departure = url.searchParams.get("departure") ?? "";
  if (!isIsoDate(arrival) || !isIsoDate(departure) || departure <= arrival) {
    return deny(400, "invalid_stay_dates");
  }
  const adults = parseOptionalNonNegInt(url.searchParams.get("adults"));
  const children = parseOptionalNonNegInt(url.searchParams.get("children"));
  if (adults === "invalid" || children === "invalid") return deny(400, "invalid_occupancy");
  try {
    const rooms = await checkAvailability({
      tenantId: ctx.session.tenantId!,
      arrival,
      departure,
      adults,
      children,
    });
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.availability.checked",
      detail: { arrival, departure, adults, children, roomCount: rooms.length },
    });
    return Response.json({ rooms }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[availability] failed", (err as Error).message?.slice(0, 200));
    return deny(500, "availability_failed");
  }
}

export const Route = createFileRoute("/api/hotel/availability")({
  server: { handlers: { GET: handleAvailability } },
});
