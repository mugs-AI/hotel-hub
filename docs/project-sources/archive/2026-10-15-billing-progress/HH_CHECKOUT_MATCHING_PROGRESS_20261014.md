# HotelHub checkout matching progress — 14/10/2026

Upload to Project Sources: **Yes** — add this dated recovery reference. Retain the previous reservation-controls, billing-progress and checkout-payment sources.

Status: the booking-bound external matching check and Prepare Checkout panel are implemented and tested in source. **Billing, payment posting, settlement and complete checkout remain incomplete and unpublished.** No operational database or N3 transaction was changed.

## Exact recovery checkpoint

- Repository: `mugs-AI/hotel-hub`.
- Branch: `review/hh-reconstruction-20261011`.
- Starting checkpoint: `48c3cc5981d5c0d6358cd917de9d4b6ac6cc7058`.
- Source commit: `432e5868851aecd60f7aa36375f188b2aef96475`.
- Source tree: `e89aa16ecc87decdf77e0fc641e821987492a185`.
- Workspace: `/workspace/scratch/90b6973e3a7b/hotel-hub-reconstruction`.
- Earlier actual-payment preparation remains at `7651aed`; its single/split entry, exact-cent validation, independent drafts and recovery are preserved.
- Main/Lovable inspected at `6e92a5a969ad9d47d1e0efb2a84487aed5266c2a`, ready with agent finished. This is the previously published read-only billing-master capture patch, not the broad checkout source.

The tracked working tree was clean after the source commit. Existing untracked adoption and Supabase temporary paths were preserved. No process from an older chat was stopped or claimed to have been recovered. No new shared push, merge, SQL, configuration change, Lovable AI Build, publication or N3 operation occurred.

## Implemented in this slice

The existing bounded saved-document checker now has a separate, fixed external-matching lane. It derives exact bill and linked receipt identities from the server-read saved intent. Browser input supplies only the intent ID under the reservation route; it cannot select another document, URL, tenant or account.

The check requires current frozen-source parity, committed detail and GL proof, exact bill/customer/currency identities, complete receipt allocations and conservation. A zero bill balance alone does not prove matching. A shared walk-in customer cannot make another booking's receipt eligible.

Two complete authenticated observations must agree, followed by fresh snapshot, durable intent and current-session checks. A changed fingerprint, source version, intent revision, missing journal, foreign receipt, cancelled check, expired credential or unresolved financial attempt prevents confirmed matching. Reads share the existing deadline and byte budget. No financial POST, allocation claim, automatic unmatch, refund or retry is introduced.

The private evidence port is bound to the original server result, persisted intent, actor/token and freshness. Copied, mutated or expired browser observations cannot become settlement authority. Public output explicitly carries `canClose:false` and does not prove local settlement persistence. Task6 must integrate the private proof and an accepted atomic room handoff before checkout can use it.

Prepare Checkout now contains **Match in N3 → Check N3 matching** in source. Owner and Front Desk may perform this read-only check with their own authenticated identity; Housekeeper is denied. Ordinary billing/payment write permission, all staff SQL boundaries and source-leg integration are still unfinished. Existing Owner-only diagnostic access remains Owner-only.

Navigation cancels the check and discards late responses rather than displaying another booking's result. Waiting/review outcomes retain saved document references and explain the next accounting action. Confirmed observations show retained receipt remainders/refunds and accountant follow-up. A matched bill with a surplus is not silently treated as checkout-ready.

## Verification and review

Final fresh full Vitest: **3,000 passed, 22 skipped, zero failed**; 212 files passed and 3 skipped. DOM and PGlite lanes were enabled explicitly. Skipped native/live acceptance was not replaced with synthetic evidence.

- Full suite: `HH_UI_DOM_PACKAGE=/workspace/scratch/cb26166d36cb/hh-checker-ui-tools/node_modules/happy-dom/lib/index.js HH_PGLITE_TEST_MODULE=/workspace/scratch/d28f1d27397d/hh-source-sql-tools/node_modules/@electric-sql/pglite/dist/index.js npm test` — exit0.
- TypeScript: `node_modules/.bin/tsc --noEmit` — exit0.
- Changed-file ESLint — exit0, one existing FastRefresh warning in SettlementCard.
- Production build: `npm run build` — exit0.
- `git diff --check` — exit0.
- Protected AGENTS/package/lock/start/integrations/hotel-store files unchanged against the starting checkpoint.

Full-repository lint was not rerun this slice. Its previously recorded 307 legacy formatting errors remain unresolved; do not call full lint green. No dependency or lockfile change was made.

One independent reviewer found one Important recovery/display issue and one Minor DTO issue. Both were reproduced and fixed in one RED→GREEN pass. The DTO issue was regraded Important because malformed input could crash the verification view or show false zero outstanding. Final client validation projects only consumed public fields and refuses incomplete success. No second review was claimed.

The reviewer found no security/ownership bypass. It confirmed an integration limitation: real creation acknowledgments remain unknown until reconciliation/proof integration. The external check correctly refuses those unknown attempts. Synthetic confirmed-flow tests do not demonstrate reachability from actual HH-created intents; this remains a release blocker.

## Required next input — separate from this Markdown

The Owner uploaded the progress Markdown successfully. **No downloaded billing-master capture JSON was present in the supplied attachments.** A progress source cannot establish current N3 response shapes, active master records, tax/UOM relationships or debit/credit mappings.

Use the already published Owner screen:

1. Reopen HotelHub through N3 as Owner.
2. Open **Settings → N3 Financial Verification → Current billing master evidence**.
3. Capture the current configured N3 master IDs, then choose **Download billing master evidence**.
4. Attach the resulting `HH_BILLING_MASTER_CAPTURE_YYYYMMDD.json` in the conversation for review.

Capture uses selected fixed master GET endpoints and does not create a bill, receipt or match. Do not supply credentials or raw tokens. Captured responses still require contract review; they do not automatically activate billing.

The CBE/RAA handover was reviewed. It explicitly lacks paired live amount-edit and current HH master evidence and contains a Purchase Invoice amount-field inconsistency. It is a reference, not substitute proof for HotelHub CashSales, AR receipts or matching.

## Remaining approved work

Continue the existing approved14/10 design and inline plan; do not repeat design or plan approvals or restart completed tasks.

- Task2: accepted current-master/snapshot/payer adapters and production posting relationships.
- Task3: server-derived folio confirmation, separate bill legs and per-leg recovery.
- Task4: own-token Front Desk write authority through RBAC/HTTP/transport/store/SQL and accepted single/split receipt contracts.
- Task5: integrate privately bound external matching into durable settlement; preserve closed automatic matching until upstream concurrency is accepted.
- Task6: whole-stay atomic close, guest/source settlement rules, accountant/no-show case reporting, all-room Dirty/DND handoff and document readers.
- Task7: disposable native concurrency, approved Owner-operated N3 proof jobs, exact release package and signed-in acceptance.

Prepare Checkout remains the approved action surface: **Confirm Folio & Post to N3 → verify bill → apply eligible deposit → Receive Payment → verify receipt/matching → Complete Checkout**. Unknown results stop mutation. Door access follows accepted financial checkout; BEC follows the established roadmap.

Backend remains Lovable-managed. A read-only Lovable status check confirmed enabled/Supabase. No separate Supabase account is required. No operational migration was applied; the broad source is not a production-ready branch.
