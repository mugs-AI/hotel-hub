# Independent deposit module controls — recovery checkpoint

09/10/2026, Asia/Kuala_Lumpur. Upload to Project Sources: **No** — repository engineering evidence.

## Authorization and scope

Owner approved two independent Room Advance Payments/Refundable Security Deposits
collection switches, reaffirmed at14:09 Malaysia time. Native implementation
preserved the existing billing branch and completed foundation work. This package
prepares controls and advance enforcement; it does not implement the security
cash custody workflow, accountant cases or separate OTA billing legs.

## Verified input and target

- Worktree `/workspace/scratch/87b64e9e3850/hh-billing`, branch `review/hh-n3-billing-20261008`.
- Input `ea294e6c1853e7fafddfad9f3c42a02309d84686`; implementation `a210ea7a569be142449b86906964799d1ca84098` before final review.
- Remote review input `e67cff5e31b3a59e70b119c6575e5a5f5b2bbf87`; its tree `33f88a800418f8a88ee5882c8241d98018bd3bcb` matches local pre-amendment `d8a0316`.
- Fresh remote main and Lovable latest both `974cb476e95d2b99c4b3236969d06719130209b5`; Lovable ready, agentFinished=true. No Lovable AI Build requested.
- Lovable project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`, workspace `JRQygHE7tZl2GgPN8a8N`; existing Supabase backend `fkakhdzelilnejyehwfk`, operational database, no separate staging proven.
- Fresh SELECT confirms policy and security-holding tables absent; newest applied migration `20261002053302`. No operational migration was applied.

## Implemented candidate

Settings → Deposits has independent boolean controls and server-versioned saves.
All four policy combinations are valid; defaults preserve existing advances and
leave security off. Owner settings cannot activate a missing security capability,
an N3 financial contract or a refund writer. Missing policy schema disables saving
while retaining the old advance behavior. Other policy read errors deny new
collection rather than guessing enabled.

Advance creation checks current policy before N3 preflight and again at its durable
SQL INSERT claim. The claim and settings update use the same tenant transaction
lock. A claim acquired before disable may finish; disabling cannot cancel already
dispatched money. Same-key recovery returns the existing row without a second POST.
Cross-reservation key reuse is rejected. Deposit listings retain existing rows even
when policy is unavailable and hide new collection capability. Checkout payment,
matching and GET recovery paths do not consume a collection switch.

The additive migration `supabase/migrations/20261009061704_hh_deposit_module_controls.sql`
was generated using Supabase CLI2.120.0. It creates service-only policy/audit tables,
RLS, explicit grants/revokes, version CAS and the advance-claim trigger. Actor and
tenant are server-session bound. Settings audit events are committed atomically
with policy changes. Application packages/lockfiles, integrations and protected
hotel-store were not changed.

## Verification

- Clean starting baseline: `npm test` — **2280 passed,20 skipped**, exit0.
- New policy/store tests: **24 passed**, watched missing implementations fail first.
- Settings API/render and advance integration tests: **126 passed** (includes existing regressions). New denied-collection/scope/claim tests failed before implementation.
- Final full suite: `npm test` — **2330 passed,20 skipped**, exit0. Skipped suites remain the existing staged receipt/folio tests; they are not new success evidence.
- `node_modules/.bin/tsc --noEmit` — exit0 after route generation and correcting the CardHeading interface.
- `npm run build` — exit0, generates the new route registration; no publish/deploy command executed.
- Changed-file ESLint —0 errors,1 existing `react-refresh/only-export-components` Settings warning, reproduced against the input version.
- `node db/checks/hh-deposit-module-controls.mjs` — PASS against disposable embedded PostgreSQL: four modes, stale versions, denied claims, preserved rows, audit atomicity, RLS and grants. No live DB connection.
- **Multi-session native PostgreSQL scheduling NOT VERIFIED.** Embedded checks do not prove concurrent lock ordering under deployment load.
- Static React render tests verify two labelled switches, pending security state and preserved checkout/return explanations. Three additional real React/QueryClient/DOM interaction tests PASS: successful save, stale-save refetch and Owner identity switch during a delayed PATCH. These failed against the preserved pre-review implementation first. Native browser download was unavailable; live signed-in/mobile acceptance NOT VERIFIED.
- Fresh independent review found no Critical issue; identity scoping was Important and feedback disappearance was regraded Important. Both were corrected in one RED→GREEN pass; final full suite and affected checks passed. No second reviewer dispatched.

## Final review corrections

Final code candidate `f1094c84df4408deb759556967e8608c0e6a982d`. Policy queries and editors now use the verified tenant/user/role identity; sign-out and auth-transition purge include policy data. Old GET/PATCH responses are aborted or ignored. An expected-identity header is checked against the server session before saving, including version-0 policies; it is only a precondition and never grants tenant authority. Feedback lives above the version-keyed editor, so both save confirmation and conflict explanations survive refreshed data.

Reproduce optional SQL/DOM checks with isolated test tools (no application package changes):

```bash
npm install --prefix .superpowers/sdd/2026-10-09-deposit-module-controls/sql-tools --no-audit --no-fund @electric-sql/pglite@0.5.8
npm install --prefix .superpowers/sdd/2026-10-09-deposit-module-controls/ui-tools --no-audit --no-fund jsdom@26.1.0
node db/checks/hh-deposit-module-controls.mjs
node_modules/.bin/vitest run --config scripts/verification/hh-deposit-module-ui.config.ts
```

## Urgent receipt correction

Fresh read-only database inspection still shows OR2610/001's existing RM50→RM65
request `d79ccc11-86ae-4730-b07d-4770e604f833`: manual, needs_review, version12,
`n3_result_mismatch`. This is saved HotelHub evidence, not a fresh N3 API readback.
No successful correction is claimed. Preserve the same receipt/request and use
the documented same-document N3 amendment plus HotelHub Verify N3 change. Never
create another OR or reclassify the amount as security cash to hide this mismatch.

## Remaining work and release lanes

1. Complete security custody: cash-only collection, SD series/receipt, room-stay identity, inspection, two-step physical return, deductions/transfers, shift counts and carry-forward reports.
2. Implement the already approved accountant case/read-only checker and separate OTA/guest billing plans; completed settlement foundations must not be repeated.
3. Verify native concurrency and actual target schema before operational installation. Security activation stays unavailable until its own workflow exists.
4. Review/main merge, actual backend migration/type parity, public publish and signed-in acceptance remain separate checks. This candidate is not live.

No N3 write, migration application, main merge, public publication or deployment
occurred while preparing these controls. SQL preparation and a local build are not
those operations. Review-branch checkpoint status is appended after verification.

## Decisions recorded during execution

- Extracted the approved source Task1 switch amendment into a separate dependency plan; later source integration may require an adapter.
- Applied the existing Owner approval/native method without another approval question; code remains review-only and operational behavior unchanged.
- Durable claim is the authorization boundary; already requested payments may finish after disable, stated in Settings.
- Embedded PostgreSQL substitutes for missing native tooling for behavior checks only; live installation must retain the concurrency verification gate.

## Final review scope decisions

The reviewer deliberately excluded the complete custody workflow; its reports/accounting/source-billing integration; the existing disputed OR; operational migration/roles/N3/public release; comprehensive re-audit of unchanged checkout/recovery/report/auth code; and final evidence/remote checkpoint. The executor retained custody/report/source work as separate approved tasks, kept the OR unresolved until real verification, kept live installation/release pending, used the existing full suite as regression evidence rather than live acceptance, and owns the exact-tree remote checkpoint below. The cost of these decisions is the remaining work and verification explicitly listed above.

The lost save/conflict feedback finding was regraded Important because Owners need a clear save outcome. It was fixed together with identity scoping. No deferred Minor finding remains. Local test server was stopped; tests/build/review have ended. Existing worktrees remain preserved.

Review branch only: this file accompanies the final candidate tree. Verify the enclosing Git commit for its exact remote SHA; local and connector-created commit metadata may differ while their trees match. No main merge or deployment is implied by that checkpoint.
