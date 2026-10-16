import type { HotelRole } from "./rbac";
import { OperationControlsError, type OperationControls } from "./operation-controls";
type Actor = { tenantId: string; n3UserKey: string; role: HotelRole | null };
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
const version = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9]\d{0,18})$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;
function parse(value: unknown, tenantId: string): OperationControls {
  const row =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (
    !row ||
    row.tenantId !== tenantId ||
    typeof row.rateChangeEnabled !== "boolean" ||
    !version(row.revision) ||
    row.available !== true
  )
    throw new OperationControlsError("operation_controls_unavailable");
  return {
    tenantId,
    rateChangeEnabled: row.rateChangeEnabled,
    revision: row.revision,
    available: true,
  };
}
export function createOperationControlsStore(rpc: Rpc) {
  return {
    async read(actor: Actor): Promise<OperationControls> {
      if (!actor.tenantId || !actor.n3UserKey || !actor.role)
        throw new OperationControlsError("forbidden");
      const result = await rpc("hh_operation_controls_read", { p_tenant_id: actor.tenantId });
      if (result.error) {
        if (
          ["PGRST202", "42883"].includes(result.error.code ?? "") &&
          /\bhh_operation_controls_read\b/.test(result.error.message ?? "")
        )
          return {
            tenantId: actor.tenantId,
            rateChangeEnabled: true,
            revision: null,
            available: false,
          };
        throw new OperationControlsError("operation_controls_unavailable");
      }
      return parse(result.data, actor.tenantId);
    },
    async update(
      actor: Actor,
      patch: { rateChangeEnabled: boolean; expectedRevision: string },
    ): Promise<OperationControls> {
      if (!actor.tenantId || !actor.n3UserKey || actor.role !== "owner")
        throw new OperationControlsError("forbidden");
      if (!version(patch.expectedRevision) || typeof patch.rateChangeEnabled !== "boolean")
        throw new OperationControlsError("invalid_request");
      const result = await rpc("hh_operation_controls_update", {
        p_tenant_id: actor.tenantId,
        p_actor_n3_user_key: actor.n3UserKey,
        p_expected_revision: patch.expectedRevision,
        p_rate_change_enabled: patch.rateChangeEnabled,
      });
      if (result.error) {
        const code = result.error.message;
        throw new OperationControlsError(
          code === "operation_controls_stale" || code === "forbidden"
            ? code
            : "operation_controls_unavailable",
        );
      }
      return parse(result.data, actor.tenantId);
    },
  };
}
export function liveOperationControlsStore() {
  return createOperationControlsStore(async (name, args) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return (supabaseAdmin as unknown as { rpc: Rpc }).rpc(name, args);
  });
}
