// Pure BasicInfo normalization. Handles realistic casing/key variants that
// N3 returns for company profile responses. Input values may be strings,
// arrays of strings, or unexpected shapes; we never assume a value is a
// string before checking. No I/O; safe to unit-test.

export type BasicInfo = {
  n3TenantKey: string | null; // immutable identity used to key the tenant
  tenantCode: string | null; // display
  companyName: string | null; // display
  userEmail: string | null;
  userName: string | null;
};

/**
 * Return the first non-empty trimmed string from a value that may be a
 * string, an array of arbitrary values, or something else entirely.
 * Never throws.
 */
function firstNonEmptyString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = firstNonEmptyString(item);
      if (s) return s;
    }
  }
  return null;
}

/**
 * Safe string picker. Iterates the given keys and returns the first
 * non-empty trimmed string value. Ignores non-string / non-array values.
 */
function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const s = firstNonEmptyString(source[k]);
    if (s) return s;
  }
  return null;
}

// Loose email shape check — good enough to reject "not an email at all"
// without pulling in a full validator. Requires `local@domain.tld`.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Safely normalize an email-shaped value. Accepts anything and never
 * throws. Behavior:
 *   - string: trim, accept if it matches EMAIL_RE, or collapse a value
 *     that is exactly two identical valid email halves
 *     (e.g. `"a@x.coa@x.co"` -> `"a@x.co"`).
 *   - array: recurse into each element; return the first valid email
 *     found. Never joins or concatenates array elements.
 *   - anything else (null, undefined, number, boolean, object, ...): null.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (EMAIL_RE.test(trimmed)) return trimmed;
    if (trimmed.length % 2 === 0) {
      const half = trimmed.slice(0, trimmed.length / 2);
      if (trimmed === half + half && EMAIL_RE.test(half)) return half;
    }
    return null;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const n = normalizeEmail(item);
      if (n) return n;
    }
  }
  return null;
}

/**
 * Select exactly one authoritative email value. Priority:
 *   1. N3 profile (BasicInfo) — Email/email/UserEmail/userEmail
 *   2. JWT claims — email/preferred_username (used only if profile is empty)
 *
 * Never concatenates. Never combines. Returns the first valid match
 * (arrays are searched element-by-element) or null.
 */
export function pickAuthoritativeEmail(
  profile: Record<string, unknown> | null | undefined,
  claims: Record<string, unknown> | null | undefined,
): string | null {
  const p = (profile ?? {}) as Record<string, unknown>;
  const c = (claims ?? {}) as Record<string, unknown>;
  for (const k of ["Email", "email", "UserEmail", "userEmail"]) {
    const n = normalizeEmail(p[k]);
    if (n) return n;
  }
  for (const k of ["email", "Email", "preferred_username"]) {
    const n = normalizeEmail(c[k]);
    if (n) return n;
  }
  return null;
}

/**
 * Normalize N3 BasicInfo. Prefers an immutable identifier
 * (tenantId / companyId / GUID) over the human-editable tenant code and
 * company name, which are display-only.
 *
 * All value reads are made through the safe string picker: array-valued
 * BasicInfo/JWT fields (which N3 has been observed returning) never
 * throw and are never concatenated.
 */
export function normalizeBasicInfo(raw: unknown, claims: Record<string, unknown> = {}): BasicInfo {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const claim = (claims && typeof claims === "object" ? claims : {}) as Record<string, unknown>;

  const tenantCode =
    pickString(src, ["TenantCode", "tenantCode", "tenantcode"]) ??
    pickString(claim, ["TenantCode", "tenantCode", "tenant_code"]);

  const companyName = pickString(src, ["CompanyName", "companyName", "company", "Company"]);

  const n3TenantKey =
    pickString(src, [
      "TenantId",
      "tenantId",
      "CompanyId",
      "companyId",
      "CompanyGuid",
      "companyGuid",
      "TenantGuid",
      "tenantGuid",
    ]) ??
    pickString(claim, ["tenantId", "TenantId", "companyId", "CompanyId"]) ??
    tenantCode ??
    null;

  const userEmail = pickAuthoritativeEmail(src, claim);

  const userName =
    pickString(src, ["UserName", "userName", "DisplayName", "displayName"]) ??
    pickString(claim, ["name", "unique_name", "sub"]);

  return { n3TenantKey, tenantCode, companyName, userEmail, userName };
}
