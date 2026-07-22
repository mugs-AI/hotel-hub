// Typed browser client for the reservation API.
// - Same-origin fetch only, `credentials: "same-origin"`.
// - Never sends tenant/identity/reference/snapshot in bodies.
// - Tenant-aware TanStack Query keys keyed by the authenticated tenantId
//   returned from `/api/session/me`. Never derived from browser storage.
// - Hides raw server error bodies; exposes a stable `code` + HTTP status.

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { useSessionMe } from "@/lib/session-client";
import { buildListQuery, type ListFilters } from "@/lib/reservations-ui";

export class ReservationApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.name = "ReservationApiError";
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch {
    throw new ReservationApiError(0, "network_error");
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    /* empty body is fine */
  }
  if (!res.ok) {
    const code =
      (parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error?: unknown }).error ?? "")
        : "") || `http_${res.status}`;
    throw new ReservationApiError(res.status, code);
  }
  return (parsed ?? {}) as T;
}

// ---------- Tenant-aware query keys ----------
function tenantKey(): string | null {
  return null; // placeholder; real value read inside hooks via useSessionMe
}
export function reservationsListKey(tenantId: string | null, params: URLSearchParams) {
  return ["reservations", "list", tenantId, params.toString()] as const;
}
export function reservationDetailKey(tenantId: string | null, id: string) {
  return ["reservations", "detail", tenantId, id] as const;
}
export function availabilityKey(tenantId: string | null, arrival: string, departure: string) {
  return ["reservations", "availability", tenantId, arrival, departure] as const;
}
export function bookingSourcesKey(tenantId: string | null, activeOnly: boolean) {
  return ["reservations", "booking-sources", tenantId, activeOnly] as const;
}

export type BookingSourceDTO = {
  id: string;
  sourceCode: string;
  displayName: string;
  isActive: boolean;
  sortOrder: number;
  usedCount: number;
};

const _tk = tenantKey;

// ---------- Types (browser DTOs) ----------
export type ReservationListItem = {
  id: string;
  bookingReference: string;
  primaryGuestName: string | null;
  bookingSource: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  roomCount: number;
  guestCount: number;
  createdAt: string;
  createdByN3UserKey: string;
};
export type ReservationListResponse = { items: ReservationListItem[]; total: number };

export type AvailabilityRoomDTO = {
  hotelRoomId: string;
  roomNumber: string;
  n3StockCode: string;
  n3StockName: string | null;
  roomType: string;
  floor: string | null;
  maxOccupancy: number;
  baseRate: number;
  currency: string;
  isActive: boolean;
};

export type ReservationDetailDTO = {
  id: string;
  tenantId: string;
  bookingReference: string;
  bookingSource: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  currency: string;
  notes: string | null;
  createdAt: string;
  createdByN3UserKey: string;
  rooms: Array<{
    id: string;
    hotelRoomId: string;
    roomNumber: string;
    baseRateSnapshot: number;
    agreedRate: number;
    adults: number;
    children: number;
    allocationStatus: string;
    rateOverrideReason: string | null;
  }>;
  guests: Array<{
    id: string;
    guestId: string;
    fullName: string;
    mobile: string | null;
    email: string | null;
    nationality: string | null;
    isPrimary: boolean;
  }>;
};

export type CreateReservationPayload = {
  bookingSource: string;
  arrivalDate: string;
  departureDate: string;
  notes: string | null;
  rooms: Array<{
    hotelRoomId: string;
    agreedRate: number;
    adults: number;
    children: number;
    rateOverrideReason: string | null;
  }>;
  guests: Array<{
    fullName: string;
    mobile: string | null;
    email: string | null;
    nationality: string | null;
    notes: string | null;
    isPrimary: boolean;
  }>;
};

export type CreateReservationResponse = {
  reservationId: string;
  bookingReference: string;
  status: "confirmed";
  arrivalDate: string;
  departureDate: string;
};

// ---------- Hooks ----------
function useTenantId(): string | null {
  const s = useSessionMe();
  if (s.data?.authenticated === true) return s.data.tenant.tenantId;
  return null;
}

export function useReservationList(
  filters: ListFilters,
  page: { limit: number; offset: number },
  options?: { enabled?: boolean },
) {
  const tenantId = useTenantId();
  const params = buildListQuery(filters, page);
  return useQuery<ReservationListResponse, ReservationApiError>({
    queryKey: reservationsListKey(tenantId, params),
    queryFn: () =>
      jsonFetch<ReservationListResponse>(`/api/hotel/reservations?${params.toString()}`),
    enabled: Boolean(tenantId) && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  } satisfies UseQueryOptions<ReservationListResponse, ReservationApiError>);
}

export function useAvailability(
  arrival: string,
  departure: string,
  options?: { enabled?: boolean },
) {
  const tenantId = useTenantId();
  return useQuery<{ rooms: AvailabilityRoomDTO[] }, ReservationApiError>({
    queryKey: availabilityKey(tenantId, arrival, departure),
    queryFn: () =>
      jsonFetch<{ rooms: AvailabilityRoomDTO[] }>(
        `/api/hotel/availability?arrival=${encodeURIComponent(arrival)}&departure=${encodeURIComponent(departure)}`,
      ),
    enabled:
      Boolean(tenantId) && Boolean(arrival) && Boolean(departure) && (options?.enabled ?? true),
    staleTime: 0,
  });
}

export function useReservationDetail(id: string) {
  const tenantId = useTenantId();
  return useQuery<{ reservation: ReservationDetailDTO }, ReservationApiError>({
    queryKey: reservationDetailKey(tenantId, id),
    queryFn: () =>
      jsonFetch<{ reservation: ReservationDetailDTO }>(`/api/hotel/reservations/${id}`),
    enabled: Boolean(tenantId) && Boolean(id),
    retry: false,
  });
}

export function useCreateReservation() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation<CreateReservationResponse, ReservationApiError, CreateReservationPayload>({
    mutationFn: (payload) =>
      jsonFetch<CreateReservationResponse>("/api/hotel/reservations", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      // Invalidate ONLY this tenant's reservation list caches.
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as unknown[];
          return k[0] === "reservations" && k[1] === "list" && k[2] === tenantId;
        },
      });
    },
  });
}

export function useBookingSources(opts: { activeOnly?: boolean } = {}) {
  const tenantId = useTenantId();
  const activeOnly = opts.activeOnly === true;
  return useQuery<{ sources: BookingSourceDTO[] }, ReservationApiError>({
    queryKey: bookingSourcesKey(tenantId, activeOnly),
    queryFn: () =>
      jsonFetch<{ sources: BookingSourceDTO[] }>(
        `/api/hotel/booking-sources${activeOnly ? "?active=true" : ""}`,
      ),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });
}

export function useCreateBookingSource() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation<
    { source: BookingSourceDTO },
    ReservationApiError,
    { displayName: string; sourceCode?: string | null }
  >({
    mutationFn: (payload) =>
      jsonFetch<{ source: BookingSourceDTO }>("/api/hotel/booking-sources", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as unknown[];
          return k[0] === "reservations" && k[1] === "booking-sources" && k[2] === tenantId;
        },
      });
    },
  });
}

export function useUpdateBookingSource() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation<
    { source: BookingSourceDTO },
    ReservationApiError,
    {
      id: string;
      displayName?: string;
      isActive?: boolean;
      direction?: "up" | "down";
    }
  >({
    mutationFn: ({ id, ...body }) =>
      jsonFetch<{ source: BookingSourceDTO }>(`/api/hotel/booking-sources/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as unknown[];
          return k[0] === "reservations" && k[1] === "booking-sources" && k[2] === tenantId;
        },
      });
    },
  });
}
