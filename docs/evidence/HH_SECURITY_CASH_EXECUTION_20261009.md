# Security cash execution and final review evidence

Upload to Project Sources: **No**. Repository recovery record.

Recorded 2026-10-09T23:13:07.350523+08:00 (Malaysia).

# SDD ledger — plan: docs/superpowers/plans/2026-10-09-security-cash.md
Start: a4e7f23955447ab22912f8497b67bec6dc156a60, clean review worktree.
Ruling: Continue approved native implementation without a repeated plan approval — the Owner has repeatedly approved this exact security policy and requested faster continuation — a design mismatch requires correction before release.
Pre-flight: Task1 RPC names match Task2 wrappers; Task2 command fields/identity fence consumed by Task3 forms. Task1 emits readiness only after full schema installed; Task3 cannot enable an absent workflow.
Ruling: Required policy defaults true when security module is enabled — matches approved collection-or-waiver check-in flow — Owner may change required=false for optional collection.
Task 1: complete (commits a4e7f23..867b907, tests: node db/checks/hh-security-cash.mjs → PASS security cash PostgreSQL: numbering/idempotency/roles/tenants, check-in/checkout, deductions vs physical cash, two-step return, correction/move, carry-forward/immutable statements, grants/RLS. Native multi-session scheduling NOT VERIFIED.)
Task 2: complete (commits 867b907..eeb2e02, tests: npx vitest run src/lib/__tests__/security-cash.test.ts src/lib/__tests__/security-cash-api.test.ts src/lib/__tests__/deposit-module-store.test.ts src/lib/__tests__/security-cash-guidance.test.ts →    Duration  8.97s (transform 5.09s, setup 0ms, import 8.57s, tests 542ms, environment 23ms))
Task 3: Ruling: Add a separate cash-disposition evidence field for an accountant bank-return exception — a bank slip alone cannot reduce notes held — accepting incomplete evidence would understate the physical drawer.
Task 3: Ruling: Bound saved-statement lists to50 with an as-at cutoff — Owner can select an earlier cutoff to inspect older statements, while all underlying statements and cash history persist — older statements require date selection.
Task 3: Verification: suite2347/20skipped; type/build exit0; lint0errors/9existingwarnings; SQL PASS; real DOM2passed. No operational writes.
Task 3: complete (commits eeb2e02..97d9c0a, tests: node db/checks/hh-security-cash.mjs → PASS security cash PostgreSQL: numbering/idempotency/roles/tenants, check-in/checkout, deductions vs physical cash, two-step return, correction/move, carry-forward/immutable statements, grants/RLS. Native multi-session scheduling NOT VERIFIED.)

Final: Ruling: Collecting-staff misattribution is Important, rather than Minor — custody receipts must name who actually took the cash — wrong attribution prevents reliable accountability. Included in the existing fix pass.
Final: Ruling: Room move during a reserved return preserves the operation and requires Owner reconciliation — no automatic release or payout; changed inspection cannot authorize front-desk confirmation — cost if wrong is an extra Owner review for a legitimate handover.
Final: Ruling: Native multi-session PostgreSQL scheduling remains NOT VERIFIED — embedded tests prove sequential SQL behavior only — undetected concurrent execution risks remain until native acceptance.
Final: Ruling: Browser/mobile print acceptance remains pending — DOM tests cannot establish actual printed layout — device-specific layout problems may remain.
Final: Ruling: Operational migrations, main merge and publish remain outside this candidate package — code-only review does not activate the cash module — users cannot use it live until separately verified activation.
Final: Ruling: Urgent OR correction and existing N3 billing remain separate — do not replace an existing financial receipt with security cash — the urgent correction remains unresolved until exact N3 readback.
Final review: six Important findings accepted, custody-staff attribution regraded Important; no deferred Minor findings. Existing SQL regressions watched fail; pending-room-move regression added and watched fail on missing rejection.

Final: fixed stale collection policy — stale collection policy refuses a changed amount RED→GREEN; UI sends displayed policy version and resets its acknowledgment when version changes.
Final: fixed guest-favorable deduction restoration — guest-favorable dispute restores due without fabricating cash RED→GREEN; original events preserved, full RM30 plus RM20 return and case resolution verified.
Final: fixed statement POST privacy — front desk statement response strips private Owner snapshot events and guest identities RED→GREEN; same projection covers GET and replay.
Final: fixed offsetting envelope discrepancies — opposing envelope discrepancies remain reviewable RED→GREEN; individual exceptions and actual-count print columns preserved despite aggregate zero.
Final: fixed unbounded historical count requirement — completed history is excluded from current count inputs RED→GREEN; archived rows remain in the saved report, arbitrary 10000-entry parser cap removed.
Final: fixed room-move inspection — room moves invalidate previous clearance and preserve pending handover RED→GREEN; front-desk confirmation refused pending Owner reconciliation.
Final: fixed custody-staff attribution — waiver collection receipt identifies actual collecting staff RED→GREEN.
Final suite: npm test 2349 passed/20 skipped; 150 files passed/3 skipped. npx tsc --noEmit exit0. npm run build exit0. Changed-fix ESLint exit0 with no code warnings. Original SQL check PASS; review SQL check seven scenarios PASS. DOM interaction suite 2 passed. Protected files unchanged; git diff --check clean.
Final lane inspection: remote review24071fd, main/Lovable974cb; backend latest20261002053302, security tables0, deposit-policy table absent. Urgent receipt needs_review/manual/n3_result_mismatch/version12. No operational writes.

## Regression results

```text
FAIL stale collection policy refuses a changed amount: Missing expected rejection.
FAIL guest-favorable dispute restores due without fabricating cash: security_invalid_request
FAIL opposing envelope discrepancies remain reviewable: Expected values to be strictly equal:
+ actual - expected

+ 'signed'
- 'variance_needs_review'

FAIL completed history is excluded from current count inputs: security_invalid_count
FAIL room moves invalidate the previous clearance: Expected values to be strictly equal:

true !== false

FAIL room move preserves pending handover and requires Owner reconciliation: Missing expected rejection.
FAIL waiver collection receipt identifies actual collecting staff: Expected values to be strictly equal:
+ actual - expected

+ undefined
- 'desk'


PASS stale collection policy refuses a changed amount
PASS guest-favorable dispute restores due without fabricating cash
PASS opposing envelope discrepancies remain reviewable
PASS completed history is excluded from current count inputs
PASS room moves invalidate the previous clearance
PASS room move preserves pending handover and requires Owner reconciliation
PASS waiver collection receipt identifies actual collecting staff
```

## Final verification output

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> test
> vitest run

The plugin "vite-tsconfig-paths" is detected. Vite now supports tsconfig paths resolution natively via the resolve.tsconfigPaths option. You can remove the plugin and set resolve.tsconfigPaths: true in your Vite config instead.

 RUN  v4.1.10 /workspace/scratch/87b64e9e3850/hh-billing


 Test Files  150 passed | 3 skipped (153)
      Tests  2349 passed | 20 skipped (2369)
   Start at  12:09:58
   Duration  22.21s (transform 16.65s, setup 0ms, import 77.02s, tests 18.02s, environment 33ms)


npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

 RUN  v4.1.10 /workspace/scratch/87b64e9e3850/hh-billing


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  12:10:29
   Duration  1.49s (transform 165ms, setup 0ms, import 907ms, tests 376ms, environment 0ms)

```

Build and TypeScript commands completed with exit 0; changed-fix lint completed with exit 0. Full prior-component lint retains the nine documented warnings. SQL uses @electric-sql/pglite 0.5.8 and UI verification uses jsdom 26.1.0, installed in isolated verification tooling; package/lock remain unchanged. Reproduction: install these tools in a separate directory and set HH_SECURITY_SQL_TOOLS to its absolute path, then run both db/checks/hh-security-cash*.mjs scripts and the security-cash UI verification config. No operational credentials or network are needed for these checks.
