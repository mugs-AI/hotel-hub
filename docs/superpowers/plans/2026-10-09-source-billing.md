# Booking Sources and Separate Payer Bills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Preserve the previously selected native execution method.

**Goal:** Give one stay distinct OTA and guest bills, source-based customer/collection settings and truthful printable documents.

**Architecture:** Add versioned source policies and reservation payer snapshots, then partition frozen folio lines into independently dispatched billing legs. Reuse the existing dispatch, evidence and lock foundation with leg-scoped identities. Checkout verifies each guest bill is paid and each source bill is issued to its debtor with a durable accountant case.

**Tech Stack:** Existing TypeScript, TanStack Start/Query, Vitest, PostgreSQL, N3 adapters and current browser/print tooling; no new packages.

**Spec:** `docs/superpowers/specs/2026-10-09-source-billing-design.md` (Owner-approved09/10). Cases/externally performed matching use the interfaces in `2026-10-09-n3-accountant-handover.md`.

## Global Constraints

- "Guest charges must be verified settled before checkout." A correctly configured source bill may remain outstanding for accountant reconciliation; never label it Paid.
- "Suppression affects only the guest copy; accounting copy and N3 payload retain exact amounts and taxes."
- "Room amount is not changed to RM211.66 or zero." Commission/net settlement remains N3 accountant-owned.
- Source name does not establish collection mode; Agoda Property Collect and prepaid variants, and guest-paid website bookings, must work.
- Each leg has its own frozen customer, intent/reference and durable dispatch. Unknown results use read-only recovery, not repeat POST.
- Preserve completed Tasks1–8 and old single-bill intents; no retroactive reassignment/repricing/renumbering of issued documents or OR2610/001.
- N3 customer/stock/UOM/tax IDs are verified integers; external document GUID guards remain N3-specific. No unverified code→ID conversion.
- Financial evidence/master/mutation gates stay independently closed until accepted; a guest print title is not an N3 document type.
- Protect `AGENTS.md`, dependency/lock/start/integration files and `hotel-store.server.ts`; adapt source-specific modules without hand-editing protected generated types.
- New schema is additive. Inspect actual history and use `supabase migration new hh_source_billing`; record the generated exact filename. SQL checks use isolated PostgreSQL; no operational migration or N3 proof job is implied by code preparation.

## Review Focus

1. An Agoda guest-pay voucher must still permit room payment (Task1/Task4).
2. OTA/private room prices must not leak through totals, CSV, print headings or unit-price columns (Task6).
3. Discounts/taxes or room reassignment must not duplicate/drop charges across legs (Task2).
4. One successful bill followed by an unknown second result must preserve the first and block replay (Task3/Task4).
5. A guest deposit must not settle the OTA customer's bill, and unresolved security cash cannot masquerade as a guest OR (Task5).

## Shared interfaces

Create `src/lib/source-billing.ts`:
`CollectionMode = 'guest'|'source'`;
`SourceBillingPolicy = {sourceId:string;version:string;defaultCollectionMode:CollectionMode;allowedCollectionModes:CollectionMode[];sourceCustomerId:number|null;guestCustomerId:number;guestDocumentTitle:string;guestItemDescription:string;showRoomPrices:boolean}`.
`ReservationPayerSnapshot = {policy:SourceBillingPolicy;collectionMode:CollectionMode;confirmedBy:string;confirmedAt:string}`; actor fields are populated server-side.
`BillingLegKind = 'source_room'|'guest'`;
`BillingLegSnapshot = {legId:string;kind:BillingLegKind;customerId:number;collectionMode:CollectionMode;documentTitle:string;itemDescription:string;showPrices:boolean;snapshot:SettlementSnapshot}`.
`SourceBillPlan = {version:1;scope:SettlementScope;payer:ReservationPayerSnapshot;legs:BillingLegSnapshot[];totalCents:number;digest:string}`.

`LegStoredIntent = StoredIntent & {legId:string;legKind:BillingLegKind;planDigest:string}` and `SourceStayView = {reservationId:string;revision:string;planDigest:string;legs:Array<{legId:string;kind:BillingLegKind;view:SettlementView}>;blockers:string[];canClose:boolean}` live in `source-billing-store.server.ts`/browser-safe view types respectively. Never serialize credentials.

Leg snapshots use stable persisted local UUIDs, not customer code/room number. Existing `SettlementSnapshot` and proofs remain the unit for one debtor bill. New wrapper APIs own multi-leg orchestration; don't rewrite single-leg APIs into a magic two-customer payload.

### Task 1: Source policies, compatibility mapping and booking payer confirmation

**Files:** Create `src/lib/source-billing.ts`, `source-billing-policy.server.ts`, `src/lib/__tests__/source-billing-policy.test.ts`; modify `booking-sources-store.server.ts`, `reservations-client.ts`, `reservations-store.server.ts`, `src/routes/settings.tsx`, `src/components/PropertySettingsPanels.tsx`, existing booking-source API routes and reservation entry; create CLI-generated migration `hh_source_billing`.

**Interfaces:** `readSourceBillingPolicy(actor:SettlementActor,sourceId:string):Promise<EvidenceResult<SourceBillingPolicy>>`; `updateSourceBillingPolicy(actor,input:{sourceId:string;expectedVersion:string;policy:SourceBillingPolicy}):Promise<SourceBillingPolicy>` requires Owner/current N3 master checks; `confirmReservationPayer(actor,mode:CollectionMode,expectedRevision:string):Promise<ReservationPayerSnapshot>`. Persist confirmed snapshot when booking is created; subsequent payer/customer changes require Owner and an unfrozen reservation.

- [ ] Write failing tests `walkin_mapping_migrates_once`, `agoda_permits_configured_guest_collect`, `website_source_name_does_not_hide_payment`, `inactive_wrong_tenant_customer_rejected`, `settings_change_does_not_reassign_existing_stay`, `frontdesk_cannot_change_frozen_payer`. Example assertion:

```ts
expect(policy.allowedCollectionModes).toEqual(['guest', 'source']);
expect(confirmed.collectionMode).toBe('guest');
expect(existingFrozenPayer).toEqual(beforeSettingsChange);
```

- [ ] Run `npm test -- src/lib/__tests__/source-billing-policy.test.ts`; expect RED.
- [ ] Generate additive source-policy/reservation-payer schema with compound tenant/source/reservation FKs and version fencing. Copy the existing walk-in mapping as a compatibility default once; preserve legacy settings/readers and historical customer IDs. Missing payer classification on an old OTA stay requires explicit Owner confirmation; never silently assign the new OTA customer. Use fixed trusted current-master readers; missing accepted evidence returns setup-required.
- [ ] Move the editable Default Walk-in customer control into Booking Sources; preserve existing N3 Integration bank/cash aliases. Admin configures permitted modes/default plus customer/title/description/visibility. Snapshot selected mode at reservation entry; Owner-only later change is audited. No source-based financial dispatch yet.
- [ ] Run unit/native migration tests for both preexisting and empty settings, auth/scope/version conflicts and schema-absent compatibility. Commit task files; preserve protected settings-store source.

### Task 2: Charge attribution and immutable two-leg projection

**Files:** Create `src/lib/source-billing-plan.server.ts`, `src/lib/__tests__/source-billing-plan.test.ts`; modify `settlement-snapshot.server.ts`, `settlement-folio.server.ts`, `folio-store.server.ts`, `src/components/FolioCard.tsx` and folio adjustment APIs for explicit payer attribution, extending Task1 candidate schema.

**Interfaces:** `partitionSourceBill(snapshot:SettlementSnapshot,payer:ReservationPayerSnapshot,attribution:ReadonlyMap<string,BillingLegKind>,legIds:{source:string;guest:string}):EvidenceResult<SourceBillPlan>`. `attribution` maps stable local line IDs to one leg. Room-night charges default to source_room only for source collection; guest mode puts rooms/extras in guest. New extras default guest; Owner can approve source-paid extras before freeze. Non-line/header adjustments need explicit leg attribution before partition.

- [ ] Write failing tests `rm300_room_rm80_extras_split`, `direct_stay_remains_one_guest_bill`, `tax_rounding_discount_cents_conserved`, `unassigned_shared_adjustment_blocks`, `foreign_receipt_excluded_from_source_leg`, `zero_empty_leg_omitted`, `source_master_change_does_not_reprice_frozen_plan`. Assert30000/8000 on explicitly tax-inclusive fixture, total38000, distinct customers, each original line appears exactly once, combined subtotal/tax/total equals original.

```ts
expect(plan.legs.map(l => l.snapshot.totalCents)).toEqual([30000, 8000]);
expect(plan.totalCents).toBe(38000);
expect(plan.legs[0].customerId).not.toBe(plan.legs[1].customerId);
```
- [ ] Run task test; expect RED. Implement lossless partition of existing computed financial facts, not recomputation from net remittance. Taxes follow their attributed taxable lines; tourism tax/local levies require explicit current collection evidence to avoid collecting an OTA-paid levy twice. Shared discount/service/rounding adjustments must be allocated explicitly to legs before freeze, with preserved original totals and tax classifications. Unsupported existing charge/master mappings remain blockers; do not invent N3 line semantics to make a split pass.
- [ ] Persist plan/leg membership and frozen print/payer facts under the existing reservation lock; membership, new lines, room changes and adjustments participate in revision/digest fencing. Guest ORs are linked only to the guest leg with exact booking/customer ownership. Security holdings are excluded entirely.
- [ ] Require task tests plus current snapshot/folio/tax/lock regressions PASS, including change of source defaults after freeze and a multi-room reservation. Commit task files.

### Task 3: Leg-scoped intent ownership and stable HotelHub numbering

**Files:** Create `src/lib/source-billing-store.server.ts`, `document-series.server.ts`, `src/lib/__tests__/source-billing-store.test.ts`, `src/lib/__tests__/document-series.test.ts`, `db/checks/hh-source-billing.sql`; extend candidate schema and exact intent ownership adapters in `settlement-store.server.ts`, `settlement-dispatch.server.ts`.

**Interfaces:** `SourceBillStore.freeze(actor:SettlementActor,plan:SourceBillPlan,requestId:string):Promise<SourceStayView>`; `read(actor):Promise<SourceStayView|null>`; `readLeg(actor,legId:string):Promise<LegStoredIntent>`; `reserveDocumentNumber(actor,series:'bill'|'receipt'|'refund',stableOperationId:string,documentDate:string):Promise<{hhNumber:string}>`. Series formats start `SIyymmNNNNN`, `ORyymmNNNNN`, `RFyymmNNNNN`; numbers are local identifiers until N3 acceptance is proven. Refund series supplies identifiers only, no refund writer.

- [ ] Write failing tests `one_booking_two_distinct_intents`, `leg_claim_cannot_use_sibling_intent`, `same_request_same_numbers_replay`, `twenty_concurrent_numbers_unique`, `period_uses_property_date`, `old_single_bill_intent_remains_readable`, `number_overflow_denied`. Assert the example SI261000001/SI261000002, nonreused numbers, exact stable-operation replay and tenant isolation. Existing issued document numbers never change.

```ts
expect(new Set(numbers).size).toBe(20);
expect(replayed.hhNumber).toBe(original.hhNumber);
await expect(claimSiblingIntent()).rejects.toThrow('settlement_scope_mismatch');
```
- [ ] Run task tests/isolated SQL; expect RED. Add stable plan/leg/intent association and per-leg active uniqueness while preserving legacy single-intent reads. Update service-owned RPCs with explicit leg scope; a read that expects one legacy intent cannot select an arbitrary leg when two exist. Reserve counter/operation mapping in the same SQL transaction, preserve consumed numbers on cancellation and fence revisions. No SQL transaction spans an N3 request.
- [ ] Store HH number, immutable N3 UUID and actual returned N3 code separately. Preserve current accepted immutable reference construction for legacy intents; new leg references include stable leg operation identity under the adapter's accepted length/format. Numbering fields are not sent to N3 until a per-document contract accepts them.
- [ ] Require native multi-session/role/FK/revision checks and unit regressions PASS; old snapshot lacks new fields safely retains legacy behavior. Commit task files/candidate SQL.

### Task 4: Two-leg coordination with preserved partial success

**Files:** Create `src/lib/source-billing-coordinator.server.ts`, `source-billing-n3.server.ts`, `src/lib/__tests__/source-billing-coordinator.test.ts`; modify `n3-billing.server.ts`, `settlement-contracts.server.ts`, `settlement-adapter.server.ts`; create `src/routes/api/hotel/reservations.$id.source-billing.ts`, `src/routes/api/hotel/reservations.$id.source-billing.step.ts`, `src/routes/api/hotel/reservations.$id.source-billing.reconcile.ts`.

**Interfaces:** `runSourceBillStep(actor,input:{legId:string;expectedRevision:string;action:SettlementStepInput},deps:SourceBillingDeps):Promise<SourceStayView>`; `reconcileSourceBills(actor,planDigest:string,deps):Promise<SourceStayView>`. `SourceBillingDeps` supplies Task3 store/leg reads and existing `SettlementDeps`, accepted per-leg document adapter, fresh actor and clock. Source leg permits bill issue/check; receipt creation/allocation actions require guest leg, even if browser calls API directly.

- [ ] Write failing tests `first_bill_success_second_timeout_no_repost`, `concurrent_double_click_one_claim_per_leg`, `source_receive_balance_rejected_before_post`, `guest_leg_can_receive_when_contract_accepted`, `401_ends_session_preserves_unknown`, `different_returned_code_displayed_honestly`. Assert create calls max1 per saved claim, recoveryGET only, sibling bill IDs cannot satisfy another leg's proof, unknown sibling blocks close.

```ts
expect(sourceCreateCalls).toHaveLength(1);
expect(guestCreateCalls).toHaveLength(1);
expect(sourceReceiptCreate).not.toHaveBeenCalled();
expect(afterRecovery.canClose).toBe(false);
```
- [ ] Run task tests; expect RED. Reuse single-leg coordinator under new explicit leg store scope; new UI calls one leg action at a time and retains completed sibling facts. Never replay both documents after failure. Preserve all original identity/status/journal/money gates and unknown-outcome rules.
- [ ] Implement a fixed Sales Invoice read/create adapter only behind a separately accepted contract; a proven Post-to-AR Cash Sale adapter may serve the source leg only with accepted debtor/credit behavior. Prepare an exact bounded Owner sandbox manifest for newly required document/number semantics, listing unique new references, calls, readback and no automatic cleanup. Completed CS/OR/refund/matching tests are not repeated. No N3 financial job runs merely to finish this task.
- [ ] Require unit/API regressions PASS and zero enabled writes when contract evidence is absent. Record outstanding real API/number acceptance accurately. Commit task files; mocked PASS is not N3 acceptance.

### Task 5: Guest-settled/source-issued close and accountant linkage

**Files:** Create `src/lib/source-billing-close.server.ts`, `src/lib/__tests__/source-billing-close.test.ts`, `db/checks/hh-source-close.sql`; modify Task3 store/candidate SQL, existing close proof/HTTP integration and accountant case interfaces.

**Interfaces:** `proveSourceStayClose(actor,plan:SourceBillPlan,legs:ReadonlyArray<LegCloseEvidence>,cases:AccountantCaseBinding[]):EvidenceResult<SourceStayCloseProof>`; `LegCloseEvidence={legId:string;intent:LegStoredIntent;bill:VerifiedBill;guestProof:AccountantHandoverCloseProof|SettlementProof|null}` from each existing opaque prover. Every guest leg needs its proof; source leg needs issued noncancelled correct-debtor bill/detail/journal proof and a scoped durable ota_receivable case when outstanding>0. No bill's proof is copied across legs.

- [ ] Write failing tests `ota300_outstanding_guest80_paid_closes`, `guest_one_cent_unpaid_refuses`, `wrong_source_customer_refuses`, `missing_source_bill_or_case_refuses`, `guest_or_cannot_pay_ota`, `security_cash_not_bill_payment`, `changed_case_or_leg_revision_refuses`, `all_rooms_close_atomically`. Assert source outstanding30000 persists as outstanding/issued, not0/Paid; no extra OR appears.

```ts
expect(verifiedStay.canClose).toBe(true);
expect(verifiedStay.legs[0].view.bill?.outstandingCents).toBe(30000);
expect(withGuestOutstandingOneCent.canClose).toBe(false);
```
- [ ] Run task tests/current close tests; expect RED. Implement explicit source policy using accountant planTask3/Task4 cases/close evidence. SQL transaction compares plan/each intent/case revision under the reservation lock, closes every room, applies Dirty/DNDoff once and keeps accountant cases open. Existing single guest-bill policy remains strict.
- [ ] Require native SQL concurrent close/late mutation/rollback and current freeze tests PASS; prove Owner cannot bypass unpaid guest bill through case review or a UI flag. Commit task files.

### Task 6: Frozen guest print, checkout presentation and final validation

**Files:** Create `src/lib/source-billing-presentation.ts`, `src/components/SourceBillingCard.tsx`, `src/lib/__tests__/source-billing-presentation.test.ts`; modify `src/components/SettlementCard.tsx`, `FolioCard.tsx`, `src/routes/reservations.$id_.folio-print.tsx`, `src/lib/folio-presentation.ts`, `folio-view.ts`, `settlement-client.ts`, `settlement-view.ts`, `checkout-preview.server.ts`, `financial-reporting-store.server.ts`.

**Interfaces:** `presentSourceBill(leg:BillingLegSnapshot,verified:VerifiedLegDisplay|null,audience:'guest'|'accounting'):SourceBillPresentation` returns frozen title/description, `showPrices`, rendered monetary columns and verified document identifiers. `VerifiedLegDisplay={hhNumber:string;n3Number:string;n3Id:string;checkedAt:string;status:'issued'|'paid'|'unavailable'}` is derived server-side, not from guest-provided data. Accounting copy always retains amounts/taxes; source guest copy suppresses room unit/subtotal/total amounts throughout the document and clearly states charges are handled by the booking source.

- [ ] Write failing tests `agoda_sales_title_and_description_frozen`, `guest_copy_contains_no_ota_prices_or_totals`, `guest_extras_sales_invoice_keeps_rm80`, `accounting_copy_retains_rm300_and_tax`, `formal_invoice_not_mislabelled`, `unverified_document_not_printed_as_final`, `source_changed_after_issue_no_print_change`, `two_documents_link_same_booking`. Assert N3 payload amounts unchanged; guest extras receive button present and source-room button absent; generated PDF/HTML no leaked room amount in hidden columns or summaries.

```ts
expect(otaGuestCopy.title).toBe('Agoda Sales');
expect(otaGuestCopy.showPrices).toBe(false);
expect(extrasGuestCopy.title).toBe('Sales Invoice');
expect(n3RoomPayload.itemDetails.reduce((sum, row) => sum + row.netAmount, 0)).toBe(300);
```
- [ ] Run task tests; expect RED. Implement per-leg final print and clearly labelled prepared folio/guest statement. Custom title is presentation only; formal N3/e-Invoice type and mandatory fields remain authoritative. Use a guest accommodation statement when suppression conflicts with formal invoice requirements. Do not promise one combined final invoice for two customers.
- [ ] Complete all-reader invalidation using existing scoped revision handling; Owner finance counts verified bill/receipt sources once, excludes security cash and does not turn accountant carry-forward into monthly sales. No partial source becomes an authoritative total.
- [ ] Require TypeScript, changed-file lint, targeted regressions and one final full suite/build PASS. Inspect actual installed browser tooling before mobile/desktop walkthrough/print; any unavailable browser acceptance is reported NOT VERIFIED. Use native final independent code review, correct findings, commit tested tree and nonforce review push with fresh exact tree verification. No Lovable AI Build.
- [ ] Record accepted API contracts, candidate migration path, final suite counts, review result and remaining live tests. Only then evaluate previously authorized main/backend/public release against the exact reviewed scope; publication alone cannot apply migration or prove financial writes.

## Execution handoff

Priority1 remains the existing receipt correction. The same N3 OR must be corrected
and verified; this plan neither reclassifies it nor enables an unaccepted Update.
Then implement accountant handover foundations and source-billing tasks in dependency
order, reusing finished work. Security cash is a separate optional module and does
not enter these plans' N3 allocation code. Written source design is approved; this
new scoped implementation plan awaits consolidated review, with native execution
already selected. Upload to Project Sources: **No** — engineering plan, not release evidence.
