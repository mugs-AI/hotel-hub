// HH-AUTH-02 — Owner-managed individual N3 user access. SERVER-ONLY layer.
//
// Reads the official read-only `GET /api/Users` with the server-held N3 token
// through the existing same-origin gateway, joins it with the tenant's local
// `hotel_user_roles` rows, and applies Owner-authorised grants/revocations.
//
// Invariants:
//  - the N3 token, the raw upstream body and any upstream error text NEVER
//    leave the server and are never audited or logged;
//  - tenant + actor always come from the verified HotelHub session;
//  - before ANY role write the actor is re-confirmed as the CURRENT N3
//    `isOwner` user with a FRESH, uncached `/api/Users` read — a stale local
//    owner row can never authorise a write;
//  - `owner` is never written to `hotel_user_roles` by this module.
import { decideEffectiveRole, type N3UserRecord, type N3UsersRead } from "./n3-owner";
import { invalidateOwnershipCacheForUser, readN3Users } from "./n3-owner.server";
import {
  accessTransition,
  buildUserControlRows,
  statusForAssignmentRejection,
  validateAssignment,
  type AccessChoice,
  type AssignmentRejection,
  type LocalRoleRow,
  type UserControlRow,
} from "./user-control";
import { isHotelRole } from "./rbac";
import { logAudit } from "./audit.server";

export type UserControlListResult =
  | {
      status: "ok";
      rows: UserControlRow[];
      skippedWithoutIdentifier: number;
      /**
       * True when the authenticated actor's own session key is byte-equal to
       * the immutable identifier N3 reports for them. When false, grants are
       * still keyed by the N3 identifier but the UI warns that the launch
       * identity may not line up. Never exposes either value.
       */
      actorKeyAlignsWithN3Id: boolean;
    }
  | { status: "upstream_unavailable" }
  | { status: "upstream_malformed" }
  | { status: "store_unavailable" };

async function readLocalRoles(tenantId: string): Promise<LocalRoleRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("hotel_user_roles")
    .select("n3_user_key, role, is_active")
    .eq("tenant_id", tenantId);
  if (error) throw new Error("role_read_failed");
  return (data ?? [])
    .filter((r) => isHotelRole(r.role))
    .map((r) => ({
      n3UserKey: r.n3_user_key,
      role: r.role,
      isActive: Boolean(r.is_active),
    }));
}

/** Test seam so the focused tests never touch N3 or Supabase. */
export type UserControlDeps = {
  readUsers?: (token: string) => Promise<N3UsersRead>;
  readLocal?: (tenantId: string) => Promise<LocalRoleRow[]>;
};

export async function listUserControl(
  input: { token: string; tenantId: string; actorN3UserKey: string },
  deps: UserControlDeps = {},
): Promise<UserControlListResult> {
  // Always a FRESH read: this screen is the Owner's source of truth.
  const read = await (deps.readUsers ?? readN3Users)(input.token);
  if (read.status === "unavailable") return { status: "upstream_unavailable" };
  if (read.status === "malformed") return { status: "upstream_malformed" };

  let localRoles: LocalRoleRow[];
  try {
    localRoles = await (deps.readLocal ?? readLocalRoles)(input.tenantId);
  } catch {
    return { status: "store_unavailable" };
  }

  const built = buildUserControlRows({ users: read.users, localRoles });
  const actorKeyAlignsWithN3Id = built.rows.some((r) => r.n3UserKey === input.actorN3UserKey);

  return {
    status: "ok",
    rows: built.rows,
    skippedWithoutIdentifier: built.skippedWithoutIdentifier,
    actorKeyAlignsWithN3Id,
  };
}

/**
 * Fresh, UNCACHED confirmation that the actor is the current N3 Owner.
 * Fails closed on every unavailable / malformed / unmatched / inactive /
 * non-owner outcome. A local `owner` row is deliberately NOT passed in, so it
 * cannot influence the answer.
 */
export async function confirmActorIsCurrentN3Owner(
  input: {
    token: string;
    identity: { n3UserKey: string; email: string | null; userName: string | null };
  },
  deps: UserControlDeps = {},
): Promise<{ ok: true; users: N3UserRecord[] } | { ok: false; code: "owner_check_failed" }> {
  const read = await (deps.readUsers ?? readN3Users)(input.token);
  if (read.status !== "ok") return { ok: false, code: "owner_check_failed" };
  const decision = decideEffectiveRole({
    read,
    identity: input.identity,
    localRole: null,
  });
  if (decision.role !== "owner" || decision.reason !== "n3_owner") {
    return { ok: false, code: "owner_check_failed" };
  }
  return { ok: true, users: read.users };
}

export type ApplyAccessResult =
  | { ok: true; n3UserKey: string; from: AccessChoice; to: AccessChoice; changed: boolean }
  | { ok: false; status: number; code: AssignmentRejection | "owner_check_failed" | "store_unavailable" };

/**
 * Apply one grant / change / revocation.
 *
 * `access: "none"` REMOVES the local assignment, so the next valid N3 launch
 * for that user reaches the existing role-not-assigned screen.
 */
export async function applyUserAccess(
  input: {
    tenantId: string;
    actorN3UserKey: string;
    actorIdentity: { n3UserKey: string; email: string | null; userName: string | null };
    token: string;
    targetN3UserKey: unknown;
    access: unknown;
  },
  deps: UserControlDeps = {},
): Promise<ApplyAccessResult> {
  const owner = await confirmActorIsCurrentN3Owner(
    { token: input.token, identity: input.actorIdentity },
    deps,
  );
  if (!owner.ok) return { ok: false, status: 403, code: "owner_check_failed" };

  const validated = validateAssignment({
    targetN3UserKey: input.targetN3UserKey,
    access: input.access,
    users: owner.users,
    actorN3UserKey: input.actorN3UserKey,
  });
  if (!validated.ok) {
    return { ok: false, status: statusForAssignmentRejection(validated.code), code: validated.code };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let previous: AccessChoice = "none";
  try {
    const { data, error } = await supabaseAdmin
      .from("hotel_user_roles")
      .select("role, is_active")
      .eq("tenant_id", input.tenantId)
      .eq("n3_user_key", validated.n3UserKey)
      .maybeSingle();
    if (error) throw new Error("role_read_failed");
    if (data && data.is_active && (data.role === "front_desk" || data.role === "housekeeper")) {
      previous = data.role;
    }

    if (validated.access === "none") {
      const del = await supabaseAdmin
        .from("hotel_user_roles")
        .delete()
        .eq("tenant_id", input.tenantId)
        .eq("n3_user_key", validated.n3UserKey);
      if (del.error) throw new Error("role_write_failed");
    } else {
      const up = await supabaseAdmin.from("hotel_user_roles").upsert(
        {
          tenant_id: input.tenantId,
          n3_user_key: validated.n3UserKey,
          role: validated.access,
          is_active: true,
        },
        { onConflict: "tenant_id,n3_user_key" },
      );
      if (up.error) throw new Error("role_write_failed");
    }
  } catch {
    return { ok: false, status: 503, code: "store_unavailable" };
  }

  // Narrow cache invalidation: the next authorization decision for this
  // tenant+user must not read a pre-change cached decision.
  invalidateOwnershipCacheForUser(input.tenantId, validated.n3UserKey);

  const transition = accessTransition(previous, validated.access);
  await logAudit({
    tenantId: input.tenantId,
    n3UserKey: input.actorN3UserKey,
    eventType: validated.access === "none" ? "role.revoked" : "role.assigned",
    // Safe identifiers + role transition only. No email, no token, no
    // upstream body, no raw error text.
    detail: {
      target: validated.n3UserKey,
      from: transition.from,
      to: transition.to,
      changed: transition.changed,
    },
  });

  return {
    ok: true,
    n3UserKey: validated.n3UserKey,
    from: transition.from,
    to: transition.to,
    changed: transition.changed,
  };
}
