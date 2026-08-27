// Server-only helpers that assemble the authenticated request context
// (session + tenant + role) used by protected server endpoints.
import { getHotelSession, type HotelSessionData } from "./session.server";
import { lookupRole } from "./tenant-store.server";
import { authorize, type Permission, type AuthzDecision } from "./rbac";
import { logAudit } from "./audit.server";
import { resolveEffectiveRole } from "./n3-owner.server";
import {
  validateN3TokenNeutralCached,
  invalidateNeutralValidation,
} from "./n3-token-validation.server";
import type { EffectiveRoleReason } from "./n3-owner";

export type RequestContext =
  | {
      authenticated: true;
      session: HotelSessionData;
      role: import("./rbac").HotelRole | null;
      roleStatus: "assigned" | "role_unassigned";
      /** Safe diagnostic code for how the effective role was decided. */
      roleReason: EffectiveRoleReason | null;
    }
  | { authenticated: false };

export async function readRequestContext(): Promise<RequestContext> {
  const session = await getHotelSession();
  const data = session.data as Partial<HotelSessionData>;
  if (!data?.n3Token || !data.tenantId || !data.n3UserKey) {
    return { authenticated: false };
  }
  // If the stored session carries a verified JWT expiration, deny + destroy
  // once we're past it. Sessions without a verified numeric `exp` fall back
  // to the fixed cookie `maxAge` in session.server.ts (currently 8h) —
  // documented in the README.
  if (data.n3TokenExpiration) {
    const expMs = Date.parse(data.n3TokenExpiration);
    if (Number.isFinite(expMs) && expMs <= Date.now()) {
      await logAudit({
        tenantId: data.tenantId ?? null,
        n3UserKey: data.n3UserKey ?? null,
        eventType: "session.destroyed",
        detail: { reason: "n3_token_expired" },
      });
      await session.clear();
      return { authenticated: false };
    }
  }
  // HH-AUTH-04 — permission-neutral token validation is the authoritative
  // liveness check for every protected request, cached server-side for at
  // most 60s. 401/403, malformed/unsuccessful envelope, 5xx, network failure
  // and timeout all fail closed and destroy the HotelHub session. It never
  // requires Company Profile / Users / accounting permissions, so ordinary
  // assigned staff pass it.
  const neutral = await validateN3TokenNeutralCached(data.n3Token);
  if (neutral.status !== "accepted") {
    await logAudit({
      tenantId: data.tenantId,
      n3UserKey: data.n3UserKey,
      eventType: "session.destroyed",
      detail: { reason: "n3_token_validation_failed", status: neutral.status },
    });
    invalidateNeutralValidation(data.n3Token);
    await session.clear();
    return { authenticated: false };
  }

  const roleLookup = await lookupRole(data.tenantId, data.n3UserKey);
  const localRole =
    roleLookup.status === "assigned"
      ? { role: roleLookup.role, isActive: roleLookup.isActive }
      : null;

  // N3 is the SOLE identity authority. The local row is an assignment, never
  // proof of ownership: the current `isOwner` flag on the authenticated N3
  // user decides Owner authority; a revocation is enforced no later than the
  // bounded 60s server-only decision cache expires for that token.

  const effective = await resolveEffectiveRole({
    token: data.n3Token,
    tenantId: data.tenantId,
    identity: {
      n3UserKey: data.n3UserKey,
      email: data.userEmail ?? null,
      userName: data.userName ?? null,
    },
    localRole,
    neutralValidated: true,
  });

  // HH-AUTH-03A — an authority failure means N3 could not positively confirm
  // this account is still a live, active member. The stale HotelHub session
  // must not survive it: audit a reason-code-only event (no PII, no token, no
  // upstream body) and clear the encrypted session server-side.
  const AUTHORITY_FAILURE_REASONS = new Set<EffectiveRoleReason>([
    "n3_users_unavailable",
    "n3_users_malformed",
    "n3_user_not_matched",
    "n3_user_inactive",
  ]);
  if (AUTHORITY_FAILURE_REASONS.has(effective.reason)) {
    await logAudit({
      tenantId: data.tenantId,
      n3UserKey: data.n3UserKey,
      eventType: "session.destroyed",
      detail: { reason: effective.reason, matchedBy: effective.matchedBy },
    });
    await session.clear();
    return { authenticated: false };
  }

  // Diagnostic-only audit, written once per fresh resolution (never per cache
  // hit) and carrying reason codes only — no PII, no upstream payload.
  if (!effective.fromCache && localRole?.role === "owner" && effective.role !== "owner") {
    await logAudit({
      tenantId: data.tenantId,
      n3UserKey: data.n3UserKey,
      eventType: "access.owner_revoked",
      detail: { reason: effective.reason, matchedBy: effective.matchedBy },
    });
  }

  if (effective.role) {
    return {
      authenticated: true,
      session: data as HotelSessionData,
      role: effective.role,
      roleStatus: "assigned",
      roleReason: effective.reason,
    };
  }
  // Only n3_no_local_role / n3_owner_revoked reach here: the N3 account is
  // verified active, so keep the role-not-assigned experience.
  return {
    authenticated: true,
    session: data as HotelSessionData,
    role: null,
    roleStatus: "role_unassigned",
    roleReason: effective.reason,
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
        roleReason: null,
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
