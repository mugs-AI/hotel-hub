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
