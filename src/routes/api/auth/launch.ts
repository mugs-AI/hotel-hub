// N3 launch entry (Path A). GET /api/auth/launch?token=<jwt>
//
// - Consumes the launch token on the SERVER only, never returning it to the browser.
// - Verifies the token by calling N3 BasicInfo through the gateway.
// - Upserts the tenant, opens an HttpOnly session cookie, then redirects to
//   `/` on a clean URL (no token in address bar or history).
import { createFileRoute } from "@tanstack/react-router";
import { getHotelSession } from "@/lib/session.server";
import { callN3Path } from "@/lib/n3-gateway.server";
import { normalizeBasicInfo } from "@/lib/n3-basicinfo";
import { decodeJwtClaims } from "@/lib/jwt-claims.server";
import { upsertTenant } from "@/lib/tenant-store.server";
import { logAudit } from "@/lib/audit.server";

async function handleLaunch({ request }: { request: Request }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();
  if (!token) {
    return new Response("Missing token", { status: 400 });
  }

  try {
    const probe = await callN3Path(token, "/api/companyprofile/BasicInfo");
    if (probe.status === 401) {
      await logAudit({
        eventType: "session.launch.failure",
        detail: { stage: "basicinfo", status: 401 },
      });
      return new Response("N3 rejected the launch token", { status: 401 });
    }
    if (probe.status < 200 || probe.status >= 300) {
      await logAudit({
        eventType: "session.launch.failure",
        detail: { stage: "basicinfo", status: probe.status },
      });
      return new Response("N3 verification failed", { status: 502 });
    }

    const envelope = (probe.body ?? {}) as { code?: string; data?: unknown };
    if (envelope.code && envelope.code !== "0000") {
      await logAudit({
        eventType: "session.launch.failure",
        detail: { stage: "basicinfo", code: envelope.code },
      });
      return new Response("N3 verification failed", { status: 502 });
    }
    const claims = decodeJwtClaims(token);
    const info = normalizeBasicInfo(envelope.data, claims);
    if (!info.n3TenantKey) {
      await logAudit({
        eventType: "session.launch.failure",
        detail: { stage: "identity", reason: "missing_n3_tenant_key" },
      });
      return new Response("N3 tenant identity not available", { status: 502 });
    }
    const n3UserKey =
      (typeof claims.sub === "string" && claims.sub) || info.userEmail || info.userName;
    if (!n3UserKey) {
      await logAudit({
        eventType: "session.launch.failure",
        detail: { stage: "identity", reason: "missing_n3_user_key" },
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
      detail: { source: "path_a" },
    });

    return new Response(null, {
      status: 302,
      headers: { Location: "/" },
    });
  } catch (err) {
    console.error("[auth/launch] failed", (err as Error).message);
    await logAudit({
      eventType: "session.launch.failure",
      detail: { stage: "exception" },
    });
    return new Response("Launch failed", { status: 500 });
  }
}

export const Route = createFileRoute("/api/auth/launch")({
  server: { handlers: { GET: handleLaunch } },
});
