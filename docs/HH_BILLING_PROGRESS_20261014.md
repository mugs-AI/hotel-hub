# HotelHub billing progress and recovery — 14/10/2026

Upload to Project Sources: **Yes** — add this dated recovery reference; retain permanent requirements and the earlier reservation-controls checkpoint as historical evidence.
Status: approved implementation continued; manual no-show source and read-only master capture are implemented and reviewed. **Billing/payment/whole-stay checkout are not complete or live.**

## Exact saved source

Repository: `mugs-AI/hotel-hub`.
Preserved broad branch: `review/hh-reconstruction-20261011`.
Starting checkpoint: `626e482dbbb0dfe45f07b8eeb83af5f6a901c724`.
No-show commit: `ca708e2`; capture preparation: `7bac4a9`.
Final reviewed product source: `e4551c5e129d2e1033a58315bb3ec057734ef363`.
Later documentation commits do not change this product source.

The existing pre-untracked adoption file and Supabase temporary directory remain untouched. No reset, discard or duplication of older billing foundations occurred. All new commits are LOCAL; no review push, main merge, schema/history write, Lovable build request, runtime/env change, N3 call/transaction or publication occurred.

Fresh main/Lovable observation remains `ce4c12d028df33894499b718f162468eb9d638b2`, ready/agentFinished. This is the existing published receipt release, not the broader source above. The backend is still the existing Lovable-managed project; no separate Supabase account is used or required. SELECT-only catalog checks used Lovable. CLI2.120.0 only generated a local SQL file.

## Completed source

- Existing reservation-controls source remains: independent reservation drafts/pending/error state, transparent info triggers, optional Owner Change rate control and expired check-in guard. Earlier test counts are historical; current whole-source results appear below.
- Manual no-show: explicit Front Desk/Owner confirmation and reason, per-reservation draft/pending/result state, current property date after locking, exact header revision, role/tenant/status/allocation refusal, durable request replay and all reserved room release in one transaction. Occupied allocations are refused; deposits and housekeeping condition remain unchanged.
- No-show accounting review binds to its immutable no-show action and retained receipt references, without inventing a settlement intent. Amount remains unknown until accepted proof. These records still require the planned Owner report integration; the whole accountant module is not claimed complete.
- Existing correction rows are stabilised and all five real active receipt states plus outstanding execution claims deny no-show. Candidate migration `20261014011310_hh_manual_no_show.sql` remains **UNAPPLIED**. Native simultaneous check-in/no-show and installed-schema/grants acceptance remain pending.
- Owner current-master capture: fixed GET detail paths for Customer/Currency/Stock/UOM/Tax/Account, caller's own server-held token,20-ID/30-second/1MB bounds, lossless JSON, positive safe scalar/path allowlists and explicit truncation. Rejecting or hanging401 body cleanup cannot launch another read or prevent session termination. No mount-time N3 requests; no contract acceptance or writer activation follows a capture.

## Billing blocker and remaining plan

Plan `docs/superpowers/plans/2026-10-14-billing-completion.md` was approved on14/10 at09:10 Malaysia. Do not ask for design/plan approval again.

Current N3 master-response/inactivity semantics and customer/stock/UOM/tax/posting-account relationships are not accepted. The production snapshot and financial gates remain closed. Public DTOs, earlier journal captures, CBE handover and synthetic tests do not supply these missing current facts. Tasks2–6 cannot be claimed complete. The source/payer coordinator, ordinary staff payment, private external matching, whole-stay close, reporting and final billing acceptance remain the approved work to resume after their evidence preconditions.

Task7's read-only prerequisite has been prepared earlier to obtain actual master observations. Do not repeat the earlier six journal captures. Follow the existing exact financial proof-job manifest for later CashSale/AR linkage, single/split final receipt and allocation-concurrency acceptance. No agent financial test write is authorised. Door access and BEC remain later.

## Narrow deployment packet awaiting authority

Standalone worktree: `/workspace/scratch/cb26166d36cb/hotel-hub-master-capture-release`.
Branch: `review/hh-billing-master-capture-20261014`.
Exact base main: `ce4c12d028df33894499b718f162468eb9d638b2`.
Candidate: `744b4b62302a8523f89aee88477780131234b857`.
Tree: `71e2736dfe396c1f9c819c34128d1038b61cd6dc`.
Ten files: capture service/HTTP/component/route/three tests, pure GUID helper, generated route registration and existing verification-console mount. No no-show SQL, broader billing foundations, package/lock/start/integration/settings projection change. Ordinary receipts remain from exact main.

After scope-specific push/merge/publication approval, publish only this packet through the existing Lovable lane. Verify main/editor/runtime/public independently. Owner opens HH through N3, then Settings → N3 Financial Verification → Current billing master evidence. Enter the exact configured master IDs, capture and download the sanitized JSON for contract review. Captured is not accepted. No N3 bill/payment/match/refund/void/delete is created by this panel. Obtain current live observations before implementing the posting adapter against accepted shapes.

## Final fresh checks

| Check                                                         | Broad source                                                                 | Narrow capture candidate                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Full Vitest, isolated DOM/PGlite lanes enabled                | **2947 passed /22 skipped /0 failed**,208 files passed /3 skipped            | **2356 passed /22 skipped /0 failed**,156 files passed /3 skipped           |
| Typecheck                                                     | exit0                                                                        | exit0                                                                       |
| Build                                                         | exit0, Nitro outputs confirmed                                               | exit0, sequential final build confirmed                                     |
| Changed-file ESLint                                           | exit0,0 errors /1 existing FastRefresh warning                               | exit0,0 errors                                                              |
| Full ESLint                                                   | **307 pre-existing formatting errors**, four unchanged scripts               | **170 pre-existing formatting errors**, two unchanged receipt-check scripts |
| New no-show SQL                                               | 17 disposable single-session cases                                           | Excluded                                                                    |
| Review                                                        | One fresh reviewer;0 Critical,3 Important fixed RED→GREEN, no deferred Minor | Same review/fix content; no second review claimed                           |
| Native race/installed backend/signed-in browser/live N3 proof | NOT VERIFIED                                                                 | Publication/browser/live responses pending                                  |

Full-lint errors are not green. Narrow errors:51 in `db/migrations-pending/checks/receipt-controls.multisession.ts`,119 in `receipt-controls.pglite.ts`; exact unchanged parity against main was checked. Broad additionally has88 in `db/checks/hh-security-cash.mjs` and49 in `docs/evidence/HH_N3_RECOVERY_COUNTEREXAMPLES_20261008.mjs`. Historical check/evidence scripts remain unchanged. Resolve or explicitly accept this formatting debt in the release decision.

Initial standalone verification exposed a missing pure GUID helper; included that exact existing helper and reran the complete candidate suite/types/build. Initial review RED reproduced401 cleanup continuation, exported personal scalar values and no-show correction omissions; all were fixed and both whole suites passed afterward. One parallel candidate-build log lacked terminal output, so its result was not accepted; a fresh sequential build returned exit0 and final Nitro outputs.

## Recorded rulings and costs

1. Skill script resources were inaccessible; use the same manual per-task ledger/brief/base/test/commit record. Cost: automatic bookkeeping is unavailable, so inspect the ledger and commits on resume.
2. Use explicit no-show action-bound review instead of a fabricated settlement intent. Cost: the planned report must merge this additional review lane; do not claim it is already mounted.
3. Advance current-master evidence capture before Task2 adapter acceptance. Cost: billing stays blocked until actual accepted facts are available; do not invent a parser or activate gates from mocks.
4. Native/installed no-show checks remain unverified; exclude its SQL from the diagnostic release. Cost: no live room-release or concurrency safety claim yet.
5. Signed-in browser/current N3/posting/financial Tasks2–6 remain unverified; proposed release is only the read-only capture. Cost: posting/payment/checkout remain unavailable until acceptance.
6. Shared-customer OR ownership and partial financial posting were outside this checkpoint; existing financial gates/foundations were unchanged. Cost: their separate plan proofs are still required before activation.

No deferred Minor findings. The execution ledger is preserved under `.superpowers/sdd/2026-10-14-billing-completion/progress.md`; a committed copy is alongside this checkpoint. Source and diagnostic packet are independently recoverable. Never use the broad branch as a ready-to-merge main release.
