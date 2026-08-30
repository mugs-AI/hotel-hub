// Browser-side folio queries/mutations. Same-origin, cookie-authenticated,
// no direct database or N3 access. The browser NEVER computes a money value:
// it sends quantities/ids and renders whatever the server returns.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSessionMe } from "./session-client";
import type { FolioViewDTO } from "./folio-view";
import type { FinancialSettings } from "./financial-settings";
import type { FolioReadiness } from "./folio-readiness";
import type { PostingReadiness } from "./posting-readiness";
import type { AddonCategory, MappingStatus, TaxClass } from "./charges-catalogue";
import type { GuestTaxClass } from "./folio";

export class FolioApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "FolioApiError";
  }
}

async function folioFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code =
      typeof body === "object" && body !== null && "error" in body
        ? ((body as { error?: unknown }).error ?? "request_failed")
        : "request_failed";
    throw new FolioApiError(typeof code === "string" ? code : "request_failed", res.status);
  }
  return body as T;
}

function useSessionKey(): string | null {
  const me = useSessionMe();
  return me.data?.authenticated === true ? "tenant" : null;
}

export function folioKey(sessionKey: string | null, reservationId: string) {
  return ["folio", sessionKey, reservationId] as const;
}

export function useReservationFolio(reservationId: string, enabled: boolean) {
  const sessionKey = useSessionKey();
  return useQuery<FolioViewDTO, FolioApiError>({
    queryKey: folioKey(sessionKey, reservationId),
    queryFn: () => folioFetch<FolioViewDTO>(`/api/hotel/reservations/${reservationId}/folio`),
    enabled: enabled && Boolean(reservationId),
    retry: false,
  });
}

function useInvalidateFolio(reservationId: string) {
  const qc = useQueryClient();
  const sessionKey = useSessionKey();
  return () => qc.invalidateQueries({ queryKey: folioKey(sessionKey, reservationId) });
}

/** Explicit folio preparation: creates the folio and snapshots room nights. */
export function useRefreshFolio(reservationId: string) {
  const invalidate = useInvalidateFolio(reservationId);
  return useMutation<unknown, FolioApiError, void>({
    mutationFn: () =>
      folioFetch(`/api/hotel/reservations/${reservationId}/folio/refresh`, { method: "POST" }),
    onSuccess: () => void invalidate(),
  });
}

export function useAddTourismTaxEvidence(reservationId: string) {
  const invalidate = useInvalidateFolio(reservationId);
  return useMutation<
    unknown,
    FolioApiError,
    {
      sourceLabel: string;
      reference?: string | null;
      collectedOn?: string | null;
      amountCents: number;
      note?: string | null;
      clientRequestId: string;
    }
  >({
    mutationFn: (input) =>
      folioFetch(`/api/hotel/reservations/${reservationId}/tax-profile`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => void invalidate(),
  });
}

export function useAddFolioItem(reservationId: string) {
  const invalidate = useInvalidateFolio(reservationId);
  return useMutation<
    unknown,
    FolioApiError,
    {
      catalogueId: string;
      quantity: number;
      clientRequestId: string;
      unitPriceCents?: number;
      reason?: string;
    }
  >({
    mutationFn: (input) =>
      folioFetch(`/api/hotel/reservations/${reservationId}/folio/lines`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => void invalidate(),
  });
}

export function useUpdateFolioQuantity(reservationId: string) {
  const invalidate = useInvalidateFolio(reservationId);
  return useMutation<
    unknown,
    FolioApiError,
    // A quantity edit is a financial mutation: it carries its own operation
    // key so a retried request can never apply twice.
    { lineId: string; quantity: number; clientRequestId: string }
  >({
    mutationFn: ({ lineId, quantity, clientRequestId }) =>
      folioFetch(`/api/hotel/reservations/${reservationId}/folio/lines/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity, clientRequestId }),
      }),
    onSuccess: () => void invalidate(),
  });
}

export function useReverseFolioLine(reservationId: string) {
  const invalidate = useInvalidateFolio(reservationId);
  return useMutation<
    unknown,
    FolioApiError,
    { lineId: string; reason: string; clientRequestId: string }
  >({
    mutationFn: ({ lineId, reason, clientRequestId }) =>
      folioFetch(`/api/hotel/reservations/${reservationId}/folio/lines/${lineId}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason, clientRequestId }),
      }),
    onSuccess: () => void invalidate(),
  });
}

export function useAddFolioAdjustment(reservationId: string) {
  const invalidate = useInvalidateFolio(reservationId);
  return useMutation<
    unknown,
    FolioApiError,
    {
      lineType: "discount" | "manual_adjustment";
      description: string;
      amountCents: number;
      reason: string;
      clientRequestId: string;
    }
  >({
    mutationFn: (input) =>
      folioFetch(`/api/hotel/reservations/${reservationId}/folio/adjustments`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => void invalidate(),
  });
}

export function useSetGuestTaxClass(reservationId: string) {
  const invalidate = useInvalidateFolio(reservationId);
  return useMutation<
    unknown,
    FolioApiError,
    { guestTaxClass: GuestTaxClass; evidenceNote?: string | null }
  >({
    mutationFn: (input) =>
      folioFetch(`/api/hotel/reservations/${reservationId}/tax-profile`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => void invalidate(),
  });
}

// ------------------------------------------------------------- catalogue

export type CatalogueItemDTO = {
  id: string;
  category: AddonCategory;
  taxClass: TaxClass;
  displayName: string;
  description: string | null;
  isActive: boolean;
  defaultUnitPriceCents: number;
  sortOrder: number;
  mappingStatus: MappingStatus;
  n3StockId?: string | null;
  n3UomId?: string | null;
  n3TaxCodeId?: string | null;
  n3StockCodeSnapshot?: string | null;
  n3StockNameSnapshot?: string | null;
  n3UomSnapshot?: string | null;
  n3TaxCodeSnapshot?: string | null;
};

export type CatalogueResponse = {
  items: CatalogueItemDTO[];
  capability: { canManage: boolean };
};

export function useChargeCatalogue(enabled = true) {
  const sessionKey = useSessionKey();
  return useQuery<CatalogueResponse, FolioApiError>({
    queryKey: ["charges-catalogue", sessionKey],
    queryFn: () => folioFetch<CatalogueResponse>("/api/hotel/charges/catalogue"),
    enabled,
    retry: false,
  });
}

export function useSaveCatalogueItem() {
  const qc = useQueryClient();
  return useMutation<unknown, FolioApiError, { id?: string; body: Record<string, unknown> }>({
    mutationFn: ({ id, body }) =>
      folioFetch(id ? `/api/hotel/charges/catalogue/${id}` : "/api/hotel/charges/catalogue", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["charges-catalogue"] }),
  });
}

export type ChargeSettingsResponse = {
  settings?: FinancialSettings;
  readiness: FolioReadiness;
  /** Owner-only: future-posting mapping summary and fail-closed readiness. */
  posting?: PostingReadiness;
  capability: { canManage: boolean };
};


export function useChargeSettings(enabled = true) {
  const sessionKey = useSessionKey();
  return useQuery<ChargeSettingsResponse, FolioApiError>({
    queryKey: ["charge-settings", sessionKey],
    queryFn: () => folioFetch<ChargeSettingsResponse>("/api/hotel/charges/settings"),
    enabled,
    retry: false,
  });
}

export function useSaveChargeSettings() {
  const qc = useQueryClient();
  return useMutation<ChargeSettingsResponse, FolioApiError, Record<string, unknown>>({
    mutationFn: (patch) =>
      folioFetch<ChargeSettingsResponse>("/api/hotel/charges/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["charge-settings"] }),
  });
}

/** Plain-language wording for every folio error code the API can return. */
export function folioErrorMessage(err: unknown, fallback = "Something went wrong."): string {
  const code = err instanceof FolioApiError ? err.code : "";
  const map: Record<string, string> = {
    unauthenticated: "Your session has ended. Relaunch HotelHub from N3.",
    forbidden: "Your HotelHub role does not allow this action.",
    role_unassigned: "Your HotelHub access has not been assigned yet.",
    reservation_not_found: "This reservation no longer exists.",
    item_not_found: "That charge item no longer exists.",
    item_inactive: "That charge item has been switched off.",
    item_not_mapped: "Finish the N3 mapping for this item before charging it.",
    line_not_found: "That folio line no longer exists.",
    line_not_editable: "This line can no longer be edited — reverse it instead.",
    room_night_not_reversible: "Room nights follow the reservation and cannot be reversed here.",
    already_reversed: "That line has already been reversed.",
    reason_required: "Give a reason of at least 3 characters.",
    price_override_forbidden: "Only the Owner can change a price.",
    invalid_quantity: "Enter a whole quantity between 1 and 9999.",
    invalid_amount: "Enter a valid amount.",
    invalid_guest_tax_class: "Choose a valid guest classification.",
    display_name_exists: "An item with that name already exists.",
    idempotency_conflict:
      "This request id was already used for a different change. Reload and try again.",
    line_not_reversible: "A reversal cannot itself be reversed.",
    reversal_not_atomic:
      "Reversals are temporarily unavailable because the database function is not installed.",
    folio_not_found: "Prepare the folio first.",
    unknown_field: "That request contained a field this action does not accept.",
    invalid_tax_class: "Choose a valid tax treatment.",
    invalid_source_label: "Give the collecting party a name of 2 to 60 characters.",
    invalid_collected_on: "Enter the collection date as YYYY-MM-DD.",
  };
  return map[code] ?? fallback;
}
