// HH-GOLIVE-01A — operation-scoped idempotency (pure, no I/O).
//
// A bare `clientRequestId` is not a safe idempotency key. The same id could
// arrive for a different operation, against a different folio line, or with a
// different payload — replaying the first result would then be silently wrong.
//
// Every mutating folio operation therefore carries:
//   * an OPERATION name,
//   * the immutable TARGET scope (tenant + reservation + folio + line),
//   * a deterministic FINGERPRINT of the request payload.
//
// Same key + same fingerprint + same target  → replay the original result.
// Same key + anything else                   → conflict, refuse (409).

export const FOLIO_OPERATIONS = [
  "folio.add_addon",
  "folio.adjustment",
  "folio.reverse",
  "folio.update_quantity",
  "folio.tourism_tax_evidence",
] as const;

export type FolioOperation = (typeof FOLIO_OPERATIONS)[number];

export function isFolioOperation(v: unknown): v is FolioOperation {
  return typeof v === "string" && (FOLIO_OPERATIONS as readonly string[]).includes(v);
}

/** Stable stringify: key order never changes the fingerprint. */
function stable(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  if (typeof value === "undefined") return "null";
  return JSON.stringify(value);
}

/** Hard cap on the canonical input so a hostile body can never make the
 *  server hash an unbounded string. Bodies are already size-capped at the
 *  route boundary; this is the second, independent bound. */
export const CANONICAL_INPUT_LIMIT = 8 * 1024;

/**
 * SHA-256 hex digest, computed on the SERVER with WebCrypto. A fingerprint
 * decides whether a retry replays a financial write, so a fast
 * non-cryptographic hash is not acceptable here: two different bodies that
 * collide would replay the wrong money.
 */
async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("fingerprint_unavailable");
  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type OperationTarget = {
  tenantId: string;
  reservationId: string;
  folioId: string | null;
  lineId: string | null;
};

/**
 * Canonical, bounded input for one operation attempt. It deliberately
 * includes the whole immutable target scope, so the same payload against a
 * different reservation, folio or line produces a DIFFERENT fingerprint.
 */
export function canonicalOperationInput(
  operation: FolioOperation,
  target: OperationTarget,
  payload: unknown,
): string {
  const canonical = stable({
    operation,
    tenantId: target.tenantId,
    reservationId: target.reservationId,
    folioId: target.folioId,
    lineId: target.lineId,
    payload,
  });
  if (canonical.length > CANONICAL_INPUT_LIMIT) {
    throw new Error("fingerprint_input_too_large");
  }
  return canonical;
}

/** SHA-256 fingerprint of one operation attempt (server-side only). */
export async function operationFingerprint(
  operation: FolioOperation,
  target: OperationTarget,
  payload: unknown,
): Promise<string> {
  return sha256Hex(canonicalOperationInput(operation, target, payload));
}

export type ClaimRecord = {
  operation: string;
  folioId: string | null;
  targetLineId: string | null;
  requestFingerprint: string;
  resultLineId: string | null;
};

export type ClaimDecision =
  | { kind: "new" }
  | { kind: "replay"; resultLineId: string | null }
  | { kind: "conflict" };

/** Fail-closed: anything that is not an exact match on operation, target and
 *  fingerprint is a conflict, never a replay and never a second write. */
export function decideClaim(
  existing: ClaimRecord | null,
  incoming: {
    operation: FolioOperation;
    folioId: string | null;
    lineId: string | null;
    fingerprint: string;
  },
): ClaimDecision {
  if (!existing) return { kind: "new" };
  if (
    existing.operation !== incoming.operation ||
    (existing.folioId ?? null) !== incoming.folioId ||
    (existing.targetLineId ?? null) !== incoming.lineId ||
    existing.requestFingerprint !== incoming.fingerprint
  ) {
    return { kind: "conflict" };
  }
  return { kind: "replay", resultLineId: existing.resultLineId ?? null };
}
