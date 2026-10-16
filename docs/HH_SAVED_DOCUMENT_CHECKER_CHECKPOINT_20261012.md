# HotelHub saved-document checker checkpoint — 12/10/2026

Upload to Project Sources: **No** — review-branch engineering record.
Status: **Task 2 source implementation complete, independently reviewed and tested; unreleased.** The wider accountant and source-billing plans remain partial.

Continues preserved local `930a04175681ca6a80a68b6895c9bf73ad4747ec` and remote `570c1d55b24d3312749bc9b106446b0e8ed73429` on the existing review branch. Product source after the review fix pass is local `1a00e39869587fc623b76c4eef91836caef0e356`, tree `2355f49ffee69317c9a796cff024504dd0c4bdc6`. A later documentation checkpoint preserves that product source. Resolve the actual remote head/tree at handover; local and API commit metadata can differ while trees match.

## Behavior prepared

Owner-only Financial Verification now has a booking selector and **Check saved documents**. Selection reads stored local intent metadata, not N3 financial status. The explicit checker POST initiates only fixed-ID N3 GETs; it has no financial writer, settlement mutator or accountant-case mutator. Existing session cleanup remains the authentication hook, not financial repair.

The checker uses privately bound persisted intents/dispatches and the existing authenticated document/journal validators. Browser input contains only the intent ID; tenant/actor/URLs/document IDs/amounts cannot be supplied. Limits: up to 12 saved documents, at most three observations, waits of 1s and 2s, one shared 40s deadline and 2,000,000-byte response budget. Reads are sequential so an observed 401 stops later calls. Navigation, booking change, scope loss, oversized response and deadline prevent further work and hide incomplete balances.

Known saved document numbers and durable attempt/operation references survive waiting or unknown identity outcomes. Incomplete ownership or identity performs no financial confirmation or guessed-ID search. Safe HTTP/business codes are retained; tokens, guest contact and raw private journals are excluded. Unknown vendor replies get safe fallback guidance.

Results distinguish document identity/status/money, observed debit-credit consistency, bank/customer/sales/tax relationships and completeness. A confirmed observation is explicitly **not** persistence proof, matching authority, available funds or checkout permission. Existing unaccepted N3 contracts remain closed; their synthetic test fixtures are not live acceptance. The CBE handover does not establish OR amount/Update semantics and none were inferred from its PI field names.

## Independent review and one fix pass

One reviewer assessed `930a041..32ef2173f3617142d17b276c8e9d3769c2f7577a`. Three Important findings, no deferred Minor findings:

1. HTTP and checker deadline timers raced, discarding the waiting packet. The bounded HTTP preflight now transfers the same absolute deadline to the runner, which returns the safe packet. HTTP plus real-runner stalled-journal regression: RED 503 → GREEN waiting/null money/retained references. Navigation cancellation remains separate.
2. Unknown bill/balance creation identity discarded earlier durable references. Attempts are populated after private scope validation and known references are retained before incomplete target construction refuses reads. Two RED → GREEN tests; zero network reads and no optimistic money.
3. Initial/background metadata failures falsely implied no intent and omitted 401 session recovery. Successful empty metadata is now distinguished from failed reads. Both GET and POST failures use session recovery; stale checker results are hidden. Three mounted DOM tests reproduced initial 401/503 and background 503, then passed after the fix.

An additional RED → GREEN test keeps 401 dominant and bounds the response even if the existing session cleanup/audit hook stalls or fails. No second independent re-review is claimed.

## Verification

| Check | Fresh observed result |
| --- | --- |
| Full Vitest, isolated DOM lane enabled | 2,767 passed / 38 skipped, zero failed; 187 files passed / 4 skipped; exit 0 |
| Task 2 and related API/verification regressions | 165 passed in 9 files; exit 0 |
| New checker/HTTP/render/transport/mounted cases | 36 passed; exit 0 |
| TypeScript | `npx tsc --noEmit`, exit 0 after correcting a test-only indexed-property type |
| Changed-file ESLint | exit 0 |
| Production build | exit 0; final Nitro outputs confirmed |
| Whitespace and protected files | clean; AGENTS, package/lock, start, integrations and hotel-store unchanged versus main `6ac17dee` |
| Native SQL | Not repeated: no schema/SQL change. Earlier accountant foundation retains its separately attributed 13 + 6 PostgreSQL 17.6 CI evidence |
| Real browser/mobile/print, installed RPC/types, signed-in N3 | **NOT VERIFIED** in this source-only continuation |

Raw excerpts and command results: [checker evidence](evidence/HH_SAVED_DOCUMENT_CHECKER_CHECK_OUTPUTS_20261012.txt). Complete outputs, RED counterexamples and task ledger remain preserved in the plan workspace.

Mounted tests use synthetic same-origin responses and isolated Happy DOM 21.0.1; no real N3 or Lovable database calls. App dependencies and lockfile are unchanged. They are optional in a normal checkout and execute when `HH_UI_DOM_PACKAGE` points to that isolated package's `lib/index.js`; without tooling the three mounted tests skip. The full result above enabled them. To reproduce, install `happy-dom@21.0.1` outside the app with no app manifest/lock changes, set the environment variable, then run `npm test`.

## Decisions and remaining lanes

- Reuse existing private validators and extend the fixed GET transport with optional shared limits; avoid introducing a second provenance implementation. Cost if wrong: regressions in existing readers, covered by retained transport/API tests.
- Add Owner GET metadata selection so selecting a booking does not trigger settlement polling. Cost if wrong: an extra local metadata endpoint; no financial mutation.
- Transfer deadline ownership after bounded preflight to preserve the recovery packet. Cost if wrong: the runner must finish stalled work itself; integrated tests cover that boundary.
- Earlier evidence/case foundations retain their independent review; Task 4 close and Task 5 accountant report/export remain pending. Live contracts/schema and real-browser acceptance are separate unverified lanes. Pre-existing verification/proof tool behavior is preserved except the checker auth interaction; no general acceptance claim is made.
- Preserve the existing plan workspace and raw evidence under the Owner's recovery instruction; do not delete prior work as skill cleanup.

Backend is managed through the existing Lovable project. The Owner has no separate Supabase account and must never be asked to create/use one. Fresh SELECT-only ledger still reports latest `20261003120216`; accountant migration `20261012032508` is absent. No operational migration, database repair, N3 call/write, main merge, deploy/publish, Lovable AI Build or BEC action occurred.

Normal receipt editing stays OFF. The original OR2610/001 exception is not resolved by this checker. Existing ordinary-flow fixture and OR2610/002 proof jobs were not repeated.

Next approved source tasks: revised zero-outstanding guest close with exact linked accountant cases and atomic all-room Dirty/DND-off handoff; mounted Owner report/export and reader refresh; source-issued OTA/guest legs, Settings/booking/master lifecycle and editable attribution. Installed backend/RPC parity, accepted real document/master contracts and mobile/print/UAT remain necessary before activation. 20/10 training and 01/11 launch remain targets, not certified readiness.
