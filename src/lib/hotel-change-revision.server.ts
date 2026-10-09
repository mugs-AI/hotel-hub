import { changeAdmin, missingChangeInstallation } from "./hotel-change-controls-store.server";
import { ReceiptControlError } from "./receipt-controls";
export function appendChangeRevision(existing: string, revision: string | null): string {
  return revision === null ? existing : `${existing}|change:${revision}`;
}
export async function readChangeRevision(tenantId: string): Promise<string | null> {
  const sb = await changeAdmin();
  const result = await sb.rpc("hotelhub_change_revision_read", { p_tenant: tenantId });
  if (result.error) {
    if (["PGRST202", "42883"].includes(result.error.code)) {
      const probe = await sb.from("hotel_change_revisions").select("tenant_id").limit(0);
      if (probe.error && missingChangeInstallation(probe.error)) return null;
    }
    throw new ReceiptControlError("change_controls_unavailable");
  }
  if (typeof result.data !== "string" || !/^(0|[1-9]\d*)$/.test(result.data))
    throw new ReceiptControlError("change_controls_unavailable");
  return result.data;
}
