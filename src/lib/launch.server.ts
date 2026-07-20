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

async function clearSessionBestEffort() {
  try {
    const s = await getHotelSession();
    await s.clear();
  } catch {
    /* best effort */
  }
}

/** Numeric JWT `exp` claim (seconds since epoch) if present and finite. */
export function jwtExpirationMs(claims: Record<string, unknown>): number | null {
  const exp = claims.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return Math.floor(exp) * 1000;
}

export async function performN3Launch(
  rawToken: string,
  redirectTo: string,
  source: LaunchSource = "path_a",
): Promise<Response> {
  const token = rawToken.trim();
  if (!token) {
    await clearSessionBestEffort();
    return new Response("Missing token", { status: 400 });
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
      return new Response("N3 token expired", { status: 401 });
    }

    const probe = await callN3Path(token, "/api/companyprofile/BasicInfo");
    if (probe.status === 401) {
      await clearSessionBestEffort();
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "basicinfo", status: 401 },
      });
      return new Response("N3 rejected the launch token", { status: 401 });
    }
    if (probe.status < 200 || probe.status >= 300) {
      await clearSessionBestEffort();
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "basicinfo", status: probe.status },
      });
      return new Response("N3 verification failed", { status: 502 });
    }
    const envelope = (probe.body ?? {}) as { code?: string; data?: unknown };
    if (envelope.code && envelope.code !== "0000") {
      await clearSessionBestEffort();
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "basicinfo", code: envelope.code },
      });
      return new Response("N3 verification failed", { status: 502 });
    }
    const info = normalizeBasicInfo(envelope.data, claims);
    if (!info.n3TenantKey) {
      await clearSessionBestEffort();
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "identity", reason: "missing_n3_tenant_key" },
      });
      return new Response("N3 tenant identity not available", { status: 502 });
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
      return new Response("N3 user identity not available", { status: 502 });
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
    console.error("[launch] failed:", (err as Error).message?.slice(0, 200));
    await clearSessionBestEffort();
    await logAudit({
      eventType: "session.launch.failure",
      detail: { source, stage: "exception" },
    });
    return new Response("Launch failed", { status: 500 });
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
