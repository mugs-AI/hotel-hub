// Pure YYYY-MM helpers for the Owner financial month selector.
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Earliest month the selector offers (server accepts 2000–2100). */
export const MIN_FINANCIAL_MONTH = "2000-01";

export function parseMonth(v: string | undefined | null): { y: number; m: number } | null {
  const r = /^(\d{4})-(\d{2})$/.exec(v ?? "");
  if (!r) return null;
  const y = Number(r[1]);
  const m = Number(r[2]);
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  return { y, m };
}

export function formatMonth(y: number, m: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** Add `delta` months with year rollover; null when the input is invalid. */
export function shiftMonth(v: string, delta: number): string | null {
  const p = parseMonth(v);
  if (!p) return null;
  const idx = p.y * 12 + (p.m - 1) + delta;
  return formatMonth(Math.floor(idx / 12), (idx % 12) + 1);
}

/** Clamp a month into [min, max] (string compare is safe for YYYY-MM). */
export function clampMonth(v: string, min: string, max: string): string {
  return v < min ? min : v > max ? max : v;
}

export type MonthSelection = { identity: string; month: string } | null;

/**
 * Month shown by the finance section. A selection only applies to the identity
 * that made it; the maximum is that identity's server-derived property month.
 * No identity or no fresh maximum → nothing (fail closed, no stale controls).
 */
export function resolveFinancialMonth(
  identity: string | null,
  selection: MonthSelection,
  max: string | undefined,
): string | undefined {
  if (identity === null || !max || !parseMonth(max)) return undefined;
  const picked = selection && selection.identity === identity ? selection.month : undefined;
  return picked ? clampMonth(picked, MIN_FINANCIAL_MONTH, max) : max;
}
