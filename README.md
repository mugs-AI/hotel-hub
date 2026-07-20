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

Two server entry points are supported. Both go through the same
`performN3Launch()` server handler in `src/lib/launch.server.ts`, so
verification, tenant upsert, session creation, and clean-URL redirect
are guaranteed to be identical.

1. **Path A1 — N3 My Apps launch (root URL).**
   The N3 My Apps configuration URL for HotelHub is:

   ```
   https://hotelrooms.lovable.app/?token={token}
   ```

   `rootTokenInterceptor` in `src/start.ts` catches the incoming
   `GET /?token=…` on the server before any React or client code runs.
   The token is consumed server-side, verified against
   `GET /api/companyprofile/BasicInfo` at N3, used to upsert the tenant
   and open an encrypted `HttpOnly` session cookie, and then a `302`
   redirect strips it from the URL. The launch token is visible only to
   the initial HTTP request line and the very first browser address bar
   entry (it is a query parameter, by protocol construction); it never
   enters client JavaScript, `localStorage`, `sessionStorage`, rendered
   HTML, or application logs.
2. **Path A2 — explicit launch endpoint.**
   `GET /api/auth/launch?token=<jwt>` behaves identically to Path A1 and
   is available for programmatic re-launch and testing.
3. **Path B — developer sign-in (non-production).**
   `POST /api/auth/connect { apiKey }` exchanges the key with N3 and
   creates the same session. Returns `{ ok: true }` — never the token.
   Returns **404** in production.
4. **Sign-out.** `POST /api/auth/logout` clears the session cookie.
5. **N3 401.** Any 401 from the N3 gateway destroys the session
   immediately and forces the UI back to the relaunch/dev-connect gate.

Preserved query parameters: `stripTokenFromUrl()` removes only `token`
from the incoming URL and preserves everything else, so the clean
redirect target keeps unrelated N3 launch parameters intact.

## First-Owner provisioning runbook (MUGS-only)

There is no browser-facing self-service Owner assignment and no public
bootstrap endpoint. The first Owner for a new tenant is provisioned
server-side by a MUGS operator using the security-definer function
`public.hotelhub_provision_owner`, which requires the `service_role`
(available inside Lovable Cloud SQL) and cannot be reached from an
authenticated browser session.

Steps:

1. The end user launches HotelHub from N3 via Path A1. Their identity
   is verified, `hotel_tenants` is upserted, and the app shows the
   role-unassigned gate that surfaces four identifiers:
   `hotel_tenants.id`, `n3_tenant_key`, `n3_user_key`, and
   `user_email`.
2. The user shares those identifiers with the MUGS operator (e.g. via
   support ticket / call).
3. The operator opens the Lovable Cloud → Backend → SQL editor (which
   runs as `service_role`) and executes:

   ```sql
   SELECT public.hotelhub_provision_owner(
     '<n3_tenant_key>',
     '<n3_user_key>'
   );
   ```

   The function verifies the tenant exists, inserts (or activates) an
   `owner` row in `hotel_user_roles`, and writes a `role.assigned`
   audit event with `source = 'first_owner_runbook'`.
4. The user refreshes the app. `/api/session/me` now resolves the role
   as `owner` and the full shell renders.

Future role management (adding another Owner, granting front_desk /
housekeeper) is Owner-only and will ship in a later milestone; the
runbook is intentionally the only path to bootstrap the initial Owner.


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
