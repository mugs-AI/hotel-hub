# HotelHub BEC one-package and room-lot control

Version: 07/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: **Yes** — replace the same logical source; keep one active copy.

Status: **Owner commercial direction recorded; integration specification for review.**
Classification: architectural, a new cross-project server authorization subsystem.
No BEC code, schema, licence or HotelHub enforcement was changed or activated.

## Purpose and decision boundaries

User 07/10: all current HotelHub functions in one package/module, capacity in lots
of 30 rooms, editable by MUGS; client target 01/11/2026.

| Item | Authority |
| --- | --- |
| One HotelHub commercial package/module | Explicit latest Owner direction |
| Default 30 rooms per lot;1=30,2=60,3=90 | Explicit latest Owner direction |
| Provider/BEC operator edits size and client lots | Proposed interpretation of edit request; tenant Owner cannot self-license |
| Trial 15 days, immutable earliest first join, BEC sync/no restarted trial | Recorded earlier Owner direction; current policy disabled |
| Count, trial seats/capacity, price, expiry/grace/offline/renewal | Proposed below or unresolved, not new confirmed business decisions |

One module describes commercial packaging. Keep internal code boundaries and role/
financial/activation controls. A bundled feature is not automatically implemented,
contract-proven or available to every role. Full maintenance and unproven writers
remain subject to their own acceptance. Prices/monthly versus yearly terms absent.

## Actual state — read-only 07/10

| Surface | Observation |
| --- | --- |
| Repository and main | mugs-AI/bec1.0 / ea3e23f2c81ea78a97605d237b9d49258d180a2f |
| Lovable | b3b02790-a853-464e-ac45-a054381e59b2; workspace tJObptvCa2MGSCihecnu; same latest SHA, ready/agentFinished |
| Backend | Enabled Cloud-accessible Supabase; configured ref iinmwukhrcectuanhojg from config.toml, no independent live endpoint-ref attestation |
| Actual migration history |20260922100000 policy and20260923100000 security applied; don't rerun |
| HotelHub product/policy | Registry hotelhub inactive; v 1disabled/autoTrial false,15 days, trial users 3, room limit NULL, offline 7 |
| Current feature catalogue | CORE_FRONT_DESK, HOUSEKEEPING, MAINTENANCE, N3_FINANCE, REPORTS |
| Current counting rule | active_mapped_rooms; users all_active_authorized_users |
| Entitlements | Zero HotelHub entitlements; one ServiceHub entitlement |
| Licence fields | room_limit, allowed_modules, policy reference and first_joined_at_utc; no lot_size/lot_count |
| Creation path | Form/schema and actual create_entitlement RPC still ServiceHub-only |
| Security evidence | RLS enabled on inspected tables; not full grants/operator/tenant acceptance |
| HotelHub bridge | No licensing bridge/table found in current source/schema scan |

**BEC does not yet control HotelHub.** Filling a room default alone cannot create
lot accounting, secure integration or server enforcement. BEC README/source contain
staleWP 0/unapplied descriptions despite actual later applied migrations.
No signed-in BEC UI acceptance or public deployment inspection performed here.

## Approaches and selected proposal

| Approach | Tradeoff |
| --- | --- |
| One versioned package plus lot size/count and derived capacity | Recommended: explicit commercial units and audited edits |
| Type each client's room_limit manually | Less UI work, but no 30-room lot/default/snapshot model |
| Keep five purchasable modules plus lots | Conflicts with one-package direction and multiplies licence combinations |

Retain legacy catalogue and audit records; add a single commercial package through
a reviewed additive change. Exact internal package identifier belongs to the plan,
not an invented existing code. External HOTELHUB maps deliberately to immutable
existing lowercase hotelhub; never rename/reuse product IDs or affect ServiceHub.

## Proposed capacity and editing contract

Product default lot size 30. Per client positive whole-number lot quantity; store
the purchased lot-size snapshot and derived effective capacity:

capacity = lot quantity × purchased lot-size snapshot.

Server validates bounded integer values and multiplication. Browser cannot grant
capacity. Operator screen displays package, size, lots, calculated limit, actual
room count, before→after, effective date and mandatory reason. Writes append
version/audit with authenticated BEC actor, not client-supplied actor/email.

Changing product default affects new entitlements/renewals only. Existing 2×30 stays
60 if default becomes 40. Explicit revision of that client's snapshot to 40 gives 80.
No bulk silent retroactive resize. Revisions preserve prior terms and rollback
compatibility; no editing append-only policy versions.

MUGS/BEC operator controls size/lots. HotelHub Owner/FD/Housekeeper cannot self-grant.
HH Owner sees status/used/limit and can request upgrade; no external alert delivery
added. A provider downgrade below active count is refused with impact information.
Resolve unused rooms/bookings or schedule a compatible later effective date.
Never delete rooms/reservations, evict guests or unmap occupied/future-booked rooms
to make a downgrade fit. Capacity pools per immutable N3 tenant+product across all
property records, unless a later per-property contract is explicitly approved.

## Proposed room counting

Follow current BEC active_mapped_rooms meaning: count distinct active operational
HotelHub rooms with valid immutable N3 mapping. Occupied, reserved, Dirty, Cleaning,
Inspected, Ready, DND and temporarily maintenance-blocked active rooms all count.
Cleanliness/maintenance/occupancy cannot free a purchased commercial slot.

Inactive/unmapped historical rooms retained and nonbookable; map/activate/reactivate
consumes capacity. Refuse deactivation/unmapping where current occupancy or future
active bookings conflict. Count before activating newly imported/cloned/remapped
rooms; audit duplicate immutable mappings so real rooms cannot reuse one slot.

Count and create/activate/remap/import commit under one tenant capacity fence.
At 29/30, two concurrent activations cannot both succeed. Bulk import refuses or
reports an explicitly accepted atomic result, never silently exceeds capacity.

| Example | Expected capacity |
| --- | --- |
| 1 lot,30 active rooms | Allowed |
| 1 lot,attempt room 31 | Blocked with useful upgrade information |
| 2 lots,60 active rooms | Allowed |
| 2 lots,attempt room 61 | Blocked |
| 31 rooms needed at default 30 | Required lots=ceil(31/30)=2 |
| Dirty/occupied/maintenance room | Still counted |

This is a proposed counting contract consistent with current BEC policy. Earlier
“all configured including inactive” was an assistant proposal, not confirmed Owner
direction. Exact counting and deactivation/downgrade exceptions require written review.

## Proposed server bridge and trial

BEC owns commercial status/terms/capacity. HH owns N3 identity, roles, rooms and hotel
operations. After N3 launch, server verifies immutable tenant and fixed HOTELHUB,
then calls a dedicated authenticated least-privilege BEC endpoint.
No browser direct BEC tables, BEC operator password shared with HH or client service
key. BEC operator is separate from hotel tenant Owner. Endpoint/authentication/
secret/runtime mechanism not present yet; inspect/test before selecting specifics.

Bound response requires tenant/product/entitlement ID/policy version/status, purchased
lot size/count/capacity, earliest join, trial/paid/grace expiry, issued/valid-until
and correlation, with integrity/authentication and replay/version validation.
Missing/alien/contradictory/disabled entitlement fails closed for new access.
App records earliest verified server join once; BEC deduplicates product+tenant
atomically and never resets trial on relaunch/reinstall/new device/company rename.
A provisional trial sync preserves first join and doesn't create another trial.

## Check frequency, offline and expiry — proposed boundary

Earlier general BEC preference: login-time checks and configurable 1–2 week offline
allowance, immediate sync on resume. Exact HH applicability not established.
Recommended starting design: login-time BEC handshake; each operation locally
validates bound server grant, licence expiry, role and capacity. No per-click remote
BEC lookup assumed. Session must not outlive accepted licence/grant bounds.
Periodic refresh or forced immediate revocation requires an explicit decision;
do not silently import an assistant's60-minute refresh recommendation.

Current policyoffline 7 is observed, not proof of a safe HH outage implementation.
Fallback requires a previously authorized authenticated/bound server grant, capped
by the earliest of offline allowance, grant validity and trial/paid/grace expiry.
Never extend cache itself, restart trial, grant capacity or accept a known revoked/
disabled/expired entitlement. Sync immediately on resume before renewing authority.

Expired/inactive ordinary access shows licence information, hides guest/financial
figures and blocks new operations, preserving all records. Proposed separate
Owner GET-only recovery for an already-dispatched unknown N3 intent may complete
read-back without new money/operations; exact recovery access/runbook needs review.
Persist evidence of in-flight effects even if licence expires; no auto-room-release
or N3 POST retry on expiry/outage.

## Remaining decisions before implementation

Provider-edit/snapshot mechanics and exact room count/downgrade exceptions; trial
capacity (proposed 1lot=30, not yet approved) and distinct N3-backed user/Owner seats;
paid pricing/terms/renewal/grace; offline/check frequency/revocation/session bounds;
expired GET-only recovery scope; concrete server authentication/runtime ownership.
These are missing mechanics, not repeated approval of one-package/default 30.
Do not silently adopt BEC observed user 3/offline7/null room as a final HH agreement.

## Separate implementation and release lanes

Review written contract → exact BEC+HH implementation plan → independent isolated
review branches → BEC additive package/lot/versioned RPC/operator UI → HH bridge/
session/status/atomic room enforcement → native SQL/security/races and mounted/
two-device UAT → exact candidate reviews → separately approved DB/runtime/secrets/
activation/main merge/publication → correct-client entitlement and acceptance.

Inspect each project's AGENTS/protected paths/history/types/backup and deployment
mechanism. Keep product disabled until complete compatible bridge contract ready.
No existing ServiceHub terms/RPC or audit is changed just to support HotelHub.
No licence created by this source refresh.

## Acceptance matrix

| Case | Expected |
| --- | --- |
| 30/31,60/61 and concurrent activation/import | Correct capacity, atomic no overflow, no remap/duplicate/property bypass |
| Default 30→40, existing 2×30 | Remains 60 until explicit audited client revision |
| Tenant Owner forged lots/role/product/tenant | Denied server/DB; no self-granted licence |
| Downgrade below used/booked | Refused or safely scheduled; no data deletion/eviction |
| Repeat launch/device/name/reinstall | Same first join/entitlement, no second trial |
| BEC unknown/offline/expired grant | No browser bypass/unbounded cache/new trial |
| Expiry during unknown N3 dispatch | Evidence retained, no POST retry, bounded approved read-only recovery |
| One package with FD/Housekeeper | Existing role minimization/financial gates retained |
|BEC/HH rollback | Independent compatible versions, ServiceHub unchanged |

Evidence: docs/evidence/HH_BEC_READONLY_STATE_20261007.json.
This specification creates no migration, licence, secret, N3 operation or publication.

## Latest sequencing, 07/10/2026

Owner prioritizes N3 billing/matching then access cards. BEC enforcement follows
safe checkout/room turnover and card integration, before agreed commercial launch.
Its contract/onboarding decisions may be reviewed alongside finance; do not displace
the financial vertical or require every optional enhancement to finish first.
21/10 forecast/freeze and 01/11 target waive no integration or activation evidence.
