// Malaysian date utilities — browser-safe, pure, no locale dependency.
//
// User-visible dates render as `dd/mm/yyyy` (e.g. `21/07/2026`) and
// timestamps as `dd/mm/yyyy HH:mm` in `Asia/Kuala_Lumpur`. Machine formats
// (ISO `yyyy-mm-dd`) are preserved for API, database and URL contracts.
//
// NEVER call `new Date("yyyy-mm-dd")` for date-only values — it is parsed
// as UTC midnight and displays as the previous day in negative offsets.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MY_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export const EMPTY_DATE_DISPLAY = "—";

/** True when `y-m-d` refers to a real calendar day (rejects e.g. 31/02). */
export function isRealCalendarDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2999) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True for a strictly-shaped, real ISO date-only string. */
export function isValidIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  return isRealCalendarDate(y, m, d);
}

/** True for a strictly-shaped, real Malaysian display date. */
export function isValidMyDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = MY_DATE_RE.exec(v);
  if (!m) return false;
  return isRealCalendarDate(Number(m[3]), Number(m[2]), Number(m[1]));
}

/** Convert ISO `yyyy-mm-dd` to Malaysian `dd/mm/yyyy`. Returns fallback for absent/invalid. */
export function isoToMyDate(v: string | null | undefined): string {
  if (v == null || v === "") return EMPTY_DATE_DISPLAY;
  if (!isValidIsoDate(v)) return EMPTY_DATE_DISPLAY;
  const [y, m, d] = v.split("-");
  return `${d}/${m}/${y}`;
}

/** Convert Malaysian `dd/mm/yyyy` to ISO `yyyy-mm-dd`, or `null` if invalid. */
export function myDateToIso(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  const m = MY_DATE_RE.exec(trimmed);
  if (!m) return null;
  const y = Number(m[3]);
  const mo = Number(m[2]);
  const d = Number(m[1]);
  if (!isRealCalendarDate(y, mo, d)) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Format an ISO timestamp explicitly in `Asia/Kuala_Lumpur` as
 * `dd/mm/yyyy HH:mm` (24-hour). Never depends on the browser locale.
 */
export function formatMyTimestamp(v: string | null | undefined): string {
  if (v == null || v === "") return EMPTY_DATE_DISPLAY;
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  if (!Number.isFinite(t)) return EMPTY_DATE_DISPLAY;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("day");
  const month = get("month");
  const year = get("year");
  let hour = get("hour");
  if (hour === "24") hour = "00";
  const minute = get("minute");
  if (!day || !month || !year || !hour || !minute) return EMPTY_DATE_DISPLAY;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

/** Format an ISO date-only value; returns fallback when absent/invalid. */
export function formatMyDate(v: string | null | undefined): string {
  return isoToMyDate(v);
}

/**
 * Today's calendar date in `Asia/Kuala_Lumpur` as ISO `yyyy-mm-dd`.
 * Never depends on the browser/system timezone — used for date-only
 * comparisons like "arrival cannot be earlier than today".
 */
export function todayInKualaLumpurIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/** Add `n` calendar days to an ISO date-only value (UTC-safe arithmetic). */
export function addDaysIso(iso: string, n: number): string {
  if (!isValidIsoDate(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
