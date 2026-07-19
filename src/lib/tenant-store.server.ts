// Server-only tenant + role store. Uses the service-role client because
// HotelHub does not use Supabase Auth — identity comes from N3.
import type { HotelRole } from "./rbac";
import { isHotelRole } from "./rbac";

export type TenantRecord = {
  id: string;
  n3TenantKey: string;
  tenantCode: string | null;
  companyName: string | null;
};

export type RoleLookup =
  | { status: "assigned"; role: HotelRole; isActive: boolean }
  | { status: "role_unassigned" };

export async function upsertTenant(input: {
  n3TenantKey: string;
  tenantCode: string | null;
  companyName: string | null;
}): Promise<TenantRecord> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("hotel_tenants")
    .upsert(
      {
        n3_tenant_key: input.n3TenantKey,
        tenant_code: input.tenantCode,
        company_name: input.companyName,
      },
      { onConflict: "n3_tenant_key" },
    )
    .select("id, n3_tenant_key, tenant_code, company_name")
    .single();
  if (error || !data) {
    throw new Error(`Failed to upsert tenant: ${error?.message ?? "unknown"}`);
  }
  return {
    id: data.id,
    n3TenantKey: data.n3_tenant_key,
    tenantCode: data.tenant_code,
    companyName: data.company_name,
  };
}

export async function lookupRole(
  tenantId: string,
  n3UserKey: string,
): Promise<RoleLookup> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("hotel_user_roles")
    .select("role, is_active")
    .eq("tenant_id", tenantId)
    .eq("n3_user_key", n3UserKey)
    .maybeSingle();
  if (error) throw new Error(`Role lookup failed: ${error.message}`);
  if (!data) return { status: "role_unassigned" };
  if (!isHotelRole(data.role)) return { status: "role_unassigned" };
  return { status: "assigned", role: data.role, isActive: Boolean(data.is_active) };
}
