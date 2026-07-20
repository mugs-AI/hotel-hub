// Shared N3 launch handler. Consumes an N3 launch token server-side,
// verifies it against N3 BasicInfo, upserts the tenant, opens the
// encrypted HttpOnly session cookie, and returns a 302 redirect to a
// clean URL. Never returns the token to the browser or writes it to
// any client-visible surface (address bar after redirect, response body,
// logs).
import { getHotelSession } from "./session.server";
import { callN3Path } from "./n3-gateway.server";
import { normalizeBasicInfo } from "./n3-basicinfo";
import { decodeJwtClaims } from "./jwt-claims.server";
import { upsertTenant } from "./tenant-store.server";
import { logAudit } from "./audit.server";

export type LaunchSource = "path_a" | "root" | "path_b_dev";

export async function performN3Launch(
  rawToken: string,
  redirectTo: string,
  source: LaunchSource = "path_a",
): Promise<Response> {
  const token = rawToken.trim();
  if (!token) {
    return new Response("Missing token", { status: 400 });
  }
  try {
    const probe = await callN3Path(token, "/api/companyprofile/BasicInfo");
    if (probe.status === 401) {
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "basicinfo", status: 401 },
      });
      return new Response("N3 rejected the launch token", { status: 401 });
    }
    if (probe.status < 200 || probe.status >= 300) {
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "basicinfo", status: probe.status },
      });
      return new Response("N3 verification failed", { status: 502 });
    }
    const envelope = (probe.body ?? {}) as { code?: string; data?: unknown };
    if (envelope.code && envelope.code !== "0000") {
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "basicinfo", code: envelope.code },
      });
      return new Response("N3 verification failed", { status: 502 });
    }
    const claims = decodeJwtClaims(token);
    const info = normalizeBasicInfo(envelope.data, claims);
    if (!info.n3TenantKey) {
      await logAudit({
        eventType: "session.launch.failure",
        detail: { source, stage: "identity", reason: "missing_n3_tenant_key" },
      });
      return new Response("N3 tenant identity not available", { status: 502 });
    }
    const n3UserKey =
      (typeof claims.sub === "string" && claims.sub) || info.userEmail || info.userName;
    if (!n3UserKey) {
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
      n3TokenExpiration: null,
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
      headers: { Location: redirectTo || "/" },
    });
  } catch (err) {
    // Redact — never echo the token or upstream error text.
    console.error("[launch] failed:", (err as Error).message?.slice(0, 200));
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
