# HotelHub change impact map

Version: 07/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: **Yes** — replace the same logical source; keep one active copy.

This checklist sits under Owner decisions, financial rules and governance.
It grants no new N3, database, merge, deployment or publication authority.

Before each change inspect actual source and recovered work. Record intent,
authoritative fields, permitted actor/tenant/stage, persistence/audit, races,
idempotency/recovery, every reader/cache, meaningful checks and lane evidence.

| Change | Affected readers and dependencies | Acceptance checks |
| --- | --- | --- |
| Mounted per-leg billing and frozen recovery | Canonical preparation/current source versions, existing source stores/coordinators, caller-owned N3 proofs, Reservation/Prepare Checkout, source/payer/allocation/folio/report caches, candidate runtime/backend | Original date and exact leg membership without whole-folio repricing; session rechecks/401 stop; no-post GET; one confirmation/replay key; blocked prerequisite reload; scoped dependent-reader refresh; separate HH/N3 identities; source payment/whole-stay close closed; combined SQL rehearsal; exact operational DB approval and Owner N3 proof before activation |
| Authoritative per-leg plan | Saved payer/allocation, canonical prepared snapshot, source customer contact, own-session current AR/revenue/tax graph, source confirmation review and future frozen-leg adapter | Read-only preparation; exact canonical money/membership; each line verified against its own debtor; saved overrides/stale/unassigned denial; deterministic scoped leg IDs; post-master payer/allocation/frozen fence; caller change/expiry denial; no whole-folio sibling projection; contract gates closed; frozen-leg recovery/mount separately incomplete |
| Pre-freeze charge allocation | Saved payer, prepared canonical lines/current own-session proofs, Owner editor/FD reader, source freeze, identity caches, immutable allocation audit | Explicit read has no save/preparation/post; exact line membership and default/derived handling; payer/source fingerprints/property midnight/revision denial; audit rollback; frozen replay; per-leg membership enforced; saved-payer legacy freeze blocked; internal bypass grants revoked; session/booking switch and central purge |
| Initial booking payer | New Reservation source/collection confirmation, source settings, atomic reservation/rooms/guests/reference/payer/audit, existing-stay payer card, financial preparation | Tenant/own role, explicit allowed mode, exact source/policy version under locks; rollback all on failure; no payer on GET; source/identity/policy change clears confirmation; old service create revoked only with coordinated candidate installation; current N3 proof still required before financial dispatch |
| Receipt amount/contact correction | N3 receipt/GL; intent/request/effective version; Reservation ledger/summaries, Dashboard, folio/print, Departures, Prepare Checkout, Monthly/export | Claim/dispatch once; fence legacy manual requests; strict after-proof; refresh every reader once; unknown/auth failure hides stale money |
| Approval settings | Every preview/save/request/approve/execute, open drafts and queue | Deposit ON/contact OFF; mixed-category approval; OFF grants no role; policy revision races |
| Local bill-to | Effective contact versus proposal; folio, print and checkout | Guard every save path; name target; enforce stage/role/audit; preserve unsaved draft |
| Cross-device revision | Scoped policy/effective versions, session and all dependent readers | Lossless monotonic revision, changed identity/current Owner, read failure clearing, two tabs/devices |
| Late Checkout | Departure-day expected time, Actions, approval/timeline, Departures/Checkout | Same departure date, time/stage/role/reason/refusal, concurrency; no room-night or money rewrite |
| Extend Stay | Departure date, allocations, calendar, rate segments, folio/readiness/Checkout | Availability races, rate snapshots, property dates, late-time compatibility; no silent collection |
| Check-in/room change | Occupancy, guests, housekeeping, calendar, reservation and folio | Ready/no DND plus conflicts/capacity; vacated room Dirty; planned departure never releases occupancy |
| Rates/taxes/extras | Server folio/mappings, print, estimates and future bill | N3 tax authority, historical snapshots, reasons/rounding/reversal pairs; no prepared-folio Sales |
| Final checkout | N3 bill/receipt/allocation/outstanding then local close | Unknown blocks close; no duplicate writes; fence status/allocation release and Dirty handoff |
| Identity/roles/property | Every endpoint/cache/guest/financial view | Server tenant/current role; expired/revoked/alien denial; clear stale PII/money |
| Dates/monthly periods | Property timezone, N3 receipt date, calendar/pickers/print/export | DD/MM/YYYY, period failure clearing, 100/101 boundary |
| Navigation/layout | Different Reservation/Checkout cards, Dashboard/Settings/mobile | Full comparison, useful action/error/status states; no duplicate deposit editor |
| BEC package/lot defaults | Provider policy/client entitlement, login/session/licence UI | One package/default 30; versioned snapshot edits/audit; tenant Owner cannot grant capacity |
| Room capacity | All properties; room create/map/activate/reactivate/import/clone | Count active mapped rooms including occupied/Dirty/maintenance; atomic30/31 and60/61; no duplicate/remap bypass |
| BEC downgrade/expiry/outage | Licence, current guests/bookings and unresolved financial intents | No deletion/eviction/free capacity/N3 retry; bounded grants and reviewed recovery contract |
| Client cutover/restore | Opening rooms/bookings/deposits/settings/mappings/licence | Correct client tenant; isolated restore then N3 reconciliation; code rollback does not undo money |

Published correction remains manual. Approved automatic target is incomplete/OFF.
Void/replacement/refund/unmatch remain OFF. Cancellation metadata alone cannot
prove cancelled GL. Sales/Collections remain Unavailable without final posted
source; Monthly above 100 candidates Unavailable. Alerts OFF until configured.
One BEC commercial package does not enable unproven writers.

Use isolated write fixtures. Native SQL, mounted browser and two-device proof
cannot be replaced with static wiring/mocked evidence. Repository handover records
actual Owner observations, exact candidates and next permitted work. Each change
must prove its own affected dependencies.

Access-card impact: check-in/authorized occupancy, additional cards, lost/replacement,
late departure, Extend Stay, room change and final checkout; shared room mapping,
property timezone, device authorization, audit and recovery. PZ22 overwrite takes
effect at lock presentation; writer cancellation is not remote-lock revocation proof.
No card success/failure creates financial settlement or releases a room by itself.
