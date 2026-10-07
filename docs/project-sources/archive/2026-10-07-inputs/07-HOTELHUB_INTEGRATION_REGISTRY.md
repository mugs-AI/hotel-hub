# HOTELHUB_INTEGRATION_REGISTRY

## Current Integration Boundaries

**Pack version:** 17/09/2026  
**Last verified main/deployed SHA:** `75ceac11089936778b672c438d3a103b4715609a`  
**Status:** Active registry

**27/09/2026 local source checkpoint:** Local commit `b32a519` contains the rebuilt N3 bank/cash account selector, Owner display labels, immutable payment-line snapshots, matching migration `20260927120000_hh_payment_accounts_and_lines.sql`, and a separate split-posting gate. Local build and TypeScript passed; 116 focused financial tests passed and changed-file lint has no errors. GitHub `main` now points to `495b90d900a44bc9b5297d24ca07529b45aff23e` (three equivalent fast-forward commits created through the GitHub integration). Its final tree `719e5932b501bda74d88a6937806e3726b27922d` exactly matches the tested local `b32a519` tree. The commit IDs differ because the connected integration created new GitHub commits. No migration, deployment or HotelHub N3 Create occurred. N3 Cloud UI evidence for split receipt and balanced journals remains distinct from HotelHub API proof. Keep split posting disabled pending tenant Create/read-back and GL verification. The 23/09 repository/deployment pointers below remain historical audit snapshots.

## 1. Status vocabulary

`Planned / Discovery / Contract Proven / Implemented / Verified / Accepted / Deferred / Blocked / Obsolete`

An integration is not verified merely because an SDK wrapper, endpoint, migration, component or mocked test exists.

## 2. Registry summary

| Integration | Status | Write enabled | Current truth |
|---|---|---:|---|
| N3 launch/session/tenant | Implemented foundation | Session only | N3 identity; server-held token; server tenant/user |
| N3 current Owner/user resolution | Implemented foundation | Role resolution | Must fail closed and revalidate high-risk Owner actions |
| HotelHub role/allowlist | Implemented foundation | Local role assignment only | Non-owner access requires active HotelHub permission |
| N3 room/customer/stock/UOM/tax reads | Implemented | No | Immutable mapping and settings verification |
| N3 AR Receive Payment deposit | Implemented, gated | Restricted | Durable local intent and reconciliation |
| N3 checkout/deposit verification | Read-only | No | Optional explicit verified-balance action |
| N3 CashMemo/Post-to-AR | Required / unproven complete contract | No | Not accepted as write vertical |
| N3 allocation/knock-off | Discovery required | No | Never invent write behavior |
| N3 balance receipt | Required | No | Linkage/allocation not accepted |
| N3 Customer Refund | Discovery required | No | Read evidence is not create authority |
| Lovable Cloud database | Implemented / 01C parity accepted | Server only | Migration `20260916120000`; live schema/ledger/generated types verified |
| Direct browser Supabase Auth | Prohibited | No | N3-only identity; no second browser login system |
| Lovable/GitHub deployment | Implemented process | Controlled | Exact project/repo/SHA must be independently verified |
| BEC licensing/trial bridge | Planned | No | Separate future contract; must not corrupt hotel data |
| Guest folio print | Implemented/accepted | No accounting write | Prepared local folio; optional N3 verification separated |
| Room-door writer | Discovery | No | Vendor/model/SDK/protocol unknown |
| OTA/channel manager | Deferred | No | Booking-source labels only |

## 3. N3 identity and security boundary

Required launch/session architecture:

```text
N3 My Apps launch
→ HotelHub server consumes and validates launch credential
→ server resolves BasicInfo tenant/company
→ server resolves active N3 actor/current Owner
→ server applies HotelHub allowlist/role
→ N3 token remains encrypted server-side
→ browser receives only secure HttpOnly HotelHub session
```

Browser must never store/receive the raw N3 bearer in localStorage, sessionStorage, IndexedDB, client logs or ordinary application payloads.

Never accept tenant, actor, role, customer/account, arbitrary N3 method/path or service secret from uncontrolled browser input.

Required role-resolution outcomes:

| Condition | Outcome |
|---|---|
| Invalid/expired HotelHub or N3 session | 401; revoke/clear session |
| N3 authority endpoint returns 403 | 403; do not invent a normal role |
| N3 user unmatched/inactive/deleted | 403; no HotelHub access |
| Current N3 Owner | Resolve `owner`; rotate/revalidate as needed |
| Former Owner | Owner power removed; continue only with active HotelHub permission |
| Active allowed non-owner | Resolve assigned `front_desk` or `housekeeper` |
| No/contradictory local role | 403 fail closed |

## 4. N3 read/mapping boundary

- Use immutable N3 IDs as authority.
- Codes/names are display/search values and snapshots.
- Cap/paginate/constrain upstream reads.
- Normalize upstream responses into safe DTOs.
- Re-read/canonicalize selected mappings on the server.
- Missing/ambiguous identity, rate, currency or account blocks readiness.
- Cache only where safe; high-risk Owner/financial actions require suitably fresh authority.

## 5. N3 financial-write boundary

Every new write requires:

- official documentation or sanitized live contract proof;
- fixed server-selected capability/path/method;
- tenant/role/customer/account/currency/document validation;
- stable local intent before POST;
- tenant-scoped uniqueness and claim;
- deterministic success/failure/unknown classification;
- no blind retry for unknown side effect;
- GET-only reconciliation;
- immutable N3 identity storage;
- amount/currency/customer/tax/allocation/outstanding read-back;
- concurrent and duplicate-click tests;
- safe audit and operator error message.

Document creation alone is not settlement.

## 6. Lovable Cloud database boundary

- The actual HotelHub database is the project’s Lovable Cloud database.
- The absence of a Supabase organisation under an unrelated account does not mean the database was discontinued.
- Browser Supabase Auth is prohibited; server-side database access remains the model.
- Migration file, Cloud-applied ledger and generated TypeScript types must agree.
- Never rewrite/delete an already-applied migration.
- A migration discovered outside approved scope is recorded as governance variance; it is not permission for further drift.
- RLS/service routines still require tenant scoping and server permission even when UI hides a feature.
- Destructive purge/cleanup requires a separate explicit scope and recovery plan.

HH-GOLIVE-01C database evidence:

- migration `20260916120000_hh_golive_01c_posting_mappings_parity` applied exactly once;
- repository SQL and stored migration MD5 matched;
- `posting_mappings` remained nullable `jsonb` with no default;
- RLS remained enabled and no browser-facing policy was added;
- the existing data fingerprint was unchanged.

## 7. Lovable/GitHub deployment boundary

Before every write/publish verify:

1. ChatGPT project is HH1.0.
2. Lovable project ID is `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`.
3. GitHub repository is `mugs-AI/hotel-hub`.
4. Intended branch and input SHA match the approved scope.
5. Lovable actually loaded that source; a stale tracked branch is a stop condition.

After publish verify:

- deployed source/bundle corresponds to intended SHA;
- live host responds;
- protected session behavior remains;
- exact changed behavior is visible;
- `main` did not gain unrelated files.

CAPTCHA/manual publication is an operational limitation, not evidence of success. A user clicking Publish must be followed by independent live verification.

Latest verified publication: SHA `75ceac11089936778b672c438d3a103b4715609a`, deployment `dd4d2ce8-9bca-475a-95d1-181fe9140a2e`, production HTTP 200, anonymous session fail-closed shape, and protected financial-settings HTTP 401.

## 8. Print integration decision

Normal Print Folio must not automatically invoke N3 checkout/deposit verification. The earlier coupling could process many deposits in limited concurrency with long timeouts, producing 90–120 second preview delays.

Accepted default path:

```text
prepared HotelHub folio
→ open dedicated print tab
→ render stable rows/styles
→ two browser paint frames
→ window.print()
```

`Load verified deposit balance` is explicit, optional and read-only. Browser-native print time may vary, but no hidden N3 call may delay normal preview.

## 9. BEC licensing/trial boundary

Future HotelHub–BEC integration must use one stable record per N3 tenant + HotelHub product. Requirements carried from BEC experience:

- preserve first join date/time;
- prevent repeated trials for the same stable tenant+product;
- use server-side license authority;
- keep marketing capture/consent separate;
- define outage/grace/fallback behavior before enabling enforcement;
- inactive/expired access may block product data visibility/operations according to approved policy but must not delete hotel/N3 records;
- purge and clean/delete are separate, explicit administrative actions;
- BEC unavailability must never trigger an N3 financial retry or tenant crossover.

No BEC implementation is authorized by this registry.

## 10. Room-door boundary

Do not expose unrestricted USB/serial commands or master keys to browser code. Preferred future architecture:

```text
HotelHub server
→ authorized credential intent
→ restricted property-local bridge
→ vendor adapter
→ supported vendor SDK/protocol
→ exact encoder/lock
```

No implementation prompt until vendor, lock/writer model, card technology, SDK/API/protocol, supported OS/runtime, licensing, key custody, lifecycle rules, offline behavior and physical test kit are proven.

## 11. Current single next action

Next: use the published `495b90d` tree for release preparation; complete authorized selected single and split receipt Create/read-back and balanced journal proof in the owner-designated N3 sandbox. Keep split posting disabled until that proof, then release matching code and migration together through the separate release process. Prior Cloud UI matching and refund tests need no repetition.
