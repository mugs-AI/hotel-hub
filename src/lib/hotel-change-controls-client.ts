import { useQuery } from "@tanstack/react-query";
import { hotelJson } from "./hotel-settings-client";
import { useReceiptIdentity } from "./receipt-controls-client";
import type { ChangePolicy, ChangePolicyInput, BillToChangeDTO } from "./hotel-change-controls";
export const changePolicyKey = (identity: string) => ["hotel-change-policy", identity] as const;
export function useChangePolicy() {
  const identity = useReceiptIdentity();
  const ownerOrStaff = identity?.endsWith(":owner") || identity?.endsWith(":front_desk");
  const query = useQuery({
    queryKey: changePolicyKey(identity ?? "none"),
    queryFn: () =>
      hotelJson<{ available: boolean; policy: ChangePolicy | null }>("/api/hotel/change-controls"),
    enabled: !!ownerOrStaff,
    retry: false,
  });
  return {
    ...query,
    policy: query.isError ? null : (query.data?.policy ?? null),
    available: !query.isError && query.data?.available === true,
  };
}
export async function saveChangePolicy(input: ChangePolicyInput): Promise<ChangePolicy> {
  return (
    await hotelJson<{ policy: ChangePolicy }>("/api/hotel/change-controls", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
  ).policy;
}
export const billToChangesKey = (identity: string) => ["bill-to-changes", identity] as const;
export function listBillToChanges(offset = 0) {
  return hotelJson<{ requests: BillToChangeDTO[]; total: number; offset: number; limit: number }>(
    `/api/hotel/bill-to-changes?offset=${offset}&limit=50`,
  );
}
export function decideBillToChange(request: BillToChangeDTO, decision: "approve" | "reject") {
  return hotelJson<{ request: BillToChangeDTO }>(
    `/api/hotel/bill-to-changes/${encodeURIComponent(request.id)}/decision`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, expectedVersion: request.version }),
    },
  );
}
