# Same-receipt correction candidate — 10/10/2026

Upload to Project Sources: No. This is repository release evidence.

The existing review branch implements same-document receipt amount/contact Update,
durable one-dispatch claims, verified amount/contact projections, approval Settings,
separate local bill-to changes and cross-session refresh. The Owner test panel uses
server-designated disposable receipts; the package list remains empty. Production
automation remains disabled. CashMemo/Sales Invoice editing is a later delivery.

The current-main journal readers, lossless JSON parser, capture UI and associated
tests were integrated from main 974cb476e95d2b99c4b3236969d06719130209b5. Eleven
files match main byte for byte; the Settings screen combines both sets of changes.
This source integration did not merge main or start a Lovable build.

Independent whole-branch review found five Important issues. Regression tests
reproduced them before the fixes: tightened policy now exposes Approve; original
approval requirements survive policy relaxation in UI and SQL; authorized holds
before dispatch recover through an audited/version-fenced transition; verified
contact flows to deposit/report projections; first bill-to saves include the exact
displayed original fallback; transient revision errors keep polling while auth
failures stop it. An existing SQL fixture that expected policy relaxation to execute
an old proposal was corrected to close the old proposal and create a new one under
the relaxed policy. Existing dispatch/unknown-result protections remain enforced.

Validation at this checkpoint:

- Full Vitest: 2,134 passed / 38 skipped, zero failures. Skips include the isolated
  database cases, which run separately; these are not live acceptance results.
- Separate PostgreSQL WASM: 17 passed / one real native-concurrency case skipped.
- Mounted proof-panel fixtures: five passed.
- TypeScript, production build, changed-file lint and product diff whitespace
  checks passed. Full-repository lint remains 170 formatting errors / 37 warnings
  in unchanged legacy scripts; it is not a clean full-lint result.
- Protected dependency/auth/integration baseline and three already-applied SQL
  files remain unchanged. All unrelated working-tree documentation is preserved.
- Updated native PostgreSQL CI must be read on this exact pushed candidate before
  treating the schema candidate as release-ready. Earlier native runs are historical.

Schema candidate, still UNAPPLIED:
`supabase/migrations/20261003120216_hh_automatic_receipt_controls.sql`
SHA256 `f6d7bdfbdb0586bc50233af6a9f58cb014451c8f714828c6ed8b4ab5b79eb6d7`.

Schema compatibility: new code depends on additive policy/revision/attempt/proof
tables and verified_contact. Apply/verify the exact schema before activating the
new runtime. Missing or inconsistent evidence holds the operation. Old code with
new schema retains the legacy generation fence; it cannot execute generation-2
requests. Disabling capability or reverting source does not reverse any N3 write.

Remaining release evidence: exact disposable test OR designation, schema/RPC/RLS
inspection, source merge/runtime setup, measured hosting budget, Owner same-OR
amount/contact and exact journal readback, signed-in mobile/two-device acceptance,
and public release. Use the already approved documented Update contract; upstream
conditional-write semantics remain not_proven and are not an invented new gate.

The legacy manual amount correction remains its separate audited recovery action.
No live amount is asserted from fixtures. No operational migration, N3 write,
main merge, publication or deployment occurred at this checkpoint. Security cash
remains in its separate worktree and was not modified by this continuation.

Deferred minor: durationMs reports the latest operation, including a read-only
recovery. It is not the original attempt duration or hosting-budget evidence.
