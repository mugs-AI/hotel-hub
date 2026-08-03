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
 * Derive a short, non-identifying fallback label for a staff member we have
 * never seen launch the app (e.g. a reservation created before the directory
 * existed). NEVER returns the raw key.
 */
export function fallbackActorLabel(n3UserKey: string | null | undefined): string {
  const k = (n3UserKey ?? "").trim();
  if (!k) return "Unknown staff";
  return `Staff ${k.slice(0, 4).toUpperCase()}`;
}

/**
 * Resolve display labels for a set of N3 user keys within one tenant.
 * Always returns a safe label — the raw key is never part of the output.
 */
export async function resolveActorLabels(
  tenantId: string,
  keys: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(keys.filter((k): k is string => Boolean(k && k.trim()))));
  const out = new Map<string, string>();
  for (const k of unique) out.set(k, fallbackActorLabel(k));
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

