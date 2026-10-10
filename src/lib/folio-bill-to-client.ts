import { useQuery } from "@tanstack/react-query";
import { hotelJson } from "./hotel-settings-client";
import { useReceiptIdentity } from "./receipt-controls-client";
import type {
  BillToReadDTO,
  BillToSaveInput,
  BillToSaveResult,
  FolioBillTo,
} from "./hotel-change-controls";
export const billToKey = (identity: string | null, id: string) =>
  ["folio-bill-to", identity, id] as const;
export type BillToClientRead = BillToReadDTO & { controlsInstalled: boolean };
export function useFolioBillTo(id: string, enabled = true) {
  const identity = useReceiptIdentity();
  return useQuery({
    queryKey: billToKey(identity, id),
    queryFn: async () => {
      const r = await hotelJson<
        Partial<BillToReadDTO> & { billTo: FolioBillTo; controlsInstalled?: boolean }
      >(`/api/hotel/reservations/${encodeURIComponent(id)}/folio/bill-to`);
      return {
        ...r,
        effectiveRevision: r.effectiveRevision ?? "0",
        pending: r.pending ?? null,
        controlsInstalled: r.controlsInstalled === true,
      } as BillToClientRead;
    },
    enabled: enabled && !!identity,
    retry: false,
  });
}
export function saveFolioBillTo(id: string, input: BillToSaveInput): Promise<BillToSaveResult> {
  return hotelJson(`/api/hotel/reservations/${encodeURIComponent(id)}/folio/bill-to`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
export async function saveLegacyFolioBillTo(
  id: string,
  billTo: FolioBillTo,
): Promise<BillToSaveResult> {
  const result = await hotelJson<{ billTo: FolioBillTo }>(
    `/api/hotel/reservations/${encodeURIComponent(id)}/folio/bill-to`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(billTo),
    },
  );
  return { ...result, effectiveRevision: "0", pending: null, outcome: "applied" };
}
