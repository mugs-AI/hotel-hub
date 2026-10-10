# HotelHub deposit verification checkpoint

Version: 1.0 — 30/09/2026 (Malaysia)
Status: PARTIALLY ACCEPTED — local engineering verified; tenant API/live acceptance pending.

- Repository: `mugs-AI/hotel-hub`.
- Local branch: `agent/hh-deposit-verification-recovery`.
- Recovered input: `a92d9234f8aceaa34c6e4a34976d8956225f3ef4` (preserved in the original worktree).
- Reviewed first correction: `3a1985b90275286c43f9afa1dcb9763f5cc2ccdb`.
- Final code candidate: `b8f36149c4496eecda6b3fae955077d8504d83f9`.
- Current remote main observed: `9a987156d95896c22cc10162321ff1d65fbb723d`.
- Finance-specific formally accepted checkpoint remains `75ceac11089936778b672c438d3a103b4715609a` (mapping parity only).
- Current exact deployed SHA: UNKNOWN; not inspected during this build.

## Authorized correction

Only deposit confirmation and GET reconciliation were changed. Existing identity, roles, tenant filters, durable intent claim, payment selection, UI, routes, migrations and generated types were preserved. The correction changes three code/test files: `deposits-store.server.ts`, `n3-receipts.server.ts`, and `run-5d1-1-deposits.test.ts`.

Create success is an identity candidate, not proof of posting. Receipt detail and its GLPosting must prove the exact identity, reference, customer, currency, amount, chosen payment accounts, fully unapplied outstanding, and balanced selected debits/customer credit. Missing, cancelled, inconsistent or unreadable evidence remains unknown, retains known N3 identity, and cannot authorize a second Create. Saved identity is preferred for recovery; reference discovery requires a unique match. Currency defaults must prove the stored property/reservation currency before a new financial side effect.

## Verification and independent review

- Baseline: 1,496 tests passed, 20 skipped.
- Final focused deposit suite: 62 tests passed.
- Final whole suite: 1,525 passed, 20 skipped across the same three existing live-database suites (`provision-owner.sql`, `reservations.sql`, `reservations.schema.sql`). No live DB checks ran.
- TypeScript and production build passed.
- Full-project lint: zero errors, 28 warnings on unchanged paths. Changed-file lint and formatting passed. Diff whitespace check passed.
- Initial regression run: 16 failures reproduced missing financial read-back/unique-discovery checks before their correction.
- Independent review found account/money alias conflicts and hidden duplicate reference casing; regression tests demonstrated the failures and passed after correction. Malformed snapshots and currency-before-Create checks were also fixed with failing tests first. No review findings were deferred.

## Limits and next gate

No push, merge, Lovable action, publish, deployment, database change, N3 operation, credential or feature-flag change occurred. The actual tenant's `/New` currency evidence, receipt detail and GLPosting response shape remain unverified. Unsupported/missing evidence blocks confirmation; fixtures are not live proof. Recovery also relies on current verified N3 defaults matching the stored currency and on existing immutable payment snapshots; it does not guess missing historical metadata.

The branch inherits four earlier local commits (receipt-print work, formatting, and incomplete checkout helpers). They are not accepted by this deposit-only correction and the branch must not be merged wholesale. Cash Sale, allocation, balance receipt, refund and final checkout remain incomplete and unreleased. A deposit-only candidate against freshly inspected main and controlled Owner-operated sandbox evidence are required before release.
