// Guest identity + masking helpers — browser-safe, pure.
// Identity numbers are treated as sensitive: never log or echo them.

export type IdentityType = "mykad" | "mypr" | "passport" | "other";

export const IDENTITY_TYPES: readonly IdentityType[] = [
  "mykad",
  "mypr",
  "passport",
  "other",
] as const;

const IDENTITY_LABELS: Record<IdentityType, string> = {
  mykad: "MyKad",
  mypr: "MyPR",
  passport: "Passport",
  other: "Other",
};

export function isValidIdentityType(v: unknown): v is IdentityType {
  return typeof v === "string" && (IDENTITY_TYPES as readonly string[]).includes(v);
}

export function identityTypeLabel(v: string | null | undefined): string {
  if (!v) return "";
  return isValidIdentityType(v) ? IDENTITY_LABELS[v] : "";
}

/** MyKad/MyPR: strip whitespace and hyphens; must be exactly 12 digits. */
export function normalizeMyKad(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d{12}$/.test(digits)) return null;
  return digits;
}

/** Passport/Other: trim, limit 50 chars, non-empty. */
export function normalizePassport(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.length > 50) return null;
  return t;
}

/**
 * Validate an identity type/number pair. Returns the normalized number when
 * valid. Both fields optional together; supplying only one is an error.
 * Never surfaces the input value in error text.
 */
export function normalizeIdentity(
  identityType: string,
  identityNumber: string,
): { ok: true; type: IdentityType | null; number: string | null } | { ok: false; code: string } {
  const t = identityType.trim();
  const n = identityNumber.trim();
  if (!t && !n) return { ok: true, type: null, number: null };
  if (!t || !n) return { ok: false, code: "identity_pair_required" };
  if (!isValidIdentityType(t)) return { ok: false, code: "invalid_identity_type" };
  if (t === "mykad" || t === "mypr") {
    const norm = normalizeMyKad(n);
    if (!norm) return { ok: false, code: "invalid_mykad" };
    return { ok: true, type: t, number: norm };
  }
  const norm = normalizePassport(n);
  if (!norm) return { ok: false, code: "invalid_passport" };
  return { ok: true, type: t, number: norm };
}

/** Mask an identity number for display; keep last 4 chars only. */
export function maskIdentityNumber(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v);
  if (s.length === 0) return null;
  if (s.length <= 4) return "•".repeat(Math.max(s.length, 1));
  const tail = s.slice(-4);
  return "•".repeat(s.length - 4) + tail;
}
