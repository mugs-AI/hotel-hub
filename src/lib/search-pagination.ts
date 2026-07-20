// Pure, browser-safe pagination for globally-filtered result lists.
// Used by the Customer & Stock pickers after the complete tenant dataset
// has been loaded into memory.

export type PageSize = 10 | 20 | 30 | 40 | 50;
export const PAGE_SIZE_OPTIONS: readonly PageSize[] = [10, 20, 30, 40, 50] as const;

export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: PageSize,
): { pageItems: T[]; page: number; totalPages: number; from: number; to: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clamped = Math.min(Math.max(1, page), totalPages);
  const start = (clamped - 1) * pageSize;
  const end = Math.min(items.length, start + pageSize);
  return {
    pageItems: items.slice(start, end),
    page: clamped,
    totalPages,
    from: items.length === 0 ? 0 : start + 1,
    to: end,
  };
}

/** Build a compact page-number list with ellipsis markers. */
export function pageWindow(current: number, total: number, span = 1): (number | "…")[] {
  if (total <= 1) return [1];
  const set = new Set<number>([1, total, current]);
  for (let d = 1; d <= span; d++) {
    set.add(current - d);
    set.add(current + d);
  }
  const pages = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}
