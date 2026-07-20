// UX helpers for the Rooms & Rates N3 stock picker.
// Purely client/UX logic — server-side unique constraint + 409 remain the
// authoritative duplicate protection.

export function normalizeStockCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function buildMappedStockSet(
  rooms: ReadonlyArray<{ n3StockCode: string }>,
): Set<string> {
  const set = new Set<string>();
  for (const r of rooms) {
    const n = normalizeStockCode(r.n3StockCode);
    if (n) set.add(n);
  }
  return set;
}

export function isStockMapped(code: string, mapped: ReadonlySet<string>): boolean {
  return mapped.has(normalizeStockCode(code));
}

// Guarded picker: refuses to invoke onPick when the code is already mapped.
// Returns true when the row was picked, false when the click was suppressed.
export function selectIfAllowed<T extends { code: string }>(
  row: T,
  mapped: ReadonlySet<string>,
  onPick: (r: T) => void,
): boolean {
  if (isStockMapped(row.code, mapped)) return false;
  onPick(row);
  return true;
}
