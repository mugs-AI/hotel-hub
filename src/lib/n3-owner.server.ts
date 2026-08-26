// Server-only N3 ownership resolution.
//
// Reads the official, read-only `GET /api/Users` endpoint with the
// server-held N3 token and turns it into an EFFECTIVE HotelHub role through
// the pure decision layer in `n3-owner.ts`.
//
// Invariants:
//  - the N3 token, the raw upstream body, and any user list NEVER leave the
//    server, are never logged, and are never returned to the browser;
//  - nothing here accepts browser-supplied tenant, user, owner or role;
//  - Owner authority fails closed on every unauthorized / forbidden /
//    unavailable / malformed / unmatched / inactive outcome.
import { createHash } from "node:crypto";
import { callN3Path } from "./n3-gateway.server";
import {
  decideEffectiveRole,
  extractN3Users,
  type EffectiveRoleDecision,
  type N3UsersRead,
  type SessionIdentity,
} from "./n3-owner";
import type { HotelRole } from "./rbac";

/** The single official read-only endpoint HotelHub consults for ownership. */
export const N3_USERS_PATH = "/api/Users";

/**
 * Short server-only cache. Bounded to 60s by the approved correction.
 *
 * Truthful statement of the guarantee: a revocation performed in N3 is
 * enforced by HotelHub NO LATER THAN this cache window expires for the same
 * token/tenant/user key — not "immediately".
 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;

/**
 * Ownership is on the critical path of the first authenticated API calls, so
 * its upstream wait is bounded far tighter than the general N3 gateway
 * timeout. On timeout the read is `unavailable` and Owner fails closed.
 */
export const OWNERSHIP_UPSTREAM_TIMEOUT_MS = 3_000;

type CacheEntry = { expiresAt: number; decision: EffectiveRoleDecision };

const decisionCache = new Map<string, CacheEntry>();

/**
 * In-flight single flight. Concurrent cache misses for the SAME safe key
 * share one upstream read + decision instead of stampeding `/api/Users`.
 * Entries are always removed in `finally`, so a failure can never wedge the
 * key.
 */
const inFlight = new Map<string, Promise<EffectiveRoleDecision>>();

/**
 * Cache key. The token is HASHED, never stored: a rotated/replaced token
 * cannot reuse another token's decision, and the cache itself never holds a
 * credential. Tenant + user are included so a decision can never cross scope.
 */
export function ownershipCacheKey(input: {
  token: string;
  tenantId: string;
  n3UserKey: string;
}): string {
  const tokenFingerprint = createHash("sha256").update(input.token).digest("hex");
  return `${input.tenantId}::${input.n3UserKey}::${tokenFingerprint}`;
}

/** Testing seam only — never exported to route code. */
export function __resetOwnershipCache(): void {
  decisionCache.clear();
  inFlight.clear();
}

/** Testing seam only: how many upstream reads are currently de-duplicated. */
export function __inFlightOwnershipCount(): number {
  return inFlight.size;
}

function readCache(key: string, now: number): EffectiveRoleDecision | null {
  const hit = decisionCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    decisionCache.delete(key);
    return null;
  }
  return hit.decision;
}

function writeCache(key: string, decision: EffectiveRoleDecision, now: number): void {
  if (decisionCache.size >= CACHE_MAX_ENTRIES) {
    // Cheap bound: drop the oldest inserted entry.
    const oldest = decisionCache.keys().next();
    if (!oldest.done) decisionCache.delete(oldest.value);
  }
  decisionCache.set(key, { expiresAt: now + CACHE_TTL_MS, decision });
}

/**
 * Read `/api/Users`. 401/403/5xx/network/timeouts all collapse to
 * `unavailable`; a 200 whose body is not a usable user list is `malformed`.
 * Neither the status body nor any user record is logged.
 */
export async function readN3Users(token: string): Promise<N3UsersRead> {
  try {
    const res = await callN3Path(token, N3_USERS_PATH, {
      timeoutMs: OWNERSHIP_UPSTREAM_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) return { status: "unavailable" };
    return extractN3Users(res.body);
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Resolve the effective role for the authenticated request. This is the ONLY
 * role every server permission check, `/api/session/me` and the navigation
 * shell may use.
 */
export type ResolvedEffectiveRole = EffectiveRoleDecision & { fromCache: boolean };

export async function resolveEffectiveRole(input: {
  token: string;
  tenantId: string;
  identity: SessionIdentity;
  localRole: { role: HotelRole; isActive: boolean } | null;
  /** Test seam: inject the upstream read instead of calling N3. */
  readUsers?: (token: string) => Promise<N3UsersRead>;
  now?: number;
}): Promise<ResolvedEffectiveRole> {
  const now = input.now ?? Date.now();
  const key = ownershipCacheKey({
    token: input.token,
    tenantId: input.tenantId,
    n3UserKey: input.identity.n3UserKey,
  });
  const cached = readCache(key, now);
  // A cached decision is only reusable when the LOCAL assignment it was made
  // against is unchanged; ownership itself always comes from N3.
  if (cached && cached.role !== "owner") {
    const localStillMatches =
      cached.role === null ||
      (input.localRole?.isActive === true && input.localRole.role === cached.role);
    if (localStillMatches) return { ...cached, fromCache: true };
  } else if (cached) {
    return { ...cached, fromCache: true };
  }

  // Single flight: the first miss owns the upstream read; every concurrent
  // miss for the same safe key awaits that same promise.
  const existing = inFlight.get(key);
  if (existing) return { ...(await existing), fromCache: true };

  const work = (async () => {
    const read = await (input.readUsers ?? readN3Users)(input.token);
    const decision = decideEffectiveRole({
      read,
      identity: input.identity,
      localRole: input.localRole,
    });
    writeCache(key, decision, now);
    return decision;
  })();
  inFlight.set(key, work);
  try {
    const decision = await work;
    return { ...decision, fromCache: false };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * HH-AUTH-02 — narrow cache invalidation.
 *
 * Drops every cached effective-role decision for one tenant + N3 user, across
 * all token fingerprints, so a grant or revocation is observed on that user's
 * NEXT authorization decision instead of up to 60s later. Scope is limited to
 * the exact `tenantId::n3UserKey::` key prefix: no other user, tenant or
 * session is affected, and no credential is read.
 */
export function invalidateOwnershipCacheForUser(tenantId: string, n3UserKey: string): number {
  const prefix = `${tenantId}::${n3UserKey}::`;
  let removed = 0;
  for (const key of Array.from(decisionCache.keys())) {
    if (key.startsWith(prefix)) {
      decisionCache.delete(key);
      removed += 1;
    }
  }
  return removed;
}
