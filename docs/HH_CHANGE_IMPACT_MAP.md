# HotelHub change impact map

Version: 1.1. Date: 03/10/2026 (Malaysia).
Upload to Project Sources: Yes — this stable engineering companion only.
Authority: engineering checklist under the existing financial master, product
decisions, DirectBuild governance and Owner instructions. It grants no new feature,
financial write, database change, merge, deployment or public publishing authority.

## Resume and authority

Before every change read README's current-delivery links, this map, current
repository source and the newest dated release/Owner acceptance evidence.
Reverify remote main/review, Lovable project/workspace and synced source, actual
backend/environment and active operations. Historical "Complete" headings are
not current acceptance. A review branch still uses the shared operational backend
unless an isolated backend is positively established.

Use direct repository coding and testing. Keep existing Lovable Cloud and hosting.
Do not send Lovable AI Build messages or consume AI credits as a silent fallback.
Keep AGENTS.md, packages/locks, src/start.ts, src/integrations and established N3
authentication unchanged unless separately reviewed and authorized.

For each task record: user intent, changed authoritative fields, permitted actor/
tenant/stage, all readers and caches, persistence/audit behavior, retries and
concurrency, tests, untested live steps, exact candidate and separate release lanes.
An agent's memory is not a substitute for source inspection or these records.
Update this map when dependencies change; save task evidence under docs/evidence.

## Current automatic-correction review source

The approved nine-task design separates deposit approval (default ON) from contact
approval (default OFF). OFF means authorized direct application; it grants no new
role. Direct N3 execution stays Owner-only. Compact cards, local contact controls
and dormant one-dispatch execution are review-branch source, not a released feature.
Production Update remains OFF/null contract; existing real manual requests must
not auto-run. Read the [incomplete recovery candidate](HH_AUTOMATIC_CORRECTION_CANDIDATE.md).

| Change target | Effective source and affected views | Controls and unsettled result |
| --- | --- | --- |
| N3 receipt amount/contact | Exact final receipt/journal plus one confirmed receipt version; deposits, folio/print/balance/excess, reservations, departures, checkout, Dashboard/monthly/reports/export | Any affected ON category requires approval. Unknown holds original effective money; no repeat POST. Same-account amount/contact adapter only until account-code mapping is proven. |
| Local folio bill-to | Saved local contact or current primary-guest fallback; local card, folio preparation/print | Contact ON creates immutable pending proposal; OFF permits existing authorized local editing. Approval rechecks fallback and stay stage. No customer-master/other-receipt sync. |
| Policy change | Property-only revision and independent switches; Settings and new request routing | Tightening is checked again at dispatch. Relaxation never starts an old pending/manual request automatically. Installed-policy read error denies saving. |
| Cross-session change | Monotonic local decimal revision; seven existing financial-effect prefixes plus policy/bill-to/proposal caches | Task 7 is uncommitted recovery work. Visible-page observation must be read-only, role-filtered, lossless and auth-fail-closed; no N3 mutation on mount, timer or retry. |

## Cross-workflow dependencies

| Change                        | Authoritative data and affected readers                                                                                                                                                              | Checks before acceptance                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Receipt correction/void       | N3 receipt and exact scoped journal; approved request; confirmed receipt versions; Reservation deposits, Owner queue, folio, reservation summaries, Departures, Prepare Checkout and Monthly Finance | Approval authorizes execution; only a proven effective version changes money. Keep original posted intent immutable. Verify proposal/account/customer/currency/date/reference/journal before publishing an effective version. Refresh every dependent cache; test pending, mismatch, expiry and verified outcomes. |
| Late Checkout                 | Departure-day property-local time converted server-side to expected_check_out_at; Actions, approval ledger, timeline, reservation detail, Departures and Prepare Checkout                            | Later than standard checkout, same departure date, accepted reservation stage, actor/tenant permissions, idempotency/concurrent decision. Preserve room nights and rates. This time change is distinct from a paid late-checkout add-on charge.                          |
| Extend Stay                   | Departure date, room allocations/availability and stay length; reservation detail/list, calendar, folio/readiness, Departures and Prepare Checkout                                                   | Room conflicts and concurrent updates; server calculation and folio preparation; property dates; no silent balance collection or N3 receipt change. Check late-checkout timestamp compatibility after departure changes.                                                 |
| Room change / check-in        | Status, room allocation, guest assignment and audited housekeeping handoff; reservation views, calendar/availability, housekeeping, folio/readiness and checkout                                     | Ready/no DND and occupancy are separate gates. Current agreed rate preservation, guest capacity, idempotency and handoff proof. Never treat a Ready room as automatically saleable.                                                                                      |
| Rates / charges / tax         | Server folio and financial settings; room nights, add-ons, readiness, estimated balance/excess, checkout and any future authoritative billing report                                                 | No client-calculated accounting truth; permissions, required reasons, historical snapshots and rounding. Do not turn Sales/Collections on using estimates.                                                                                                               |
| Identity / property / roles   | Server N3 tenant/user/role and property settings; every query, mutation and cached financial/guest view                                                                                              | Fail closed; scope every read/write; clear stale data on failed auth/period reads or identity changes. Test cross-tenant and cross-role denial. No browser-controlled authority or exposed tokens.                                                                       |
| Dates / timezone / formatting | Server property timezone and standard times, reservation dates, N3 receipt dates; pickers, calendar, operations, departures and monthly period                                                       | Display DD/MM/YYYY; do not interpret native browser date formatting as the property format. Resolve wall-clock times on the server. Month boundaries use N3 receipt dates, not booking or request dates.                                                                 |
| Navigation / layouts          | Reservation Actions and deposits versus Prepare Checkout's intentionally different cards                                                                                                             | Desktop compactness and narrow-screen readability; labels, keyboard and error states. Do not duplicate deposit editing into checkout or silently advance checkout stages.                                                                                                |

## Financial truths that remain frozen

- Automatic N3 receipt edit, void and replacement are disabled.
- Approved correction -> Owner completes the approved change in N3 -> HotelHub
  Verify reads receipt/journal -> only proven effective versions alter totals.
- Cancellation flags/timestamps alone do not prove cancelled journal entries.
- Sales and Collections stay Unavailable without authoritative final billing.
- Monthly receipt candidates above 100 show Unavailable, never partial totals.
- External alert delivery stays disabled until provider/recipients are configured.
- DB changes, runtime/function deployment, N3 writes, merge and public publishing
  are independently authorized and evidenced. A Git merge proves none of the rest.

## Validation and handover

Use isolated fixtures for write tests; never run live transactions merely to
demonstrate a UI. Exercise the changed behavior and affected readers/caches,
including denial and stale-data cases. Run relevant regression checks and normal
engineering gates for the candidate. Record screenshots as Owner-observed evidence
when appropriate; do not claim the coordinator performed their actions.

Every handover identifies source/review SHA, synced/published state, DB history,
financial state, completed and pending acceptance steps, and next permitted action.
Project Sources can carry this stable map; volatile SHAs and transaction state
belong in repository checkpoints. No document makes the whole app permanently
verified: each change must prove its specific dependencies.
