// GET /api/session/me — returns the authenticated session context or a
// deny-by-default anonymous shape. NEVER returns the N3 token.
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
      };
      user: {
        userEmail: string | null;
        userName: string | null;
      };
      role: import("@/lib/rbac").HotelRole | null;
      roleStatus: "assigned" | "role_unassigned";
    };

export const Route = createFileRoute("/api/session/me")({
  server: {
    handlers: {
      GET: async () => {
        const ctx = await readRequestContext();
        const devConnectAvailable = process.env.NODE_ENV !== "production";
        if (!ctx.authenticated) {
          const body: SessionMeResponse = { authenticated: false, devConnectAvailable };
          return Response.json(body, {
            headers: { "cache-control": "no-store" },
          });
        }
        const s = ctx.session;
        const body: SessionMeResponse = {
          authenticated: true,
          tenant: {
            tenantId: s.tenantId!,
            tenantCode: s.tenantCode,
            companyName: s.companyName,
          },
          user: {
            userEmail: s.userEmail,
            userName: s.userName,
          },
          role: ctx.role,
          roleStatus: ctx.roleStatus,
        };
        return Response.json(body, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
