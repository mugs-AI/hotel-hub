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
  /** Human-readable room labels (never raw UUIDs), tenant-scoped, server-derived. */
  roomLabels: string[];
  guestCount: number;
  createdAt: string;
};
export type ReservationListResponse = { items: ReservationListItem[]; total: number };

export type AvailabilityRoomDTO = {
  hotelRoomId: string;
  roomNumber: string;
  displayName: string | null;
  n3StockCode: string;
  n3StockName: string | null;
  roomType: string;
  floor: string | null;
  maxOccupancy: number;
  baseRate: number;
  currency: string;
  isActive: boolean;
};

export type ReservationDetailGuestDTO = {
  id: string;
  guestId: string;
  fullName: string;
  mobile: string | null;
  email: string | null;
  /** Legacy read-only field kept for historical reservations. */
  nationality: string | null;
  /** ISO 3166-1 alpha-3 for new-format guests. */
  nationalityCode: string | null;
  identityType: string | null;
  /** ALWAYS masked server-side. Raw identity numbers never cross this boundary. */
  identityNumberMasked: string | null;
  /** Free-text guest note (housekeeping/front-desk annotation). */
  notes: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressLine3: string | null;
  city: string | null;
  postcode: string | null;
  countryCode: string | null;
  stateCode: string | null;
  stateProvince: string | null;
  isPrimary: boolean;
  /** Reservation-room this guest is assigned to, or null when unassigned. */
  assignedReservationRoomId: string | null;
};

export type ReservationDetailDTO = {
  id: string;
  bookingReference: string;
  bookingSource: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  currency: string;
  notes: string | null;
  externalBookingReference: string | null;
  createdAt: string;
  updatedAt: string;
  /** Safe, server-resolved staff label, or null when unresolved. */
  createdByLabel: string | null;
  checkedInAt: string | null;
  checkedInByLabel: string | null;
  expectedCheckOutAt: string | null;
  rooms: Array<{
    id: string;
    hotelRoomId: string;
    roomNumber: string;
    displayName: string | null;
    n3StockName: string | null;
    baseRateSnapshot: number;
    agreedRate: number;
    adults: number;
    children: number;
    /** Real capacity from the mapped hotel room. */
    maxOccupancy: number;
    allocationStatus: string;
    rateOverrideReason: string | null;
    remark: string | null;
  }>;
  guests: ReservationDetailGuestDTO[];
};

/**
 * Run 5D2.6 — complete one-page edit payload.
 *
 * Never carries tenant, actor, role or fingerprint: those are server-derived.
 * `identityNumber` is write-only — it is sent once and must never be copied
 * into query cache, URLs, storage or logs.
 */
export type UpdateReservationFullPayload = {
  clientRequestId: string;
  expectedUpdatedAt: string;
  bookingSource: string;
  arrivalDate: string;
  departureDate: string;
  notes: string | null;
  externalBookingReference: string | null;
  correctionReason: string | null;
  rooms: Array<{
    clientKey: string;
    reservationRoomId: string | null;
    hotelRoomId: string;
    agreedRate: number;
    adults: number;
    children: number;
    rateOverrideReason: string | null;
    remark: string | null;
  }>;
  guests: Array<{
    clientKey: string;
    reservationGuestId: string | null;
    fullName: string;
    mobile: string | null;
    email: string | null;
    notes: string | null;
    nationalityCode: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    addressLine3: string | null;
    city: string | null;
    postcode: string | null;
    countryCode: string | null;
    stateCode: string | null;
    stateProvince: string | null;
    isPrimary: boolean;
    assignedRoomClientKey: string | null;
    identityAction: "keep" | "replace" | "clear";
    identityType: string | null;
    identityNumber: string | null;
  }>;
};

export type UpdateReservationFullResponse = {
  reservationId: string;
  updatedAt: string;
  replayed: boolean;
};

export type CreateReservationPayload = {
  bookingSource: string;
  arrivalDate: string;
  departureDate: string;
  notes: string | null;
  externalBookingReference: string | null;
  rooms: Array<{
    hotelRoomId: string;
    agreedRate: number;
    adults: number;
    children: number;
    rateOverrideReason: string | null;
    remark: string | null;
  }>;
  guests: Array<{
    fullName: string;
    mobile: string | null;
    email: string | null;
    notes: string | null;
    isPrimary: boolean;
    identityType: string | null;
    identityNumber: string | null;
    nationalityCode: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    addressLine3: string | null;
    city: string | null;
    postcode: string | null;
    countryCode: string | null;
    stateCode: string | null;
    stateProvince: string | null;
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
  options?: { enabled?: boolean; excludeReservationId?: string | null },
) {
  const tenantId = useTenantId();
  const exclude = options?.excludeReservationId ?? null;
  return useQuery<{ rooms: AvailabilityRoomDTO[] }, ReservationApiError>({
    queryKey: [...availabilityKey(tenantId, arrival, departure), exclude] as const,
    queryFn: () => {
      const qs = new URLSearchParams({ arrival, departure });
      // When editing, the reservation's own rooms must stay selectable.
      if (exclude) qs.set("excludeReservationId", exclude);
      return jsonFetch<{ rooms: AvailabilityRoomDTO[] }>(`/api/hotel/availability?${qs}`);
    },
    enabled:
      Boolean(tenantId) && Boolean(arrival) && Boolean(departure) && (options?.enabled ?? true),
    staleTime: 0,
  });
}

/** Server-derived edit capabilities (advisory for the UI; server enforces). */
export type ReservationEditCapabilitiesDTO = {
  mode: "full" | "contact" | "owner_correction" | "none";
  canOpenEditor: boolean;
  canEditStayAndRooms: boolean;
  canEditGuestContact: boolean;
  canEditGuestIdentity: boolean;
  canAddRemoveGuests: boolean;
  canChangePrimaryGuest: boolean;
  canAssignGuestRooms: boolean;
  correctionReasonRequired: boolean;
  reasonCode: string | null;
};

type ReservationDetailResponse = {
  reservation: ReservationDetailDTO;
  editCapabilities: ReservationEditCapabilitiesDTO;
};

export function useReservationDetail(id: string) {
  const tenantId = useTenantId();
  return useQuery<ReservationDetailResponse, ReservationApiError>({
    queryKey: reservationDetailKey(tenantId, id),
    queryFn: () => jsonFetch<ReservationDetailResponse>(`/api/hotel/reservations/${id}`),
    enabled: Boolean(tenantId) && Boolean(id),
    retry: false,
  });
}

export type GuestAssignmentPayload = {
  clientRequestId: string;
  expectedUpdatedAt: string;
  correctionReason?: string | null;
  assignments: Array<{ reservationGuestId: string; reservationRoomId: string | null }>;
};

/** Assign reservation guests to rooms (idempotent, optimistic-concurrency). */
export function useAssignGuestRooms(id: string) {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation<
    { updated: number; updatedAt: string; replayed: boolean },
    ReservationApiError,
    GuestAssignmentPayload
  >({
    mutationFn: (payload) =>
      jsonFetch(`/api/hotel/reservations/${id}/guest-assignments`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reservationDetailKey(tenantId, id) });
    },
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
  return useMutation<{ source: BookingSourceDTO }, ReservationApiError, { displayName: string }>({
    mutationFn: (payload) =>
      jsonFetch<{ source: BookingSourceDTO }>("/api/hotel/booking-sources", {
        method: "POST",
        // Strict allow-list — only displayName is ever sent. `sourceCode` is
        // generated server-side and immutable.
        body: JSON.stringify({ displayName: payload.displayName }),
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
      /** Reorder direction. Server accepts `move: "up" | "down"`. */
      direction?: "up" | "down";
    }
  >({
    mutationFn: ({ id, direction, ...rest }) => {
      const body: Record<string, unknown> = {};
      if (rest.displayName !== undefined) body.displayName = rest.displayName;
      if (rest.isActive !== undefined) body.isActive = rest.isActive;
      if (direction !== undefined) body.move = direction;
      return jsonFetch<{ source: BookingSourceDTO }>(`/api/hotel/booking-sources/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
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

/**
 * Resolve the display name for a booking source code, preferring the
 * tenant-configured `displayName` and falling back to a snake→Title
 * rendering only when the historical code no longer has a source record
 * (e.g. deleted before the tenant-configured store existed).
 */
export function tenantSourceLabel(
  sources: readonly BookingSourceDTO[] | null | undefined,
  code: string | null | undefined,
): string {
  if (!code) return "";
  const hit = (sources ?? []).find((s) => s.sourceCode === code);
  if (hit) return hit.displayName;
  return code
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Full one-page reservation update (Run 5D2.6, hardened in Run 5D2.7).
 *
 * Deliberately NOT a TanStack `useMutation`: the payload may carry a
 * write-only replacement identity number, and React Query retains mutation
 * variables for observers/devtools. This plain function builds the request
 * body immediately before a same-origin fetch and keeps no reference to it.
 * The value never reaches Query state, the cache, a URL, storage or logs.
 */
export async function submitReservationFullUpdate(
  id: string,
  payload: UpdateReservationFullPayload,
): Promise<UpdateReservationFullResponse> {
  return jsonFetch<UpdateReservationFullResponse>(`/api/hotel/reservations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/**
 * Invalidate everything a full reservation update can affect. Kept identical
 * to the invalidation the retired `useUpdateReservationFull` hook performed.
 */
export function useInvalidateReservationUpdate(id: string) {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return () => {
    qc.invalidateQueries({ queryKey: reservationDetailKey(tenantId, id) });
    qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey as unknown[];
        return (
          k[0] === "reservations" &&
          (k[1] === "list" || k[1] === "availability" || k[1] === "calendar") &&
          k[2] === tenantId
        );
      },
    });
    qc.invalidateQueries({ queryKey: ["reservation-timeline", tenantId, id] });
    qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey as unknown[];
        return k[0] === "reservation-calendar" || k[0] === "reservations-calendar";
      },
    });
  };
}
