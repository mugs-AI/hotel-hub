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

/**
 * Upsert the tenant row keyed by the immutable N3 tenant key.
 *
 * HH-AUTH-04: a permission-neutral staff launch cannot read Company Profile,
 * so `tenantCode` / `companyName` may be unknown. Null display values NEVER
 * overwrite values a previous (Owner) launch already stored.
 */
export async function upsertTenant(input: {
  n3TenantKey: string;
  tenantCode: string | null;
  companyName: string | null;
}): Promise<TenantRecord> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let tenantCode = input.tenantCode;
  let companyName = input.companyName;
  if (tenantCode === null || companyName === null) {
    const { data: existing } = await supabaseAdmin
      .from("hotel_tenants")
      .select("tenant_code, company_name")
      .eq("n3_tenant_key", input.n3TenantKey)
      .maybeSingle();
    if (existing) {
      tenantCode = tenantCode ?? existing.tenant_code;
      companyName = companyName ?? existing.company_name;
    }
  }
  const { data, error } = await supabaseAdmin
    .from("hotel_tenants")
    .upsert(
      {
        n3_tenant_key: input.n3TenantKey,
        tenant_code: tenantCode,
        company_name: companyName,
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

export async function lookupRole(tenantId: string, n3UserKey: string): Promise<RoleLookup> {
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

/**
 * Record (or refresh) the tenant-scoped staff directory entry for the user
 * launching the app. This gives the UI a safe human-readable label so we
 * never render the raw N3 user key (an opaque UUID/`sub` claim).
 *
 * Best-effort: a directory failure must never break a valid launch.
 */
export async function upsertUserDirectory(input: {
  tenantId: string;
  n3UserKey: string;
  displayName: string | null;
  email: string | null;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("hotel_user_directory").upsert(
      {
        tenant_id: input.tenantId,
        n3_user_key: input.n3UserKey,
        display_name: input.displayName ? input.displayName.slice(0, 200) : null,
        email: input.email ? input.email.slice(0, 320) : null,
      },
      { onConflict: "tenant_id,n3_user_key" },
    );
  } catch (err) {
    console.error("[directory] upsert failed", (err as Error).message?.slice(0, 200));
  }
}

/**
 * Run 5D2.1: there is deliberately NO derived fallback label. A label built
 * from key characters (e.g. `Staff 9BEB`) is a partial UUID disclosure, so an
 * unresolved actor is represented by the ABSENCE of a map entry and rendered
 * as "System" or omitted by the caller.
 */

/**
 * Resolve display labels for a set of N3 user keys within one tenant.
 * Only real directory names/emails are returned; the raw key never is.
 */
export async function resolveActorLabels(
  tenantId: string,
  keys: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(keys.filter((k): k is string => Boolean(k && k.trim()))));
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("hotel_user_directory")
      .select("n3_user_key, display_name, email")
      .eq("tenant_id", tenantId)
      .in("n3_user_key", unique);
    if (error) return out;
    for (const row of data ?? []) {
      const label = (row.display_name ?? "").trim() || (row.email ?? "").trim();
      if (label) out.set(row.n3_user_key, label);
    }
  } catch (err) {
    console.error("[directory] resolve failed", (err as Error).message?.slice(0, 200));
  }
  return out;
}
