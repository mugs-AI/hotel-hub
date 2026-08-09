/**
 * Run 5D2.6 §7 — idempotent client request IDs.
 *
 * One UUID belongs to one normalized payload. Retrying the SAME payload after
 * an unknown/network outcome must reuse the same UUID so the server-side
 * mutation ledger can replay instead of double-applying. A new UUID is
 * generated only when the payload signature changes, or after the caller
 * explicitly rotates it (successful / authoritative response).
 */
import { useCallback, useRef, useState } from "react";

export type RequestIdState = { signature: string; id: string };

export function makeRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Deterministic-shaped fallback for non-crypto environments (tests/SSR).
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

/**
 * Pure transition: keep the existing ID while the signature is unchanged.
 */
export function nextRequestId(
  prev: RequestIdState | null,
  signature: string,
  makeId: () => string = makeRequestId,
): RequestIdState {
  if (prev && prev.signature === signature) return prev;
  return { signature, id: makeId() };
}

/**
 * React binding. `get(signature)` returns a stable ID for that signature;
 * `rotate()` forces a fresh ID after a completed (successful or
 * authoritative non-retryable) response.
 */
export function useIdempotentRequestId() {
  const ref = useRef<RequestIdState | null>(null);
  const [, force] = useState(0);
  const get = useCallback((signature: string) => {
    const next = nextRequestId(ref.current, signature);
    ref.current = next;
    return next.id;
  }, []);
  const rotate = useCallback(() => {
    ref.current = null;
    force((n) => n + 1);
  }, []);
  return { get, rotate };
}
