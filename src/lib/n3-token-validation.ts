// HH-AUTH-04 — permission-neutral N3 token validation (PURE decision layer).
//
// Business problem: HotelHub used to prove a launch token by calling
// `GET /api/companyprofile/BasicInfo`. That endpoint is guarded by the N3
// "Company Profile" permission, so ordinary front-desk / housekeeping staff
// receive HTTP 403 and could never authenticate, even when the HotelHub Owner
// had explicitly assigned them a role.
//
// Official contract used instead (platform-v1 OpenAPI, fetched from
// the official N3 platform-v1 OpenAPI document):
//   operationId: UserData_GetValue_GET
//   GET /api/UserData?keys=<key>
//   security: [{ Bearer: [] }]  (global security requirement)
//   envelope: x-qne-envelope = "api-response" (ApiResponseMessage:
//            { success, code: "0000", message, data, error })
//
// `/api/UserData` is the caller's OWN user-scoped key/value store. It is not
// gated by a business module permission (Company Profile, Users
// administration, Customers, Stock, accounting), so any authenticated N3 user
// of the tenant can call it. It therefore proves exactly one thing, which is
// all HotelHub needs at this stage: *N3 itself accepted this bearer token*.
//
// This module contains only deterministic interpretation so it can be unit
// tested exhaustively. The HTTP call lives in `n3-token-validation.server.ts`.
// The endpoint's business body is never read, returned or logged.

/** Official permission-neutral, current-user-scoped validation endpoint. */
export const N3_NEUTRAL_VALIDATION_PATH = "/api/UserData?keys=hotelhub.session.probe";
/** Official operationId of the endpoint above (platform-v1). */
export const N3_NEUTRAL_VALIDATION_OPERATION_ID = "UserData_GetValue_GET";

/**
 * Outcome of the neutral validation. Only `accepted` may ever produce or
 * preserve a HotelHub session; every other value fails closed.
 */
export type NeutralValidationStatus =
  | "accepted"
  | "rejected" // upstream 401 — N3 refuses the token itself
  | "forbidden" // upstream 403 — N3 refuses this account access
  | "unavailable" // network / timeout / 5xx / other non-2xx
  | "malformed"; // 2xx but not a successful N3 envelope

export type NeutralValidation = { status: NeutralValidationStatus };

/**
 * Positive-confirmation reading of the official N3 `ApiResponseMessage`
 * envelope. Returns true ONLY when the payload explicitly confirms success.
 * Anything else (bare object, null, array, no body, unrelated payload,
 * contradictory markers) is not a confirmation.
 */
function envelopeConfirmsSuccess(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  const rawCode = b.code ?? b.Code;
  const rawSuccess = b.success ?? b.Success;

  let codeSeen = false;
  let codeOk = false;
  if (typeof rawCode === "string" && rawCode.trim() !== "") {
    codeSeen = true;
    codeOk = rawCode.trim() === "0000";
  } else if (typeof rawCode === "number") {
    codeSeen = true;
    codeOk = rawCode === 0;
  } else if (rawCode !== undefined && rawCode !== null) {
    // Present but of an unrecognized shape — not a confirmation.
    return false;
  }

  let successSeen = false;
  let successOk = false;
  if (typeof rawSuccess === "boolean") {
    successSeen = true;
    successOk = rawSuccess;
  } else if (rawSuccess !== undefined && rawSuccess !== null) {
    return false;
  }

  if (!codeSeen && !successSeen) return false;
  if (codeSeen && !codeOk) return false;
  if (successSeen && !successOk) return false;
  return true;
}

/**
 * Interpret one raw response from the neutral endpoint.
 *
 * Rules:
 *  - 401 => rejected, 403 => forbidden (both deny; never a session);
 *  - any other non-2xx (including 5xx) => unavailable;
 *  - 2xx WITHOUT an explicitly successful N3 envelope => malformed
 *    (bare object, null, array, 204/no body, unrelated payload,
 *    unsuccessful or contradictory envelope all fail closed);
 *  - 2xx with an explicitly successful envelope => accepted. The business
 *    body itself is irrelevant and is discarded.
 */
export function interpretNeutralValidation(status: number, body: unknown): NeutralValidation {
  if (status === 401) return { status: "rejected" };
  if (status === 403) return { status: "forbidden" };
  if (status < 200 || status >= 300) return { status: "unavailable" };
  return envelopeConfirmsSuccess(body) ? { status: "accepted" } : { status: "malformed" };
}


// ---- Validated identity ---------------------------------------------------

export type ValidatedIdentity = {
  /** Immutable N3 user identifier (prefer `sub`). */
  n3UserKey: string;
  /** Immutable-ish N3 tenant identifier. */
  n3TenantKey: string;
  /** Display-only. Never used for authorization. */
  email: string | null;
  /** Display-only. Never used for authorization. */
  userName: string | null;
  /** Display-only tenant code, when the token carries one. */
  tenantCode: string | null;
};

export type IdentityExtraction =
  | { status: "ok"; identity: ValidatedIdentity }
  | { status: "missing_user" }
  | { status: "ambiguous_user" }
  | { status: "missing_tenant" }
  | { status: "ambiguous_tenant" };

function claimString(claims: Record<string, unknown>, key: string): string | null {
  const v = claims[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

type ClaimResolution =
  | { status: "none" }
  | { status: "ok"; value: string }
  | { status: "ambiguous" };

/**
 * Resolve one identity from a set of recognized claim keys. More than one
 * distinct normalized value means the token contradicts itself about that
 * identity, which fails closed rather than picking a winner.
 */
function resolveClaim(claims: Record<string, unknown>, keys: readonly string[]): ClaimResolution {
  const seen = new Set<string>();
  let first: string | null = null;
  for (const k of keys) {
    const v = claimString(claims, k);
    if (!v) continue;
    if (!seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      if (first === null) first = v;
    }
  }
  if (seen.size === 0) return { status: "none" };
  if (seen.size > 1) return { status: "ambiguous" };
  return { status: "ok", value: first as string };
}

/**
 * Recognized immutable user-ID claims. `sub` is preferred, but only when
 * every other present recognized claim agrees with it.
 */
const USER_ID_CLAIMS = [
  "sub",
  "userId",
  "UserId",
  "userid",
  "uid",
  "nameid",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier",
] as const;

const TENANT_ID_CLAIMS = [
  "tenantId",
  "TenantId",
  "tenantid",
  "tenant_id",
  "companyId",
  "CompanyId",
  "companyid",
  "companyGuid",
  "CompanyGuid",
] as const;

const TENANT_CODE_CLAIMS = ["tenantCode", "TenantCode", "tenant_code", "dbCode", "DbCode"] as const;

/**
 * Derive the authorization identity from claims of a token N3 has ALREADY
 * accepted through the permission-neutral endpoint. Claims are never trusted
 * before that acceptance.
 *
 * `sub` wins for the user key, but only when it does not conflict with any
 * other recognized immutable user-ID claim — a conflict fails closed. Email /
 * userName are display data only and can never stand in for an immutable id.
 */
export function extractValidatedIdentity(claims: Record<string, unknown>): IdentityExtraction {
  const c = claims && typeof claims === "object" ? claims : {};

  const user = resolveClaim(c, USER_ID_CLAIMS);
  if (user.status === "ambiguous") return { status: "ambiguous_user" };
  if (user.status === "none") return { status: "missing_user" };
  const n3UserKey = claimString(c, "sub") ?? user.value;

  const codeResolution = resolveClaim(c, TENANT_CODE_CLAIMS);
  if (codeResolution.status === "ambiguous") return { status: "ambiguous_tenant" };
  const tenantCode = codeResolution.status === "ok" ? codeResolution.value : null;

  const tenant = resolveClaim(c, TENANT_ID_CLAIMS);
  if (tenant.status === "ambiguous") return { status: "ambiguous_tenant" };
  const n3TenantKey = tenant.status === "ok" ? tenant.value : tenantCode;
  if (!n3TenantKey) return { status: "missing_tenant" };

  const email = claimString(c, "email") ?? claimString(c, "Email");
  const userName =
    claimString(c, "name") ?? claimString(c, "unique_name") ?? claimString(c, "preferred_username");
  return {
    status: "ok",
    identity: { n3UserKey, n3TenantKey, email, userName, tenantCode },
  };
}

