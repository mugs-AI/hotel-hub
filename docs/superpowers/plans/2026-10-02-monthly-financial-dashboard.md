# Monthly Financial Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Owners month-selectable financial cards and traceable receipt/void reports without confusing prepared bookings, posted sales and collected money.

**Architecture:** One server service reads bounded HotelHub-linked source batches, uses the receipt-controls effective projection, and returns summaries plus source completeness and verification time. Owner-only APIs share the same normalized rows with paginated reports and exports. Dashboard month state applies only to the financial section; existing operational queries stay on the property day.

**Tech Stack:** Existing TypeScript, TanStack Start/Query, React, Supabase, N3 read adapters and Vitest. No new charting dependency, currency conversion or final-billing engine.

**Spec:** `docs/superpowers/specs/2026-10-02-monthly-financial-dashboard-design.md`, approved after written review on 2 October 2026. Dependency: the receipt-controls plan, particularly `EffectiveReceipt` and `listEffectiveReceipts`. This plan is not yet approved for execution.

## Global Constraints

- Financial figures, receipt histories and exports are Owner-only at both UI and server boundaries.
- The four upper action cards remain today's Confirmed arrivals, Departures, Overdue occupied and Rooms needing attention.
- The financial section defaults to the current property-local month; its selector affects financial cards and their drill-down reports only.
- Prepared reservation folios are excluded from posted sales.
- Deposits are a subset of collections; the cards are never added together as if they were separate income.
- Only HotelHub-linked documents count. A shared walk-in customer or bank account is not proof that a transaction belongs to HotelHub.
- Use N3 document dates for receipt/sales activity, confirmed void event dates for void activity. Never substitute local deposit creation time for an absent N3 document date.
- An unavailable/unsupported/incomplete source is Unavailable, not zero. Different currencies are never summed into MYR using an assumed rate.
- Label reports as current verified state, not a frozen historical closing balance. Refunds and immutable month-end closing are outside this release.
- No report fetch posts, matches, refunds or modifies receipts. Final sales/settlement sources are currently unsupported and remain visibly Unavailable until a verified source exists.

## Review Focus

- December/January boundaries, leap February and a browser in another timezone: use the property's month, validate strict YYYY-MM and start-inclusive/end-exclusive boundaries (Task 1).
- A confirmed void follows an earlier RM50→80 correction: void activity uses RM80; audit keeps both amounts (Tasks 1, 2).
- A document or allocation appears on multiple N3 pages: deduplicate transaction identity, never count matching as new collections (Task 2).
- A source fails halfway through pagination: mark the dependent metric unavailable and disclose completeness; never show partial totals as complete (Tasks 2, 3).
- Spreadsheet-formula characters in exported customer/reference text: export escaped values without executing formulas; data remains tenant/Owner scoped (Task 3).

## File boundaries and contracts

Create `src/lib/financial-reporting.ts` for pure month/source/summary contracts, `financial-reporting-store.server.ts` for bounded tenant-scoped reads, `financial-reporting-client.ts` for same-origin Owner queries, `FinancialDashboard.tsx` for cards/month control and `ReceiptReports.tsx` for report tables. Consume `src/lib/effective-receipts.server.ts`; do not add separate amount logic to each component.

Shared types from Task 1:

- `FinancialMonth = {month:string; startDate:string; endExclusive:string; timezone:string}`.
- `FinancialSource<T> = {status: complete | unavailable | needs_review; rows:readonly T[]; verifiedAt:string|null; reasonCode:string|null}`.
- `HotelFinancialEvent = {transactionId,documentId,documentCode,documentDate,bookingReference,customerLabel,currency:string; amountCents,creationAmountCents:number; kind: deposit | settlement | direct_payment | sale | void; state: active | voided; receiptStatus: active | corrected | voided | needs_review; savedPaymentName,paymentAccountId,accountCode:string|null; replacementOf,replacementReceiptId:string|null; requesterLabel,approverLabel,reason,confirmedVoidAt:string|null}`. Voids carry the last verified effective amount immediately before void; receipt identity/contact labels and creation amounts remain available for report rows without a second unscoped read.
- `FinancialMetric = {amount:number|null; count:number|null; currency:string; status:FinancialSource<never>['status']; verifiedAt:string|null; explanation:string|null}`.
- `MonthlyFinancialDTO = {period:FinancialMonth; sales,deposits,collections,voids:FinancialMetric; currentVerifiedState:true}`.
- `ReceiptReportFilter = {month:string; tab: receipts | voided; fromDate?:string; toDate?:string; bookingReference?:string; receiptNumber?:string; paymentAccountId?:string; status?:active | corrected | voided | needs_review; sort:documentDate | documentCode; direction:asc | desc; limit:25 | 50 | 100; offset:number}`. Optional date filters are inclusive YYYY-MM-DD dates within the selected month, with fromDate≤toDate; omitted bounds use the whole month. Receipt rows filter N3 document date, void rows filter confirmed void event date.
- `ReceiptReportRow = {id,receiptId,receiptNumber,documentDate,bookingReference,customerLabel,currency:string; amount:number; creationAmount:number; savedPaymentName,accountCode:string|null; status:active | corrected | voided | needs_review; replacementOf,replacementReceiptId,requesterLabel,approverLabel,reason,confirmedVoidAt:string|null}`.
- `ReceiptReportDTO = {period:FinancialMonth; items:ReceiptReportRow[]; total:number; sourceStatus:FinancialSource<never>['status']; verifiedAt:string|null}`.
- Test helper `financialEvent(overrides?: Partial<HotelFinancialEvent>): HotelFinancialEvent` in `src/lib/__tests__/fixtures/financial-reporting.ts` returns a confirmed sample MYR50 HotelHub deposit dated 2026-10-01.

### Task 1: Property months and exact metric definitions

**Files:** Create `src/lib/financial-reporting.ts`, `src/lib/__tests__/financial-reporting.test.ts`, `src/lib/__tests__/fixtures/financial-reporting.ts`.

**Interfaces:** Produce `financialMonth(month:string|undefined, timezone:string, now?:Date): FinancialMonth`, `summarizeFinancialMonth(period:FinancialMonth, sources:{receipts:FinancialSource<HotelFinancialEvent>; sales:FinancialSource<HotelFinancialEvent>; otherCollections:FinancialSource<HotelFinancialEvent>}, currency:string): MonthlyFinancialDTO` and `validateReceiptReportFilter(input:URLSearchParams, period:FinancialMonth): ReceiptReportFilter`.

- [ ] Write tests for Asia/Kuala_Lumpur current month at a UTC date boundary, December→January, leap February, invalid month/timezone and offset/limit rejection. Assert one RM50 deposit gives Deposits50 and Collections50; allocation repetitions never give100. Assert posted sale1114.55 without payment affects Sales only and prepared folios never enter events. A RM50 receipt corrected to80 and then voided contributes zero active deposits/collections and void activity80. Unavailable sales/other collections leave their dependent cards unavailable while an independently complete deposit metric may remain50. Mixed currency, overflow, missing dates and partial source evidence cannot yield a complete MYR total.

```ts
it("counts a RM50 deposit once in collections", () => {
  const complete = (rows: HotelFinancialEvent[]): FinancialSource<HotelFinancialEvent> => ({
    status: "complete",
    rows,
    verifiedAt: "2026-10-02T00:00:00Z",
    reasonCode: null,
  });
  const result = summarizeFinancialMonth(
    financialMonth("2026-10", "Asia/Kuala_Lumpur"),
    { receipts: complete([financialEvent()]), sales: complete([]), otherCollections: complete([]) },
    "MYR",
  );
  expect(result.deposits.amount).toBe(50);
  expect(result.collections.amount).toBe(50);
});
```

- [ ] Run `bun run test src/lib/__tests__/financial-reporting.test.ts`; confirm missing contract failures.
- [ ] Implement checked-cent aggregation, source-sensitive availability and strict month bounds. Current-state correction/void exclusions restate receipt document month; void activity selects confirmed-void property-local date. Deduplicate collections by authoritative N3 money transaction ID across deposit/settlement/direct-payment sources. Distinct currencies produce Needs review, with no implicit conversion. Limit receipt text filters to 100 characters, validate real calendar dates and ordered date bounds within the selected month, stable secondary sort by immutable ID, limit≤100 and offset a nonnegative safe integer. Add tests rejecting February30, out-of-month and reversed date ranges.
- [ ] Run pure tests and type checking; verify exact user example and source-completeness outcomes.
- [ ] Commit with message `Add property-month financial definitions and safe aggregation`.

### Task 2: Bounded verified sources shared by cards and reports

**Files:** Create `src/lib/financial-reporting-store.server.ts`, `src/lib/__tests__/financial-reporting-store.test.ts`, `docs/HH_MONTHLY_FINANCIAL_SOURCE_CONTRACT.md`. Consume receipt-controls evidence/version tables and N3 read operations. No write migration is needed for aggregation; add indexed reads to the receipt-controls migration only before its release, otherwise use a new additive index migration.

**Interfaces:** Produce `readMonthlyFinancialSources(actor:ReceiptControlActor, period:FinancialMonth, deps?: FinancialReportingDeps): Promise<{receipts:FinancialSource<HotelFinancialEvent>; sales:FinancialSource<HotelFinancialEvent>; otherCollections:FinancialSource<HotelFinancialEvent>}>`, `readMonthlyFinancialDashboard(actor, month?:string, deps?): Promise<MonthlyFinancialDTO>` and `readReceiptReport(actor, filter:ReceiptReportFilter, deps?): Promise<ReceiptReportDTO>`. `FinancialReportingDeps` injects tenant-scoped effective receipt reads, bounded evidence normalization and optional verified sales/settlement read adapters; unsupported adapters return Unavailable explicitly.

- [ ] Write tests proving every local/N3 lookup belongs to server-authenticated tenant and immutable HotelHub links; shared customer/account unrelated transactions excluded; >500 local rows and multiple N3 pages included; duplicate documents allocated on later pages counted once; page failure/cap reached marks source incomplete; changed external receipt held Needs review; original+replacement one active contribution; verified void uses pre-void effective80; zero from a confirmed empty source differs from an inaccessible source. Assert no N3 Create/Update/Delete calls and one shared source batch for all four cards.
- [ ] Run `bun run test src/lib/__tests__/financial-reporting-store.test.ts`; confirm missing service failures.
- [ ] Implement page-scoped source reads ordered by stable immutable ID, local pages500 and cap100000, N3 page size/cap fixed only from verified read contract. Use at most three concurrent N3 receipt verifications; cap100 per request and stop starting reads after a20-second verification budget, returning incomplete rather than omitting data. Existing20-second read timeouts bound outstanding calls; total source processing must stop within40 seconds. Cache only successful tenant/month/source snapshots for at most30 seconds server-side, with the latest scoped receipt-version revision in the cache key so a confirmed control result cannot reuse a stale snapshot. Never cache tokens, denial responses or mixed-tenant QueryClient values. Cards/report rows use the same verified source snapshot and verification time. Document immutable HH linking, source limits and current unsupported sales/settlement status. Later N3 write/read sources must supply the declared `HotelFinancialEvent` contract before cards become available.
- [ ] Run service/pagination tests and local query-plan checks for tenant+document-date and tenant+void-date indexes. Current receipt versions must agree with existing card/list/folio/checkout totals from the preceding plan. No N3 write call during validation.
- [ ] Commit with message `Add shared monthly financial reads with explicit completeness`.

### Task 3: Owner-only report APIs and safe export

**Files:** Create `src/routes/api/hotel/financial-dashboard.ts`, `src/routes/api/hotel/receipt-reports.ts`, `src/routes/api/hotel/receipt-reports.export.ts`, `src/lib/receipt-report-export.server.ts`, `src/lib/__tests__/financial-reporting-api.test.ts`, `src/lib/__tests__/receipt-report-export.test.ts`. Modify `src/lib/rbac.ts` to add `hotel:financial_reports:view` for Owner only.

**Interfaces:** API contracts: GET `/api/hotel/financial-dashboard?month=YYYY-MM` returns `MonthlyFinancialDTO`; GET `/api/hotel/receipt-reports` returns `ReceiptReportDTO`; GET `/api/hotel/receipt-reports/export` returns a UTF-8 CSV of the same authorized/filter snapshot. Export helper `receiptReportCsv(rows:readonly ReceiptReportRow[]): string` escapes CSV text and leading spreadsheet formula triggers. CSV is an audit/report export, never an N3 receipt voucher.

- [ ] Write API tests denying Front Desk, Housekeeper, revoked Owner, unprovisioned session, unauthenticated and cross-tenant queries before fetching sources. Reject browser tenant/actor/currency overrides, malformed month, unknown filters, oversized text and unsafe paging. Verify reports sort/filter/paginate before returning rows and count the complete matching set. Export tests cover comma/newline/quotes and leading `=`, `+`, `-`, `@`, tab/CR formula triggers, while numeric amount columns remain numeric; verify void reason/original/replacement fields and unavailable-source export refuses rather than silently producing an empty report.
- [ ] Run `bun run test src/lib/__tests__/financial-reporting-api.test.ts src/lib/__tests__/receipt-report-export.test.ts`; confirm missing routes/export helper failures.
- [ ] Implement same-origin cookie-authenticated Owner gates with no-store responses and sanitized error codes. Exports use the exact report predicate but traverse the complete bounded source snapshot rather than the current25-row page. Refuse export when required evidence is incomplete. Include current-verified-state label, currency and verification time in metadata rows. No raw guest identity/contact/token in reports; customer label is the authorized accounting display value.
- [ ] Run API, export and RBAC tests; assert report totals and exported contribution rows reconcile and no access leakage through error messages.
- [ ] Commit with message `Add Owner-only financial reports and escaped audit exports`.

### Task 4: Dashboard cards, month selector and receipt/void listing

**Files:** Create `src/lib/financial-reporting-client.ts`, `src/components/FinancialDashboard.tsx`, `src/components/ReceiptReports.tsx`, `src/routes/receipt-reports.tsx`, `src/lib/__tests__/financial-dashboard-render.test.ts`. Modify `src/routes/index.tsx`, `src/components/AppShell.tsx` (Owner Tools entry), `src/lib/workspace-tabs.ts` (Owner-only report tab), and `src/components/ReceiptApprovalQueue.tsx` only for links into the matching report. Create `docs/HH_MONTHLY_FINANCIAL_RELEASE_CHECKPOINT.md`.

**Interfaces:** Produce `useMonthlyFinancialDashboard(month?:string, enabled?:boolean)` and `useReceiptReport(filter:ReceiptReportFilter, enabled?:boolean)` with tenant/session keyed queries; `FinancialDashboard()` reads Owner capability and renders month control/four financial cards; `ReceiptReports({filter,onFilterChange})` shows server rows and their N3 print/history links. Server default month controls the initial displayed value; browser clock never chooses it.

- [ ] Write render/navigation tests: four original action cards keep operational day queries when reporting month changes; Front Desk sees neither financial section nor Tools reports link; Owner sees Sales/Deposits/Collections/Voided receipts with server availability text and verification time. Voided card links to the same month/tab; receipts show saved payment name, original/corrected/void status and replacement link; failed source visibly unavailable; Print in N3 appears only for a safe nonzero receipt identity. December/January selection preserves report filters without changing operational dates or triggering mutations.
- [ ] Run `bun run test src/lib/__tests__/financial-dashboard-render.test.ts` and relevant workspace tests; confirm missing UI/hook failures.
- [ ] Implement responsive cards and receipt tables, month/date filter, paging, column sorting, CSV export and audit drill-down. Display a short explanation that deposits form part of collections. Voided activity shows pre-void effective amount, current verified state and link to audit history. Source unsupported copy says “Unavailable — final billing source not connected.” Do not show financial cards to non-Owners, generate an imitation receipt, or add prepared folios to sales. Receipt-control completion invalidates the financial snapshot/query cache; month selection is read-only.
- [ ] Browser-check actual components with synthetic data: current/prior month, void after correction, receipt history, safe original N3 print link, narrow phone layout and all availability states. Run full suite/type checking/build/changed lint; independently review, publish the exact tested tree and verify serving deployment. Record source capability/completeness and pending signed-in acceptance. Do not create/void/settle documents to make card screenshots.
- [ ] Commit with message `Add Owner monthly finance cards and receipt audit reports`.

## Self-review and execution handoff

Four tasks cover property month behavior, definitions, source evidence/availability, privileged filtering/export and UI drill-downs. Every Review Focus condition has assertions in its owning task. The receipt-controls effective version contract is a prerequisite; notification delivery is independent. Unsupported final-billing data remains unavailable throughout this release, avoiding a false claim that prepared revenue is posted sales.

Execution method has not been chosen. Review this plan with the approved spec before implementation. Recommended method: Native, using the same session as the receipt-controls implementation because its financial projection is a direct dependency; obtain independent whole-branch review before release.
