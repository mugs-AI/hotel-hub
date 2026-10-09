/* eslint-disable @typescript-eslint/no-explicit-any -- additive tables await separately approved schema/types generation */
import { type ChangePolicy, type ChangePolicyInput } from "./hotel-change-controls";
import { ReceiptControlError } from "./receipt-controls";
import type { ReceiptControlActor } from "./receipt-controls-evidence.server";
import { mapDbError } from "./receipt-controls-store.server";
export const missingChangeInstallation = (error: { code?: string }) =>
  ["42P01", "PGRST205"].includes(error.code ?? "");
export async function changeAdmin(): Promise<{
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
export function validateChangePolicyInput(value: unknown): ChangePolicyInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ReceiptControlError("invalid_policy");
  const p = value as Record<string, unknown>;
  if (
    Object.keys(p).some(
      (k) =>
        !["expectedRevision", "depositApprovalRequired", "contactApprovalRequired"].includes(k),
    ) ||
    typeof p.expectedRevision !== "string" ||
    !/^(0|[1-9]\d{0,18})$/.test(p.expectedRevision) ||
    typeof p.depositApprovalRequired !== "boolean" ||
    typeof p.contactApprovalRequired !== "boolean"
  )
    throw new ReceiptControlError("invalid_policy");
  return p as ChangePolicyInput;
}
export async function readChangePolicy(tenantId: string): Promise<ChangePolicy | null> {
  const sb = await changeAdmin();
  const { data, error } = await sb.rpc("hotelhub_change_policy_read", { p_tenant: tenantId });
  if (error) {
    if (missingChangeInstallation(error)) return null;
    if (["PGRST202", "42883"].includes(error.code ?? "")) {
      const probe = await sb.from("hotel_change_control_policies").select("tenant_id").limit(0);
      if (probe.error && missingChangeInstallation(probe.error)) return null;
    }
    throw new ReceiptControlError("change_controls_unavailable");
  }
  if (
    !data ||
    typeof data.revision !== "string" ||
    !/^(0|[1-9]\d*)$/.test(data.revision) ||
    typeof data.depositApprovalRequired !== "boolean" ||
    typeof data.contactApprovalRequired !== "boolean"
  )
    throw new ReceiptControlError("change_controls_unavailable");
  return {
    revision: data.revision,
    depositApprovalRequired: data.depositApprovalRequired,
    contactApprovalRequired: data.contactApprovalRequired,
  };
}
export async function requireFreshChangeOwner(actor: ReceiptControlActor): Promise<void> {
  if (actor.role !== "owner") throw new ReceiptControlError("forbidden");
  const [{ readN3Users }, { decideEffectiveRole }] = await Promise.all([
    import("./n3-owner.server"),
    import("./n3-owner"),
  ]);
  const read = await readN3Users(actor.n3Token);
  if (
    decideEffectiveRole({
      read,
      identity: { n3UserKey: actor.n3UserKey, email: null, userName: null },
      localRole: null,
      neutralValidated: true,
    }).role !== "owner"
  )
    throw new ReceiptControlError("forbidden");
}
const EXTRA_CODES = [
  "bill_to_changed",
  "bill_to_locked",
  "not_found",
  "invalid_bill_to",
  "approval_required",
  "claim_stale",
  "change_controls_unavailable",
];
export function changeDbError(error: { code?: string; message?: string }) {
  for (const code of EXTRA_CODES)
    if (error.message?.includes(code)) return new ReceiptControlError(code);
  return mapDbError(error);
}
export async function changeRpc(
  actor: ReceiptControlActor,
  name: string,
  data: unknown,
): Promise<any> {
  const result = await (
    await changeAdmin()
  ).rpc(name, {
    p_tenant_id: actor.tenantId,
    p_actor: actor.n3UserKey,
    p_role: actor.role,
    p_data: data,
  });
  if (result.error) throw changeDbError(result.error);
  return result.data;
}
export async function setChangePolicy(
  actor: ReceiptControlActor,
  input: ChangePolicyInput,
): Promise<ChangePolicy> {
  const data = validateChangePolicyInput(input);
  await requireFreshChangeOwner(actor);
  return changeRpc(actor, "hotelhub_change_policy_set", data);
}
