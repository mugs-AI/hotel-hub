// Browser-side deposit queries/mutations. Same-origin, cookie-authenticated,
// no direct Supabase or N3 access. Amounts and a client request id are the
// only values the browser may send.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSessionMe } from "./session-client";

export type DepositDTO = {
  id: string;
  status: "submitting" | "posted" | "failed" | "unknown";
  amount: number;
  currency: string;
  n3DocCode: string | null;
  n3ReceiptId: string | null;
  customerLabel: string | null;
  accountLabel: string | null;
  description: string | null;
  createdByN3UserKey: string;
  createdAt: string;
  errorCode: string | null;
};

export type DepositsResponse = {
  deposits: DepositDTO[];
  capability: { canCreate: boolean };
};

export class DepositApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "DepositApiError";
  }
}

async function depositFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
  });
  const body = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new DepositApiError(body?.error ?? "request_failed", res.status);
  return body as T;
}

function useTenantKey(): string | null {
  const me = useSessionMe();
  const d = me.data as any;
  return d?.authenticated === true ? (d.tenantCode ?? "tenant") : null;
}

export function depositsKey(tenantKey: string | null, reservationId: string) {
  return ["deposits", tenantKey, reservationId] as const;
}

export function useReservationDeposits(reservationId: string, enabled: boolean) {
  const tenantKey = useTenantKey();
  return useQuery<DepositsResponse, DepositApiError>({
    queryKey: depositsKey(tenantKey, reservationId),
    queryFn: () => depositFetch<DepositsResponse>(`/api/hotel/reservations/${reservationId}/deposits`),
    enabled: enabled && Boolean(reservationId),
    retry: false,
  });
}

export function useCreateDeposit(reservationId: string) {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation<
    { deposit: DepositDTO },
    DepositApiError,
    { amount: number; clientRequestId: string }
  >({
    mutationFn: (payload) =>
      depositFetch<{ deposit: DepositDTO }>(`/api/hotel/reservations/${reservationId}/deposits`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: depositsKey(tenantKey, reservationId) });
    },
  });
}

export type DepositPreview = {
  bookingReference: string;
  customerLabel: string;
  amount: number;
  currency: string;
  accountLabel: string | null;
  warning: string;
};

/** Owner-triggered read-only confirmation preview (no N3 write). */
export function useDepositPreview(reservationId: string) {
  return useMutation<{ preview: DepositPreview }, DepositApiError, { amount: number }>({
    mutationFn: (payload) =>
      depositFetch<{ preview: DepositPreview }>(
        `/api/hotel/reservations/${reservationId}/deposits/preview`,
        { method: "POST", body: JSON.stringify(payload) },
      ),
  });
}

export function useReconcileDeposit(reservationId: string) {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation<{ deposit: DepositDTO }, DepositApiError, { depositId: string }>({
    mutationFn: ({ depositId }) =>
      depositFetch<{ deposit: DepositDTO }>(
        `/api/hotel/reservations/${reservationId}/deposits/${depositId}/reconcile`,
        { method: "POST", body: JSON.stringify({}) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: depositsKey(tenantKey, reservationId) });
    },
  });
}

/** Interrupted (`submitting`) and uncertain (`unknown`) rows are recoverable. */
export function isRecoverableDeposit(s: DepositDTO["status"]): boolean {
  return s === "submitting" || s === "unknown";
}

export function depositStatusLabel(s: DepositDTO["status"]): string {
  switch (s) {
    case "posted":
      return "Posted to N3";
    case "failed":
      return "Not posted";
    case "unknown":
      return "Result uncertain — check N3";
    default:
      return "Submitting…";
  }
}

export function depositErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case "deposit_writes_disabled":
      return "Deposit posting is not enabled for this property yet.";
    case "walk_in_customer_not_mapped":
      return "Map the N3 walk-in customer in Settings before posting a deposit.";
    case "n3_defaults_unavailable":
    case "n3_defaults_invalid":
      return "N3 did not return valid receipt defaults. Nothing was posted.";
    case "n3_preflight_unavailable":
      return "HotelHub could not verify N3 before posting, so nothing was created. Try again later.";
    case "reservation_not_eligible":
      return "Only confirmed reservations can take a deposit.";
    case "reference_conflict":
      return "A conflicting N3 document already uses this reference. Nothing was posted.";
    case "n3_rejected":
      return "N3 rejected this payment. Nothing was posted.";
    case "n3_result_uncertain":
      return "HotelHub could not confirm the N3 result. Check N3 before doing anything else.";
    case "invalid_amount":
      return "Enter a positive amount with at most 2 decimals.";
    case "deposit_not_recoverable":
      return "This deposit is already resolved.";
    case "unauthorized":
      return "Your N3 session expired. Relaunch HotelHub from N3 to continue.";
    default:
      return "The deposit could not be completed.";
  }
}

