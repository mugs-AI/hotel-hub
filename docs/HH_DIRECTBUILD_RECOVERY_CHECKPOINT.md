# HotelHub DirectBuild recovery checkpoint

Latest design handover: Owner approved the conceptual automatic-correction design.
`superpowers/specs/2026-10-03-automatic-receipt-correction-design.md` is now written
for review, with `evidence/HH_AUTOMATIC_CORRECTION_OWNER_PROOF_20261003.md` and
`evidence/HH_AUTOMATIC_CORRECTION_DESIGN_HANDOVER_20261003.md`. Defaults are deposit
approval ON and contact approval OFF; OFF means authorized direct application,
not an editing prohibition. Direct N3 execution remains Owner-only. Local bill-to
and N3 receipt contact are distinct targets governed by the same contact policy.
No implementation, DB/N3 write, feature activation, merge or public release in
this design turn. Next permitted stage is Owner review of the written spec; after
approval, write the implementation plan. Old manual requests must not auto-run.

Newest requirement: `evidence/HH_AUTOMATIC_CORRECTION_INTENT_20261003.md` supersedes
the previous allow/block option design. Owner wants one-click approval with automatic
N3 Update/readback, or authorized direct application without approval, and independent
deposit/contact controls. This is not yet implemented or activated; architectural
design and Owner-run sandbox API proof precede activation. Existing RM65 remains
an unresolved manual request and must not be automatically replayed.

Latest continuation: `evidence/HH_RECEIPT_VERIFY_AND_EDIT_OPTIONS_DIAGNOSIS_20261003.md`
records Owner rejection of RM60, new RM65 request and five recorded N3 mismatch
results. Owner confirmed no manual N3 change before Verify. New request is Needs
review, with no effective corrected version. Compact approval, visible feedback
and allow/block editing switches are proposed, not built. Billing defaults OFF,
existing deposit corrections ON; DB/apply/release gates remain separate.

Latest release: `evidence/HH_CHECKOUT_FOLLOWTHROUGH_PUBLICATION_20261003.md` records
Owner-approved publication of exact source `734ac405c82e653a7098ce0ef22d51586382bd9d`,
deployment `3480110d-0dd7-4ad1-8ad7-b3843ab39be5`, matched by live HTTP and signed-out
browser smoke. Signed-in Late Checkout and completed manual N3 correction/Verify
acceptance remain pending. Read-only SQL confirms posted MYR50, manual request
approved_awaiting_n3 and zero executions/verified versions. No DB or N3 writes.

Latest code merge: `evidence/HH_CHECKOUT_FOLLOWTHROUGH_MERGE_20261003.md` records
Owner-approved exact source `734ac405c82e653a7098ce0ef22d51586382bd9d` merged to
main and synced to Lovable, with a fresh 1937 passing tests / 20 skipped. Its
pending publication state is superseded by the release record above. The frozen build/review evidence is
`HH_CHECKOUT_FOLLOWTHROUGH_CANDIDATE.md`. The receipt still awaits manual N3
completion and verification; the latest read-only SQL is recorded in that
candidate. The Owner-uploaded `HH_CHANGE_IMPACT_MAP.md` was compared byte-for-byte
with the repository and matches. Merge evidence is not a Project Source upload.

Latest continuation: `evidence/HH_OWNER_RECEIPT_AND_LATE_CHECKOUT_20261003.md`
records Owner-observed request creation and approval, confirmed by scoped SQL.
The request is approved_awaiting_n3; manual correction and Verify remain pending.
It also records the Late Checkout date/error diagnosis and change impact map.
`evidence/HH_RECEIPT_JOURNAL_BINDING_PUBLICATION_20261003.md` records the preceding
Owner-approved code merge/publication and verified live deployment. Implementation and
engineering checks are in `HH_RECEIPT_JOURNAL_BINDING_CANDIDATE.md`. The entries
below are historical recovery observations, superseded by those current records.

Version: 1.0. Date: 02/10/2026, Asia/Kuala_Lumpur.
Status: engineering baseline verified; Owner receipt/journal UI evidence captured;
diagnostic-only source candidate tested; signed-in API field shape NOT VERIFIED.
Input/main source: `33167f94f8667d1b030b7ab562623723630251e2`.
Input tree: `2c366e4fe07a8a9e62136fdfdbc0739631c041af`.
Review branch: `review/hh-receipt-diagnostic-20261002`.
Candidate SHA: the Git commit containing this document (safe diagnostics only).
Latest formally accepted complete product SHA: NOT re-established here. Main
and a successful build are not formal acceptance.
Historical reported deployed source: `33167f94f8667d1b030b7ab562623723630251e2`;
deployment ID `4c4a14c1-991a-4e6f-88bc-c2b2b8b5b588` is Owner-supplied historical
evidence, not freshly verified exact serving identity in this recovery.

## Current verified state

- GitHub repository metadata: `mugs-AI/hotel-hub`, default branch `main`.
  `git ls-remote` and connector branch read agreed on input SHA. No open PRs.
  Combined commit status returned no statuses; this is not CI success evidence.
- Lovable project/workspace matched the locked IDs in governance. Project API
  returned latest input SHA, `ready`, `agentFinished=true`. Recent messages and
  edits were completed. No concurrent AI operation was observed; this is a
  point-in-time observation, not a lock against future work.
- Settings → Git → GitHub explicitly showed repository `mugs-AI/hotel-hub`,
  branch `main`, “In sync with GitHub” and “same commit”. Credits displayed 24.9.
  No AI message was sent. Opening settings was read-only.
- Fresh workspace had no old checkout or changes to recover. A clone and linked
  review worktree were created at the verified input. No old changes discarded.
- `git diff --quiet a68664f56e38bfb74e32972c14becdc6e6938449 HEAD -- AGENTS.md
  package.json bun.lock src/start.ts src/integrations src/lib/hotel-store.server.ts`
  exited 0. The protected foundation matches exactly, including absence of the
  three regenerated Supabase authentication files.

## Backend and deployment lanes

Lovable Cloud is enabled (`stack=supabase`); Cloud UI and successful project-scoped
SQL reads establish actual accessible PostgreSQL. Advanced settings displayed
Asia Pacific (Tokyo), PostgreSQL 17.6.1.147. Database timezone read as UTC.
Repository `supabase/config.toml` and configured URL both reference
`fkakhdzelilnejyehwfk`; the connector did not independently expose its runtime
project-reference field. No isolated staging backend was observed.

Both applied versions were read from actual `supabase_migrations.schema_migrations`.
Their stored SQL matched the repository file bytes exactly:

| Version | Repository SQL SHA-256 | Result |
| --- | --- | --- |
| 20261002053219 | 087280536a717ee471e2e96e3f5a9492bf0c7dfe367c8e233cb3cc7fc9f30a89 | Applied already; exact match |
| 20261002053302 | 3bd6ae65ccd7933a32f088ca950150d224bff2da7f2dab34b3ad187ba8d8422f | Applied already; exact match |

Actual catalog reads confirmed all five receipt tables have RLS enabled, zero
policies, no anon/authenticated table privileges and service_role SELECT. All eight receipt
RPCs are SECURITY DEFINER and deny anon/authenticated EXECUTE; service_role can
execute. Seven compound FKs bind tenant with request/reservation/deposit IDs.
This is catalog verification, not a fresh multisession mutation test.

Protected generated types do not yet contain the new receipt-control tables.
Existing server adapters deliberately use bounded untyped service-role rows.
The frozen type snapshot was preserved; complete generated schema/type parity
is not claimed by this recovery and requires its own reviewed correction.

Architecture is TanStack Start server routes with Nitro/Cloudflare build target;
there is no `supabase/functions` or `.github` pipeline directory at input SHA.
Application server code therefore belongs to the hosting runtime lane; source
sync is not proof of runtime/public deployment. Applied SQL was historically
executed through Lovable's tracked migration mechanism, not Git merge.

Cloud Secrets listed the names `HOTELHUB_SESSION_SECRET`,
`HOTELHUB_N3_DEPOSIT_WRITES_ENABLED`, `HOTELHUB_N3_DEPOSIT_WRITE_TENANT_ALLOWLIST`
and `LOVABLE_API_KEY`. Values were neither opened nor changed. Managed Supabase
credentials and exact live runtime versions were not exposed by this inspection.
Cloud UI states secret changes affect preview immediately and require publish
for live. This does not grant permission to change them.

Live browser loaded the N3 launch screen. Shell HTTP inspection returned 403,
so the historical HTTP deployment marker could not be independently rechecked
through that transport. No evidence of a new public deployment was obtained.

## Requirements classification

| Requirement | Classification / independent evidence |
| --- | --- |
| Larger correction/void popup text, responsive scrolling | Implemented; text-base/text-xl and bounded overflow present; signed-in visual UAT not verified |
| Amber Receipt Requests card | Implemented; amber card/queue mounted in Dashboard; signed-in UAT not verified |
| Previous/Next and month/year selectors | Verified by source and existing renderer/month tests; live signed-in UAT not verified |
| Property/person/Owner finance isolation and stale-data hiding | Verified by source and existing permission/identity/cache/error regressions; full live actor matrix not verified |
| Nested/case-variant journal parsing with conflict rejection | Verified with existing fixture tests; actual failing N3 response unknown |
| Correction request for the reported receipt | Failed in Owner's prior attempt; current live result NOT VERIFIED |
| Automatic edit/void/replacement | Deferred/disabled in source, preserved |
| Sales/Collections final billing | Deferred; remains Unavailable |
| External alerts | Deferred/disabled; no provider/recipient setup performed |

## Receipt issue and diagnostic boundary

Owner-reported booking/receipt: BK260920001 / OR2610/001; requested RM50 → RM60,
reason “guest no small notes”. Actual backend read still shows posted MYR50.00,
last updated `2026-10-01 13:29:10.589519+00`. Receipt request, decision, execution,
version and alert tables each contained zero rows. Saved customer/bank codes
matched the Owner's handover. This is local state proof, not current N3 readback.
No raw guest/contact data or immutable financial identifiers are copied here.

The live cloud browser has no N3 session and shows “Sign in from N3”. The same
preview also has no N3 session. Do not use developer sign-in or extract a cookie,
token or secret. Existing safe GET diagnostics are already implemented:
`GET /api/hotel/reservations/:id/deposits/:depositId/receipt-requests` reads the
saved scoped deposit and performs receipt-detail + GLPosting GETs. Its original
DTO includes `journal.exact` and Owner-only `journal.reasons`. The dialog shows
safe codes/explanations while Send Request stays blocked when proof fails.
GET may use existing access/audit/session controls, but creates no financial request.

Current checks require exact bank debits, one customer AR credit, amounts,
receipt number and HotelHub reference on every journal row. Missing row fields,
conflicting aliases and wrong accounts remain refusals. Prior deposit posting
proof used a different verifier; posted status alone does not prove the stricter
receipt-control predicate now passes. No root cause is asserted from fixture shape.

Next diagnostic: as Owner, open this receipt's Request correction popup only;
capture the displayed safe journal reason code(s). Do not click Send Request,
approve, Verify, edit, void or refund. If reasons indicate a shape omission,
obtain authorized sanitized field-presence evidence before designing a fix.
Never invent row doc/reference values or remove the proof gate to allow submission.

### Owner screenshot follow-up — 02/10/2026

The Owner supplied two screenshots after opening Request correction with no
previous successful request. The popup loads the saved RM50 original, contact
and current account and displays exactly one safe reason:
`journal_row_doc_code_missing` — “Journal lines do not show the receipt number”.
This is a pre-submit evidence check, not a requirement to have an earlier request.
The screenshots show the Reservation URL and its Deposits card; the Owner called
the flow Prepare Checkout. No card relocation or duplication is justified by this
evidence. Larger popup text is visually present; responsive/mobile UAT is not proven.

Fresh connector reads still report GitHub main and Lovable latest SHA as input
`33167f94f8667d1b030b7ab562623723630251e2`; project/workspace match and project is
ready/agentFinished. Backend still has posted MYR50.00 with unchanged timestamp,
and zero requests, decisions, executions and versions. No financial action occurred.

The source resolves case-insensitive row `docCode` / `docNo` aliases. A null
resolved value on at least one row produces this reason. Absent, null, blank or
unsupported value/shape can all lead to that outcome; the screenshot cannot
distinguish them or identify which row. Under the current source predicate,
this sole reason also indicates that the parsed account/amount and reference
checks did not report another mismatch. That is a code-based inference, not an
independently captured upstream payload.

The public sales-v1 document was fetched again. `GLTransactionDto.docCode` is a
nullable string, but the actual ARReceipts/GLPosting 200 contract refers only to
`ApiResponseMessage` with varying Data shape. Presence of GLTransactionDto in the
same document does not prove that this endpoint always returns that DTO or that
every live row contains docCode. No documented alternate receipt-number field
was established. See `evidence/HH_RECEIPT_OWNER_DIAGNOSTIC_20261002.md`.

The agent's fresh cloud browser still shows “Sign in from N3”; the Owner's
desktop signed-in session is not shared with it. Existing HotelHub diagnostics
return safe reason codes, not raw upstream GLPosting rows. The exact missing
capability is an authorized signed-in upstream journal read/sanitized capture.
Lovable SQL access does not provide the server-held N3 session token, and no
token, cookie or secret was extracted. Do not ask for those values in chat.

Next investigation requires a sanitized GET GLPosting response for this receipt,
preserving wrappers, field names, null/blank values, row structure and consistently
redacted document/reference bindings. It must distinguish a missing/empty field
from an alternate location before a parser fix or contract change can be designed.
No speculative source change, accounting relaxation or public release was made.

The subsequent Owner N3 detail/print screenshots confirm that OR2610/001 exists
at MYR50.00. Fresh SELECT comparisons prove their UUID, document number and
HotelHub reference match the saved scoped deposit, with zero requests. They do
not show the journal rows or API payload. The attached financial source assigns
N3 login/operations to the Owner. Next supporting evidence is the existing
receipt's Account Journal screenshot; raw upstream shape still requires separate
sanitized capture before an evidence-based parser fix. See the evidence follow-up.

The Owner then supplied Account Journal: Dr 700-0310 MAYBANK MYR50.00 and
Cr 700-7001 customer MYR50.00, same HotelHub reference on both lines, dated
01/10/2026. Displayed journal totals balance. This is supporting N3 UI evidence,
not captured GLPosting JSON, and the table has no receipt-number column. It does
not establish whether the missing API field is absent, null, blank or unsupported.

The current candidate adds exactly those safe classifications to existing
Owner-only reason codes and fixes the pre-submit warning wording. It retains
the generic missing-number reason and all existing refusal conditions; it never
copies the receipt header into journal rows. See `HH_RECEIPT_DIAGNOSTIC_CANDIDATE.md`.

## Independent engineering checks

Node 24.19.0; Bun 1.4.2 used for frozen dependency installation with scripts
disabled. No package/lock edits. No DB/N3 runtime credentials supplied to tests;
PGHOST, PGUSER, PGPASSWORD, HOTELHUB_LIVE_WRITE and service credentials were unset.
Actual command summaries are preserved in `evidence/HH_DIRECTBUILD_GATES_20261002.txt`.

| Gate | Result |
| --- | --- |
| Frozen Bun install | 468 packages, exit 0; lock unchanged |
| Full Vitest | 119 files passed / 3 skipped; 1,868 passed / 20 skipped / 0 failed; exit 0 |
| TypeScript `tsc --noEmit` | Exit 0, no output/errors |
| ESLint src | Exit 0; 0 errors / 37 existing warnings |
| Prettier src | Exit 0; all matched files formatted |
| Actual Vite production build | Exit 0; Nitro worker artifact built |
| Protected-file comparison | Exit 0, no differences |

The builder's historical 1,873/15 count differs because the five read-only
PostgreSQL schema tests have no credentials here. Other skipped suites require
privileged DB access or explicit live-write opt-in and were intentionally not
enabled. No test assertions changed. These checks verify engineering behavior
at input SHA; they do not prove live N3 journal compatibility or financial settlement.

## Candidate, handover and release state

Earlier recovery commits changed README/documentation only. The current follow-up
also changes three application files and three existing test files for diagnostic
classification and pre-submit wording. Routes, authentication, generated types,
dependencies and migrations remain at input SHA. No speculative accounting fix,
duplicate implementation, AI build, database mutation,
function deploy, N3 financial request/write, external alert, merge or publish occurred.
The review branch is the durable candidate/handover; it is not the synced main.

Recovery result: PARTIAL — verified source/engineering/schema checkpoint and
Owner-observed failed journal field; upstream response capture remains blocked.
Receipt correction remains an unresolved release-blocking
business workflow issue (P1); no dependent major work or unrelated release begins.
Old plans/specs/checkpoint headers describing migrations as unapplied or finance
as unbuilt are historical. This dated record supplies current verified state and
does not rewrite their historical evidence.

Resume from this branch on any device, refresh remote main/Lovable sync, preserve
the notes, obtain sanitized upstream journal evidence and implement only an evidence-supported
fix with a failing reproduction test. Request new approval only for a separate
lane or genuinely new scope, not the already-authorized bounded correction.
