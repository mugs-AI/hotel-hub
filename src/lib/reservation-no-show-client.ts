import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSessionMe } from "./session-client";
import {
  NO_SHOW_CODES,
  NoShowError,
  type NoShowInput,
  type NoShowResult,
} from "./reservation-no-show";
const endpoint = (id: string) => `/api/hotel/reservations/${encodeURIComponent(id)}/no-show`;
async function json<T>(id: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint(id), {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new NoShowError(
      NO_SHOW_CODES.has(body.error)
        ? body.error
        : response.status === 401
          ? "unauthenticated"
          : "no_show_unavailable",
    );
  return body;
}
export function useNoShowState(id: string, enabled: boolean) {
  const me = useSessionMe();
  const tenantId = me.data?.authenticated ? me.data.tenant.tenantId : null;
  return useQuery({
    queryKey: ["no-show", tenantId, id],
    enabled: enabled && Boolean(tenantId),
    refetchInterval: 60000,
    queryFn: async () =>
      (await json<{ state: { eligible: boolean; propertyDate: string; updatedAt: string } }>(id))
        .state,
  });
}
export function useMarkNoShow(
  id: string,
  callbacks: {
    onSuccess(result: NoShowResult, input: NoShowInput): void;
    onError(error: unknown, input: NoShowInput): void;
  },
) {
  const qc = useQueryClient();
  const me = useSessionMe();
  const tenantId = me.data?.authenticated ? me.data.tenant.tenantId : null;
  return useMutation({
    mutationFn: async (input: NoShowInput) => {
      const { reservationId, ...body } = input;
      if (reservationId !== id) throw new NoShowError("invalid_request");
      return (
        await json<{ result: NoShowResult }>(id, { method: "POST", body: JSON.stringify(body) })
      ).result;
    },
    onSuccess: async (result, input) => {
      callbacks.onSuccess(result, input);
      if (tenantId)
        await qc.invalidateQueries({ predicate: (query) => query.queryKey.includes(tenantId) });
    },
    onError: callbacks.onError,
  });
}
export function noShowMessage(error: unknown): string {
  const code = error instanceof NoShowError ? error.code : "no_show_unavailable";
  return (
    (
      {
        reservation_changed: "This booking changed. Refresh and review it before marking no-show.",
        no_show_ineligible:
          "Only a confirmed booking with a past arrival date can be marked no-show.",
        no_show_occupied:
          "This booking has an occupied room. Review the stay before releasing rooms.",
        receipt_correction_pending: "Finish the pending receipt correction before marking no-show.",
        unauthenticated: "Your session ended. Open HotelHub from N3 again.",
        forbidden: "Your role cannot mark this booking no-show.",
        idempotency_conflict:
          "This request changed. Refresh the booking and review its saved outcome.",
        settlement_locked:
          "Billing is already in progress. Review the saved bill before changing this stay.",
      } as Record<string, string>
    )[code] ??
    "Unable to confirm no-show. Retry the saved request or ask Admin to check this booking."
  );
}
