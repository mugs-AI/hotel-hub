// GET /api/session/me — returns the authenticated session context or a
// deny-by-default anonymous shape. NEVER returns the N3 token.
//
// For role-unassigned users the response includes the immutable
// `n3TenantKey` and `n3UserKey` so a server operator (MUGS) can locate
// the exact `hotel_tenants` / `hotel_user_roles` rows for first-Owner
// provisioning — those identifiers are not secrets, unlike the N3 token.
import { createFileRoute } from "@tanstack/react-router";
import { readRequestContext } from "@/lib/session-context.server";
import { getHotelSettingsReadOnly } from "@/lib/hotel-store.server";

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
      /**
       * Safe diagnostic code for HOW the effective role was decided (never
       * raw N3 data, never another user's details). The role-unassigned UI
       * needs it so a revoked ex-Owner is not told to provision Owner again.
       */
      roleReason: import("@/lib/n3-owner").EffectiveRoleReason | null;
      /** Which housekeeping workflow this property runs (P1 mode authority). */
      housekeepingMode: "simple" | "dedicated";
      /** SME approval policy for reservation exceptions. */
      exceptionApprovalMode: "owner_approval" | "direct";
      /** Property-wide application display size level (7 | 8 | 9). */
      displaySize: 7 | 8 | 9;
    };

export async function handleSessionMe(): Promise<Response> {
  const ctx = await readRequestContext();
  const devConnectAvailable = process.env.NODE_ENV !== "production";
  if (!ctx.authenticated) {
    const body: SessionMeResponse = { authenticated: false, devConnectAvailable };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  }
  const s = ctx.session;
  // Read-only: never creates a settings row as a side effect of loading.
  let housekeepingMode: "simple" | "dedicated" = "simple";
  let exceptionApprovalMode: "owner_approval" | "direct" = "owner_approval";
  let displaySize: 7 | 8 | 9 = 7;
  try {
    const settings = s.tenantId ? await getHotelSettingsReadOnly(s.tenantId) : null;
    housekeepingMode = settings?.housekeepingMode ?? "simple";
    exceptionApprovalMode = settings?.exceptionApprovalMode ?? "owner_approval";
    displaySize = settings?.displaySize ?? 7;
  } catch {
    housekeepingMode = "simple";
    exceptionApprovalMode = "owner_approval";
    displaySize = 7;
  }
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
    roleReason: ctx.roleReason,
    housekeepingMode,
    exceptionApprovalMode,
    displaySize,
  };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/session/me")({
  server: { handlers: { GET: handleSessionMe } },
});
