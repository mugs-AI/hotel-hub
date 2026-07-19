# HotelHub

Boutique hotel management, integrated with **N3 AI Cloud Accounting**.
This repository contains the foundation only — hotel business modules
(rooms, reservations, folios, housekeeping, reports) are deferred to
later MAF milestones.

## Milestone 1.0.1 — Foundation security, tenant context & RBAC

The current build establishes a secure, tenant-aware foundation:

- N3 identity is the sole identity source — no local usernames/passwords.
- N3 access tokens live **only** in an encrypted, HttpOnly server session
  cookie. They are never sent to the browser, never written to
  `localStorage` / `sessionStorage`, and never logged.
- A deny-by-default N3 gateway allows only three read-only GET probes.
- Every authenticated route and endpoint runs through a central RBAC guard.
- HotelHub roles are strictly `owner`, `front_desk`, `housekeeper`.

## Environment variables

Server-only:

| Name | Purpose |
| --- | --- |
| `HOTELHUB_SESSION_SECRET` | Encryption key for the session cookie (≥ 32 chars). Generated automatically in Lovable Cloud. |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Lovable Cloud (Supabase) service access. Managed by Cloud. |
| `OPEN_API_BASE_URL` | Overrides the N3 Open API host (defaults to `https://openapi.account.qne.cloud`). |
| `NODE_ENV` | `production` disables the developer API-key sign-in route. |

There are no `VITE_*` variables carrying N3 credentials — the browser has
no access to any N3 secret.

## N3 launch and session flow

1. **Path A — production launch (My Apps).**
   N3 opens `GET /api/auth/launch?token=<jwt>` on the HotelHub server.
   The server:
   - calls `GET /api/companyprofile/BasicInfo` at N3 with the token to
     verify identity;
   - resolves the immutable tenant key (N3 tenant/company id, falling
     back to tenant code) and the immutable user key (JWT `sub` → email);
   - upserts the tenant in `hotel_tenants`;
   - opens a `Secure`, `HttpOnly`, `SameSite=Lax` session cookie
     (`hotelhub_session`);
   - redirects to `/` on a clean URL (no token in the address bar).
2. **Path B — developer sign-in (non-production).**
   `POST /api/auth/connect { apiKey }` exchanges the key with N3 and
   creates the same session. Returns `{ ok: true }` — never the token.
   Returns **404** in production.
3. **Sign-out.** `POST /api/auth/logout` clears the session cookie.
4. **N3 401.** Any 401 from the N3 gateway destroys the session
   immediately and forces the UI back to the relaunch/dev-connect gate.

## Tenant and role boundaries

- The **canonical tenant** is the `hotel_tenants.id` UUID keyed by the
  immutable N3 tenant/company identifier (`n3_tenant_key`).
  Tenant code and company name are **display values only**.
- **Roles** live in `hotel_user_roles(tenant_id, n3_user_key, role)` and
  are limited to `owner | front_desk | housekeeper`. Assignment is
  performed by server code only — no browser client can self-assign role
  or tenant.
- No automatic Owner provisioning has been implemented. New N3 users
  land in the `role_unassigned` state until an operator grants a role.
  The rule that will decide first-Owner assignment is an open decision
  (see “Unresolved assumptions” below).

## Allowed N3 verification endpoints

Only these three read-only GETs are reachable through the server
gateway (`GET /api/n3/probe/:name`); anything else is rejected with a
403 or 405.

| Probe | Upstream path |
| --- | --- |
| `companyprofile` | `GET /api/companyprofile/BasicInfo` |
| `customers` | `GET /api/customers/list?$top=5&$skip=0` |
| `stocks` | `GET /api/stocks/list?$top=5&$skip=0` |

`n3:verify` is granted to `owner` only. Front desk and housekeeping do
not receive N3 accounting integration surfaces.

## Cloud schema (see `supabase/migrations/`)

- `hotel_tenants` — one row per verified N3 tenant/company.
- `hotel_user_roles` — HotelHub role assignment.
- `hotel_audit_events` — session, access-denied, probe, and role events.
- Enum `public.hotel_role` — `owner | front_desk | housekeeper`.

Row-Level Security is enabled on all three tables with **no policies**
for `anon` or `authenticated`. This is deliberate: HotelHub does not use
Supabase Auth, and all access happens through the service-role client
from server code. The database linter surfaces this as an INFO —
expected and intended.

## RBAC

The permission matrix lives in `src/lib/rbac.ts`:

| Permission | owner | front_desk | housekeeper |
| --- | --- | --- | --- |
| `app:view` | ✅ | ✅ | ✅ |
| `n3:verify` | ✅ |   |   |
| `roles:manage` | ✅ |   |   |

`authorize()` is the single choke-point. Missing session, missing
tenant, missing role, unknown role, and inactive assignment all resolve
to a denial.

## Automated tests

```bash
bun run test
```

Covers:

- BasicInfo normalization across PascalCase / camelCase / claim-fallback
  variants.
- RBAC matrix (three-role guard, deny-by-default, permission scoping).
- N3 gateway allowlist (path allowlist, traversal / absolute-URL / other
  probe-name rejection).

Result of last run: **18 tests passing**.

## Manual verification

1. Open the deployed URL — the app shows the unauthenticated relaunch
   gate. `document.cookie` shows no HotelHub or N3 token; `localStorage`
   and `sessionStorage` are empty of N3 material.
2. In development, expand **Developer sign-in**, paste a valid N3 API
   key, submit. The shell loads with the company/tenant/user badge
   populated. `document.cookie` contains only the opaque
   `hotelhub_session` cookie; it is not readable by client JS
   (`HttpOnly`).
3. Confirm `POST /api/auth/connect` returns `404` when
   `NODE_ENV=production`.
4. Confirm `GET /api/n3/probe/companyprofile` returns a JSON envelope
   for an owner, and 403 (`forbidden` / `role_unassigned`) for anyone
   without the role.
5. Confirm `POST /api/n3/probe/companyprofile` returns 405.
6. Confirm `GET /api/n3/probe/../secrets` and
   `GET /api/n3/probe/customers%2F..` are rejected with 403
   (unknown probe).
7. Sign out via the header button — `GET /api/session/me` responds
   `{ authenticated: false }` and the shell returns to the gate.
8. If N3 returns 401 during a probe, the session is destroyed
   immediately and the UI returns to the gate on the next refresh.

## Unresolved assumptions

- **First-Owner provisioning rule.** N3 does not expose a canonical
  “hotel owner” flag. HotelHub currently treats every new user as
  `role_unassigned` until an operator grants a role explicitly. A
  future milestone must define who grants the initial Owner (invitation
  link, Marketplace subscription callback, manual N3 support step).
- **N3 user identity key.** The current build derives the immutable
  user key from the JWT `sub` claim, falling back to email or display
  name. This should be re-validated once N3 publishes an official user
  identifier field in BasicInfo.
- **Session lifetime.** The session cookie is fixed at 8 hours. Future
  work should align this with the N3 token expiry once it is exposed
  reliably.

## Explicit scope confirmation

This milestone did **not** add any of the following: rooms, rates,
reservations, guests, deposits, check-in, checkout, CashMemo, AR
matching, refunds, cancellation / no-show processing, housekeeping
operations, maintenance jobs, dashboards, reports, or sample hotel
data. The navigation shell continues to render placeholders for these
deferred modules.
