// Pure integer-money helpers for the checkout folio preview (Run 5D3.1).
//
// Authoritative money arithmetic NEVER uses floating point. Every amount is
// converted to integer minor units (cents) with strict scale validation, and
// only converted back to a two-decimal number at the DTO/UI boundary.

/** Upper bound for any single amount or total: 10,000,000.00 in cents. */
export const MAX_MONEY_CENTS = 1_000_000_000;

/** Maximum whole nights a single preview may charge. */
export const MAX_NIGHTS = 3650;

/**
 * Convert a stored decimal amount to integer cents.
 * Rejects non-finite, negative, out-of-range and >2-decimal values.
 */
export function toCents(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) n = Number(v);
  else return null;
  if (!Number.isFinite(n) || n < 0) return null;
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return null; // more than two decimals
  if (!Number.isSafeInteger(cents) || cents > MAX_MONEY_CENTS) return null;
  return cents;
}

/** Convert integer cents to a two-decimal DTO number. */
export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Whole calendar nights over the half-open interval [arrival, departure).
 * Returns null for malformed dates or a non-positive span.
 */
export function nightsBetween(arrivalIso: string, departureIso: string): number | null {
  const a = parseIsoUtc(arrivalIso);
  const d = parseIsoUtc(departureIso);
  if (a === null || d === null) return null;
  const diff = (d - a) / 86_400_000;
  if (!Number.isInteger(diff) || diff <= 0 || diff > MAX_NIGHTS) return null;
  return diff;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoUtc(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = ISO_DATE_RE.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/** `nights × rateCents`, fail-closed on overflow. */
export function multiplyCents(rateCents: number, nights: number): number | null {
  if (!Number.isSafeInteger(rateCents) || rateCents < 0) return null;
  if (!Number.isSafeInteger(nights) || nights <= 0) return null;
  const total = rateCents * nights;
  if (!Number.isSafeInteger(total) || total > MAX_MONEY_CENTS) return null;
  return total;
}

/** Checked integer sum, fail-closed on overflow or invalid members. */
export function sumCents(values: readonly number[]): number | null {
  let total = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v) || v < 0) return null;
    total += v;
    if (!Number.isSafeInteger(total) || total > MAX_MONEY_CENTS) return null;
  }
  return total;
}

/** Balance never goes negative. */
export function estimatedBalanceCents(chargeCents: number, depositCents: number): number {
  return Math.max(chargeCents - depositCents, 0);
}

/** Deposit beyond the room charge — a credit requiring review, never a refund. */
export function excessDepositCents(chargeCents: number, depositCents: number): number {
  return Math.max(depositCents - chargeCents, 0);
}
