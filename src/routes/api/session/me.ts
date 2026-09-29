// GET /api/session/me — returns the authenticated session context or a
// deny-by-default anonymous shape. NEVER returns the N3 token.
//
// Keep the N3 tenant key server-side, including for role-unassigned sessions.
import { createFileRoute } from "@tanstack/react-router";
import { readRequestContext } from "@/lib/session-context.server";
import { getHotelSettingsReadOnly } from "@/lib/hotel-store.server";
import { readTenantCompanyName, readUserDisplayName } from "@/lib/tenant-store.server";
import { humanDisplayName } from "@/lib/header-display";

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
  // Company name is display metadata. Staff sessions can predate the Owner's
  // optional N3 profile sync, so read the latest tenant-scoped value here.
  // A failed display read must never revoke a valid N3 session.
  let companyName = s.companyName;
  if (!companyName && s.tenantId && s.n3TenantKey) {
    try {
      companyName = await readTenantCompanyName(s.tenantId, s.n3TenantKey);
    } catch {
      // Header stays blank until the next session refresh.
    }
  }
  let userName = humanDisplayName(s.userName);
  if (s.tenantId && s.n3UserKey) {
    try {
      userName = (await readUserDisplayName(s.tenantId, s.n3UserKey)) ?? userName;
    } catch {
      // A missing display name never interrupts the authenticated session.
    }
  }
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
      companyName,
    },
    user: {
      userEmail: s.userEmail,
      userName,
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
