import type { SettlementActor } from "./settlement-context.server";
import { parseInitialPolicyView } from "./initial-booking-payer";
import { isSourceCodeFormat } from "./booking-sources-store.server";
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
export async function readInitialBookingPolicy(
  actor: SettlementActor,
  sourceCode: string,
  rpc: Rpc,
) {
  const a = Object.freeze({ ...actor });
  if (
    !["owner", "front_desk"].includes(a.role) ||
    !a.n3Token?.trim() ||
    !a.n3UserKey?.trim() ||
    !isSourceCodeFormat(sourceCode)
  )
    throw Error("forbidden");
  const r = await rpc("hh_source_billing_entry_get", {
    p_tenant: a.tenantId,
    p_source_code: sourceCode,
    p_actor: a.n3UserKey,
    p_role: a.role,
  });
  for (const key of ["tenantId", "role", "n3Token", "n3UserKey"] as const)
    if (a[key] !== actor[key]) throw Error("source_policy_scope_mismatch");
  if (r.error) {
    // Only the exact absent candidate routine permits the pre-installation booking path.
    if (
      ["PGRST202", "42883"].includes(r.error.code ?? "") &&
      /\bhh_source_billing_entry_get\b/.test(r.error.message ?? "")
    )
      return { tenantId: a.tenantId, sourceCode, required: false as const, policy: null };
    throw Error("source_billing_setup_required");
  }
  try {
    return parseInitialPolicyView(r.data, a.tenantId, sourceCode);
  } catch {
    throw Error("source_policy_scope_mismatch");
  }
}
export async function readLiveInitialBookingPolicy(actor: SettlementActor, sourceCode: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return readInitialBookingPolicy(actor, sourceCode, async (name, args) =>
    supabaseAdmin.rpc(name as never, args as never),
  );
}
