// N3 identity is resolved by the caller's server session. Never imported by clients.
import type { HotelRole } from "./rbac";
import {
  DepositModulePolicyError,
  legacyDepositModulePolicy,
  parseDepositModulePolicy,
  type DepositModulePolicy,
  type DepositModulePolicyState,
} from "./deposit-module-policy";
export { DepositModulePolicyError } from "./deposit-module-policy";

type DbResult = { data: unknown; error: { code?: string; message?: string } | null };
// Separate migration tables are deliberately absent from platform-generated types
// until installation. No edits to protected integration/type files.
type PolicyDb = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { maybeSingle(): Promise<DbResult> };
    };
  };
  rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
};
async function db(): Promise<PolicyDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as PolicyDb;
}
function validScope(tenantId: string): void {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tenantId))
    throw new DepositModulePolicyError("deposit_module_policy_unavailable");
}
function state(data: unknown): DepositModulePolicyState {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new DepositModulePolicyError("deposit_module_policy_unavailable");
  const row = data as Record<string, unknown>;
  try {
    const policy = parseDepositModulePolicy({
      roomAdvanceEnabled: row.room_advance_enabled,
      securityDepositEnabled: row.security_deposit_enabled,
      version: row.version,
    });
    if (typeof row.security_module_ready !== "boolean" || policy.version === "0")
      throw new Error("invalid row");
    return { policy, available: true, securityReady: row.security_module_ready };
  } catch {
    throw new DepositModulePolicyError("deposit_module_policy_unavailable");
  }
}
export async function readDepositModulePolicy(tenantId: string): Promise<DepositModulePolicyState> {
  validScope(tenantId);
  try {
    const result = await (await db())
      .from("hotel_deposit_module_policies")
      .select("room_advance_enabled,security_deposit_enabled,security_module_ready,version")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (result.error) {
      if (["42P01", "PGRST205"].includes(result.error.code ?? ""))
        return { policy: legacyDepositModulePolicy(), available: false, securityReady: false };
      throw new DepositModulePolicyError("deposit_module_policy_unavailable");
    }
    return result.data === null
      ? { policy: legacyDepositModulePolicy(), available: true, securityReady: false }
      : state(result.data);
  } catch (error) {
    if (error instanceof DepositModulePolicyError) throw error;
    throw new DepositModulePolicyError("deposit_module_policy_unavailable");
  }
}
export async function assertRoomAdvanceCollectionEnabled(tenantId: string): Promise<void> {
  if (!(await readDepositModulePolicy(tenantId)).policy.roomAdvanceEnabled)
    throw new DepositModulePolicyError("room_advance_disabled");
}
export async function updateDepositModulePolicy(
  actor: { tenantId: string; userKey: string; role: HotelRole },
  input: DepositModulePolicy,
): Promise<DepositModulePolicyState> {
  if (actor.role !== "owner") throw new DepositModulePolicyError("forbidden");
  validScope(actor.tenantId);
  if (!actor.userKey?.trim()) throw new DepositModulePolicyError("forbidden");
  const policy = parseDepositModulePolicy(input);
  try {
    const result = await (
      await db()
    ).rpc("hh_update_deposit_module_policy", {
      p_tenant: actor.tenantId,
      p_actor: actor.userKey,
      p_expected_version: policy.version,
      p_advance: policy.roomAdvanceEnabled,
      p_security: policy.securityDepositEnabled,
    });
    if (result.error) {
      const code = result.error.message;
      if (code === "deposit_module_policy_conflict" || code === "security_deposit_unavailable")
        throw new DepositModulePolicyError(code);
      throw new DepositModulePolicyError("deposit_module_policy_unavailable");
    }
    return state(result.data);
  } catch (error) {
    if (error instanceof DepositModulePolicyError) throw error;
    throw new DepositModulePolicyError("deposit_module_policy_unavailable");
  }
}
