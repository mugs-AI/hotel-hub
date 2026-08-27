// HH-GOLIVE-01A — signed integer-cent money helpers for the authoritative
// folio. No floating-point money anywhere: every amount is an integer number
// of minor units, every derivation is deterministic, and every operation
// fails closed (returns null) on overflow or malformed input.

/** Hard cap for any single amount or total: 10,000,000.00. */
export const MAX_CENTS = 1_000_000_000;

/** Basis points: 10000 bp = 100%. */
export const BP_SCALE = 10_000;

export type RoundingMode = "none" | "nearest_5_cents" | "nearest_10_cents";

export const ROUNDING_MODES: readonly RoundingMode[] = [
  "none",
  "nearest_5_cents",
  "nearest_10_cents",
] as const;

export function isRoundingMode(v: unknown): v is RoundingMode {
  return typeof v === "string" && (ROUNDING_MODES as readonly string[]).includes(v);
}

/** A signed cent amount inside the supported range. */
export function isCents(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= MAX_CENTS;
}

/** Parse a non-negative decimal (number or string) into integer cents. */
export function parseCents(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) n = Number(v);
  else return null;
  if (!Number.isFinite(n) || n < 0) return null;
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return null; // more than two decimals
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return cents;
}

/** Integer cents → two-decimal display number, for DTO/UI boundaries only. */
export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

/** Format integer cents for humans. Never used as an arithmetic input. */
export function formatCents(cents: number, currency = "MYR"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${currency} ${(abs / 100).toFixed(2)}`;
}

/**
 * Deterministic half-up-away-from-zero rounding of a rational cent value.
 * `roundHalfUp(2.5) === 3`, `roundHalfUp(-2.5) === -3`.
 */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** `base × bp / 10000`, half-up, fail-closed. */
export function applyBasisPoints(baseCents: number, bp: number): number | null {
  if (!isCents(baseCents)) return null;
  if (!Number.isSafeInteger(bp) || bp < 0 || bp > BP_SCALE) return null;
  const raw = (baseCents * bp) / BP_SCALE;
  const out = roundHalfUp(raw);
  return isCents(out) ? out : null;
}

/** `unit × quantity`, fail-closed. Quantity must be a positive whole number. */
export function multiplyCents(unitCents: number, quantity: number): number | null {
  if (!isCents(unitCents)) return null;
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 9999) return null;
  const total = unitCents * quantity;
  return isCents(total) ? total : null;
}

/** Checked signed sum. Fail-closed on any malformed member or overflow. */
export function sumCents(values: readonly number[]): number | null {
  let total = 0;
  for (const v of values) {
    if (!isCents(v)) return null;
    total += v;
    if (!isCents(total)) return null;
  }
  return total;
}

/**
 * Cash-rounding adjustment applied to a grand total. Returns the signed
 * delta that must be added to reach the rounded total (0 for `none`).
 */
export function roundingAdjustmentCents(totalCents: number, mode: RoundingMode): number | null {
  if (!isCents(totalCents)) return null;
  const step = mode === "nearest_5_cents" ? 5 : mode === "nearest_10_cents" ? 10 : 0;
  if (step === 0) return 0;
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const rounded = Math.round(abs / step) * step;
  const delta = sign * rounded - totalCents;
  return isCents(delta) ? delta : null;
}
