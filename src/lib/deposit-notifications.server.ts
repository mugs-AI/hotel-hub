import { changeAdmin } from "./hotel-change-controls-store.server";
import { ReceiptControlError } from "./receipt-controls";
import type { ReceiptControlActor } from "./receipt-controls-evidence.server";
import type { DepositNoticePacket } from "./deposit-notifications";
export async function readDepositNotices(
  actor: ReceiptControlActor,
  after: string | null,
): Promise<DepositNoticePacket | null> {
  if (after !== null && !/^(0|[1-9]\d{0,18})$/.test(after))
    throw new ReceiptControlError("invalid_body");
  const result = await (
    await changeAdmin()
  ).rpc("hotelhub_receipt_applied_events_read", {
    p_tenant_id: actor.tenantId,
    p_actor: actor.n3UserKey,
    p_role: actor.role,
    p_after: after,
  });
  // Forward-compatible with the existing deployment; never invent an event.
  if (result.error && ["42883", "PGRST202"].includes(result.error.code)) return null;
  if (
    result.error ||
    !result.data ||
    typeof result.data.cursor !== "string" ||
    !Array.isArray(result.data.events)
  )
    throw new ReceiptControlError("change_controls_unavailable");
  return result.data as DepositNoticePacket;
}
