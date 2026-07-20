// Shared N3 launch handler. Consumes an N3 launch token server-side,
// verifies it against N3 BasicInfo, upserts the tenant, opens the
// encrypted HttpOnly session cookie, and returns a 302 redirect to a
// clean URL. Never returns the token to the browser or writes it to
// any client-visible surface (address bar after redirect, response body,
// logs).
//
// Fail-closed: any verification/identity/exception failure clears the
// pre-existing HotelHub session cookie so a rejected re-launch cannot
// leave the old session intact.
import { getHotelSession } from "./session.server";
import { callN3Path } from "./n3-gateway.server";
import { normalizeBasicInfo } from "./n3-basicinfo";
import { decodeJwtClaims } from "./jwt-claims.server";
import { upsertTenant } from "./tenant-store.server";
import { logAudit } from "./audit.server";

export type LaunchSource = "path_a" | "root" | "path_b_dev";

/** Allowlisted, user-safe launch-error codes surfaced in the URL. */
export const SAFE_LAUNCH_ERROR_CODES = [
  "session_expired",
  "n3_rejected",
  "n3_unavailable",
  "identity_unavailable",
  "launch_failed",
] as const;
export type SafeLaunchErrorCode = (typeof SAFE_LAUNCH_ERROR_CODES)[number];

/** Custom header on non-2xx launch responses so the interceptor can map
 * a specific failure branch to a specific safe code. Never contains
 * token material or upstream error text. */
export const LAUNCH_ERROR_HEADER = "x-hotelhub-error-code";

async function clearSessionBestEffort() {
  try {
    const s = await getHotelSession();
    await s.clear();
  } catch {
    /* best effort */
  }
}

function failure(status: number, message: string, code: SafeLaunchErrorCode): Response {
  return new Response(message, {
    status,
    headers: { [LAUNCH_ERROR_HEADER]: code, "cache-control": "no-store" },
  });
}

/** Numeric JWT `exp` claim (seconds since epoch) if present and finite. */
export function jwtExpirationMs(claims: Record<string, unknown>): number | null {
  const exp = claims.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return Math.floor(exp) * 1000;
}

export async function performN3Launch(
  rawToken: unknown,
  redirectTo: string,
  source: LaunchSource = "path_a",
): Promise<Response> {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!token) {
    await clearSessionBestEffort();
    return failure(400, "Missing token", "launch_failed");
  }
  try {
    // Reject already-expired JWTs before we ever hand them to N3.
    const claims = decodeJwtClaims(token);
    const expMs = jwtExpirationMs(claims);
    if (expMs !== null && expMs <= Date.now()) {
      await clearSessionBestEffort();
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "jwt_expired" },
      });
      return failure(401, "N3 token expired", "session_expired");
    }

    const probe = await callN3Path(token, "/api/companyprofile/BasicInfo");
    if (probe.status === 401) {
      await clearSessionBestEffort();
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "basicinfo", status: 401 },
      });
      return failure(401, "N3 rejected the launch token", "n3_rejected");
    }
    if (probe.status < 200 || probe.status >= 300) {
      await clearSessionBestEffort();
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "basicinfo", status: probe.status },
      });
      return failure(502, "N3 verification failed", "n3_unavailable");
    }
    const envelope = (probe.body ?? {}) as { code?: string; data?: unknown };
    if (envelope.code && envelope.code !== "0000") {
      await clearSessionBestEffort();
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "basicinfo", code: envelope.code },
      });
      return failure(502, "N3 verification failed", "n3_unavailable");
    }
    const info = normalizeBasicInfo(envelope.data, claims);
    if (!info.n3TenantKey) {
      await clearSessionBestEffort();
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "identity", reason: "missing_n3_tenant_key" },
      });
      return failure(502, "N3 tenant identity not available", "identity_unavailable");
    }
    // Prefer immutable JWT `sub` for the user key; email/username fallback
    // is retained (documented as unresolved in README) but never used for
    // authorization state beyond first-Owner identification.
    const n3UserKey =
      (typeof claims.sub === "string" && claims.sub) || info.userEmail || info.userName;
    if (!n3UserKey) {
      await clearSessionBestEffort();
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "identity", reason: "missing_n3_user_key" },
      });
      return failure(502, "N3 user identity not available", "identity_unavailable");
    }

    const tenant = await upsertTenant({
      n3TenantKey: info.n3TenantKey,
      tenantCode: info.tenantCode,
      companyName: info.companyName,
    });

    const session = await getHotelSession();
    await session.update({
      n3Token: token,
      n3TokenExpiration: expMs !== null ? new Date(expMs).toISOString() : null,
      n3TenantKey: tenant.n3TenantKey,
      tenantCode: tenant.tenantCode,
      companyName: tenant.companyName,
      n3UserKey,
      userEmail: info.userEmail,
      userName: info.userName,
      tenantId: tenant.id,
      createdAt: Date.now(),
    });
    await logAudit({
      tenantId: tenant.id,
      n3UserKey,
      eventType: "session.launch.success",
      detail: { source },
    });

    return new Response(null, {
      status: 302,
      headers: { Location: redirectTo || "/", "cache-control": "no-store" },
    });
  } catch (err) {
    // Redact — never echo the token or upstream error text.
    console.error("[launch] failed:", (err as Error)?.message?.slice(0, 200));
    await clearSessionBestEffort();
    await logAudit({
      eventType: "session.launch.failure",
      detail: { source, stage: "exception" },
    });
    return failure(500, "Launch failed", "launch_failed");
  }
}

/**
 * Strip `token` from a URL's query string, preserving unrelated params,
 * and return `pathname[?remaining]`.
 */
export function stripTokenFromUrl(url: URL): string {
  const params = new URLSearchParams(url.searchParams);
  params.delete("token");
  const qs = params.toString();
  return url.pathname + (qs ? `?${qs}` : "");
}

/** Build the token-free 302 redirect to the launch-error view. */
export function redirectToLaunchError(code: SafeLaunchErrorCode): Response {
  const safe = (SAFE_LAUNCH_ERROR_CODES as readonly string[]).includes(code) ? code : "launch_failed";
  return new Response(null, {
    status: 302,
    headers: {
      location: `/launch-error?code=${encodeURIComponent(safe)}`,
      "cache-control": "no-store",
    },
  });
}

function mapStatusToSafeCode(status: number): SafeLaunchErrorCode {
  if (status === 401) return "n3_rejected";
  if (status === 502) return "n3_unavailable";
  return "launch_failed";
}

/**
 * Root `GET /?token=<jwt>` interception, extracted from `src/start.ts`
 * so it can be exercised directly by tests.
 *
 * Returns:
 *   - `Response` — the interceptor consumed the request; caller must NOT
 *     call `next()`. Success is a 302 to the clean URL; failure is a
 *     token-free 302 to `/launch-error?code=<safe>`.
 *   - `null` — this request is not a root launch; caller should proceed.
 */
export async function handleRootLaunchRequest(request: Request): Promise<Response | null> {
  if (request.method !== "GET") return null;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.pathname !== "/") return null;
  const token = url.searchParams.get("token");
  if (!token || !token.trim()) return null;

  // Token handling has begun. From here on we do not call next(), and
  // every response omits the token from body/headers.
  try {
    const cleanTarget = stripTokenFromUrl(url);
    const res = await performN3Launch(token, cleanTarget, "root");
    if (res.status >= 300 && res.status < 400) return res;
    const headerCode = res.headers.get(LAUNCH_ERROR_HEADER);
    const code: SafeLaunchErrorCode =
      headerCode && (SAFE_LAUNCH_ERROR_CODES as readonly string[]).includes(headerCode)
        ? (headerCode as SafeLaunchErrorCode)
        : mapStatusToSafeCode(res.status);
    await clearSessionBestEffort();
    return redirectToLaunchError(code);
  } catch (err) {
    console.error("[root-launch] failed:", (err as Error)?.message?.slice(0, 200));
    await clearSessionBestEffort();
    return redirectToLaunchError("launch_failed");
  }
}
