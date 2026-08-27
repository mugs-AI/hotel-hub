// HH-AUTH-04 — server-only permission-neutral N3 token validation.
//
// Calls the official `UserData_GetValue_GET` endpoint with the server-held
// token. The token never leaves the server, the response body is discarded,
// and nothing here is reachable from the browser.
import { createHash } from "node:crypto";
import { callN3Path } from "./n3-gateway.server";
import {
  interpretNeutralValidation,
  N3_NEUTRAL_VALIDATION_PATH,
  type NeutralValidation,
} from "./n3-token-validation";

/** Bounded upstream wait — this sits on the critical path of every request. */
export const NEUTRAL_VALIDATION_TIMEOUT_MS = 3_000;

/** Maximum server-only cache window mandated by HH-AUTH-04. */
export const NEUTRAL_VALIDATION_CACHE_TTL_MS = 60_000;

const CACHE_MAX_ENTRIES = 500;

type CacheEntry = { expiresAt: number; result: NeutralValidation };

const cache = new Map<string, CacheEntry>();

/** Testing seam only. */
export function __resetNeutralValidationCache(): void {
  cache.clear();
}

/** Token is hashed, never stored. */
function cacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * One raw, uncached validation call. Network errors and timeouts collapse to
 * `unavailable`; nothing upstream is logged.
 */
export async function validateN3TokenNeutral(token: string): Promise<NeutralValidation> {
  try {
    const res = await callN3Path(token, N3_NEUTRAL_VALIDATION_PATH, {
      timeoutMs: NEUTRAL_VALIDATION_TIMEOUT_MS,
    });
    return interpretNeutralValidation(res.status, res.body);
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Cached validation for the protected-request lifecycle. Only a positive
 * `accepted` result is cached, and never for longer than 60 seconds: a
 * revoked / expired token is re-checked at the next request after that
 * window. Failures are never cached, so a transient upstream error cannot
 * pin a user out beyond the failing request itself.
 */
export async function validateN3TokenNeutralCached(
  token: string,
  opts?: {
    now?: number;
    /** Test seam: inject the upstream validation. */
    validate?: (token: string) => Promise<NeutralValidation>;
  },
): Promise<NeutralValidation & { fromCache: boolean }> {
  const now = opts?.now ?? Date.now();
  const key = cacheKey(token);
  const hit = cache.get(key);
  if (hit) {
    if (hit.expiresAt > now) return { ...hit.result, fromCache: true };
    cache.delete(key);
  }
  const result = await (opts?.validate ?? validateN3TokenNeutral)(token);
  if (result.status === "accepted") {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { expiresAt: now + NEUTRAL_VALIDATION_CACHE_TTL_MS, result });
  }
  return { ...result, fromCache: false };
}

/** Drop a cached acceptance (e.g. when the session is destroyed). */
export function invalidateNeutralValidation(token: string): void {
  cache.delete(cacheKey(token));
}
