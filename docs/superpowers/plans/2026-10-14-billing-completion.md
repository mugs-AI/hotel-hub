# HotelHub Billing Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Preserve the existing inline DirectBuild execution method.

**Goal:** Complete confirmed-folio posting, actual payment entry, verified settlement and safe checkout in HH for authorised Front Desk users, while finishing the approved manual no-show room-release workflow.

**Architecture:** Reuse the existing settlement, separate payer, accountant and saved-document foundations. Mount their production adapters and ordinary reservation workflow, widen staff authority consistently, and preserve durable one-dispatch recovery and accepted N3 contract gates. Whole-stay close binds settled guest legs, issued source legs and unresolved accountant cases in one local transaction.

**Tech Stack:** Existing TypeScript, React, TanStack Start/Query, Vitest and Lovable-managed PostgreSQL. No new app dependencies, separate Supabase account or authentication platform.

**Spec:** `docs/superpowers/specs/2026-10-14-billing-completion-and-reservation-controls-design.md`, written at `eddd7cf009e94f0bfd64460505c36b2484559b28`, approved by the user on 14/10/2026. Earlier approved billing/source/accountant plans remain applicable.

Upload to Project Sources: **No** — engineering execution plan.
Status: approved by the user on 14/10/2026 at 09:10 Malaysia. Manual no-show source and the current-master capture prerequisite are implemented; native/live acceptance remains pending. The independent bounded reservation fixes and review fix pass have already been implemented at `de7cc66`; they are source-only, not a billing release.

## Global Constraints

- Preserve current receipt correction/account-change behavior and the broader unfinished source; integrate additively from verified main. No reset, history rewrite or duplicate implementation.
- Backend is the existing Lovable project. Review branch, operational SQL, N3 proof, runtime activation and publication are separate lanes.
- N3-only server session, tenant identity and the caller's own N3 token remain authoritative. Owner-only setup/payer overrides/adjustments/accountant reporting remain Owner-only; no Owner-token delegation to staff.
- Use the existing prepared-folio calculator and checked minor-unit amounts. Unknown financial amounts remain unknown; never use zero as a fallback.
- Source rooms and guest extras keep separate customer debts. Source-leg payment is denied. A verified source receivable can remain open; guest bills require proven zero outstanding.
- Single and split-method final payment total equals the freshly verified positive guest balance in this first vertical. Partial/overpayment is explicitly outside the approved first-vertical scope.
- No automatic refund, write-off, Sales CN, journal, unmatch or void. No-show does not delete receipts or release occupied rooms. Automated no-show processing remains OFF.
- Preserve independently closed financial gates until exact current API acceptance. Unknown dispatched results cannot be reposted automatically; 401 stops the session and later operations.
- Preserve protected AGENTS, package/lock, start, integrations and hotel-store. The rate-control code uses a separate adapter without changing the protected settings projection.
- Door access and BEC remain later packages. Training20/10 and launch01/11 are targets, not completion evidence.

## Review Focus

1. Switching bookings while confirmation/payment is pending: outcome remains bound to its original stay and leg; Task3.
2. Another staff member resumes a saved intent: fresh own-token reads and rights, with no reused Owner credential/proof; Task4.
3. The walk-in customer is shared by different bookings: another booking's OR cannot fund this stay; Tasks2/5.
4. Guest leg posts while source leg times out: preserve the successful bill and recover only the uncertain attempt; Task3.
5. Property midnight or another-device change between preview and close/no-show: locked revisions/date/status prevent releasing an occupied room or closing changed charges; Tasks1/6.

## File and interface map

| Unit                     | Files/interfaces                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manual no-show           | New `reservation-no-show.ts`, `.server.ts`, `.http.server.ts`, `reservations.$id.no-show.ts`, `NoShowAction.tsx`; new CLI-generated additive migration.                                                |
| Current billing facts    | Existing `settlement-adapter.server.ts`, `settlement-snapshot.server.ts`, `source-billing-policy-store.server.ts`, `source-billing-plan.server.ts`; new focused `settlement-master-adapter.server.ts`. |
| Confirm and recover legs | Existing source store/coordinator/view, `FolioCard.tsx`, `PaymentStatusCard.tsx`; new `source-billing-http.server.ts`, `.client.ts`, `SourceBillingCard.tsx` and fixed reservation billing routes.     |
| Staff and payment        | Existing RBAC, settlement HTTP/context/transport/store/coordinator/evidence/allocation modules and pending SQL candidates.                                                                             |
| Matching and cases       | Existing `proveExternalMatching`, `externalMatchEvidenceForStore`, `createAccountantCaseStore`; extend private proof/store branches rather than duplicate ownership logic.                             |
| Close/report/print       | New `source-billing-close.server.ts`; existing folio/source presentation and financial readers; new accountant report HTTP/client/panel/export adapters.                                               |

### Task 1: Manual no-show with safe room release

**Interfaces:** `markReservationNoShow(actor: {tenantId:string;n3UserKey:string;role:HotelRole}, input: {reservationId:string;expectedUpdatedAt:string;clientRequestId:string;reason:string}): Promise<{reservationId:string;status:"no_show";updatedAt:string;releasedRoomIds:string[];accountingReviewRequired:boolean}>`. No browser tenant/room IDs or financial values.

- [ ] Write `reservation-no-show.test.ts` and disposable SQL cases: overdue confirmed booking releases only its reserved rooms; today/future arrival, checked-in stay, occupied allocation, stale revision and alien tenant deny without effects; replay returns the saved outcome. Deposits and housekeeping condition remain byte-equivalent.
- [ ] Run targeted tests and observe RED. Generate the migration with the installed CLI. Inspect live signatures/schema read-only before reserving its dependencies.
- [ ] Implement one locked RPC/transition and scoped HTTP action with reason/confirmation. Show overdue-arrival guidance; prepare a durable receipt/accountant exception when money needs review. Do not fabricate a settlement intent solely to satisfy a case FK: extend the case binding explicitly for an unposted no-show if required.
- [ ] Require PASS for request/role validation, duplicate requests, simultaneous check-in/no-show and all-room rollback in disposable native PostgreSQL. Commit source and evidence; operational application remains separate.

### Task 2: Current master and payer adapters

**Consumes:** `loadSettlementSnapshot(actor: SettlementActor,deps: SnapshotDeps): Promise<EvidenceResult<SettlementSnapshot>>`; `partitionSourceBill(snapshot,payer,attribution,legIds,customers): EvidenceResult<SourceBillPlan>`; existing source-policy store.
**Produces:** `createSettlementMasterAdapter(actor: SettlementActor): SnapshotDeps`, mounted only alongside the reviewed master-response contract. `liveSettlementDeps().snapshot` uses this adapter and preserves frozen source-version checks.

- [ ] Write failing `settlement-master-adapter.test.ts`: exact current customer/currency/stock/UOM/tax/account IDs; inactive/foreign/contradictory mappings; verified debit/credit relationships; no universal revenue account. Wrong-booking OR, stale source policy and frozen charge mismatch deny posting.
- [ ] Implement fixed bounded GET ports and accepted-shape parsers. Missing contract/evidence yields the existing explicit unavailable result. No hard-coded accepted gate or browser/env override.
- [ ] Mount approved source Settings/booking-payer lifecycle and editable pre-freeze attribution. Preserve existing mappings and saved payer on older reservations. Owner alone changes payer; every active charge belongs to exactly one leg.
- [ ] Run master/snapshot/source-policy/partition tests, including source-prepaid versus property-collect and foreign shared-customer receipts; require PASS, commit.

### Task 3: Confirm folio, mount billing and recover per leg

**Consumes:** `createSourceBillStore(rpc): SourceBillStore`, its `freeze/read/readLeg/forLeg`; `readSourceBillingStatus`, `runSourceBillStep(actor,{legId,planDigest,expectedRevision,action},deps)` and `reconcileSourceBills(actor,planDigest,deps)` returning `SourceStayView`.
**Produces:** HTTP service exposing read/confirm/step/reconcile; `confirmFolioBilling(reservationId:string,input:{expectedFolioRevision:string;clientRequestId:string}): Promise<SourceStayView>` and `useSourceBilling(reservationId:string)` client readers. Confirmation derives the plan server-side and freezes/posts eligible legs through the existing durable service.

- [ ] Write route and mounted tests: read/print zero POSTs; changed-folio confirmation409; double-click/two-device freeze returns same identities; source success plus guest timeout does not repost source; navigation while pending cannot submit/reset another booking.
- [ ] Implement allowlisted browser DTOs and fixed same-origin routes. Never serialize credential context, raw private proofs or a callback-supplied contract. Preserve HH number, N3 UUID and returned N3 code separately.
- [ ] Connect final-folio confirmation and explicit status/next-action cards in Reservation and checkout. Existing preparation/print remains fast; ineligible or unproven contracts display actionable setup/recovery guidance.
- [ ] Run source store/coordinator, HTTP, client and mounted tests to PASS; commit. No contract activation or financial proof transaction is implied.

### Task 4: Staff authority and actual-payment entry

**Interfaces:** Keep `hotel:checkout:write` for ordinary Owner/Front Desk settlement actions and deny Housekeeper. Extend balance intent with `paymentLines: Array<{accountId:string;amountCents:number}>`; the server verifies accounts and total against current guest outstanding. Existing one-method clients remain compatible.

- [ ] Write failing role/transport/SQL tests for Front Desk own-token bill/payment/recovery/close; denied or revoked N3 rights, actor/tenant changes, ended session and source-leg collection deny. A different authorised staff member must obtain fresh proof using their own session when resuming an intent.
- [ ] Update every Owner-only boundary that governs ordinary settlement consistently: RBAC, HTTP, coordinator/store, bounded N3 transport and candidate SQL claims/proofs/close. Keep setup, payer overrides, accounting adjustments and reports Owner-only.
- [ ] Implement amount/account entry and review for one method and split methods. Full positive balance is server-derived; entered lines must be positive, eligible and sum exactly. Create one OR, with no invented extra deposit or embedded bill payment. Verify each debit and one customer credit.
- [ ] Run new payment/role suites and all deposit/receipt/settlement regressions to PASS. Split contract remains independently gated until its exact acceptance. Commit.

### Task 5: External matching, receipt conservation and exception guidance

**Consumes:** `proveExternalMatching(actor,intent,reads): EvidenceResult<ExternalMatchProof>` and its privately bound store evidence; strict existing bill/receipt/GL provers.
**Produces:** an explicit verified external-match progress/settlement branch consumed by close; it is not a generic `allowUnownedAllocation` option.

- [ ] Write failing `settlement-external-match.test.ts`: linked same-bill match accepted; same customer/foreign receipt, wrong target, omitted prior allocations/refunds, missing committed GL, ambiguous identities and changed fingerprints deny. Case presence alone never proves settlement.
- [ ] Mount accountant **Match in N3 → Check N3 result** with fixed saved identities. Preserve uncertain attempts and current ownership guards; accept external matches only through exact privately bound evidence.
- [ ] Complete action-specific recovery guidance. Automatic allocation remains unavailable without accepted N3-side stale/concurrent validation; an HH lock/readback is not that evidence. No automatic clearing, refund or retry.
- [ ] Require conservation/ownership/recovery tests PASS, commit. Reuse prior journal captures and existing checker; do not repeat them as new proof jobs.

### Task 6: Whole-stay close, accountant carry-forward and document readers

**Interfaces:** `closeSourceBilledStay(actor: SettlementActor,input:{planDigest:string;expectedRevision:string;clientRequestId:string}): Promise<SourceStayView>`. Server derives fresh guest/source proofs and exact accountant bindings; browser cannot supply zero balance or case-acceptance assertions.
**Consumes:** case store `ensureOpen/readCase/append/read/saveStatement/readStatement`, existing source print projection and frozen folio presentation.

- [ ] Implement remaining approved source Task5/6 and accountant Task4/5. First write missing `source-billing-close.test.ts`, `settlement-accountant-close.test.ts`, `accountant-review.test.ts` and native concurrency cases.
- [ ] Prove guest bills zero; source bills correctly issued; bind unresolved OTA/surplus/no-show cases and versions. Close all rooms/Dirty/DNDoff atomically, reject stale facts or occupied foreign allocations, and replay local close without another financial POST.
- [ ] Mount Owner report/history/as-at print/export, monthly carry-forward and booking-specific Front Desk guidance. Unknown amounts stay unavailable; saved statements do not change after later case resolution. Escape CSV formulas.
- [ ] Mount guest/source prints and scoped reader refresh across Reservation, folio, checkout, Departures, calendar, housekeeping and finance. Preserve source guest-price privacy and formal accounting values. No partial period totals or allocation counted as new cash/revenue.
- [ ] Require unit/mounted/native SQL and print/mobile checks PASS, commit; attribute unavailable capabilities separately.

### Task 7: Contract acceptance and exact release packet

- [ ] Reconcile existing API proof jobs against actual remaining evidence. Prepare bounded Owner-operated jobs for current committed CashSales/Post-to-AR GL/INV linkage, source credit behavior, full-balance single/split OR and allocation concurrency. Exact tenant/document/master/amount scope is required before a financial transaction; no agent test write.
- [ ] Keep missing operations closed. Record accepted or failed evidence, and which ordinary workflow is still blocked. A mocked response, balanced calculated journal or new UI is not live proof.
- [ ] Run full Vitest with isolated DOM/SQL lanes, types, lint, build and applicable native single/multi-session tests. Review protected blobs, session isolation, all diffs and fresh main/Lovable/backend states; obtain one independent final review and one RED→GREEN fix pass.
- [ ] Resolve or explicitly accept the recorded baseline formatting debt in four unchanged check/evidence scripts before claiming a passing whole-candidate lint result; do not describe the current307 errors as green.
- [ ] Prepare a clean, exact main-based candidate using the finished source, preserving already released receipts. Present code/SQL/runtime/public lanes with exact SHA/tree and migration order. Apply/publish only within scope-specific authority; verify actual installed functions/types/grants and deployed version separately.
- [ ] Complete signed-in Front Desk/Owner acceptance: confirm folio, N3 bill, advance match, actual payment, no duplicate retry, guest/source balances, print, all-room Dirty close and report reconciliation. Until these pass, billing is not complete or live. Door access follows this acceptance.

## Self-review and handoff

Spec coverage: bounded tabs/info/rate/expiry already implemented and verified separately; no-show Task1; billing facts/payers Task2; confirmation/recovery Task3; own-identity payment Task4; matching Task5; checkout/reports/print Task6; contract and release evidence Task7. Each Review Focus has an owning test task. Existing method/type names above are taken from current source; proposed new interfaces are defined here.

Plan approval is recorded. Earlier approved source is reused, and the inline execution method remains selected. Plan approval does not authorize N3 test transactions, operational SQL, main merge or publication.
