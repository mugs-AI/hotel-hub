# HotelHub bounded receipt journal binding candidate

Checkpoint: 03/10/2026 UTC. Status: TESTED REVIEW CANDIDATE; not merged or published.
Repository: `mugs-AI/hotel-hub`.
Review branch: `review/hh-receipt-diagnostic-20261002`.
Implementation parent: `37f5d00f26c99eb3e6f484e278766dfdf8863391`.
Fresh remote main and Lovable latest: `7449e9cdf4e3afa750396af7e808f0c0e11f4e0d`.
Main tree: `802053dab9ca3e1fe2c8d209929fe9ac7a139e61`.
Exact candidate: the Git commit containing this record; resolve the review ref
before any merge and compare its tree with the tested files.

## Owner decision and verified cause

The Owner explicitly approved implementing/testing the bounded design in
`HH_RECEIPT_JOURNAL_BINDING_REVIEW_20261003.md`. DirectBuild remains authoritative
over older Lovable-only development instructions. No Lovable AI message was sent.

The signed-in Owner popup for BK260920001 / OR2610/001 reports
`journal_row_doc_code_missing` and `journal_row_doc_code_null`. This confirms
an unresolved supported document-number field classified as null. It does not
capture the raw GLPosting response or prove endpoint response semantics. Original
deposit verification did not require row document numbers; receipt controls do.
The published diagnostic exposed that existing distinction rather than adding it.

This candidate accepts only explicit JSON null under a new, Owner-approved
application evidence rule. It is not a claim of a vendor guarantee. The official
GLPosting contract still has a generic response shape; live response acceptance
remains unverified. No earlier successful request is required to open the dialog.

## Implemented evidence rule

The server loads the saved tenant-scoped immutable receipt UUID, receipt number
and HotelHub reference. It validates receipt detail, then obtains the journal
through the fixed ARReceipts GLPosting GET with that UUID and authenticated token.
A private transport WeakMap records provenance on the actual returned object;
JSON flags, copied responses, another key or another token cannot confer binding.

Only explicitly null supported document-number aliases can use that provenance.
Absent, blank, malformed, conflicting or incorrect aliases remain refusals.
Every row still requires the exact HotelHub reference, exact payment-account
debits and amounts, and one exact customer AR credit. Accounts/amounts are checked
against the currently verified N3 receipt payment lines, so approved manual
corrections do not compare against stale creation amounts.

If all checks succeed under correlated proof, a second receipt detail GET must
validate and match the first payload. Changed content, business/HTTP errors,
malformed bodies, connection loss or timeout refuse the result. The fingerprint
includes the binding method, immutable UUID and actual journal identity evidence.
Unbound parser calls retain strict document-number checks. The shared evidence
reader covers request, approval preflight, manual Verify and monthly verification;
there is no booking-specific bypass or automatic financial execution.

Source changes: `src/lib/n3-receipts.server.ts`,
`src/lib/receipt-controls-evidence.server.ts`, and the new
`src/lib/__tests__/receipt-journal-binding.test.ts`. Contract/design/checkpoint
and evidence documentation accompany them. No UI, dependency, auth foundation,
schema, migration, environment variable or write endpoint changed.

## Engineering evidence

Tests preceded implementation: initial synthetic null-binding reproduction had
15 expected failures / 16 passes; additional invalid-alias cases had 3 failures /
35 passes with exit 1 before the corresponding refusal was added. These are
hand-authored fixtures, not captured live N3 JSON.

| Gate | Result |
| --- | --- |
| Full Vitest | 1,921 passed / 20 skipped / 0 failed; 120 files passed / 3 skipped; exit 0 |
| TypeScript | `--noEmit`, exit 0 |
| ESLint src | 0 errors / 37 existing warnings, exit 0 |
| Prettier src | All matched files formatted, exit 0 |
| Production Vite build | Nitro/Cloudflare worker built, exit 0; not deployed |
| Independent focused review | 95 tests passed, including all 42 binding cases; no Critical or Important findings |
| Protected foundation | Matches `a68664f56e38bfb74e32972c14becdc6e6938449`, exit 0 |

Protected comparison includes AGENTS.md, package.json, bun.lock, src/start.ts,
src/integrations and src/lib/hotel-store.server.ts. Established N3 authentication
remains unchanged. Test credentials/live-write flags were unset; new transport
tests mock HTTP and reject unexpected operations. No live financial test ran.
Commands, exit codes and log excerpts are committed in
`evidence/HH_RECEIPT_JOURNAL_BINDING_GATES_20261003.txt`.

Limitations: explicit-null acceptance adds one detail GET per eligible receipt.
Full payload comparison can conservatively refuse nonfinancial or volatile-field
changes. Row ordering can change the correlated fingerprint and require review.
Inherited receipt-date validation checks ISO shape rather than calendar validity;
independent review recorded this as a separate P2 follow-up, not changed here.
Fixture success does not prove this live receipt will pass.

## Locked targets and independent lanes

Lovable project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`, workspace
`JRQygHE7tZl2GgPN8a8N`, freshly returned ready/agentFinished with main SHA above.
Prior read-only Git settings explicitly established main as the synced branch.
The active backend is the previously inspected Lovable Cloud PostgreSQL backend;
configured reference `fkakhdzelilnejyehwfk`. No isolated staging DB was observed.
Current application server code uses TanStack Start/Nitro/Cloudflare hosting;
Git merge is not runtime/public deployment. See the recovery checkpoint and
diagnostic-publication evidence for actual backend catalog and release reads.

No backend operation was performed during this implementation. Applied receipt
migrations `20261002053219` and `20261002053302` were previously verified against
actual history/schema and were not reapplied. Last separately recorded backend
read retained the original posted MYR50 and zero receipt-control records. This
is historical read evidence, not a fresh N3 financial readback in this turn.

Current public diagnostic source is main above; last verified public deployment
is `8a1963c0-9456-4b0a-82ff-cb86abc95d41`. This candidate is not that deployment.
No code merge, database change, function deployment, secret change, publication,
N3 request/approval/edit/void/refund or external alert occurred in this lane.

Automatic N3 edit/void/replacement and alerts remain disabled; a cancellation
flag does not prove cancelled journals. Sales/Collections remain Unavailable.
Monthly receipts retain N3 dates and the >100-candidate Unavailable boundary.
Reservation and Prepare Checkout retain their different cards.

## Next exact gate and live acceptance

Present this exact review commit for code-only merge approval. Before merging,
reverify remote main, review SHA/tree and Lovable sync, and stop on content drift.
Then verify merged source/sync and preview. Runtime/public publication requires
its separate explicit approval; neither merge nor fixture checks establish live.

After an authorized publication, the Owner can open the same correction dialog
without sending anything. Confirm evidence loads, warning is cleared only when
the checks pass, and the original receipt remains MYR50 with no new control row.
Do not ask for N3 credentials or perform N3 login on the Owner's behalf. Any real
Send Request, approval or accounting transaction needs its own agreed scope.
P1 remains open until signed-in live acceptance is recorded.
