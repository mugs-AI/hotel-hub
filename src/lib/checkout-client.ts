// Browser-side, read-only checkout queries (Run 5D3.1).
// Same-origin cookie auth; no direct Supabase or N3 access, and no money is
// ever computed here — every value below is rendered exactly as the server
// calculated it.
import { useQuery } from "@tanstack/react-query";
import type { CheckoutPreviewDTO, DeparturesResponseDTO } from "./checkout-preview";

export type { CheckoutPreviewDTO, DeparturesResponseDTO };

export class CheckoutApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "CheckoutApiError";
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : "request_failed";
    throw new CheckoutApiError(code, res.status);
  }
  return body as T;
}

export type DeparturesFilter = {
  bucket: "today" | "overdue" | "upcoming" | "all";
  limit?: number;
  offset?: number;
};

export function useDepartures(filter: DeparturesFilter) {
  const params = new URLSearchParams({ bucket: filter.bucket });
  if (filter.limit) params.set("limit", String(filter.limit));
  if (filter.offset) params.set("offset", String(filter.offset));
  const qs = params.toString();
  return useQuery({
    queryKey: ["departures", qs],
    queryFn: () => getJson<DeparturesResponseDTO>(`/api/hotel/departures?${qs}`),
    staleTime: 15_000,
  });
}

export function useCheckoutPreview(reservationId: string | undefined) {
  return useQuery({
    queryKey: ["checkout-preview", reservationId],
    enabled: Boolean(reservationId),
    queryFn: () =>
      getJson<CheckoutPreviewDTO>(`/api/hotel/reservations/${reservationId}/checkout-preview`),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** Format a server-calculated amount for display. Never used to derive money. */
export function formatMoney(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  return `${currency} ${amount.toFixed(2)}`;
}

const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: "Your session has expired. Please relaunch HotelHub from N3.",
  forbidden: "Your role cannot view checkout preparation.",
  role_unassigned: "Your HotelHub role is not assigned yet.",
  invalid_id: "That reservation link is not valid.",
  invalid_filter: "That filter is not valid.",
  reservation_not_found: "Reservation not found.",
  reservation_not_checked_in: "Only checked-in reservations can be prepared for checkout.",
  property_timezone_invalid: "The property timezone is not configured correctly.",
  hotel_settings_missing: "Property settings have not been configured yet.",

  checkout_preview_failed: "The checkout preview could not be prepared. Please try again.",
};

export function checkoutErrorMessage(err: unknown): string {
  const code = err instanceof CheckoutApiError ? err.code : "checkout_preview_failed";
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.checkout_preview_failed;
}
