// What a user WITHOUT an effective HotelHub role should be told.
//
// Pure presentation policy: it maps the safe `roleReason` diagnostic code
// (never raw N3 data, never a token, never another user's details) to the one
// truthful message for that situation.
//
// The first-Owner provisioning runbook is shown ONLY for the genuine
// bootstrap case. A user whose N3 Owner permission was removed, or whose
// ownership simply cannot be confirmed right now, must never be told to
// provision Owner again.
import type { EffectiveRoleReason } from "./n3-owner";

export type RoleUnassignedGuidance = {
  /** Stable code for tests and telemetry. Safe: no PII. */
  kind: "revoked" | "unconfirmed" | "inactive" | "unmatched" | "bootstrap" | "denied";
  title: string;
  body: string;
  /** Only the genuine no-local-role bootstrap case may show the SQL runbook. */
  showProvisioning: boolean;
  /** Transient authority failure: offer retry / reopen instead of a runbook. */
  showRetry: boolean;
  /** Show the immutable tenant/user identifiers a MUGS operator needs. */
  showIdentifiers: boolean;
};

export const ROLE_UNASSIGNED_TITLES = {
  revoked: "N3 Owner permission was removed",
  unconfirmed: "Owner authority cannot be confirmed right now",
  inactive: "This N3 user is not active",
  unmatched: "This N3 user could not be confirmed",
  bootstrap: "HotelHub role not assigned",
  denied: "HotelHub access is not available",
} as const;

export function roleUnassignedGuidance(
  reason: EffectiveRoleReason | null | undefined,
): RoleUnassignedGuidance {
  switch (reason) {
    case "n3_owner_revoked":
      return {
        kind: "revoked",
        title: ROLE_UNASSIGNED_TITLES.revoked,
        body:
          "N3 no longer lists you as an Owner, so HotelHub Owner authority has been withdrawn. " +
          "Settings and all Owner-only actions are blocked. If you still need access, ask the " +
          "current N3 Owner or MUGS to assign you an approved non-owner HotelHub role " +
          "(Front desk or Housekeeper). Do not run the first-Owner provisioning step.",
        showProvisioning: false,
        showRetry: false,
        showIdentifiers: true,
      };
    case "n3_users_unavailable":
    case "n3_users_malformed":
      return {
        kind: "unconfirmed",
        title: ROLE_UNASSIGNED_TITLES.unconfirmed,
        body:
          "HotelHub could not confirm your Owner permission with N3, so access is blocked until " +
          "it can. This is a temporary check, not a change to your account. Try again, or " +
          "reopen HotelHub from N3. Nothing needs to be provisioned.",
        showProvisioning: false,
        showRetry: true,
        showIdentifiers: false,
      };
    case "n3_user_inactive":
      return {
        kind: "inactive",
        title: ROLE_UNASSIGNED_TITLES.inactive,
        body:
          "N3 reports this user account as inactive, so HotelHub access is denied. Ask the " +
          "current N3 Owner to reactivate the account in N3 first.",
        showProvisioning: false,
        showRetry: false,
        showIdentifiers: false,
      };
    case "n3_user_not_matched":
      return {
        kind: "unmatched",
        title: ROLE_UNASSIGNED_TITLES.unmatched,
        body:
          "HotelHub could not match your signed-in identity to an N3 user, so access is denied. " +
          "Ask the current N3 Owner to confirm your N3 user record, then reopen HotelHub from N3.",
        showProvisioning: false,
        showRetry: true,
        showIdentifiers: false,
      };
    case "n3_no_local_role":
    case null:
    case undefined:
      return {
        kind: "bootstrap",
        title: ROLE_UNASSIGNED_TITLES.bootstrap,
        body:
          "Your N3 identity is verified, but no HotelHub role is assigned to it, so all " +
          "application content stays denied. Owner authority comes from N3 itself and cannot be " +
          "granted inside HotelHub. If you need operational access, the current N3 Owner must " +
          "explicitly assign you a Front desk or Housekeeper role in HotelHub.",
        showProvisioning: false,
        showRetry: false,
        showIdentifiers: true,
      };
    default:
      return {
        kind: "denied",
        title: ROLE_UNASSIGNED_TITLES.denied,
        body:
          "HotelHub could not grant this session a role. Ask the current N3 Owner or MUGS to " +
          "review your HotelHub access.",
        showProvisioning: false,
        showRetry: false,
        showIdentifiers: false,
      };
  }
}
