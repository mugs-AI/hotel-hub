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
 * Select exactly one authoritative email value. Priority:
 *   1. N3 profile (BasicInfo) — Email/email/UserEmail/userEmail
 *   2. JWT claims — email/preferred_username (used only if profile is empty)
 *
 * Never concatenates. Never combines. Returns the first non-empty match
 * or null. The header, session response, and audit log all read from a
 * single value; there is no second render path that could double-print.
 */
export function pickAuthoritativeEmail(
  profile: Record<string, unknown> | null | undefined,
  claims: Record<string, unknown> | null | undefined,
): string | null {
  const p = (profile ?? {}) as Record<string, unknown>;
  const c = (claims ?? {}) as Record<string, unknown>;
  const fromProfile = pick<string>(p, ["Email", "email", "UserEmail", "userEmail"]);
  const fromClaims = pick<string>(c, ["email", "Email", "preferred_username"]);
  return normalizeEmail(fromProfile) ?? normalizeEmail(fromClaims) ?? null;
}

// Loose email shape check — good enough to reject "not an email at all"
// without pulling in a full validator. Requires `local@domain.tld`.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Trim whitespace and collapse a value that is exactly two identical valid
 * email halves (e.g. `"a@x.coma@x.co"` -> `"a@x.co"`). Returns null if the
 * result is not a valid single email address.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (EMAIL_RE.test(trimmed)) return trimmed;
  if (trimmed.length % 2 === 0) {
    const half = trimmed.slice(0, trimmed.length / 2);
    if (trimmed === half + half && EMAIL_RE.test(half)) return half;
  }
  return null;
}

/**
 * Normalize N3 BasicInfo. Prefers an immutable identifier
 * (tenantId / companyId / GUID) over the human-editable tenant code and
 * company name, which are display-only.
 */
export function normalizeBasicInfo(raw: unknown, claims: Record<string, unknown> = {}): BasicInfo {
  const src = (raw ?? {}) as Record<string, unknown>;
  const claim = (claims ?? {}) as Record<string, unknown>;

  const tenantCode =
    pick<string>(src, ["TenantCode", "tenantCode", "tenantcode"]) ??
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

  const userEmail = pickAuthoritativeEmail(src, claim);

  const userName =
    pick<string>(src, ["UserName", "userName", "DisplayName", "displayName"]) ??
    pick<string>(claim, ["name", "unique_name", "sub"]);

  return { n3TenantKey, tenantCode, companyName, userEmail, userName };
}
