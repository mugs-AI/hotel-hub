// POST /api/hotel/company-name/refresh — Owner-only, optional N3 display sync.
// The staff launch never depends on Company Profile permission. This route
// runs after launch, using the server-held token and a fixed read-only N3 path.
import { createFileRoute } from "@tanstack/react-router";
import { destroySession, requirePermission } from "@/lib/session-context.server";
import { deny, isSameOriginWrite } from "@/lib/operations-api.server";
import { callN3Path } from "@/lib/n3-gateway.server";
import { normalizeBasicInfo } from "@/lib/n3-basicinfo";
import { decodeJwtClaims } from "@/lib/jwt-claims.server";
import { saveTenantCompanyName, saveUserDisplayName } from "@/lib/tenant-store.server";
import { readN3Users } from "@/lib/n3-owner.server";
import { humanDisplayName } from "@/lib/header-display";
import { logAudit } from "@/lib/audit.server";

export async function handleRefreshCompanyName({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "forbidden");
  const { ctx, decision } = await requirePermission("n3:verify");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }

  try {
    const result = await callN3Path(ctx.session.n3Token, "/api/companyprofile/BasicInfo", {
      timeoutMs: 5_000,
    });
    if (result.status === 401) {
      await destroySession("n3_401");
      return deny(401, "n3_unauthorized");
    }
    if (result.status === 403) return deny(502, "n3_company_profile_forbidden");
    if (result.status < 200 || result.status >= 300) {
      return deny(502, "n3_company_profile_unavailable");
    }
    const body = result.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return deny(502, "n3_company_profile_invalid");
    }
    const envelope = body as Record<string, unknown>;
    const code = envelope.code ?? envelope.Code;
    const success = envelope.success ?? envelope.Success;
    if ((code !== "0000" && code !== 0) || success === false) {
      return deny(502, "n3_company_profile_invalid");
    }
    const info = normalizeBasicInfo(
      envelope.data ?? envelope.Data,
      decodeJwtClaims(ctx.session.n3Token),
    );
    if (!info.companyName || info.companyName.length > 200) {
      return deny(502, "n3_company_name_missing");
    }
    if (
      info.n3TenantKey !== ctx.session.n3TenantKey ||
      (info.tenantCode && ctx.session.tenantCode && info.tenantCode !== ctx.session.tenantCode)
    ) {
      return deny(409, "n3_company_identity_mismatch");
    }

    await saveTenantCompanyName(ctx.session.tenantId!, ctx.session.n3TenantKey, info.companyName);
    // The Owner can read N3 Users. Match only their immutable user ID, then
    // fall back to BasicInfo if the directory is unavailable or unnamed.
    const users = await readN3Users(ctx.session.n3Token);
    const current =
      users.status === "ok"
        ? users.users.find((user) => user.id?.toLowerCase() === ctx.session.n3UserKey.toLowerCase())
        : null;
    const userName = humanDisplayName(current?.userName) ?? humanDisplayName(info.userName);
    if (userName) {
      try {
        await saveUserDisplayName(ctx.session.tenantId!, ctx.session.n3UserKey, userName);
      } catch {
        // Company metadata is already saved; an optional name cannot undo it.
      }
    }
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.company_name.synced",
      detail: { source: "n3_basicinfo" },
    });
    return Response.json(
      { companyName: info.companyName },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[company-name.refresh] failed", (err as Error)?.message?.slice(0, 160));
    return deny(502, "n3_company_profile_unavailable");
  }
}

export const Route = createFileRoute("/api/hotel/company-name/refresh")({
  server: { handlers: { POST: handleRefreshCompanyName } },
});
