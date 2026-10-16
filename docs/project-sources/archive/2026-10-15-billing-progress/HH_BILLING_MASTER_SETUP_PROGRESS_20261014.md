# HotelHub billing-master setup progress — 14/10/2026

Upload to Project Sources: **Yes** — add this dated recovery reference; retain the previous reservation, billing, payment and matching checkpoints.

Status: the saved-ID capture helper is implemented and tested in source. **It is not published. Billing, N3 posting, matching persistence and Complete Checkout remain unfinished.**

## Resume identities

- Repository: `mugs-AI/hotel-hub`.
- Preserved broad branch: `review/hh-reconstruction-20261011`.
- Broad source commit: `6a9526a9e9db0ea45d9af56fedca099dd3e7245a`; tree `f592932fda779526460141473800ece509e7c074`.
- Broad workspace: `/workspace/scratch/90b6973e3a7b/hotel-hub-reconstruction`.
- Separate helper candidate branch: `review/hh-configured-master-capture-20261014`.
- Candidate source commit: `dc6e7f564f83c95f7fe60843c6352f5acb12a4a9`; tree `44ddcb309098e8fc36f6f07b412ff032538ea5fc`.
- Candidate workspace: `/workspace/scratch/cb26166d36cb/hotel-hub-configured-master-release`.
- Candidate base, freshly fetched GitHub main and Lovable latest: `6e92a5a969ad9d47d1e0efb2a84487aed5266c2a`, tree `71e2736dfe396c1f9c819c34128d1038b61cd6dc`.
- These source commits precede documentation-only checkpoint commits. Resume from the latest local HEAD after checking its diff; do not repeat the implementation.

## What changed

The empty capture screen previously required the Owner to find internal N3 IDs manually. The source now offers **Use saved billing IDs**. It reads only the authenticated Owner's HH settings, active rooms, active add-on catalogue and financial mappings. It fills saved customer/stock/UOM/tax/account references and groups more than 20 references into explicit capture batches. No currency ID or revenue/debtor relationship is guessed.

The local GET does not start N3 master capture. The Owner still explicitly chooses **Capture current billing masters**, then **Download billing master evidence** for each batch. Saved references are not current N3 proof and never activate posting. Missing kinds and invalid saved references are visible; invalid values and names/contact data are not returned.

Every local table query includes server-resolved tenant scope and an exact count. Missing count, failed reads, row-cap truncation, foreign rows and excessive catalogues fail without returning partial setup. Limits: at most 200 active rooms and 200 active add-on rows, plus one settings and one financial-settings row; more returns Unavailable rather than partial results.

Failed local loads preserve entered values. Tenant/user/role changes remount the form and discard late responses. Capture is separately Owner-only. Each batch keeps its own report; a recapture clears its old report before attempting the new read. Batch filenames identify the batch. Existing financial writes, their contracts and all receipt/account corrections are unchanged.

## Fresh verification

- Broad full Vitest: **3,023 passed, 22 skipped, zero failed**; 214 files passed and 3 skipped.
- Isolated helper full Vitest: **2,379 passed, 22 skipped, zero failed**; 158 files passed and 3 skipped.
- Both typecheck, changed-file ESLint, production build and diff whitespace checks passed.
- Both full suites explicitly enabled existing Happy DOM and PGlite lanes; no new package/lockfile change.
- Isolated full lint: **170 errors, 38 warnings**, including formatting errors in two unchanged legacy receipt-check scripts. The broad branch retains its recorded 307 legacy formatting errors. Full lint is not green.
- Protected AGENTS/package/bun.lock/start/integrations/hotel-store files unchanged in this slice. Seven candidate files match the broad source byte-for-byte.

An initial broad run failed the unchanged mounted test `submits one reviewed cash/card receipt intent with exact cents` (expected POST absent); its isolated 10-test suite and two later broad runs passed. No payment code/test was changed, and the intermittent cause is not established. Keep this limitation in recovery evidence rather than claiming it fixed.

One independent checkpoint review found one Important and two Minor findings. Missing-count/truncation was reproduced and fixed. Old report resurrection after failed recapture was regraded Important because it could confuse current evidence; it was reproduced and fixed. Both regressions ran RED then GREEN in one pass. The remaining Minor is a shared busy label: the capture button says Capturing during local saved-ID loading, although no N3 capture occurs. This label is deferred. No second review or whole-billing acceptance was claimed.

## Decisions and next boundary

Ruling: use existing saved mappings to fill the approved capture prerequisite instead of asking the Owner to locate every internal ID. Cost if wrong: local mappings can be stale; current N3 capture and contract review remain mandatory.

Keep the helper separate from unfinished billing/no-show SQL and UI. The current request authorizes continuing source implementation, not a new shared push/merge/publication. The release packet is `docs/HH_CONFIGURED_MASTER_CAPTURE_RELEASE_20261014.md`; publication needs its own exact approval. No migration or configuration change is proposed.

After an approved helper release, the Owner captures/downloads all available batches. Review the resulting JSON, derive any missing relationship IDs from actual current responses, and prepare further bounded Owner reads as needed. Then resume the existing approved plan: current-master/snapshot/payer adapters, source/guest leg confirmation and recovery, own-token staff writes, actual single/split OR proof, durable matching, atomic all-room Dirty close, reports/print and live acceptance. The original design and plan approvals persist; do not seek them again.

The CBE/RAA handover remains a reference only. It is not current HotelHub CashSales/AR master or transaction proof. No downloaded billing-master JSON is available yet. No automatic financial contract acceptance, N3 transaction, operational migration, new runtime setting, shared push/merge or publication occurred in this slice. Backend checks were SELECT-only through the existing Lovable-managed project; no separate Supabase account is required.
