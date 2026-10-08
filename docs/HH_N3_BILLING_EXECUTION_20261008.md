# HH1.0 billing execution checkpoint

Upload to Project Sources: **No**.

# SDD ledger — plan: docs/superpowers/plans/2026-10-08-n3-billing-settlement.md

Approved plan: 853986ed9abcb1ba2452af7ee1e8eb34a959fc14; user APPROVE 08/10/2026 07:55 Malaysia.
Product base: 734ac405c82e653a7098ce0ef22d51586382bd9d. Dedicated branch review/hh-n3-billing-20261008.
Existing hh-review dirty work preserved; native fetch and new sibling worktree succeeded.
Dependency package/bun.lock hashes match; installed node_modules reused without installation/lock changes.
Baseline: npm test -> 1937 passed / 20 skipped / 0 failures, 121 files passed / 3 skipped. Targeted checkout ->115 passed.
Ruling: Existing linked hh-review is parked on unrelated automatic-control work; create the explicitly approved separate main-based billing worktree instead of implementing in that dirty tree — preserves both scopes — wrong choice could mix unrelated release code.
Ruling: Test receipt/bill month behavior in Task10's production source, not a tautological assertion on Task1's fixture dates — no money helper consumes dates — wrong placement could omit period coverage; carry this requirement forward.

Pre-flight: Task1 ->2/5/6/7/9/10 types: shared signatures and integer IDs reviewed; actor uses existing n3UserKey, token server-only.
Pre-flight: Task2 ->3 snapshot: source versions and complete row-set membership must be compared under SQL lock; N3 calls remain outside SQL.
Pre-flight: Task3 ->7/8 store: freeze requires clientRequestId; claim fences never reset on lease expiry; close actor/intent/revision/proofDigest signatures align.
Pre-flight: Task4 ->5/7 transport: bound provenance required; public DTO cannot manufacture journal or proof authority.
Pre-flight: Task5 ->6 VerifiedReceiptBefore includes refunds/prior allocations; separate newly-created vs allocated receipt contexts.
Pre-flight: Task7 ->9 first post_bill may atomically freeze one snapshot; GET never creates intent, no extra freeze click required.
Pre-flight: Task8 ->10 close all rooms atomically; monthly facts are external document dates, not local close dates.

Task1: started, BASE734ac405c82e653a7098ce0ef22d51586382bd9d.

Task1: Ruling: put actor credentials and opaque proof types in settlement-context.server.ts, not browser-safe settlement.ts — prevents accidental credential DTO coupling — later proof producers must also enforce runtime provenance.
Task1 RED:24 assertion failures against stub behavior; initial missing-module failure not counted as behavioral RED.
Task1 GREEN:24 money tests passed; full suite1961 passed/20 skipped/0 failures. Skips: provision-owner.sql, reservations.schema.sql, reservations.sql. Typecheck empty/error-free; affected ESLint exit0.
Task 1: complete (commits 734ac40..6b68de6, tests: npm test -- src/lib/__tests__/settlement-money.test.ts src/lib/__tests__/run-5d3-1-checkout-preview.test.ts src/lib/__tests__/hh-golive-01a-authoritative-checkout.test.ts src/lib/__tests__/run-5d3-2-checkout-correction.test.ts →    Duration  332ms (transform 331ms, setup 0ms, import 452ms, tests 103ms, environment 0ms))

Task2: started, BASE6b68de6aa4d58f20cc9f77e36e3fed1ed58c244a.
Task2: Ruling: server read/master/receipt ports are implemented and tested first; production adapter mounts with Task9 after store/contract guards exist — no unproven live reader fallback — until then this task is an internal foundation, not an end-to-end ready flow.
Ruling: Native Git fetch works but push lacks an authenticated username; persist code on the authorized isolated GitHub branch using the GitHub GitData connector. Local and remote commit SHAs may differ; exact tree parity is the release evidence.

Task2 RED:14 assertion failures against stub;2 further price/contact failures reproduced, then fixed. GREEN:16 snapshot tests; full suite1977 passed/20 skipped/0 failures. Typecheck and affected ESLint exit0. Production adapter remains the explicit Task9 mount obligation.
Task1 remote checkpoint:2d1cd80456178dd42756dd52c2b554e335d362d3; tree b3098a31af55705b76ee277355f20eea10783c63 exactly matches local b7605e9 tree.
Task 2: complete (commits b7605e9..911b061, tests: npm test -- src/lib/__tests__/settlement-snapshot.test.ts src/lib/__tests__/hh-golive-01a-folio-foundation.test.ts src/lib/__tests__/hh-golive-01a-authoritative-checkout.test.ts →    Duration  338ms (transform 296ms, setup 0ms, import 397ms, tests 66ms, environment 0ms))

Task3: Ruling: same-version native PG17.6 binary is available, but container root cannot switch users (runuser cannot set groups, chown invalid); do not bypass PostgreSQL root protections. Use test-only PGlite for single-session SQL correctness; real concurrent PostgreSQL remains NOT VERIFIED and an activation blocker. Test tools stay in ignored scratch, no application dependency/lock change.
