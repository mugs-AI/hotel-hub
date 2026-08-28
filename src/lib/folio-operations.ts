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

/** Deterministic, non-cryptographic 64-bit-ish digest. Collision-resistant
 *  enough for replay detection, and never used as a security boundary. */
function digest(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export type OperationTarget = {
  tenantId: string;
  reservationId: string;
  folioId: string | null;
  lineId: string | null;
};

/**
 * Fingerprint of one operation attempt. It deliberately includes the whole
 * immutable target scope, so the same payload against a different reservation,
 * folio or line produces a DIFFERENT fingerprint.
 */
export function operationFingerprint(
  operation: FolioOperation,
  target: OperationTarget,
  payload: unknown,
): string {
  return digest(
    stable({
      operation,
      tenantId: target.tenantId,
      reservationId: target.reservationId,
      folioId: target.folioId,
      lineId: target.lineId,
      payload,
    }),
  );
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
  incoming: { operation: FolioOperation; folioId: string | null; lineId: string | null; fingerprint: string },
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
