# HotelHub normal receipt Edit — reviewed UI candidate, 11/10/2026

This is a source/release checkpoint, not an additional Project Source upload requirement.

## Outcome

The existing receipt update pipeline is preserved. No deposit rebuild or repeated N3 proof.
The normal Edit dialog now:

- Shows the fresh N3 original amount and initializes the amount/account/contact from the successful post-mount receipt read.
- Keeps same-identity cached preview visible, but blocks sending while loading, offline-paused, failed or changed evidence.
- Requires closing/reopening if N3 details change while the draft is open; no silent draft rebase.
- Retains the returned outcome instead of closing silently: verified change, pending approval, or held/needs-review result.
- Gives explicit Owner Dashboard next steps and do-not-resend guidance after a lost submission response.
- Uses a neutral **Save change** label because property policy can request approval or permit authorized Owner direct save.
- Locks a completed/uncertain submission and synchronously blocks rapid double clicks.
- Preserves saved N3 contact on amount-only edits.

Late decision/submission callbacks are fenced against signed-in identity changes. Owner approval remains one click with the expected request version. There is no optimistic deposit/folio total change.

## Exact bounded scope

Four existing product/test files and two isolated mounted-test files are changed, plus this checkpoint. Backend execution, transport, policies, SQL, proof packages and runtime flags are unchanged. Baseline bytes for all four existing files were independently compared with GitHub main `edb599b9484b72e24021194bea3ac7b458ebe889` and matched.

Local base: `1f475c3299e52499d655709582e8a1a510a317a8`.
Review branch: `review/hh-normal-receipt-acceptance-20261011`.
Unrelated dirty documents, prior evidence and the separate billing/security-cash worktree are preserved.

## Verification

| Check | Fresh result |
|---|---|
| Whole repository `npm test` | 2,235 passed; 38 skipped; zero failed |
| Mounted normal Edit/approval | 15 passed |
| Mounted second-session revision refresh | 5 passed |
| Mounted controlled-proof/recovery screen | 8 passed |
| TypeScript `npx tsc --noEmit` | Exit 0 |
| Changed-file ESLint | Zero errors; four existing fast-refresh export warnings |
| Local production build | Exit 0; client, SSR and Nitro final generation confirmed |
| Independent bounded review | No unresolved Critical/Important findings |

TDD captured expected failures for stale amount, cached refresh failure/loading, discarded outcomes, late account-switch callbacks, lost response, rapid double click and offline-paused evidence. Review's offline finding was reproduced RED, fixed once, then independently confirmed with 15/15 mounted tests.

The isolated DOM tests require the already-prepared jsdom tools at `.superpowers/sdd/2026-10-03-automatic-receipt-correction/dom-tools/package.json`. Run explicitly:

```sh
npx vitest run --config scripts/verification/hh-receipt-edit-ui.config.ts
npx vitest run --config scripts/verification/hh-receipt-revision-ui.config.ts
npx vitest run --config scripts/verification/hh-receipt-proof-ui.config.ts
```

These mounted suites are not part of the default `npm test` count and do not establish clean-checkout DOM-tool provisioning. That minor tooling limitation is documented, not hidden; protected package/dependency files were not expanded.

## Operational limits and next step

- Normal automatic editing remains OFF. No normal-workflow live acceptance is claimed.
- No N3 write, database change, migration, merge, publication or deployment occurred while preparing this candidate.
- OR2610/002's prior same-receipt RM65 -> RM50 -> RM65 successful designated proof is retained as historical evidence; it was not rerun here. Remote atomic conditional write remains `not_proven`.
- OR2610/001 / BK260920001 remains the separate legacy manual `needs_review` request. This candidate does not amend, convert or duplicate it.
- Release this UI-only candidate with normal editing still OFF first. A separate explicitly bounded normal-workflow activation/UAT packet must specify tenant, eligible linked test receipt/reservation, role/policy cases and recovery/rollback conditions before any financial click.
- Do not reuse the expired/completed controlled-proof package or ask the user to repeat the earlier seven proof steps.
- BEC remains recorded in existing Project Sources and the saved launch roadmap; this task does not implement BEC or move it ahead of core priorities.
- User deadline remains 20/10/2026 hands-on delivery/training/UAT and 01/11/2026 client use.

User action while this is awaiting release: no test clicks and no N3 changes. No extra upload to Project Sources is needed for this technical checkpoint.
