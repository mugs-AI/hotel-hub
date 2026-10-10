# HH1.0 N3 Billing Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn one prepared stay into one proven N3 Post-to-AR Cash Sale, correctly allocate its receipts, receive any positive balance and close every room safely.

**Architecture:** Add a focused durable settlement service around the existing folio and receipt primitives. Persist immutable intent and dispatch fences, add database guards for every financially relevant mutation, and verify external evidence before atomic local close. New financial transports remain disabled until their specific API proofs are accepted.

**Tech Stack:** Existing TypeScript, TanStack Start/Nitro, React, Vitest 4.1.10 and Lovable Cloud PostgreSQL/Supabase. No new application dependencies or authentication platform.

**Spec:** `docs/superpowers/specs/2026-10-08-n3-billing-settlement-design.md`, approved by the user on 08/10/2026 at 07:39 Malaysia time; approval applies to the specification at commit `ca485ad285c4411be5019e3b80aa695334708993`.

Date: 08/10/2026, Asia/Kuala_Lumpur. Upload to Project Sources: **No**.
Status: complete written implementation plan awaiting review; execution method already chosen: direct repository coding/testing, inline through executing-plans. No subagent implementation is selected by this plan.

## Global Constraints

- Direct repository coding/testing on a review branch; keep Lovable hosting and Lovable Cloud backend; never send Lovable AI Build messages.
- This first settlement writer and final close are Owner-only; existing Front Desk checkout viewing remains available.
- Amounts use checked integer minor units. The existing prepared folio is the only charge calculator; never add room nights a second time.
- Preserve independently closed gates for split API writes, refund, unmatch, void, replacement and automatic correction.
- A review branch is not a separate database environment. No shared DB writes or N3 transactions during automated tests.
- Customer, currency, stock, UOM and tax schema IDs are integers; bill/receipt IDs and accountId are UUIDs. Preserve lossless int64 revision evidence.
- After external dispatch, uncertainty prevents another financial POST. A 401 also terminates the session. GET-only recovery cannot turn a missing search result into proven absence.
- Monthly >100 receipt verification candidates remains Unavailable, never a partial total. Sales/Collections remain Unavailable until authoritative sources and complete reads are accepted.
- Keep N3-only server auth, current Owner allowlist, HttpOnly session, server tenant identity and separate merge/DB/runtime/N3/publish approvals.
- Do not alter AGENTS.md, package/lock files, src/start.ts, src/integrations/* or protected hotel-store.server.ts. Use existing server integration imports. Any genuinely necessary protected change is a separately reviewed exception, not part of this plan.
- Existing automatic-correction code and its unapplied `20261003120216` migration remain parked. Do not ship unrelated uncommitted product changes in this billing candidate.

## Review Focus

1. Shared walk-in customer with another booking's receipt: ownership comes from immutable reservation linkage, never customer equality (Tasks 1, 2, 7).
2. Deposit/correction already dispatched while billing freeze begins: refuse freeze and preserve the existing uncertain transaction (Task 3).
3. Malaysian midnight and a bill/receipt dated in different months: use each authoritative N3 document date, without counting allocation as cash (Tasks 1, 10).
4. Success response followed by contradictory journal/detail, or token revocation after dispatch: retain Needs review and end the invalid session without reposting (Tasks 4, 5, 7, 9).
5. Code synced while additive SQL is unapplied: existing preview works and settlement writers are disabled, with an honest setup status (Tasks 3, 8, 9).

## Starting state and execution setup

Fresh review is `ca485ad285c4411be5019e3b80aa695334708993`; main/Lovable latest is `734ac405c82e653a7098ce0ef22d51586382bd9d`. Lovable project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`, workspace `JRQygHE7tZl2GgPN8a8N`; backend configured reference `fkakhdzelilnejyehwfk`. Fresh database history still has receipt versions `20261002053219` and `20261002053302`, no automatic-control or checkout ledger candidate. Lovable reports ready/agentFinished. No local build/test process was found during this planning inspection.

The current hh-review local HEAD is `b4a783f3ba3a90a743905ea65374e36e8f4297a7`, with pre-existing dirty work preserved. A fresh GitHub comparison shows the review branch is18 commits ahead of main and includes parked automatic-control product changes, not only documentation. Therefore the billing execution branch must use verified main product source, not the combined review source. Read the using-git-worktrees skill at execution time. Reverify main; create dedicated `review/hh-n3-billing-20261008` from `734ac405c82e653a7098ce0ef22d51586382bd9d` (or a newly inspected accepted main), then copy only the approved specification/plan and required documentation from their immutable review commits. Record both product-base SHA and documentation approval SHA. Preserve the parked review branch untouched.

Fetch the actual product-base object before worktree creation. If native fetch cannot access it, use the authorized GitHub connector to obtain that exact main tree into a new isolated directory and record its content/tree baseline; do not copy dirty source as the release baseline or reset either existing checkout. Keep the product parent SHA explicit in GitData commits when that connector is the persistence mechanism. If an existing file differs between main and review, implement against main's deployed path and keep the parked future adapter out of this candidate.

Run the existing 3-file checkout baseline in the isolated execution tree and preserve output. The previous 115-pass result belongs to the earlier dirty local tree, not this new execution candidate. Compare protected blobs to the baseline, record pre-existing drift and retain it unchanged. Reuse installed dependencies only when package and lock hashes match; do not silently install a different resolution.

No psql/initdb/pg_ctl/docker executable was found on PATH during planning. True PostgreSQL multi-session validation is a required later capability, not a passing or skippable check. Existing historical receipt SQL runners use Bun and a throwaway PostgreSQL server; do not assume those runtimes remain available. Task 3 defines a new psql-based runner that needs only existing Node plus a separately available disposable local PostgreSQL instance. If unavailable, finish independent code/mock tests and identify this exact acceptance blocker; do not point tests at Lovable Cloud.

## File and interface map

| Files | Responsibility |
| --- | --- |
| `src/lib/settlement.ts`, `settlement-money.ts` | Browser-safe DTOs/state/strict cents and conservation contracts |
| `src/lib/settlement-snapshot.server.ts` | Prepared folio and immutable charge/receipt binding snapshot |
| `src/lib/settlement-evidence.server.ts` | Strict bill, receipt allocation and journal proof |
| `src/lib/n3-billing.server.ts`, `settlement-contracts.server.ts` | Fixed bounded operations, provenance and closed contract gates |
| `src/lib/settlement-store.server.ts`, `settlement-coordinator.server.ts` | Durable database port and one-next-step orchestration/recovery |
| `src/lib/settlement-http.server.ts`, `settlement-client.ts` | Authenticated routes and view/request client |
| `src/components/SettlementCard.tsx`, existing checkout page | Compact persisted status and explicit Owner actions |
| `src/lib/settlement-financial-source.server.ts` | Complete authoritative Sales/balance receipt sources |
| `supabase/migrations/20261008080000_hh_billing_settlement.sql` | New ledger, freeze/claims, mutation guards and atomic close |
| `db/checks/hh-settlement-{setup,single}.sql`, `hh-settlement-multisession.mjs` | Disposable PostgreSQL acceptance; never operational DB |

Migration version is reserved only as a candidate filename. Recheck actual history immediately before implementation/application; if occupied, choose a new version and update the execution ledger. Never reuse `20260930210000` or rewrite applied SQL. All new .server.ts modules remain server-only; no new supabase/functions deployment is presumed.

## Shared contract decisions (Task 1 creates these types)

Use `SettlementScope = { tenantId: string; reservationId: string }`; `SettlementActor = SettlementScope & { n3UserKey: string; role: HotelRole; n3Token: string }`, server-only in use, with token never stored in a DTO or SQL JSON. `Revision = string` is a lossless nonnegative decimal string. `Cents = number` is checked as safe integer. `EvidenceResult<T> = {kind:'confirmed'; value:T} | {kind:'contradiction'|'unavailable'; code:string}`.

`SettlementSnapshot` contains scope, folioId, digest, revision, currency, propertyTimezone, billDate, customerId (integer), immutable billTo snapshot, `lines: ChargeLine[]`, totalCents, `receipts: LinkedReceipt[]` and `sourceVersions: Array<{table:string; id:string; version:string}>`. Source table names come from a fixed server/SQL whitelist; timestamps/versions identify the local rows read. Freeze checks them under locks, including row-set membership, so a newly inserted line cannot escape validation. N3 master/detail checks occur outside SQL and again before dispatch. A ChargeLine carries localLineId, integer stockId/uomId/taxCodeId, qty, unit/subtotal/tax/total cents and immutable mapping evidence. Unsupported charge kinds have an explicit blocker; no invented stock or lump-sum mapping. LinkedReceipt carries depositId, UUID receiptId, reference, customerId, account/payment snapshots, amountCents and receiptDate. No booking association is inferred from a customer master.

`SettlementState = 'frozen'|'bill_dispatched'|'bill_verified'|'allocating'|'awaiting_payment'|'balance_dispatched'|'settled'|'closing'|'closed'|'needs_review'|'abandoned'`. `Intent` contains id, scope, revision, state, snapshot and dispatch history. `StepKind = 'bill'|'deposit_allocation'|'balance_receipt'|'balance_allocation'`. `DispatchClaim` contains attemptId, intentId, step kind, receiptId when relevant, expectedRevision and immutable payloadDigest. `SettlementProof` contains digest, exact bill/receipt IDs, confirmed balances, doc dates, checkedAt and evidence fingerprints; it is never constructed from browser DTOs. `SettlementView` exposes scope, intentId/null, revision, state, confirmed bill/receipt display facts, readiness/blocker codes and allowed actions, with no token/raw journal.

`SettlementStepInput` is `{action:'post_bill'; clientRequestId:string; snapshotDigest:string; expectedRevision:Revision; intentId?:string}` or `{action:'apply_deposits'|'receive_balance'|'close'; intentId:string; expectedRevision:Revision; selectedAccountId?:string}`. Before an intent exists, the read-only view includes snapshotDigest and revision:'0'; post_bill rebuilds/compares the snapshot and freezes it atomically using clientRequestId before its one bill dispatch. It does not require an extra UI freeze click. `DispatchOutcome = {kind:'confirmed'|'rejected'|'unknown'; code:string; documentId?:string; httpStatus?:number}`. `AcceptedContract = {operation:StepKind; evidenceHash:string; concurrencyProofHash:string|null; allocationMode:'preserve_existing'|null}`; allocations require both accepted hashes and a supported mode.

---

### Task 1: Strict money, ownership and view contracts

**Files:** Create `src/lib/settlement.ts`, `src/lib/settlement-money.ts`, `src/lib/__tests__/settlement-money.test.ts`, `src/lib/__tests__/fixtures/settlement.ts`.
**Interfaces:** Produce the shared types above; `receiptRemainder({amountCents,allocatedCents,refundCents}: {amountCents:Cents; allocatedCents:Cents; refundCents:Cents|null}): EvidenceResult<Cents>` and `planAllocation({receiptRemainderCents,billOutstandingCents}: {receiptRemainderCents:Cents; billOutstandingCents:Cents}): EvidenceResult<Cents>`. Fixture `settlementFixture(overrides?: Partial<SettlementSnapshot>): SettlementSnapshot` uses synthetic reservation IDs, MYR500 bill and MYR50 deposit, separate from the real disputed receipt.

- [ ] Write failing tests `conserves_refunded_receipt`, `missing_refund_is_unavailable`, `never_allocates_over_remaining`, `rejects_unsafe_or_fractional_cents` and `keeps_bill_and_receipt_dates_distinct`.
  Assertions: `receiptRemainder({amountCents:10001,allocatedCents:6001,refundCents:4000})` confirms 0; null refund is unavailable; allocation of remainder5000 to outstanding3000 confirms3000; unsafe/fractional/negative inputs contradict; fixture billDate08/10 and receiptDate30/09 remain distinct.
- [ ] Run `npm test -- src/lib/__tests__/settlement-money.test.ts`; require RED for missing new behavior, then implement signatures using checked integer arithmetic/reuse checkout-money without changing its existing behavior.
- [ ] Re-run that command and existing checkout baseline; require all assertions green. Commit only this task's files as `feat: add settlement money and identity contracts`.

### Task 2: Frozen charge snapshot and exact receipt binding

**Files:** Create `src/lib/settlement-snapshot.server.ts`, `src/lib/__tests__/settlement-snapshot.test.ts`; read existing `folio-store.server.ts`, `effective-receipts.ts`, `checkout-preview.server.ts` without unrelated refactoring.
**Interfaces:** `loadSettlementSnapshot(actor: SettlementActor, deps: SnapshotDeps): Promise<EvidenceResult<SettlementSnapshot>>`. SnapshotDeps provides scoped reservation/folio/line/tax/contact/settings/deposit/effective-version reads, master verification and `now(): Date`; no mutation or N3 POST methods. `snapshotDigest(snapshot: Omit<SettlementSnapshot,'digest'>): string` uses deterministic ordered canonical facts.

- [ ] Write failing tests `same_customer_foreign_receipt_is_excluded`, `reversed_pair_does_not_double_charge`, `later_settings_cannot_reprice_snapshot`, `unsupported_rounding_mapping_blocks`, `snapshot_read_creates_nothing`, `historical_charge_gap_blocks`.
  Assertions: an alien reservation's receipt never appears; exact linked reversal pair contributes0 while an unrelated equal charge survives; current setting changes leave frozen lines unchanged; unsupported mapping returns contradiction; all write spies have0 calls; missing historical charge evidence blocks.
- [ ] Run `npm test -- src/lib/__tests__/settlement-snapshot.test.ts`; verify RED. Implement scoped reads, active integer master-ID proof, exact bill-to/tax/stock/UOM snapshots and prepared total reconciliation. A snapshot built outside SQL carries expected row versions/digest for Task 3 to compare atomically, never authority to claim by itself.
- [ ] Re-run task tests and folio/checkout baselines. Commit `feat: derive immutable settlement snapshots`.

### Task 3: Durable claims and database freeze across all mutation paths

**Files:** Create candidate migration above, `src/lib/settlement-store.server.ts`, `src/lib/__tests__/settlement-store.test.ts`, `db/checks/hh-settlement-setup.sql`, `hh-settlement-single.sql`, `hh-settlement-multisession.mjs`; modify error mapping in `deposits-store.server.ts`, `folio-store.server.ts`, `reservations-store.server.ts`, `reservation-operations.server.ts`, `receipt-controls-store.server.ts` and the deployed `src/routes/api/hotel/reservations.$id.folio.bill-to.ts` as needed for `settlement_locked`. Do not import the parked review-only folio-bill-to-controls.server.ts or automatic policy store.
**Interfaces:** `SettlementStore` methods `read(scope): Promise<Intent|null>`, `freeze(actor,snapshot,clientRequestId): Promise<Intent>`, `claim(actor,intentId,revision,step,payloadDigest): Promise<DispatchClaim|null>`, `recordOutcome(actor,claim,outcome): Promise<Intent>`, `recordProof(actor,intentId,revision,proof): Promise<Intent>`, `abandonUnused(actor,intentId,revision): Promise<Intent>`, `close(actor,intentId,revision,proofDigest): Promise<Intent>`. All actor parameters are server-derived. Outcome includes classified known rejection/unknown/confirmed; recordProof accepts only a Task 5 server-produced SettlementProof.

Type parameters explicitly: scope is SettlementScope; actor is SettlementActor; snapshot is SettlementSnapshot; revision is Revision; claim is DispatchClaim; outcome is DispatchOutcome; proof is SettlementProof; intentId/payloadDigest/proofDigest/clientRequestId are string. Same freeze key plus same digest replays, conflicting digest rejects. claim takes `step: {kind:StepKind; receiptId?:string}`. Omit token when persisting actor metadata.

- [ ] Write failing mocked store tests and SQL assertions for `one_claim_in_20_sessions`, `cross_tenant_fk_denied`, `pending_deposit_or_receipt_execution_refuses_freeze`, `stale_worker_cannot_record`, `expired_lease_never_redispatches`, `browser_cannot_read_or_execute`, `schema_absent_disables_new_writer`.
  Assertions: exactly1 dispatch owner; no alien FKs; deposit submitting/unknown or unresolved receipt-control execution blocks freeze; stale revision leaves row unchanged; no repeat claim after expiry; anon/authenticated cannot select or execute; missing schema yields setup-required, no fallback direct write.
- [ ] Run `npm test -- src/lib/__tests__/settlement-store.test.ts`; require RED. Create service-only RLS tables `hotel_settlement_intents`, `hotel_settlement_attempts`, `hotel_settlement_evidence`, `hotel_settlement_events`. Use composite tenant/reservation/intent FKs, immutable snapshots/events, unique active intent per reservation and unique step/receipt claims, explicit grants/revokes and pinned function search_path. Add RPCs `hotelhub_settlement_freeze`, `hotelhub_settlement_claim`, `hotelhub_settlement_outcome`, `hotelhub_settlement_prove`, `hotelhub_settlement_abandon`; Task 8 adds the close body. All return stable codes/revision; no SQL transaction spans network.
- [ ] Add trigger guards that acquire the parent reservation lock and reject financially relevant mutations once frozen. Cover hotel_reservations, reservation_rooms/guests, folios/lines, tax_profile/tourism evidence, deposits, receipt-control intents/executions/effective versions and folio_bill_to. Resolve scoped parent IDs for INSERT/UPDATE/DELETE; forbid reparenting. Audit existing hotel_guests/direct contact paths so frozen bill-to cannot change. Do not block unrelated audit/event writes. Preserve service-only atomic close as the sole precise closing transition; no caller-controlled bypass flag.
- [ ] Add tests invoking the actual existing RPCs: `hotelhub_update_reservation_v2`, `hotelhub_direct_operation_v2`, `hotelhub_decide_operation`, `hotelhub_add_folio_line`, `hotelhub_update_folio_line_quantity`, `hotelhub_reverse_folio_line`, `hotelhub_receipt_control_verify_atomic`, plus direct tax/deposit/bill-to updates. Assert locked errors roll back every write. Also prove an already-started deposit cannot be claimed concurrently with freeze, including check/insert race; freeze waits for the same reservation lock and sees the persisted pending intent. Settings/master snapshots are compared again immediately before dispatch; global settings edits do not rewrite an already frozen bill.
- [ ] Guard lock ordering across these existing RPCs: parent reservation first, then intent/folio/receipt rows. Where an old RPC already locks a child first, add a forward replacement definition in this new migration to acquire the parent first, retaining its observed live signature/body behavior. Test both competing lock orders and fail on deadlock; a trigger alone is not sufficient proof. Read live definitions before replacing; never edit old applied migrations.
- [ ] Implement setup runner that refuses non-loopback targets and any database without a dedicated `hh_settlement_test` identity marker. Reconstruct current prerequisite schema/function definitions in the disposable database, then apply candidate migration; list/hash prerequisites and excluded migrations. Do not replay all repository migrations blindly: repository filenames/history differ and unapplied automatic SQL is excluded.
- [ ] Run `psql "$HH_TEST_PG_URL" -v ON_ERROR_STOP=1 -f db/checks/hh-settlement-setup.sql`, then `psql "$HH_TEST_PG_URL" -v ON_ERROR_STOP=1 -f db/checks/hh-settlement-single.sql`, then `node db/checks/hh-settlement-multisession.mjs`. Multi-session runner uses separate psql backends and verifies locking, rollback, winner count and replay; exit0 with all named checks PASS is required. No executable/database means NOT VERIFIED, not skip/pass. Commit `feat: fence settlement intents and reservation mutations` after available checks; record any still-blocked SQL acceptance explicitly.

### Task 4: Fixed bounded N3 transports with closed gates

**Files:** Create `src/lib/n3-billing.server.ts`, `src/lib/settlement-contracts.server.ts`, `src/lib/__tests__/n3-billing.test.ts`; reuse `n3-receipts.server.ts` public client types/functions, preserve generic GET gateway.
**Interfaces:** `N3BillingClient` has `createBill(actor,claim,snapshot): Promise<N3Outcome>`, `readBill(actor,id): Promise<N3Outcome>`, `readBillJournal(actor,id): Promise<N3Outcome>`, `writeAllocation(actor,claim,rows): Promise<N3Outcome>`, `createBalanceReceipt(actor,claim,payload): Promise<N3Outcome>`; receipt detail/journal use existing fixed client. `billingJournalBoundTo(outcome,actor,id): boolean` checks server WeakMap provenance. `billingContractGate(operation: StepKind): EvidenceResult<AcceptedContract>` is unavailable by default; AcceptedContract stores reviewed contract/evidence hash, not a browser/env override.

- [ ] Write tests `arbitrary_url_cannot_be_supplied`, `gate_closed_makes_zero_fetch_calls`, `fixed_paths_and_types`, `oversize_and_timeout_unknown`, `forged_journal_is_untrusted`, `unsafe_int64_rejected_or_preserved`. Assertions: only the documented fixed operation paths dispatch; no caller URL; closed gate0 POST; write30s/read20s/2,000,000-byte ceilings; copied journal JSON has no provenance; contradictory success is not confirmed.
- [ ] Run `npm test -- src/lib/__tests__/n3-billing.test.ts` RED. Implement bounded transport with token only in Authorization header, no automatic fetch retry, abort/response limits and lossless revision extraction. Bind bill/GL response to actual tenant/token/ID. Reference uses `HH-B-` plus immutable intent-derived bounded hex identity within50 chars. Follow documented CashSale itemDetails, isPostToAR:true, no embedded receipt/payment. Balance receipt reuses accepted single account creation shape, omits details and is not inserted as a deposit.
- [ ] Re-run tests plus existing receipt transport guards. Commit `feat: add disabled bounded N3 billing transports`.

### Task 5: Exact bill, allocation and journal provers

**Files:** Create `src/lib/settlement-evidence.server.ts`, `src/lib/__tests__/settlement-evidence.test.ts`; preserve existing deposit creation proof and preview classifier.
**Interfaces:** `proveBill(snapshot: SettlementSnapshot,detail: N3Outcome,journal: N3Outcome,actor: SettlementActor): EvidenceResult<VerifiedBill>`; `proveReceiptBefore(snapshot: SettlementSnapshot,receipt: LinkedReceipt,detail: N3Outcome,journal: N3Outcome,actor: SettlementActor): EvidenceResult<VerifiedReceiptBefore>`; `proveReceiptAllocation(input: {snapshot:SettlementSnapshot; bill:VerifiedBill; receipt:LinkedReceipt; before:VerifiedReceiptBefore; detail:N3Outcome; journal:N3Outcome; actor:SettlementActor}): EvidenceResult<VerifiedAllocation>`; `proveSettlement(snapshot: SettlementSnapshot,bill: VerifiedBill,allocations: VerifiedAllocation[],checkedAt: string): EvidenceResult<SettlementProof>`. VerifiedBill includes exact immutable ID, INV target identity, total/outstanding cents and fingerprints; VerifiedReceiptBefore includes proven full current/prior allocation rows, amount/refund/remainder cents and fingerprints; VerifiedAllocation adds the expected matching result. These are server evidence types, never browser input.

- [ ] Tests assert bill50000=AR debit50000=sales/tax credits sum; exact receipt5000 allocated5000 leaves0; bill outstanding45000. Then synthetic balance45000 allocation leads0 only when both receipts and bound journals agree. Add wrong/nested conflicting IDs, account/currency/customer/date mismatch, extra credit/debit, unapplied vs previously matched contexts, foreign booking, missing refund and cancellation-only cases. `success_then_contradictory_gl` must return contradiction; `receipt_total_equals_allocations_plus_refunds_plus_remainder` must hold.
- [ ] Run `npm test -- src/lib/__tests__/settlement-evidence.test.ts` RED. Implement coherent alias collection/conflict rejection using strict receipt evidence patterns, not legacy first-field-wins helpers. Reject unproven CashSale-to-INV identity. Reuse original receipt detail/journal creation guard for newly created unapplied balance, then a separate matching prover after allocation. A matched receipt never requires changing the creation validator.
- [ ] Re-run new and existing receipt/deposit/checkout proof tests. Commit `feat: prove exact N3 settlement evidence`.

### Task 6: Allocation planning and explicit balance intent

**Files:** Create `src/lib/settlement-allocation.server.ts`, `src/lib/__tests__/settlement-allocation.test.ts`.
**Interfaces:** `buildAllocationRows(snapshot: SettlementSnapshot, bill: VerifiedBill, receipt: VerifiedReceiptBefore, contract: AcceptedContract): EvidenceResult<AllocationPlan>`; VerifiedReceiptBefore is Task 5's proven full before-state including prior rows/refunds. AllocationPlan contains flat typed OR rows, new amount, expected after fingerprint and immutable payloadDigest. `buildBalanceIntent(snapshot,bill,account: VerifiedPaymentAccount): EvidenceResult<BalanceIntent>` produces a positive single-account purpose:'settlement' receipt payload and digest. VerifiedPaymentAccount wraps the existing verified active BCA/BAC-or-CAC detail and immutable ID.

- [ ] RED tests: `stable_receipt_order`, `partial_never_consumes_excess`, `prior_rows_preserved`, `empty_clear_never_sent`, `already_applied_is_get_recovery_only`, `balance_uses_actual_selected_account`, `split_gate_closed`. Assert 5000 remainder/3000 outstanding plans3000; prior foreign rows are preserved only when the accepted contract proves that safe operation, otherwise block; no inferred INV/customer/document IDs; pending account alias change does not reroute immutable ID.
- [ ] Implement only positively proven partial allocation shape. Fresh N3 outstanding determines balance amount; operator selection is re-verified, no /New default routing. Require accepted replace/append and concurrency semantics before returning writable rows. Excess remains Needs review under this first vertical and cannot close. Reject unproven/negative/zero balance create, stock availability warning and unsupported mapping before financial claim.
- [ ] Run `npm test -- src/lib/__tests__/settlement-allocation.test.ts` green. Commit `feat: plan conserved receipt allocations and balance intents`.

### Task 7: One-step orchestration and GET-only recovery

**Files:** Create `src/lib/settlement-coordinator.server.ts`, `src/lib/__tests__/settlement-coordinator.test.ts`.
**Interfaces:** `runSettlementStep(actor: SettlementActor, input: SettlementStepInput, deps: SettlementDeps): Promise<SettlementView>`; `reconcileSettlement(actor: SettlementActor,intentId: string,deps: SettlementDeps): Promise<SettlementView>`. SettlementDeps contains Task 3 store, snapshot builder, fixed clients, contract gates, proof/allocation functions, `now(): Date` and `invalidateSession(reason:string): Promise<void>`. Fresh balance amount never comes from input. Exact-reference lookup is GET-only and only available when its response completeness/identity shape is proven.

- [ ] RED tests for full synthetic500/50/450 flow; two-click/two-device races; crash before/after every dispatch/store boundary; already-written bill/match/receipt recovery; no-result/multiple reference matches; 200 malformed; 500/timeout; 401 before/after write; GL contradiction; unresolved excess; freeze input changed. Assert every uncertain write has exactly1 POST lifetime, future attempts GET only; after-write401 preserves intent and invokes invalidation; local close failure causes0 additional N3 writes.
- [ ] Implement state transitions from the specification using persisted claim before dispatch. Each HTTP action executes at most one bounded financial dispatch; deposit allocations are resumed receipt by receipt through persisted status, avoiding an unbounded request. Before each dispatch re-read exact evidence and reject changed mapping/stale revision; no automatic reissue if contract or external concurrency is unproven. Persist proof/outcome without raw token/journal in public evidence. Lease expiry never resets a dispatch fence.
- [ ] Run `npm test -- src/lib/__tests__/settlement-coordinator.test.ts` green and Task 3 multi-session claim cases where available. Commit `feat: orchestrate settlement without financial retries`.

### Task 8: Fenced close and all-room housekeeping handoff

**Files:** Complete the new migration's `hotelhub_settlement_close`; complete SettlementStore.close; create `src/lib/__tests__/settlement-close.test.ts`; extend the disposable SQL checks.
**Interfaces:** SQL `hotelhub_settlement_close(p_tenant uuid,p_reservation uuid,p_intent uuid,p_expected_revision bigint,p_proof_digest text,p_actor text) RETURNS jsonb`; JS close input matches Task 3. A server-created fresh SettlementProof is persisted first; SQL compares digest/revision, settled state and evidence age, never browser zero.

- [ ] RED tests: two occupied rooms close to checked_out/released/Dirty/DNDoff with one close event; alien room, other occupant, stale digest/revision or room2 failure rolls back room1 and reservation; repeated close returns same outcome. Reject expired evidence using a fixed60-second close window and re-run GET proof before any local close retry. No N3 network inside SQL.
- [ ] Implement lock order reservation→intent→allocations/rooms in stable UUID order; validate scoped occupancy; mark internal closing and complete checked_out/released/hand-off/audit in the same transaction. Reuse existing hk enqueue/vacate-v2 SQL semantics where compatible, ensure source/unique handoff maps to the settlement intent, and do not use sequential JS per-room closes. Freeze guards allow only these exact closing changes under the service-only RPC, remain effective afterward, and do not expose generic bypass. A guest is never sent to Ready automatically.
- [ ] Run `npm test -- src/lib/__tests__/settlement-close.test.ts` and both real PostgreSQL scripts; require rollback/replay/parallel-close cases green. Commit `feat: close settled stays with atomic Dirty handoff`.

### Task 9: Authenticated routes and compact checkout status

**Files:** Create `src/lib/settlement-http.server.ts`, `settlement-client.ts`, `src/components/SettlementCard.tsx`; create `src/routes/api/hotel/reservations.$id.settlement.ts`, `reservations.$id.settlement.step.ts`, `reservations.$id.settlement.reconcile.ts`; modify `src/lib/rbac.ts`, `src/routes/reservations.$id_.checkout.tsx`; tests `settlement-api.test.ts`, `settlement-view.test.ts`.
**Interfaces:** GET `/api/hotel/reservations/:id/settlement` is read-only/no-store with checkout:view. POST `.../settlement/step` and POST `.../settlement/reconcile` use new Owner-only `hotel:checkout:write`; reconcile performs no financial writes. Body allows only Task 7 action fields, route-derived reservation and current server actor. `fetchSettlement(reservationId,signal?): Promise<SettlementView>`; `submitSettlementStep(reservationId,input): Promise<SettlementView>`. Reconcile client returns the same persisted attempt. HTTP shared handlers take a permission resolver/service injection for meaningful denied-role tests.

- [ ] RED tests assert Front Desk GET succeeds/POST403, housekeeper denied, alien reservation404, browser tenant/token/amount/unknown fields rejected400, expired session401 clears money, SQL absent keeps preview working and writer unavailable. Render-state tests assert confirmed values only; Awaiting payment requires actual Owner confirmation/account; Needs review shows reason/recovery action; click racing returns same attempt instead of spinning forever.
- [ ] Implement compact status/amount rows, existing font/mobile conventions and concise [i] guidance. Preserve readonly preview URL/DTO and separate Reservation deposit editing. Use conditional bounded polling (every5s only while in-flight, stop after60s with a visible persisted status/recovery action), cancel on unmount/auth loss, refetch on focus and settled revisions. Background GET never initiates a POST. Disable financial controls when capabilities absent or unresolved proof.
- [ ] Run new route/view tests, existing rbac and checkout tests. Run affected TSX lint and inspect desktop/mobile at local mock-backed UI only; no production payment clicks. Commit `feat: show recoverable settlement actions at checkout`.

### Task 10: Authoritative monthly sources and all-reader refresh

**Files:** Create `src/lib/settlement-financial-source.server.ts`, `src/lib/__tests__/settlement-financial-source.test.ts`, `settlement-readers.test.ts`; modify `financial-reporting-store.server.ts`, `folio-store.server.ts` page projections, `checkout-preview.server.ts` integration boundary only, `src/components/FolioCard.tsx`, `FinancialDashboard.tsx`, and the client query invalidation hooks found in the checkout/Reservation/Departures/housekeeping readers. List actual touched client paths in execution evidence before committing.
**Interfaces:** `readSettlementSales(actor: ReceiptControlActor, period: FinancialMonth): Promise<FinancialSource<HotelFinancialEvent>>`, `readSettlementCollections(actor,period): Promise<FinancialSource<HotelFinancialEvent>>`, consumed by existing optional `FinancialDeps.sales/otherCollections`. `invalidateSettlementReaders(reservationId: string): void` is defined in settlement-client.ts and invalidates/refetches confirmed scopes; its revision comes from SettlementView, never a pending automatic-control endpoint.

- [ ] RED tests: receipt30/09 and bill08/10 fall into respective Malaysian months; allocation event contributes0 cash/sales; balance purpose appears once as settlement, not deposit; same document duplicate dedupes; 101 monthly receipt candidatesUnavailable; incomplete N3 pagination/refund/reversal evidenceUnavailable; person/property/Owner restrictions retained; auth/period failure hides stale values; wrong currency not summed.
- [ ] Implement complete bounded sources using existing FinancialSource shape, authoritative current N3 reads and immutable ledger links. Preserve FINANCIAL_LIMITS including40s total budget, verification cap100 and scoped cache keys. A local ledger alone is not complete Sales/Collections proof; without complete discovery/read contract keep the adapter unavailable rather than filling zeros. Existing deposits remain deposit-purpose totals, matched receipts use the new allocation-aware proof without weakening creation guards. Normal folio print remains independent of live verification.
- [ ] Wire confirmed revision refresh for Reservation/list/deposits, Owner queue, folio/print, Departures, checkout, Monthly/export and housekeeping/calendar. Reads on other devices detect persisted revision via the new GET/focus refresh. Test closed stay projections and failed scope reads; no local cache optimism. Run new tests plus all financial-reporting/receipt-report/folio baselines. Commit `feat: connect proven settlement facts to financial readers`.

### Task 11: Prepare precise API proof jobs; retain disabled activation

**Files:** Create `docs/evidence/HH_N3_BILLING_API_PROOF_JOB_20261008.md` and `docs/HH_N3_BILLING_EXECUTION_20261008.md`; modify contract registry only after accepted evidence.
**Interfaces:** Each proof job records target Owner-designated non-production tenant, exact endpoints/inputs, document/customer/account/master IDs, bounded amounts, prior state, permitted writes, read-back assertions, uncertain-outcome stop rule and cleanup as its own authorized lane. A signed current-session transport proof feeds Task 5; sanitized repository evidence contains hashes/IDs only as Owner permitted, no tokens/guest journals.

- [ ] Derive jobs from the implemented candidate and public schema. First use separately authorized signed-in GET diagnostics to collect actual current response shapes where possible. Preserve completed Cloud UI examples as historical evidence, not repeat tests. Do not invent tenant/master data or request credentials.
- [ ] Present concrete jobs for CashSale Post-to-AR/GL/INV linkage, balance receipt/GL, allocation preservation/partial/repetition and N3-side stale/concurrent rejection. Authorize each N3 write lane separately before execution. Refund/split/clear/unmatch are excluded; if vendor clarification of clearing semantics is needed, do not run a clearing transaction under this job.
- [ ] Record accepted or failed proof. Missing atomic stale/concurrent behavior keeps allocation gate closed; do not use HH locking as a substitute. Only reviewed source change with the accepted contract hash enables the matching operation; no environment toggle bypass. Require full bill/receipt/GL zero settlement and fresh read consistency before enabling final-close readiness.
- [ ] Re-run the strict prover/coordinator tests against sanitized accepted response shapes, including conflicting evidence; commit the accepted evidence/contract change as a separately reviewed candidate. Without proof, document exact launch blockers and continue independent work.

### Task 12: Whole-candidate verification and independent release lanes

**Files:** Update execution ledger; create `docs/evidence/HH_N3_BILLING_RELEASE_CANDIDATE_20261008.json`.
**Interfaces:** Evidence identifies input/candidate tree/SHA, scope, exact diff, protected blob parity, baseline failures, full checks, SQL/migration state, N3 accepted contract/proof state, deployment/publish state and remaining blockers.

- [ ] Run `npm test`, `npx --no-install tsc --noEmit`, `npm run lint`, `npm run build`; inspect complete exit codes/counts. Run real PostgreSQL single and multi-session checks. Record skipped or unavailable validation separately; do not extrapolate 115 baseline tests into a release claim. New changes/failures justify further targeted checks; no redundant full-suite loop.
- [ ] Review exact candidate across code, SQL, proof and readers. Confirm no parked automatic SQL/product drift or protected-file modification slipped into the diff. Recheck remote/main/Lovable and current migration history before presenting release lanes.
- [ ] Present exact code merge candidate and additive SQL/apply plan separately, with recovery/compatibility. Deploy old-compatible code first with writers disabled; apply separately approved migration once through the selected Lovable Cloud mechanism; verify actual schema/RLS/grants/RPCs; deploy matching runtime/enable only proven contracts; publish only after its separate approval. Do not claim Git merge applied SQL or public release.
- [ ] After authorization for applicable lanes, obtain signed-in end-to-end evidence: exact bill/receipt/GL reconciliation, positive balance payment, close/replay, all rooms Dirty/DNDoff, cross-device readers and Monthly/export. Keep production transactions separately bounded/authorized. Until this passes, readiness is not complete. Continue access cards then BEC then client UAT; no unsupported 01/11/2026 completion promise.

## Spec coverage and handoff

Core assertion anchors for the owning test tasks (the remaining named assertions above extend these; do not use them as reported test output):

```ts
// Task 1: conserves_refunded_receipt / missing_refund_is_unavailable
expect(receiptRemainder({ amountCents: 10001, allocatedCents: 6001, refundCents: 4000 }))
  .toEqual({ kind: 'confirmed', value: 0 });
expect(receiptRemainder({ amountCents: 10001, allocatedCents: 6001, refundCents: null }).kind)
  .toBe('unavailable');
// Task 1 / Task 6: never_allocates_over_remaining
expect(planAllocation({ receiptRemainderCents: 5000, billOutstandingCents: 3000 }))
  .toEqual({ kind: 'confirmed', value: 3000 });
// Tasks 3 / 7: one_claim_in_20_sessions and unknown outcome
expect(successfulClaims).toHaveLength(1);
expect(financialPostCallsForSameClaim).toHaveLength(1);
expect(view.state).toBe('needs_review');
// Task 8: all-room rollback and replay
expect(afterFailedRoomTwo).toEqual(beforeClose);
expect(replayedClose.intentId).toBe(firstClose.intentId);
expect(closeEvents).toHaveLength(1);
// Task 9: Front Desk cannot perform writes
expect(frontDeskPostResponse.status).toBe(403);
expect(n3WriteSpy).not.toHaveBeenCalled();
// Task 10: complete monthly figures cannot be a partial 101-row total
expect(monthWith101Candidates.deposits.status).toBe('unavailable');
expect(monthWith101Candidates.deposits.amount).toBeNull();
```

| Approved requirement | Tasks |
| --- | --- |
| Immutable folio, IDs, money, selected payment account | 1, 2, 5, 6 |
| Frozen all writers, tenant/service-only SQL, existing pending transactions | 3 |
| Fixed bounded transport, null gates, provenance, no new auth | 4, 9 |
| Exact bill/receipt/refund-remainder/GL proof | 5, 6, 11 |
| Unknown dispatch/crash/concurrency recovery, no duplicate writes | 3, 7, 11 |
| Fenced multi-room checked_out/released/Dirty/DND handoff | 8 |
| Compact UI, role guards, cross-device status and fast print | 9, 10 |
| Monthly complete sources, N3 dates, >100 guard, stale reads | 10 |
| API acceptance, full tests and separate release lanes | 11, 12 |

Self-review completed: all specification sections map to tasks; shared signatures align; five Review Focus cases have explicit owning tests; no placeholder behavior or invented API success; closed gates and missing disposable PostgreSQL capability remain explicit. Task steps use RED→implementation→GREEN/commit, with plan assertions serving as acceptance instructions, not reported test results.

Next action after the user reviews this plan: invoke executing-plans, establish isolated execution checkout, record its exact baseline and start Task 1. The user's DirectBuild/inline method is preserved. This document does not approve SQL application, N3 proof transactions, main merge or publishing. No additional Project Sources upload is required.
