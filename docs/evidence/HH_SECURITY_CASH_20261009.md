# HotelHub security cash candidate — 09/10/2026

Upload to Project Sources: **No**. Repository implementation and recovery evidence.

## Scope and checkpoint

Continued the Owner-approved native security-cash specification from clean local
HEAD `a4e7f23955447ab22912f8497b67bec6dc156a60`. Existing deposit controls were
preserved. This package separates security cash from N3 advances, guest bills,
AR matching and the N3 refund setting. Existing disputed OR2610/001 is unchanged.

Implemented candidate: default RM50 per room per stay, independently optional
module, required-collection/Owner-waiver check-in guard, stable room-stay receipt
identity, atomic SD numbering, cash-only collection, saved terms and recipient,
room/key inspection separate from housekeeping Ready, reserved then acknowledged
physical return, Owner reconciliation of unperformed returns, deductions and
physical disposition kept distinct, reasoned count corrections/storage changes,
lost-receipt/recipient authority, unresolved guest-left/dispute cases, evidence-backed
accountant bank-return recording (requires actual notes disposition, no bank writer),
immutable shift counts with second staff signature or single-person Owner review,
variance cases, month carry-forward/as-at reports, local receipts, print/CSV export.
Housekeeping receives an inspection-only reader with no cash amounts; its current
property mode still limits authority. Browser identity changes abort/ignore late
responses. All money/staff/tenant authority stays on the server.

## Verification before final review

| Check | Result |
| --- | --- |
| `npm test` | 2,347 passed / 20 skipped; 150 files passed / 3 skipped |
| `npx tsc --noEmit` | exit0 |
| `npm run build` | exit0 |
| Changed-file ESLint | 0 errors, 9 existing warnings in prior components |
| `node db/checks/hh-security-cash.mjs` | PASS real disposable embedded PostgreSQL |
| `npx vitest run --config scripts/verification/hh-security-cash-ui.config.ts` | 2 real React/QueryClient/DOM interaction tests passed |
| Protected files | No diff: AGENTS, packages/lock, start, integrations, hotel-store |
| Browser/mobile/live print acceptance | NOT VERIFIED; DOM tests are not browser acceptance |
| Native multi-session PostgreSQL scheduling | NOT VERIFIED; advisory locks/unique constraints exercised sequentially in PGlite |

The full suite initially caught a compatibility regression: probing security
installation from an advance authorization path. A dedicated RED test reproduced
it; advance collection now reads its own toggle without probing security readiness.
All 120 focused legacy advance/policy tests and the final whole suite passed.
SQL RED checks also proved payout amount injection rejection, no phantom physical
cash reduction on a bank-only slip, and a single as-at boundary for cash plus its
holding snapshot. Exports neutralize guest-entered spreadsheet formulas.
All checks use disposable databases or fixture fetches, with no N3 financial calls.

## Independently inspected operational lanes

Read-only connector inspection during this package:

- Remote review branch before push: `24071fdc387039861b8493287be2571949b184d8`.
- Remote main and Lovable latest: `974cb476e95d2b99c4b3236969d06719130209b5`.
- Lovable project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`, ready,
  `agentFinished=true`, existing published app. No AI Build request was sent.
- Existing operational Cloud backend: enabled Supabase stack, adopted reference
  `fkakhdzelilnejyehwfk`; no separate staging was established.
- Fresh SELECT: newest applied migration `20261002053302`;
  zero `hotel_security_%` tables; `hotel_deposit_module_policies` absent.
- New prepared security migration `20261009075854_hh_security_cash.sql`
  depends on prepared `20261009061704_hh_deposit_module_controls.sql`.
  Neither has been applied. Never rerun earlier receipt migrations.
- Generated integration types were not fabricated or edited. RPC transport types
  are narrow server-only adapters until actual schema/type reconciliation.
- No main merge, operational migration, function deployment, public publish,
  N3 write, real collection or real cash return occurred in this package.

Public activation requires the reviewed code and actual schema to agree, followed
by signed-in Owner/Front Desk/housekeeping and real-browser print acceptance.
The reviewed cash candidate does not activate pending N3 settlement contracts.

## Work that remains outside this package

Urgent OR2610/001 RM50→RM65 still needs the same existing receipt amended in N3
and the saved HotelHub request verified by GET. No duplicate OR or reclassification
into security cash is authorized by this implementation. Do not claim RM65 is
verified from a local test. Source/OTA two-leg billing and the persistent N3
accountant handover cases remain their approved separate plans.

## Final review fix pass and verified recovery

The initial final review withheld release for six Important findings; custody-staff attribution was regraded Important. All seven were fixed in the existing worktree with failing regressions observed first. No package recreation or new Lovable AI Build occurred.

- Collection compares the displayed cash policy version under the tenant lock. Stale amount/terms are rejected; policy changes reset the collection form acknowledgment.
- Owner may restore a deducted amount to guest-returnable cash without changing physically held notes. Original deduction and dispute history remain immutable.
- Front Desk statement POST, replay and GET share the same redacted snapshot projection.
- Per-envelope shortages/surpluses remain exceptions when aggregate variance is zero. Saved prints show actual counts and individual variances.
- Shift input includes holdings with actual cash, pending returns or open cases; completed zero-cash history remains in reports rather than compulsory count inputs.
- A room move invalidates the old inspection. A pending return is preserved and requires Owner reconciliation or release if unperformed.
- Cash receipts identify the actual collection actor after an earlier Owner waiver.

Fresh final checks: **2,349 passed / 20 skipped**, TypeScript and build exit0, changed-fix lint exit0, original disposable SQL checks PASS, seven review SQL scenarios PASS, DOM interactions2passed, protected-file diff empty, git diff --check clean. Final fix evidence and all execution rulings are preserved in HH_SECURITY_CASH_EXECUTION_20261009.md. Native multi-session PostgreSQL scheduling and real-browser/mobile print acceptance remain NOT VERIFIED.

Read-only reinspection still shows main/Lovable974cb476, latest applied migration20261002053302, zero security tables and no deposit-policy table. Receipt correction remains needs_review/manual/n3_result_mismatch/version12. No new cash module migration, deployment, main merge, publish or N3 write.
