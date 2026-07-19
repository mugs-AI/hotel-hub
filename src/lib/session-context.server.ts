// Server-only helpers that assemble the authenticated request context
// (session + tenant + role) used by protected server endpoints.
import { getHotelSession, type HotelSessionData } from "./session.server";
import { lookupRole } from "./tenant-store.server";
import { authorize, type Permission, type AuthzDecision } from "./rbac";
import { logAudit } from "./audit.server";

export type RequestContext =
  | {
      authenticated: true;
      session: HotelSessionData;
      role: import("./rbac").HotelRole | null;
      roleStatus: "assigned" | "role_unassigned";
    }
  | { authenticated: false };

export async function readRequestContext(): Promise<RequestContext> {
  const session = await getHotelSession();
  const data = session.data as Partial<HotelSessionData>;
  if (!data?.n3Token || !data.tenantId || !data.n3UserKey) {
    return { authenticated: false };
  }
  const roleLookup = await lookupRole(data.tenantId, data.n3UserKey);
  if (roleLookup.status === "assigned" && roleLookup.isActive) {
    return {
      authenticated: true,
      session: data as HotelSessionData,
      role: roleLookup.role,
      roleStatus: "assigned",
    };
  }
  return {
    authenticated: true,
    session: data as HotelSessionData,
    role: null,
    roleStatus: "role_unassigned",
  };
}

export async function requirePermission(
  permission: Permission,
): Promise<{ ctx: Extract<RequestContext, { authenticated: true }>; decision: AuthzDecision }> {
  const ctx = await readRequestContext();
  if (!ctx.authenticated) {
    const decision = authorize({ hasSession: false, tenantId: null, role: null }, permission);
    return {
      ctx: {
        authenticated: true,
        session: {} as HotelSessionData,
        role: null,
        roleStatus: "role_unassigned",
      },
      decision,
    };
  }
  const decision = authorize(
    {
      hasSession: true,
      tenantId: ctx.session.tenantId,
      role: ctx.role,
    },
    permission,
  );
  if (!decision.ok) {
    await logAudit({
      tenantId: ctx.session.tenantId,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "access.denied",
      detail: { permission, reason: decision.reason },
    });
  }
  return { ctx, decision };
}

/**
 * Destroy the session server-side. Callers should follow with a client-side
 * redirect back to the relaunch gate.
 */
export async function destroySession(reason: string) {
  const session = await getHotelSession();
  const data = session.data as Partial<HotelSessionData>;
  await logAudit({
    tenantId: data.tenantId ?? null,
    n3UserKey: data.n3UserKey ?? null,
    eventType: "session.destroyed",
    detail: { reason },
  });
  await session.clear();
}
