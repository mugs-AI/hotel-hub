# Accountant Handover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Native execution was previously selected; preserve it.

**Goal:** Verify externally performed N3 matching and maintain an audited accountant list across months without new financial repair writes.

**Architecture:** Extend existing settlement evidence and durable close machinery with explicitly external matching provenance and separately linked accountant cases. Fixed-ID verification is read-only; explicit Owner actions persist observations/case history. Guest-paid bills must be settled, while the approved source-billing extension separately proves issued OTA debtor bills.

**Tech Stack:** Existing TypeScript, TanStack Start/Query, Vitest, PostgreSQL on existing Lovable Cloud, current N3 GET adapters. No dependency changes.

**Spec:** `docs/superpowers/specs/2026-10-08-n3-accountant-handover-design.md`; source-debtor close extension is owned by `2026-10-09-source-billing-design.md` and its separate plan.

**Approval:** Owner approved the scoped plans13:09 Malaysia time with two independent
deposit-module collection switches. Existing receipt matching/readback/reporting
and security-cash returns remain available when new collection is disabled.

## Global Constraints

- "Bill settled first" applies to guest-paid legs; source-paid legs use the approved source-billing amendment, never a generic Owner bypass.
- HotelHub does not create refunds, write-offs, journal adjustments, voids, unmatches or reallocation cleanup to eliminate receipt surplus.
- Missing/null refundAmount remains unknown; neither an empty array nor a balanced journal alone proves completeness or available credit.
- Preserve Tasks1–8, unfinished Tasks9/10/11 and parked automatic correction; no financial POST retries or synthesized dispatch provenance.
- Check saved documents: at most three observations, waits1s then2s, one total deadline/body cap, abort on401/scope loss.
- Owner-only financial reports/export; Front Desk receives minimum booking recovery guidance; no automatic messages/sharing.
- No token, cookie, raw private journal or guest contact in Git or export diagnostics; protect managed/integration/dependency files.
- Never edit an applied migration. Generate new unique migration with `supabase migration new hh_accountant_handover` after inspecting actual history; record its exact generated path in progress. Native schema tests use isolated PostgreSQL, never the operational backend.

## Review Focus

1. Same customer and amount across two bookings must not permit alien OR adoption (Task1).
2. A refund row counted both as allocation and refund must remain unknown rather than become available funds (Task1).
3. Later resolution must not change an October statement printed in December (Task3).
4. An Owner acknowledgment or case omission must not permit unpaid checkout (Task4).
5. A401 during a delayed journal read must stop all remaining reads and hide stale money (Task2).

## File and interface decisions

New units: `accountant-cases.ts` pure case/events; `accountant-cases-store.server.ts` scoped persistence; `settlement-manual-evidence.server.ts` external match prover; `saved-documents-check.server.ts` bounded GET-only runner; `accountant-review-client.ts` browser client; `AccountantReview.tsx` Owner report; `accountant-review-export.server.ts` immutable print/export.

`AccountantActor = Omit<SettlementActor,'reservationId'>` is server-only. `AccountantCaseKey = {reservationId:string; intentId:string; kind:'receipt_surplus'|'refund_review'|'n3_conflict'|'ota_receivable'; documentIds:string[]}`. `AccountantCaseObservation = {available:boolean; checkedAt:string; evidenceDigest:string|null; observedAmountCents:number|null; outcomeCode:string}`; null is never0. Case states are `open|reviewed|resolved`; reviewed is acknowledgment, and an event can reopen resolved.

`ExternalMatchProof` is opaque, minted only by the new prover with privately bound N3 GET outcomes and persisted owned identities. It records provenance `external_n3_matching`, bill/receipt IDs, target matching rows, bill outstanding and fingerprint. It is distinct from `VerifiedAllocation` and does not claim HH sent a POST. Serialization is allowed for storage only through the service's trusted proof converter; browser JSON cannot construct it.

`AccountantCaseStore.ensureOpen(actor:AccountantActor,key:AccountantCaseKey,observation:AccountantCaseObservation,requestId:string):Promise<{caseId:string;version:string}>`; `append(actor,caseId,expectedVersion,event,requestId)` is the only note/review/resolve/reopen mutator. `event` is `AccountantCaseEvent` from Task3. GET list never invokes either mutator.

`AccountantCaseRow = {caseId:string;version:string;key:AccountantCaseKey;bookingReference:string;stayFrom:string;stayTo:string;documentReferences:Array<{id:string;code:string;date:string}>;currency:string;firstSeen:string;lastChecked:string|null;status:'open'|'reviewed'|'resolved';observation:AccountantCaseObservation;nextAction:string;notes:string[]}`. `AccountantCasePage = {rows:AccountantCaseRow[];asAt:string;generatedAt:string;complete:boolean;nextOffset:number|null}`. `AccountantStatement = {statementId:string;digest:string;page:AccountantCasePage}` contains an immutable snapshot, not live references to mutable rows. `SafeDocumentRefs = {bookingReference:string;documents:Array<{id:string;code:string}>}`. `AccountantCaseBinding` comes only from a scoped store read with caseId/version/key/document IDs, privately bound to that read.

### Task 1: External matching evidence without a fictitious financial dispatch

**Files:** Create `src/lib/settlement-manual-evidence.server.ts`, `src/lib/__tests__/settlement-manual-evidence.test.ts`; modify `settlement-context.server.ts`, `settlement-evidence.server.ts`, `settlement-coordinator.server.ts`, `settlement-contracts.server.ts` only at new proof integration points.

**Interfaces:** Consume `StoredIntent`, `SettlementSnapshot`, existing scoped `VerifiedBill`/GET provenance. Produce `proveExternalMatching(actor:SettlementActor,intent:StoredIntent,reads:ExternalMatchReads):EvidenceResult<ExternalMatchProof>`; `ExternalMatchReads` contains privately bound bill/detail/journal and owned OR detail/journal outcomes from fixed existing adapters, never arbitrary browser IDs or URLs. An unknown receipt remainder is not an allocation input.

- [ ] Write failing tests `external_match_has_no_hh_write_claim`, `same_customer_foreign_or_rejected`, `journal_without_matching_rows_rejected`, `unknown_refund_not_available_funds`, `refund_overlap_not_double_counted` and `changed_or_bill_identity_rejected`. Assert an owned OR matched to the exact proven bill with bill outstanding0 confirms external provenance; no allocation/write spies run; another reservation's OR rejects; matching absence rejects despite balanced GL; null/overlap cannot return spendable cents.

```ts
expect(proof.value.provenance).toBe('external_n3_matching');
expect(writeAllocation).not.toHaveBeenCalled();
expect(alienReceiptResult.kind).toBe('contradiction');
```
- [ ] Run `npm test -- src/lib/__tests__/settlement-manual-evidence.test.ts`; expect RED for missing new module/behavior.
- [ ] Implement the opaque proof and converter, reusing existing identity, journal and status validators. Preserve independent GL/master contracts. Where receipt refund/remainder facts lack accepted semantics, retain them as an unavailable accountant observation; they cannot authorise allocation. Contradictory bill settlement or unrelated owned-match attribution still blocks proof.
- [ ] Re-run task tests plus `settlement-evidence.test.ts`, `settlement-allocation.test.ts`, `settlement-coordinator.test.ts`; require PASS and unchanged create/allocation gates. Commit only task files.

### Task 2: Bounded saved-document checker and actionable errors

**Files:** Create `src/lib/saved-documents-check.server.ts`, `src/lib/settlement-recovery-messages.ts`, `src/routes/api/hotel/reservations.$id.saved-documents-check.ts`, `src/lib/__tests__/saved-documents-check.test.ts`; modify `src/routes/settings_.n3-financial-verification.tsx`, `src/lib/settlement-client.ts`.

**Interfaces:** `checkSavedDocuments(actor:SettlementActor,intentId:string,deps:SavedCheckDeps):Promise<SavedDocumentCheck>` returns `status:'confirmed'|'waiting'|'needs_review'|'unauthorized'`, `checks`, safe `operation/attempt/document references`, `checkedAt`, `observations`. `SavedCheckDeps` supplies owned-intent loader, fixed GET readers, accepted evidence validators, `deadline`, `now`, abort signal and injectable wait. No POST/create/repair methods. `recoveryMessage(code:string,phase:'before_dispatch'|'after_dispatch',refs:SafeDocumentRefs):string` maps the spec's12 categories and unknown vendor errors.

- [ ] Write failing tests `empty_empty_present_uses_three_observations`, `three_empty_results_wait_without_post`, `401_aborts_remaining_calls`, `shared_deadline_bounds_all_document_reads`, `wrong_scope_rejected_before_network`, `browser_url_or_unowned_id_ignored`, `unknown_code_safe_fallback`. Assert waits exactly `[1000,2000]`, zero financial writes, navigation abort stops waits, partial/auth failure hides stale confirmed totals.

```ts
expect(waits).toEqual([1000, 2000]);
expect(result.observations).toBe(3);
expect(after401Reads).toHaveLength(0);
```
- [ ] Run `npm test -- src/lib/__tests__/saved-documents-check.test.ts`; expect RED.
- [ ] Implement GET-only runner and existing Owner authentication/allowlist route. POST to the same-origin checker endpoint starts a read-only operation; it does not mutate cases. Label observed balance separately from persistence proof. UI uses "Check saved documents" and "Waiting for verification"; preserve existing database states and attempts.
- [ ] Run task tests plus existing verification/API tests. Render the checker with simulated401, empty GL and a wrong-booking result. Require actionable same-document recovery text and no auto financial retry. Commit task files.

### Task 3: Durable cases, explicit events and historical statements

**Files:** Create `src/lib/accountant-cases.ts`, `src/lib/accountant-cases-store.server.ts`, `src/lib/__tests__/accountant-cases.test.ts`, `db/checks/hh-accountant-cases.sql` and CLI-generated migration `hh_accountant_handover`.

**Interfaces:** Produce case/key/observation types and `AccountantCaseEvent = {kind:'note'|'review'|'resolve'|'reopen'|'observe';reason:string;observation:AccountantCaseObservation|null;proofDigest:string|null}`. `resolve` requires a server-minted accepted proof digest, not a body string. Store interfaces are defined above. `readAccountantCases(actor:AccountantActor,input:{asAt:string;status:'open'|'all';offset:number;limit:number}):Promise<AccountantCasePage>` validates Malaysia as-at boundaries and provides completeness. `saveAccountantStatement(actor,input,requestId):Promise<{statementId:string;digest:string}>` persists an immutable selected as-at statement via explicit Owner action; `readStatement` is read-only.

- [ ] Write failing tests `prior_month_case_carries_forward`, `resolved_case_visible_in_earlier_statement`, `review_is_not_resolution`, `contradictory_fresh_facts_reopen`, `statement_retry_is_idempotent`, `unavailable_amount_not_zero`, `foreign_tenant_case_denied`. Assert October origin persists November/December; later resolution/reopen cannot change a saved October statement's bytes/digest.

```ts
expect(december.rows.map(r => r.caseId)).toContain(octoberCase.caseId);
expect(reprintedOctober.digest).toBe(savedOctober.digest);
expect(unknown.observation.observedAmountCents).toBeNull();
```
- [ ] Run task tests and isolated SQL assertions; expect missing tables/RPCs initially. Inspect history and CLI help; generate the new filename, record it, then implement service-only `hotel_accountant_cases`, `hotel_accountant_case_events`, `hotel_accountant_statements`. Use compound tenant/reservation/intent ownership, stable case keys, unique request IDs, version fences, immutable events/statements, RLS and explicit revokes for anon/authenticated.
- [ ] Implement `hotelhub_accountant_case_event`/`hotelhub_accountant_statement` RPCs with no caller-controlled proof bypass. Never mutate an event or statement after insert. Overlap/surplus values are display observations with availability, not funding authority. GET listing does not persist fresh observations.
- [ ] Pin `historical_state_before_capture_is_unavailable`: an as-at date before sufficient recorded case/evidence history cannot be reconstructed from today's status. Report incomplete history explicitly and disallow a falsely complete statement. Date-only inputs use the property's Asia/Kuala_Lumpur day boundary; UTC timestamps remain actual event times.
- [ ] Require unit PASS and native SQL single/multi-session tests for duplicate events, stale versions, alien FKs and RLS. No operational migration application in this task. Commit files and generated migration.

### Task 4: Revised guest close proof with linked accountant case

**Files:** Modify `src/lib/settlement-evidence.server.ts`, `settlement-context.server.ts`, `settlement-store.server.ts`, `settlement-coordinator.server.ts`, candidate new migration fromTask3; create `src/lib/__tests__/settlement-accountant-close.test.ts`, `db/checks/hh-accountant-close.sql`.

**Interfaces:** `proveAccountantHandoverClose(actor, snapshot, bill, external:ExternalMatchProof, cases:AccountantCaseBinding[]):EvidenceResult<AccountantHandoverCloseProof>` consumes only server-bound evidence and durable scoped case bindings `{caseId,version,kind,documentIds}` fromTask3. Guest bill outstanding must be0. Opaque `AccountantHandoverCloseProof` is a distinct accepted close policy stored with the existing close revision fence. OTA leg extension belongs to the source planTask5.

- [ ] Write failing tests `settled_guest_bill_with_surplus_case_closes`, `unpaid_bill_review_flag_cannot_close`, `omitted_surplus_case_refuses_close`, `foreign_or_or_case_refuses_close`, `changed_case_version_refuses_close`, `unknown_post_result_stays_held`. Assert current proof path remains intact; neither generic remainder-guard deletion nor Owner note creates proof.

```ts
expect(withSurplusCase.kind).toBe('confirmed');
expect(unpaidGuest.kind).toBe('contradiction');
expect(omittedCase.kind).not.toBe('confirmed');
```
- [ ] Run task tests and existing `settlement-close.test.ts`; expect RED for the new policy.
- [ ] Implement an additive policy branch binding zero guest outstanding, owned matches, accepted journal/status evidence and linked unresolved cases. Store/SQL compares exact intent snapshot/revision/case versions and performs all-room close/Dirty/DNDoff atomically. Receipt remainder may remain unresolved only as an explicit bound case; it cannot fund another match or mask unknown guest bill.
- [ ] Require unit/native SQL PASS for all-room rollback, two simultaneous close calls, case omission and changed evidence; run existing lock/mutation tests. Commit task files without editing any applied migration.

### Task 5: Owner list, export, recovery card and all readers

**Files:** Create `src/components/AccountantReview.tsx`, `src/lib/accountant-review-client.ts`, `src/lib/accountant-review-export.server.ts`, `src/routes/accountant-review.tsx`, `src/routes/api/hotel/accountant-review.ts`, `src/routes/api/hotel/accountant-review.$caseId.ts`, `src/routes/api/hotel/accountant-review.statements.ts`, `src/routes/api/hotel/accountant-review.statements.$statementId.ts`; modify `src/components/AppShell.tsx`, `SettlementCard.tsx`, `src/lib/workspace-tabs.ts`, `settlement-view.ts`, `settlement-client.ts`, `financial-reporting-store.server.ts`; test `src/lib/__tests__/accountant-review.test.ts`.

**Interfaces:** Client list follows `AccountantCasePage`; explicit statement creation/read followsTask3. `renderAccountantStatement(statement:AccountantStatement):{html:string;csv:string}` escapes all text and spreadsheet formulas, prints availability/completeness/as-at/checked time; CSV is a case report, not sales/receipt collections.

- [ ] Write failing tests `front_desk_has_only_booking_guidance`, `owner_as_at_list_carries_months`, `saved_print_unchanged_after_resolution`, `auth_failure_hides_stale_amounts`, `csv_formula_escaped`, `case_presence_not_counted_as_new_cash`, `external_match_no_apply_button`, `reader_refresh_keeps_scope`. Assert12 guidance categories, same-document recovery, safe N3 links only from saved identities, report GET/print zero mutation spies.

```ts
expect(frontDeskHtml).not.toContain('Export accountant report');
expect(monthlyCollectionsAfterCaseCarryForward).toBe(beforeCollections);
expect(printMutations).toHaveLength(0);
```
- [ ] Run `npm test -- src/lib/__tests__/accountant-review.test.ts`; expect RED. Implement responsive Owner table, filters/history/notes/review and explicit verified resolution actions; Front Desk sees short guidance. Integrate settled-stay/open-accounting-case status and scoped cache invalidation across Reservation, Departures, Folio/print and Monthly Finance without introducing source partial totals.
- [ ] Require task tests, TypeScript, changed-file lint and one final full suite/build to PASS; retain documented baseline lint debt separately. Inspect installed browser/mock availability before mobile/desktop test; if unavailable report NOT VERIFIED, not a fabricated pass. Do not repeat earlier completed proof jobs. Obtain one final independent code review using the native method before any release.
- [ ] Commit exact candidate/evidence. Verify remote review tree with a nonforce push. Main merge, operational schema activation, N3 contract acceptance and public publication require their exact verified release inputs; no Lovable AI Build. Record which tests are fresh and which live behaviors remain unverified.

## Order, approval and acceptance checkpoint

First preserve/recover OR2610/001 under `HH_RECEIPT_CORRECTION_RECOVERY_20261009.md`;
this plan neither edits that N3 document nor turns on dormant automatic Update.
Execute these five tasks natively after the scoped plan review. Source-billing
uses Task3 case persistence and Task4 close foundations, then introduces distinct
OTA/guest legs. Security cash has its own written specification and separate
custody schema; never put security funds into these N3 receipt balance calculations.

The accountant design and this implementation plan are approved with that
amendment. Existing authorization and native method remain valid. No product
implementation or new test/build run occurred while writing this amendment.
