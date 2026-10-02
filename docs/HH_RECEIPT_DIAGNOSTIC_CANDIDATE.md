# HotelHub receipt diagnostic candidate

Date: 02/10/2026, Asia/Kuala_Lumpur.
Status: DIAGNOSTIC CANDIDATE — correction root cause still unconfirmed; not live.
Repository: `mugs-AI/hotel-hub`.
Review branch: `review/hh-receipt-diagnostic-20261002`.
Application input/main/Lovable latest: `33167f94f8667d1b030b7ab562623723630251e2`.
Follow-up parent: `f2ac118ae4aba3c803dfcc3a9b006ea17ec3c84a` (prior notes only).
Exact candidate: resolve the Git commit containing this file.

## Problem and scope

Owner opening correction for OR2610/001 gets `journal_row_doc_code_missing`.
Receipt UI and print prove the original MYR50 exists. Account Journal UI shows
Maybank debit/customer credit MYR50 each and the saved reference. The actual
signed-in GLPosting field shape was not captured. Prior diagnostics collapse
absent, null, blank and invalid fields into one code, and the pre-submit warning
incorrectly sounds like a request was submitted. A prior successful request is
not required.

This bounded candidate enriches the existing safe Owner diagnostic. It does not
fix the correction or relax evidence. Existing `docCode` / `docNo` aliases and
their case/conflict handling stay. No new alternate field is guessed. Missing
row identity is never supplied from receipt detail. Every prior refusal remains.

New fixed reason codes (no upstream values or arbitrary field names):

| Code suffix after `journal_row_doc_code_` | Meaning for unresolved supported aliases |
| --- | --- |
| absent | No supported field present on at least one row |
| null | All present supported fields are null/undefined |
| blank | Supported fields contain only blank text/null/undefined |
| invalid | Supported fields cannot be read as a number/code by the existing parser |

The original `journal_row_doc_code_missing` remains. Multiple row states are
deduplicated. These classifications never change `journalExact` from false to
true. Conflicting document aliases continue to return the prior conflict refusal.
The existing DTO shape and Owner-only projection remain unchanged. Front Desk
still sees no diagnostic reasons and the same blocked verification flag.

Pre-submit warning: “This receipt’s N3 journal could not be verified. Sending is
blocked.” POST errors retain the existing “request was not created” wording.

## Changed application/test files

- `src/lib/receipt-controls-evidence.server.ts`: classify unresolved row number fields.
- `src/lib/receipt-controls-client.ts`: safe plain-language labels for fixed codes.
- `src/components/ReceiptControlRequestDialog.tsx`: correct pre-submit wording.
- `src/lib/__tests__/receipt-journal-shape.test.ts`: presence classes, privacy, aliases,
  conflicts, wrong numbers and coexistence with amount/reference mismatches.
- `src/lib/__tests__/receipt-controls-store.test.ts`: Owner-only projection and
  refusal with zero request/decision/version/execution claims.
- `src/lib/__tests__/receipt-auth-switch-cache.test.ts`: actual rendered warning/label.

Recovery/evidence notes and this candidate record are also updated. No route,
permission, integration, dependency, secret, schema, migration or N3-operation
change. Protected foundation remains identical to baseline `a68664f...`.

## Independent engineering evidence

Tests written first: after fixing one test-double assertion, 8 expected failures
and 68 passes showed missing classifications/pre-submit copy; exit 1. Implemented
minimal code, then focused 76 tests passed; exit 0. This is synthetic reproduction
of the diagnostic gap, not a captured live N3 response.

| Gate | Actual result |
| --- | --- |
| Full Vitest | 119 files passed / 3 skipped; 1,879 tests passed / 20 skipped / 0 failed; exit 0 |
| TypeScript `--noEmit` | Exit 0, no errors |
| ESLint src | Exit 0; 0 errors / 37 unchanged warnings |
| Prettier src | Exit 0; all files formatted |
| Vite production build | Exit 0; Nitro worker built |
| Whitespace and protected diff | Exit 0; no protected changes |

Full commands use Node to run installed Vitest/TypeScript/ESLint/Prettier/Vite
entrypoints, matching prior recovery gates. Relevant DB/N3 runtime credentials
and live-write flags were unset for tests. Existing 20 skips remain intentional;
no live financial tests or N3 POSTs were enabled. The rendered disabled button
also has an incomplete reason field in the SSR fixture, so it is not independent
proof of the journal-only button condition. Service tests independently prove
both Owner and staff requests remain refused. Signed-in browser click UAT remains
pending; the existing disabled predicate itself is unchanged.

An independent read-only reviewer found no Critical or Important issue and
confirmed unchanged exact-journal refusal, fixed-code privacy, Owner-only
projection and no added upstream operation. Reviewer independently ran the
76 focused fixture tests. The SSR disabled-button caveat above is its one Minor
finding; it is documented and does not claim journal-only click coverage.
Exact commands/results are in `evidence/HH_RECEIPT_DIAGNOSTIC_GATES_20261002.txt`.

## Release lanes and next proof

Candidate push is the authorized review/handover lane. Main remains unchanged.
Database migrations are already applied and need no changes. No merge, runtime
deployment, public publication, N3 request/approval/edit/void/refund or alert has
occurred. No Lovable AI message was sent.

Seek exact-candidate code-merge approval separately. Recheck main/Lovable drift
before merge, verify sync and preview, then seek the required publication gate.
The unresolved P1 prevents calling this a completed correction or go-live release.
If a diagnostic-only public rollout is proposed while P1 remains, the Owner must
explicitly authorize that limited rollout; no unrelated release is implied.

After an authorized diagnostic runtime is available, Owner opens this existing
receipt's popup only and returns its fixed safe reason code. That determines
whether supported fields are absent/null/blank/invalid without sharing credentials.
An alternate response location still needs authoritative sanitized field-shape
evidence. Genuine missing identity still blocks requests. No real Send Request
or N3 change is part of the diagnostic acceptance.
