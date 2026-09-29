import { useQuery } from "@tanstack/react-query";
import { hotelJson } from "./hotel-settings-client";
import { useSessionMe } from "./session-client";
import type { FolioBillTo } from "@/routes/api/hotel/reservations.$id.folio.bill-to";

export const billToKey = (tenantId: string | null, id: string) =>
  ["folio-bill-to", tenantId, id] as const;

export function useFolioBillTo(id: string, enabled = true) {
  const session = useSessionMe();
  const tenantId = session.data?.authenticated === true ? session.data.tenant.tenantId : null;
  return useQuery({
    queryKey: billToKey(tenantId, id),
    queryFn: () =>
      hotelJson<{ billTo: FolioBillTo }>(`/api/hotel/reservations/${id}/folio/bill-to`),
    enabled: enabled && Boolean(tenantId),
    retry: false,
  });
}
