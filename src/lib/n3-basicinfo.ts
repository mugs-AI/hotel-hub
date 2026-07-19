// Pure BasicInfo normalization. Handles realistic casing/key variants that
// N3 returns for company profile responses. No I/O; safe to unit-test.

export type BasicInfo = {
  n3TenantKey: string | null; // immutable identity used to key the tenant
  tenantCode: string | null; // display
  companyName: string | null; // display
  userEmail: string | null;
  userName: string | null;
};

function pick<T = string>(source: Record<string, unknown>, keys: string[]): T | null {
  for (const k of keys) {
    const v = source[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return null;
}

/**
 * Normalize N3 BasicInfo. Prefers an immutable identifier
 * (tenantId / companyId / GUID) over the human-editable tenant code and
 * company name, which are display-only.
 */
export function normalizeBasicInfo(
  raw: unknown,
  claims: Record<string, unknown> = {},
): BasicInfo {
  const src = (raw ?? {}) as Record<string, unknown>;
  const claim = (claims ?? {}) as Record<string, unknown>;

  const tenantCode = pick<string>(src, ["TenantCode", "tenantCode", "tenantcode"]) ??
    pick<string>(claim, ["TenantCode", "tenantCode", "tenant_code"]);

  const companyName =
    pick<string>(src, ["CompanyName", "companyName", "company", "Company"]) ?? null;

  const n3TenantKey =
    pick<string>(src, [
      "TenantId",
      "tenantId",
      "CompanyId",
      "companyId",
      "CompanyGuid",
      "companyGuid",
      "TenantGuid",
      "tenantGuid",
    ]) ??
    pick<string>(claim, ["tenantId", "TenantId", "companyId", "CompanyId"]) ??
    tenantCode ??
    null;

  const userEmail =
    pick<string>(src, ["Email", "email", "UserEmail", "userEmail"]) ??
    pick<string>(claim, ["email", "Email", "preferred_username"]);

  const userName =
    pick<string>(src, ["UserName", "userName", "DisplayName", "displayName"]) ??
    pick<string>(claim, ["name", "unique_name", "sub"]);

  return { n3TenantKey, tenantCode, companyName, userEmail, userName };
}
