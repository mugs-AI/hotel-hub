# Monthly financial dashboard — release checkpoint (2 Oct 2026)

Status: implemented, NOT published. No migration applied; no N3 write; no alert sent. Held for coordinator review.

## Delivered (plan tasks 1–4)
1. `src/lib/financial-reporting.ts` — property-local months, checked-cent metrics, source availability, strict report filters, shared report rows.
2. `src/lib/financial-reporting-store.server.ts` — bounded, tenant-scoped sources using the repaired receipt projection (see `HH_MONTHLY_FINANCIAL_SOURCE_CONTRACT.md`).
3. Owner-only GET `/api/hotel/financial-dashboard`, `/api/hotel/receipt-reports`, `/api/hotel/receipt-reports/export` (no-store, sanitized errors, formula-safe CSV, export refuses incomplete source). New permission `hotel:financial_reports:view` (Owner only).
4. Dashboard "Monthly finance" section (Sales, Deposits, Collections, Voided receipts; server default month), `/receipt-reports` page (Receipts / Voided tabs, Malaysian date filters, server paging and sort, audit fields, replacement links, Print in N3, CSV), Owner-only Tools link and workspace tab. Upper four operational cards unchanged. Approval/verify invalidates the finance queries.

## Evidence (run in the Lovable sandbox at base HEAD 49b1859d4e4841498df8ed6112c8af272380e09a plus this batch)
- `bunx vitest run`: Test Files 116 passed | 2 skipped (118); Tests 1790 passed | 15 skipped (1805); exit 0.
  - New: financial-reporting 16, financial-reporting-store 16, financial-reporting-api 7, receipt-report-export 3, financial-dashboard-render 6 (48 tests).
  - First full run: 2 existing tests failed because report dates used the browser date picker; replaced with the Malaysian date input. One run had a 5 s timeout in `reservations.schema.sql.test.ts` and stale-file reads; the rerun was fully green.
  - New tests passed on first run except two store tests that hit the 30 s cache (test fixed by clearing the cache). No red-first run was captured for the new contracts.
- `bunx tsgo --noEmit`: 0 errors.
- ESLint on all changed files: 0 errors, 1 pre-existing warning (AppShell fast-refresh).
- `git diff --check`: clean.
- Production build (`vite build`, copy in /tmp): exit 0.
- Browser check (Playwright, live preview, sample Owner session and sample figures supplied by intercepting the app's data requests — not real data): Dashboard shows the four finance cards (Sales/Collections "Unavailable — final billing source not connected.", Deposits MYR 50.00, Voided MYR 80.00); /receipt-reports?tab=voided shows the row with amount before void MYR 80.00, original MYR 50.00, requester/approver/reason, Print in N3 and Export CSV. This check caught a real crash (missing date-picker import on the report page), now fixed; tests, types and build were re-run afterwards with the same green results.
- Live preview signed out: the three finance endpoints return 401; `/receipt-reports` and `/` return 200.

## Not verified (honest gaps)
- All source/API tests use injected in-memory stand-ins, not the real database or N3.
- No signed-in Owner end-to-end check; no true multi-session SQL concurrency.
- Receipt-controls tables are not applied, so in production the deposits figure currently uses original receipts (reason `receipt_controls_not_installed`) and every original needs a live N3 GET.
- Protected files: automatic regeneration (three auth files, types.ts, package/bun.lock) reappeared during this batch and was restored to a68664f.

## Frozen42f receipt UI/server review fixes (2026-10-02)
- Correction dialog loads the saved receipt (GET-only N3 readback) and keeps the saved bill-to contact by default. Contact is sent only in explicit "Change bill-to contact" mode and only when changed; the server treats an omitted contact/account as "preserve original". Original/Requested rows shown to requester ("Unchanged" when kept).
- Account policy (`requiresAccountEligibility`): a contact-only correction (same amount, same account) may keep a disabled historical account; any amount or account change re-verifies the account is allowed and enabled, even the same id. Enforced at create and at verify.
- Owner queue: Approve appears only after Review is opened and "I reviewed…" is ticked. Cache keyed by tenant:user:role; receipt-control snapshots for any other identity purged on auth switch.
- Verify/decide success invalidates receipt-controls, deposits, folio, reservations (list/detail), departures, checkout-preview and financial-reporting.
- Staged SQL `hotelhub_receipt_control_decide`: any in-flight claim raises `claim_conflict` before any update, so a claimed prior-approved Needs review cannot be rejected / terminate / free the active index; completion stays fenced to claim version and applying/needs_review.
- Evidence: Vitest 116 files passed/2 skipped, 1,797 passed/15 skipped (final run, includes race test; receipt store file 40/40). tsgo 0 errors; ESLint 0 errors; diff --check clean. Browser (sample data via intercepted requests, not real): Approve hidden before Review (0), hidden after Review before tick (0), visible after tick (1).
- Not run: staged SQL against a real Postgres (no throwaway DB available this turn — SQL fence checked by source assertion + in-memory double only); signed-in real-data flow; multi-session concurrency.

## Final review findings (interrupted verify + queue paging) — 2026-10-02

1. Manual Verify now calls `hotelhub_receipt_control_verify_atomic` (claim + complete + version in one transaction) after the read-only N3 GET. Owner-only `POST /api/hotel/receipt-controls/:id/recover` calls `hotelhub_receipt_control_recover`: releases only a claim older than 300 s, bumps the version (old worker's complete fails `claim_not_found`), Applying → approved_awaiting_n3, terminal states refused. No N3 call, write or retry. UI: "Recover interrupted verification".
2. `db.list` uses `.range()` + exact count + stable order (requested_at, id); API returns total/nextOffset (default 50, max 100, invalid → 400). Owner queue has "Load more" and "Showing X of Y"; reservation deposits card reads every page, failing closed past 20 pages.

Evidence: Vitest 1,807 passed / 15 skipped (116 files); tsgo 0 errors; ESLint 0 errors on changed files. Real-DB SQL execution, signed-in E2E and multi-session timing NOT run. Protected files re-restored to a68664f after generated drift.

## Review 2e755 receipt-evidence blockers — 2026-10-02

- Evidence envelope now reuses the deposit adapter's strict `successfulEnvelope` (code must be official "0000", all case variants agree, success true if present) and casing-agnostic data/Value unwrapping; conflicting envelopes fail closed. Journal accepts array, details, lines or value forms; conflicting forms are not exact.
- The single non-payment credit must carry the deposit's immutable `n3_customer_code`; a wrong-customer credit or missing code is not exact.
- Request creation now refuses `journal_unproven` (409) unless the journal is exactly proven; unavailable N3 evidence is an explicit refusal at request and a hold at approval.

Evidence: Vitest 1,821 passed / 15 skipped (116 files); tsgo 0 errors; ESLint 0 errors on changed files. Protected files re-restored to a68664f. No N3 writes, alerts, migrations or publication.

## Monthly review 5a26829 fixes — 2026-10-02

1. No creation-date window: every posted HotelHub-linked deposit is discovered (keyset paging, 100k cap) and each is re-read by N3 GET; the N3 document date alone decides the month. Above `verifyCap` (100) the source is Unavailable (`verification_cap`), never partial. Superseded: see Month-date discovery section below.
2. Corrected/voided receipts are re-verified live every read (amount, receipt id, currency, exact journal, payment lines; voided must read voided). Unreadable => Unavailable; drift => Needs review. Replacement-receipt effects cannot be re-read through the deposit and are Unavailable (stale).
3. Versions/unresolved use `pagedAll`: stable order + `.range()` + exact count; missing/changed count or short read => Unavailable. voidedDepositIds removed (superseded by full discovery).
4. Audit fields come from the latest effective version for the receipt.
5. Original exactness compares immutable creation payment lines (account + cents); same-amount bank change => Needs review.
6. One shared 40 s `Deadline` covers settings, revision, every DB page, audit/labels/booking refs and every N3 GET; each call races the remaining time and the AbortSignal fires at the deadline. Production N3 GETs are not network-aborted by that signal (they keep their own read timeout); late results are discarded.
7. Finance query keys use authenticated tenant/user/role; snapshots for other identities are purged on account change.

Evidence: Vitest 1,831 passed / 15 skipped (116 files); tsgo 0; ESLint 0; vite production build OK. Protected files restored to a68664f. No N3 writes, alerts, migrations or publication.


## Month-date discovery (option (a)) — 2026-10-02
- Replaced lifetime re-read with documented ARReceipts/List docDate month discovery (`src/lib/n3-month-receipts.server.ts`, `docDateListPath` in `n3-receipts.server.ts`). Cap 100 now per selected-month candidates.
- Tests: `bunx vitest run` => 116 files passed, 2 skipped; 1,843 tests passed, 15 skipped. New: >100 lifetime/<100 month succeeds; >100 month candidates Unavailable; filter ignored; count change/duplicate page/truncation/wrong order; list failure and 401; old-created N3-dated-in-month; non-HH crosslink not counted; isCancelled => Needs review only; reference drift; leap 2028-02 end-exclusive; query encoding/validation; strict '0000' page parsing.
- `tsgo --noEmit` 0 errors; ESLint 0 errors on changed files; `vite build` succeeded.
- Protected generated files drifted again and were restored to a68664f.
- Not exercised: live N3 filter (no signed-in GET probe run), real-DB SQL, authenticated E2E, multi-session concurrency. No N3 writes, alerts, migrations or publication.

## Receipt/finance cache identity scoping (review 1c2b) — 2026-10-02
- All receipt query keys (deposit-card requests, request-dialog original, Owner queue) and finance keys are namespaced `[prefix, tenant:user:role, ...]`; disabled while identity unknown.
- A failed session refetch yields identity null (never the previous identity).
- AppShell mounts a central guard (`useSensitiveReceiptCacheGuard`) that removes foreign receipt/finance queries and receipt mutation results on every identity change; sign-out removes all. Deposit dialogs opened under another identity are discarded and remount per identity; queue errors reset.
- Tests: `receipt-auth-switch-cache.test.ts` (tenant/user/role switch and failed session fetch with the request dialog mounted and no dashboard; central purge of queries + mutations). Full suite 117 files passed, 1,848 tests passed, 15 skipped; tsgo 0 errors; ESLint 0 errors on changed files. Protected files restored to a68664f.

## Review e220930 fixes — 2026-10-02
- Confirmed void events are candidates by property-local `verified_at` month, separate from N3 docDate discovery (empty month list still reports them); report rows keep the receipt's N3 document date (`n3DocumentDate`, CSV "N3 document date"). Only stored void versions count; `VOID_JOURNAL_CONTRACT_PROVEN` stays false.
- One 40 s deadline now starts before settings/period resolution and covers every DB/N3 lookup; a hanging settings read returns Unavailable (`time_budget`).
- Audit/user-label lookups limited to selected candidates' versions.
- Source contract updated (creation-date window and 20 s cutoff removed).
- Evidence: full Vitest 117 files passed / 2 skipped, 1,853 tests passed / 15 skipped; tsgo 0 errors; ESLint 0 errors on changed files; vite production build OK. Protected files restored to a68664f.

## Production migration apply — 2026-10-02 05:32–05:33 UTC
Source HEAD before apply: 1b08534d201b12a7416a20b28b1c65a93969e507. Applied through the Lovable tracked migration tool (one transaction per script, stop on error).
- Pre-check: no hotel_receipt_* tables, no hotelhub_receipt_*/utf16 functions; last history 20260930135429 hh_payment_account_visibility; deposit OR2610/001 = 50 MYR posted, updated 2026-10-01 13:29:10.589519+00.
- Applied 20261002053219 (= staged 20261002110000_hh_receipt_controls.sql) sha256 087280536a717ee471e2e96e3f5a9492bf0c7dfe367c8e233cb3cc7fc9f30a89 — diff vs staged: IDENTICAL.
- Applied 20261002053302 (= staged 20261002110100_hh_receipt_alert_outbox.sql) sha256 3bd6ae65ccd7933a32f088ca950150d224bff2da7f2dab34b3ad187ba8d8422f — diff vs staged: IDENTICAL.
- Post-check: 5 tables RLS on, 0 policies, anon/authenticated no table access, service_role full. 7 RPCs (create, decide, claim, complete, verify_atomic, recover, alert_claim, alert_settle = 8 incl. alert pair) SECURITY DEFINER, EXECUTE service_role only; guard + utf16 helper service_role only. 7 compound FKs; 2 deposit unique keys; 17 indexes; 3 guard triggers. 0 rows in new tables. Deposit OR2610/001 unchanged (50 MYR, posted, same updated_at).
- Linter: 5 new "RLS enabled, no policy" INFO — intended (service-role only, same pattern as all existing hotel tables).
- No fixture writes, N3 writes, alert delivery or publication. Pending: signed-in preview check, live N3 date filter, publication.
