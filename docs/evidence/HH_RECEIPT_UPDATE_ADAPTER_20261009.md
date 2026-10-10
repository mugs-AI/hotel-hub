# Same-OR receipt Update adapter — 09/10/2026

Upload to Project Sources: No — repository validation and continuation evidence.

## Scope and approval

Owner approved all following the urgent OR2610/001 / BK260920001 RM50→RM65 correction and request to follow Custom Bill. This bounded change reuses the existing automatic receipt coordinator and parked worktree. It does not recreate the billing/security-cash package, mutate any receipt, or retroactively execute the old manual request. All unrelated dirty work is preserved.

## Diagnosis and reference

The published application creates AR receipts but its legacy correction action only verifies a manual N3 change. The parked automatic adapter also returned a hard-coded null production contract and assumed synthetic concurrency fields. These are HotelHub implementation gaps, not proof that N3 cannot update receipts.

Inspected Custom Bill repository: mugs-AI/n3-custom-bill-entry, src/routes/api/bills/update.ts, captured main tree f626cac35e03e2cab243d51904a1a8d3a125244d. It reads and preserves the existing PurchaseInvoice and detail IDs before Update. This is a reference pattern, not live ARReceipt acceptance evidence.

Inspected QNE sales-v1 schema: POST /api/ARReceipts/Update, both confirmedForBankRecon and confirmedForKnockOff false. ARReceiptDto.updatedAt is int64; ReceiptMultiPaymentDto.id is int32. The captured DTO does not document a compare-and-set token or isReconciled flag.

## Changes

Three adapter files only: n3-receipt-update.server.ts, n3-receipt-update-fields.ts, and n3-receipt-update.test.ts.

- Documented strict allowlists replace the synthetic-only production blocker.
- Same-account MYR amount/contact correction preserves receipt UUID, OR number, raw date-time, reference, customer, currency, numeric payment ID and unrelated fields.
- Updates supported main/local totals and the one payment amount; refuses unknown fields, matching, refunds, cancellation, nonzero or malformed tax/bank-charge/rounding companions, split payment and account replacement.
- Immediately before the one Update POST, performs a bounded fresh GET and compares a canonical full-source digest. Any observed outside change refuses dispatch.
- Keeps both N3 override flags false. No assumed safe rejection codes and no financial POST retries. Existing coordinator still requires receipt and exact journal readback before local effective totals change.
- This is not upstream atomic CAS. An outside edit between the final GET and POST remains possible; conflicting post-readback stays held.

## Fresh validation

Clean committed baseline b4a783f3ba3a90a743905ea65374e36e8f4297a7 exported solely for validation; existing worktrees were not reset or cleaned. Only the three adapter files were copied into that export.

| Check | Result |
|---|---|
| Initial documented-contract regressions | RED: 3 failed, 19 passed |
| Review date-time regression | RED: 3 failed, 26 passed |
| Local companion regressions after date fix | RED: 7 failed, 22 passed |
| Adapter after fixes | GREEN: 29 passed |
| Clean committed baseline full suite | 2,012 passed, 33 skipped, zero failures |
| Clean candidate full suite | 2,022 passed, 33 skipped, zero failures |
| TypeScript noEmit | exit 0 |
| Targeted ESLint | exit 0 |
| Local production build | exit 0 |
| Changed tracked files whitespace | exit 0 |
| Independent review | Two Important findings fixed; reviewer confirmed 29/29 and both fixes |

The 33 skips include unapplied-schema/native PostgreSQL checks; they are not passes. Running the full suite against the parked dirty worktree instead exposed unrelated existing cache-key changes and a timeout; its type check also exposed an existing ungenerated change-revision route. Those unrelated files were not edited to obtain a green adapter check.

## Fresh operational reads

GitHub main and Lovable source remain 974cb476e95d2b99c4b3236969d06719130209b5. Main does not contain the parked generation-2 workflow. The remote receipt review branch contains the same committed production code as local b4a, plus documentation; it is not the live application.

Read-only HotelHub database query: request d79ccc11-86ae-4730-b07d-4770e604f833 remains needs_review, manual, version 12, n3_result_mismatch, original 5000 cents, proposed 6500 cents. Automatic receipt attempt table is absent. This query is NOT a fresh N3 receipt amount readback and does not establish whether N3 currently has RM50 or RM65.

No N3 read or write, operational database write/migration, main merge, Lovable AI Build, publish, or deployment was performed for this adapter checkpoint. Local tests/build only. Security-cash package remains separate and untouched.

## Remaining work and safe continuation

1. Validate the existing additive automatic-receipt schema with native PostgreSQL, including two-connection dispatch races. The existing ledger reports root/initdb and setuid restrictions; no native server is currently available. PGlite functional evidence alone is not the missing concurrency proof.
2. Finish the existing workflow release candidate against current main, preserving the newer journal reader and all current live changes. Finish the parked UI/session revision work selectively, not by copying its entire dirty tree.
3. Add/review an explicit Owner action for the existing legacy correction (or an audited successor correction request for the same OR). Preserve the manual request history; do not silently change generation, execute background retries, create another OR, or convert the advance to security cash.
4. Install the verified schema and enable only the approved tenant/runtime controls, then perform the approved same-OR Update with an authenticated Owner session. Read the receipt and journal back and prove RM65 before reporting success.

The adapter is verified locally. The urgent receipt correction and whole automatic workflow are not completed or released.

## Verified review push

Local adapter commit: 02dcdc72a51597f72d68afa5d60f0e600f76457d. Remote adapter commit: d73b24a1007f2baaab8ac88753de1638de6ad5ae, parent 853986ed9abcb1ba2452af7ee1e8eb34a959fc14, tree cc04a9ec780dd6550760cdc63e5b6db47721274b, on review/hh-receipt-diagnostic-20261002. GitHub ref update used expected-parent checking and force=false; fresh read confirmed the new head. Remote tree comparison proved exactly the three verified code/test files plus this evidence document changed, with no deletions. Their Git blob hashes match the local verified files. This review push is not a main merge or publication.

All adapter test/type/lint/build processes and the independent review are finished. No background financial job was started. Existing unrelated uncommitted files remain intact.
