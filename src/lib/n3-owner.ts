// N3 ownership authority — PURE decision layer (no I/O, no secrets).
//
// HotelHub treats N3 as the sole identity authority. The persistent
// tenant-scoped `hotel_user_roles` row is a LOCAL assignment, never proof of
// ownership: a user whose N3 `isOwner` flag was removed loses HotelHub Owner
// authority no later than the bounded server-side decision cache expires for
// that token (see `n3-owner.server.ts`), even though the stale local owner
// row still exists. Truthfully: enforced within the cache window, not
// literally instantaneously.
//
// This module holds only the deterministic matching + decision rules so they
// can be unit-tested exhaustively. Fetching `/api/Users` with the server-held
// N3 token lives in `n3-owner.server.ts`.
import type { HotelRole } from "./rbac";

/** The subset of the official N3 UserDto HotelHub is allowed to rely on. */
export type N3UserRecord = {
  /** Stable N3 identity (id / userId / guid), when the payload carries one. */
  id: string | null;
  userName: string | null;
  email: string | null;
  isOwner: boolean;
  isActive: boolean;
};

/** Why the effective role came out the way it did. Safe for audit: no PII. */
export type EffectiveRoleReason =
  | "n3_owner"
  | "n3_non_owner_local_role"
  | "n3_owner_revoked"
  | "n3_no_local_role"
  | "n3_user_inactive"
  | "n3_user_not_matched"
  | "n3_users_unavailable"
  | "n3_users_forbidden_local_staff"
  | "n3_users_forbidden"
  | "n3_users_malformed";

export type EffectiveRoleDecision = {
  role: HotelRole | null;
  reason: EffectiveRoleReason;
  /** How the authenticated user was matched — immutable N3 id only. */
  matchedBy: "id" | null;
  /** True when N3 could not be consulted, so Owner authority failed closed. */
  ownerAuthorityFailedClosed: boolean;
};

/**
 * Outcome of reading `/api/Users`. Raw upstream bodies never leave the server.
 *
 * HH-AUTH-04: `forbidden` (upstream 401/403 on the DIRECTORY endpoint) is
 * distinct from `unavailable`. A front-desk / housekeeping token legitimately
 * lacks Users-administration permission; that must not erase an explicit
 * immutable-ID staff assignment once the permission-neutral token validation
 * has already succeeded. It can never grant Owner.
 */
export type N3UsersRead =
  | { status: "ok"; users: N3UserRecord[] }
  | { status: "forbidden" }
  | { status: "unavailable" }
  | { status: "malformed" };


export function normalizeIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().toLowerCase();
  return t ? t : null;
}

function firstString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = source[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function firstBool(source: Record<string, unknown>, keys: readonly string[]): boolean | null {
  for (const k of keys) {
    const v = source[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (t === "true") return true;
      if (t === "false") return false;
    }
  }
  return null;
}

const ID_KEYS = ["id", "Id", "ID", "userId", "UserId", "userID", "guid", "Guid", "key", "Key"];
const NAME_KEYS = ["userName", "UserName", "username", "Username", "name", "Name", "loginId"];
const EMAIL_KEYS = ["email", "Email", "emailAddress", "EmailAddress"];
const OWNER_KEYS = ["isOwner", "IsOwner", "owner", "Owner"];
const ACTIVE_KEYS = ["isActive", "IsActive", "active", "Active", "enabled", "Enabled"];
const INACTIVE_KEYS = [
  "isDeleted",
  "IsDeleted",
  "isDisabled",
  "IsDisabled",
  "disabled",
  "Disabled",
  "isInactive",
  "IsInactive",
];

/** Normalize one raw N3 user entry. Unknown shapes yield `null`. */
export function normalizeN3User(raw: unknown): N3UserRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = firstString(o, ID_KEYS);
  const userName = firstString(o, NAME_KEYS);
  const email = firstString(o, EMAIL_KEYS);
  if (!id && !userName && !email) return null;
  const active = firstBool(o, ACTIVE_KEYS);
  const inactive = firstBool(o, INACTIVE_KEYS);
  return {
    id,
    userName,
    email,
    isOwner: firstBool(o, OWNER_KEYS) === true,
    // Absence of any activity flag is treated as active; an explicit
    // inactive/deleted/disabled marker always wins.
    isActive: active === null ? inactive !== true : active === true && inactive !== true,
  };
}

/**
 * Pure envelope unwrapping for the official `/api/Users` response.
 *
 * Real N3 responses are wrapped, e.g.
 *   { code: "0000", data: { value: [UserDto], count: n } }
 * but casing and nesting vary across endpoints, so a small set of shapes is
 * accepted. Two hard rules:
 *  - when the envelope carries `code`/`Code`, ONLY "0000" is success: a
 *    non-success envelope is refused even if it happens to contain an array;
 *  - nothing here ever returns or exposes the raw body.
 */
export type N3ArrayUnwrap =
  | { status: "ok"; items: unknown[] }
  | { status: "non_success" }
  | { status: "malformed" };

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

export function unwrapN3Array(body: unknown): N3ArrayUnwrap {
  const top = asArray(body);
  if (top) return { status: "ok", items: top };
  if (!body || typeof body !== "object") return { status: "malformed" };
  const b = body as Record<string, unknown>;

  const code = b.code ?? b.Code;
  if (
    (typeof code === "string" && code.trim() !== "" && code.trim() !== "0000") ||
    (typeof code === "number" && code !== 0)
  ) {
    return { status: "non_success" };
  }

  const data = b.data ?? b.Data;
  const dataArray = asArray(data);
  if (dataArray) return { status: "ok", items: dataArray };
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const v of [d.value, d.Value, d.items, d.Items, d.data, d.Data]) {
      const arr = asArray(v);
      if (arr) return { status: "ok", items: arr };
    }
  }
  for (const v of [b.value, b.Value, b.items, b.Items, b.result, b.Result]) {
    const arr = asArray(v);
    if (arr) return { status: "ok", items: arr };
  }
  return { status: "malformed" };
}

/** Tolerantly extract the user array out of the official `/api/Users` body. */
export function extractN3Users(body: unknown): N3UsersRead {
  const unwrapped = unwrapN3Array(body);
  // A non-success envelope is an upstream refusal, not a payload we may read:
  // Owner authority must fail closed exactly as if N3 were unreachable.
  if (unwrapped.status === "non_success") return { status: "unavailable" };
  if (unwrapped.status !== "ok") return { status: "malformed" };
  const users = unwrapped.items.map(normalizeN3User).filter((u): u is N3UserRecord => u !== null);
  if (users.length === 0) return { status: "malformed" };
  return { status: "ok", users };
}

export type SessionIdentity = {
  /** Stable JWT identity of the authenticated user (never browser-supplied). */
  n3UserKey: string;
  email: string | null;
  userName: string | null;
};

export type N3UserMatch = { user: N3UserRecord; matchedBy: "id" };

/**
 * HH-AUTH-03A — immutable-ID-only match.
 *
 * The authenticated session key MUST equal a UserDto immutable id after
 * normalization, and exactly one user may match. Email and userName remain
 * display data only: they never grant nor preserve authorization, so a
 * re-created N3 account that reuses an email cannot inherit access.
 */
export function matchN3User(
  users: readonly N3UserRecord[],
  identity: SessionIdentity,
): N3UserMatch | null {
  const key = normalizeIdentity(identity.n3UserKey);
  if (!key) return null;
  const byId = users.filter((u) => normalizeIdentity(u.id) === key);
  if (byId.length === 1) return { user: byId[0]!, matchedBy: "id" };
  return null;
}

/** An active local assignment is only ever honoured for these roles. */
function operationalLocalRole(
  local: { role: HotelRole; isActive: boolean } | null,
): HotelRole | null {
  if (!local || !local.isActive) return null;
  return local.role === "front_desk" || local.role === "housekeeper" ? local.role : null;
}

/**
 * The effective HotelHub role for this request.
 *
 * Rules (deny-by-default, FAIL CLOSED for every authority failure):
 *  - matched by immutable id + active + isOwner === true -> owner (no local
 *    row required);
 *  - matched by immutable id + active + isOwner !== true -> only an active
 *    explicit local front_desk / housekeeper; a stale local OWNER row becomes
 *    role_unassigned;
 *  - unavailable / malformed / unmatched / inactive -> role is ALWAYS null. A
 *    local row is an assignment, never proof that the N3 account still exists
 *    or is active, so it is never preserved for these outcomes.
 *  - HH-AUTH-04: directory `forbidden` (401/403 on `/api/Users` only) after a
 *    SUCCESSFUL permission-neutral token validation keeps an explicit active
 *    front_desk / housekeeper assignment, and nothing else. Owner is never
 *    granted this way; without such an assignment it still fails closed.
 */
export function decideEffectiveRole(input: {
  read: N3UsersRead;
  identity: SessionIdentity;
  localRole: { role: HotelRole; isActive: boolean } | null;
  /** True only when N3 already accepted this bearer token neutrally. */
  neutralValidated?: boolean;
}): EffectiveRoleDecision {
  if (input.read.status === "forbidden") {
    const staff = input.neutralValidated === true ? operationalLocalRole(input.localRole) : null;
    return {
      role: staff,
      reason: staff ? "n3_users_forbidden_local_staff" : "n3_users_forbidden",
      matchedBy: null,
      ownerAuthorityFailedClosed: true,
    };
  }
  if (input.read.status !== "ok") {
    return {
      role: null,
      reason: input.read.status === "malformed" ? "n3_users_malformed" : "n3_users_unavailable",
      matchedBy: null,
      ownerAuthorityFailedClosed: true,
    };
  }


  const match = matchN3User(input.read.users, input.identity);
  if (!match) {
    return {
      role: null,
      reason: "n3_user_not_matched",
      matchedBy: null,
      ownerAuthorityFailedClosed: true,
    };
  }
  if (!match.user.isActive) {
    return {
      role: null,
      reason: "n3_user_inactive",
      matchedBy: match.matchedBy,
      ownerAuthorityFailedClosed: true,
    };
  }
  if (match.user.isOwner) {
    return {
      role: "owner",
      reason: "n3_owner",
      matchedBy: match.matchedBy,
      ownerAuthorityFailedClosed: false,
    };
  }
  const operational = operationalLocalRole(input.localRole);
  return {
    role: operational,
    reason: operational
      ? "n3_non_owner_local_role"
      : input.localRole?.role === "owner"
        ? "n3_owner_revoked"
        : "n3_no_local_role",
    matchedBy: match.matchedBy,
    ownerAuthorityFailedClosed: false,
  };
}
