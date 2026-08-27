// HH-AUTH-04 — permission-neutral N3 token validation (PURE decision layer).
//
// Business problem: HotelHub used to prove a launch token by calling
// `GET /api/companyprofile/BasicInfo`. That endpoint is guarded by the N3
// "Company Profile" permission, so ordinary front-desk / housekeeping staff
// receive HTTP 403 and could never authenticate, even when the HotelHub Owner
// had explicitly assigned them a role.
//
// Official contract used instead (platform-v1 OpenAPI, fetched from
// https://openapi.account.qne.cloud/doc/platform-v1.json):
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

function envelopeIsSuccessful(body: unknown): boolean | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const code = b.code ?? b.Code;
  const success = b.success ?? b.Success;
  let sawEnvelope = false;
  if (typeof code === "string" && code.trim() !== "") {
    sawEnvelope = true;
    if (code.trim() !== "0000") return false;
  } else if (typeof code === "number") {
    sawEnvelope = true;
    if (code !== 0) return false;
  }
  if (typeof success === "boolean") {
    sawEnvelope = true;
    if (!success) return false;
  }
  return sawEnvelope ? true : null;
}

/**
 * Interpret one raw response from the neutral endpoint.
 *
 * Rules:
 *  - 401 => rejected, 403 => forbidden (both deny; never a session);
 *  - any other non-2xx (including 5xx) => unavailable;
 *  - 2xx with an N3 envelope that is not success ("0000" / success:true)
 *    => malformed (unsuccessful envelope, fail closed);
 *  - 2xx without envelope markers => accepted (N3 served the authenticated
 *    request; the body itself is irrelevant and is discarded).
 */
export function interpretNeutralValidation(status: number, body: unknown): NeutralValidation {
  if (status === 401) return { status: "rejected" };
  if (status === 403) return { status: "forbidden" };
  if (status < 200 || status >= 300) return { status: "unavailable" };
  const ok = envelopeIsSuccessful(body);
  if (ok === false) return { status: "malformed" };
  return { status: "accepted" };
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
  | { status: "missing_tenant" };

function claimString(claims: Record<string, unknown>, key: string): string | null {
  const v = claims[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Collect the distinct values for a set of claim keys. More than one distinct
 * value means the token is ambiguous about that identity, which fails closed.
 */
function uniqueClaim(claims: Record<string, unknown>, keys: readonly string[]): string | null {
  const seen = new Set<string>();
  let last: string | null = null;
  for (const k of keys) {
    const v = claimString(claims, k);
    if (v) {
      seen.add(v.toLowerCase());
      last = v;
    }
  }
  if (seen.size !== 1) return null;
  return last;
}

const USER_ID_CLAIMS = [
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
 * `sub` wins for the user key. Email / userName are display data only and can
 * never stand in for a missing immutable id.
 */
export function extractValidatedIdentity(claims: Record<string, unknown>): IdentityExtraction {
  const c = claims && typeof claims === "object" ? claims : {};
  const n3UserKey = claimString(c, "sub") ?? uniqueClaim(c, USER_ID_CLAIMS);
  if (!n3UserKey) return { status: "missing_user" };
  const tenantCode = uniqueClaim(c, TENANT_CODE_CLAIMS);
  const n3TenantKey = uniqueClaim(c, TENANT_ID_CLAIMS) ?? tenantCode;
  if (!n3TenantKey) return { status: "missing_tenant" };
  const email = claimString(c, "email") ?? claimString(c, "Email");
  const userName =
    claimString(c, "name") ?? claimString(c, "unique_name") ?? claimString(c, "preferred_username");
  return {
    status: "ok",
    identity: { n3UserKey, n3TenantKey, email, userName, tenantCode },
  };
}
