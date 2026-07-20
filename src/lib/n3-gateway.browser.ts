// Browser-safe search helpers for N3 records. Pure, no I/O.
// The server module (n3-gateway.server.ts) re-exports these so tests can
// import from either location.

export function normalizeSearchText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesQuery(query: string, code: string, name: string | null): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const hay = normalizeSearchText(`${code} ${name ?? ""}`);
  const words = q.split(" ");
  return words.every((w) => hay.includes(w));
}
