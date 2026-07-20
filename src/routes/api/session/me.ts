// GET /api/session/me — returns the authenticated session context or a
// deny-by-default anonymous shape. NEVER returns the N3 token.
//
// For role-unassigned users the response includes the immutable
// `n3TenantKey` and `n3UserKey` so a server operator (MUGS) can locate
// the exact `hotel_tenants` / `hotel_user_roles` rows for first-Owner
// provisioning — those identifiers are not secrets, unlike the N3 token.
import { createFileRoute } from "@tanstack/react-router";
import { readRequestContext } from "@/lib/session-context.server";

export type SessionMeResponse =
  | {
      authenticated: false;
      devConnectAvailable: boolean;
    }
  | {
      authenticated: true;
      tenant: {
        tenantId: string;
        tenantCode: string | null;
        companyName: string | null;
        n3TenantKey: string;
      };
      user: {
        userEmail: string | null;
        userName: string | null;
        n3UserKey: string;
      };
      role: import("@/lib/rbac").HotelRole | null;
      roleStatus: "assigned" | "role_unassigned";
    };

export async function handleSessionMe(): Promise<Response> {
  const ctx = await readRequestContext();
  const devConnectAvailable = process.env.NODE_ENV !== "production";
  if (!ctx.authenticated) {
    const body: SessionMeResponse = { authenticated: false, devConnectAvailable };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  }
  const s = ctx.session;
  const body: SessionMeResponse = {
    authenticated: true,
    tenant: {
      tenantId: s.tenantId!,
      tenantCode: s.tenantCode,
      companyName: s.companyName,
      n3TenantKey: s.n3TenantKey,
    },
    user: {
      userEmail: s.userEmail,
      userName: s.userName,
      n3UserKey: s.n3UserKey,
    },
    role: ctx.role,
    roleStatus: ctx.roleStatus,
  };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/session/me")({
  server: { handlers: { GET: handleSessionMe } },
});
