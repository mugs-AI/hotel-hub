// HH-AUTH-02 — Owner-managed individual N3 user access. PURE decision layer.
//
// Option 2: identity-based control. Authorization identity is ALWAYS the
// immutable N3 user identifier (stored as `hotel_user_roles.n3_user_key`);
// email and display name are recognition aids only and are never used as an
// authorization key here.
//
// Invariants encoded in this module:
//  - Owner is never locally assignable. `owner` is only ever the CURRENT N3
//    `isOwner` user, resolved live by `n3-owner.ts`.
//  - The current N3 Owner row is locked: it cannot be downgraded, revoked,
//    duplicated or reassigned through local role data.
//  - Only ACTIVE N3 users of the current tenant may be targeted.
//  - Unknown / inactive / malformed / owner targets are rejected.
import { normalizeIdentity, type N3UserRecord } from "./n3-owner";
import type { HotelRole } from "./rbac";

/** The only roles an Owner may grant locally. `owner` is deliberately absent. */
export type ManagedRole = "front_desk" | "housekeeper";

export const MANAGED_ROLES: readonly ManagedRole[] = ["front_desk", "housekeeper"] as const;

/** What the Owner picks per row. */
export type AccessChoice = "none" | ManagedRole;

export function isManagedRole(v: unknown): v is ManagedRole {
  return v === "front_desk" || v === "housekeeper";
}

export function isAccessChoice(v: unknown): v is AccessChoice {
  return v === "none" || isManagedRole(v);
}

/** A local `hotel_user_roles` row, reduced to what the decision layer needs. */
export type LocalRoleRow = { n3UserKey: string; role: HotelRole; isActive: boolean };

export type UserControlRow = {
  /** Immutable N3 identifier — the authorization key. Never the email. */
  n3UserKey: string;
  displayName: string | null;
  email: string | null;
  /** Effective HotelHub access for this user right now. */
  access: "owner" | AccessChoice;
  /** True only for the current N3 `isOwner` user. Locked in the UI. */
  isCurrentN3Owner: boolean;
  /** False for the locked Owner row. */
  manageable: boolean;
  /**
   * True when a local row exists that the effective decision refuses to
   * honour (e.g. a stale `owner` row on a non-owner). Surfaced so the Owner
   * can see that it grants nothing.
   */
  staleLocalRole: HotelRole | null;
};

export type BuildRowsResult = {
  rows: UserControlRow[];
  /** Active N3 users skipped because they carry no immutable identifier. */
  skippedWithoutIdentifier: number;
};

/** Local rows keyed by the normalized immutable identifier. */
export function indexLocalRoles(rows: readonly LocalRoleRow[]): Map<string, LocalRoleRow> {
  const out = new Map<string, LocalRoleRow>();
  for (const r of rows) {
    const key = normalizeIdentity(r.n3UserKey);
    if (key) out.set(key, r);
  }
  return out;
}

/**
 * Build the User Control table.
 *
 * Only ACTIVE N3 users are listed — an inactive N3 user is not a HotelHub
 * access subject. A user with no immutable identifier is skipped entirely
 * rather than being keyed by email.
 */
export function buildUserControlRows(input: {
  users: readonly N3UserRecord[];
  localRoles: readonly LocalRoleRow[];
}): BuildRowsResult {
  const local = indexLocalRoles(input.localRoles);
  const rows: UserControlRow[] = [];
  let skipped = 0;

  for (const u of input.users) {
    if (!u.isActive) continue;
    const key = typeof u.id === "string" ? u.id.trim() : "";
    const normalized = normalizeIdentity(key);
    if (!key || !normalized) {
      skipped += 1;
      continue;
    }
    const localRow = local.get(normalized) ?? null;
    const activeLocal = localRow && localRow.isActive ? localRow.role : null;

    if (u.isOwner) {
      rows.push({
        n3UserKey: key,
        displayName: u.userName,
        email: u.email,
        access: "owner",
        isCurrentN3Owner: true,
        manageable: false,
        // A local row on the Owner is irrelevant: N3 grants Owner directly.
        staleLocalRole: null,
      });
      continue;
    }

    const access: AccessChoice = isManagedRole(activeLocal) ? activeLocal : "none";
    rows.push({
      n3UserKey: key,
      displayName: u.userName,
      email: u.email,
      access,
      isCurrentN3Owner: false,
      manageable: true,
      // A stale local `owner` row must never read as Owner anywhere.
      staleLocalRole: activeLocal === "owner" ? "owner" : null,
    });
  }

  // Deterministic ordering: Owner first, then by display label.
  rows.sort((a, b) => {
    if (a.isCurrentN3Owner !== b.isCurrentN3Owner) return a.isCurrentN3Owner ? -1 : 1;
    const la = (a.displayName ?? a.email ?? "").toLowerCase();
    const lb = (b.displayName ?? b.email ?? "").toLowerCase();
    return la.localeCompare(lb);
  });

  return { rows, skippedWithoutIdentifier: skipped };
}

export type AssignmentRejection =
  | "invalid_target"
  | "invalid_role"
  | "owner_not_assignable"
  | "unknown_target"
  | "target_inactive"
  | "target_is_owner"
  | "target_is_self";

export type AssignmentValidation =
  | { ok: true; n3UserKey: string; access: AccessChoice; previousLabelSafe: null }
  | { ok: false; code: AssignmentRejection };

const MAX_KEY_LENGTH = 200;

/**
 * Validate one assign/revoke request against the CURRENT N3 user list of the
 * caller's own tenant. `users` must always come from a fresh, server-side
 * `/api/Users` read for the session tenant — never from the browser.
 */
export function validateAssignment(input: {
  targetN3UserKey: unknown;
  access: unknown;
  users: readonly N3UserRecord[];
  /** The authenticated actor's own session key, to block self-modification. */
  actorN3UserKey: string;
}): AssignmentValidation {
  if (input.access === "owner") return { ok: false, code: "owner_not_assignable" };
  if (!isAccessChoice(input.access)) return { ok: false, code: "invalid_role" };

  if (typeof input.targetN3UserKey !== "string") return { ok: false, code: "invalid_target" };
  const target = input.targetN3UserKey.trim();
  if (!target || target.length > MAX_KEY_LENGTH) return { ok: false, code: "invalid_target" };
  const normalizedTarget = normalizeIdentity(target);
  if (!normalizedTarget) return { ok: false, code: "invalid_target" };

  const matches = input.users.filter((u) => normalizeIdentity(u.id) === normalizedTarget);
  // Ambiguity must never resolve to a grant.
  if (matches.length !== 1) return { ok: false, code: "unknown_target" };
  const user = matches[0]!;
  if (!user.isActive) return { ok: false, code: "target_inactive" };
  if (user.isOwner) return { ok: false, code: "target_is_owner" };

  if (normalizeIdentity(input.actorN3UserKey) === normalizedTarget) {
    return { ok: false, code: "target_is_self" };
  }

  return { ok: true, n3UserKey: target, access: input.access, previousLabelSafe: null };
}

/** HTTP status for a rejection. Deny-by-default: everything unknown is 400. */
export function statusForAssignmentRejection(code: AssignmentRejection): number {
  switch (code) {
    case "unknown_target":
      return 404;
    case "target_is_owner":
    case "target_is_self":
    case "owner_not_assignable":
      return 403;
    case "target_inactive":
      return 409;
    default:
      return 400;
  }
}

/** Safe, non-secret audit transition. Contains no email and no upstream body. */
export function accessTransition(
  previous: AccessChoice,
  next: AccessChoice,
): { from: AccessChoice; to: AccessChoice; changed: boolean } {
  return { from: previous, to: next, changed: previous !== next };
}
