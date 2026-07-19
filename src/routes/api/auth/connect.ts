// Dev-only API-key sign-in (Path B).
// - Returns 404 in production so the key can never be exchanged there.
// - Creates the SAME server session as Path A. Never returns the token.
// - The raw API key is not logged, not persisted, and not echoed back.
import { createFileRoute } from "@tanstack/react-router";
import { exchangeApiKey, callN3Path } from "@/lib/n3-gateway.server";
import { getHotelSession } from "@/lib/session.server";
import { normalizeBasicInfo } from "@/lib/n3-basicinfo";
import { decodeJwtClaims } from "@/lib/jwt-claims.server";
import { upsertTenant } from "@/lib/tenant-store.server";
import { logAudit } from "@/lib/audit.server";

export const Route = createFileRoute("/api/auth/connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (process.env.NODE_ENV === "production") {
          return new Response("Not found", { status: 404 });
        }
        let body: { apiKey?: string } = {};
        try {
          body = (await request.json()) as { apiKey?: string };
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        const apiKey = body.apiKey?.trim();
        if (!apiKey) {
          return Response.json({ error: "apiKey is required" }, { status: 400 });
        }

        try {
          const { token, expiration } = await exchangeApiKey(apiKey);
          const probe = await callN3Path(token, "/api/companyprofile/BasicInfo");
          if (probe.status < 200 || probe.status >= 300) {
            await logAudit({
              eventType: "session.dev_connect.failure",
              detail: { stage: "basicinfo", status: probe.status },
            });
            return Response.json(
              { error: "N3 verification failed" },
              { status: 502 },
            );
          }
          const envelope = (probe.body ?? {}) as { code?: string; data?: unknown };
          if (envelope.code && envelope.code !== "0000") {
            return Response.json(
              { error: "N3 verification failed" },
              { status: 502 },
            );
          }
          const claims = decodeJwtClaims(token);
          const info = normalizeBasicInfo(envelope.data, claims);
          if (!info.n3TenantKey) {
            return Response.json(
              { error: "N3 tenant identity not available" },
              { status: 502 },
            );
          }
          const n3UserKey =
            (typeof claims.sub === "string" && claims.sub) ||
            info.userEmail ||
            info.userName;
          if (!n3UserKey) {
            return Response.json(
              { error: "N3 user identity not available" },
              { status: 502 },
            );
          }

          const tenant = await upsertTenant({
            n3TenantKey: info.n3TenantKey,
            tenantCode: info.tenantCode,
            companyName: info.companyName,
          });

          const session = await getHotelSession();
          await session.update({
            n3Token: token,
            n3TokenExpiration: expiration ?? null,
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
            eventType: "session.dev_connect.success",
            detail: { source: "path_b_dev" },
          });

          return Response.json({ ok: true });
        } catch (err) {
          const message = (err as Error).message ?? "connect failed";
          await logAudit({
            eventType: "session.dev_connect.failure",
            detail: { stage: "exception", message: message.slice(0, 120) },
          });
          return Response.json({ error: "Connect failed" }, { status: 401 });
        }
      },
    },
  },
});
