# Receipt Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff request receipt corrections/voids and let Owners review, approve, reject and verify their outcomes without losing accounting evidence.

**Architecture:** A pure comparison/state module defines the contract. Tenant-scoped database transactions store immutable requests, decisions, execution claims and effective receipt versions; a separate server adapter verifies N3 evidence. Owner-authenticated execution supports a clearly labelled manual N3 path until an official write contract is proven. Notifications have their own outbox and never execute a receipt.

**Tech Stack:** Existing TypeScript, TanStack Start/Query, React, Supabase/Postgres, Vitest and server-only N3 adapter. Bun runs the existing scripts; no new browser storage or authentication system.

**Spec:** `docs/superpowers/specs/2026-10-02-receipt-controls-design.md`, approved by the user on 2 October 2026 after written review. This plan has not yet been approved for execution.

## Global Constraints

- “Admin” uses HotelHub's existing Owner role. No additional administrator role is introduced.
- The user explicitly permits Owners to approve their own requests.
- Keep the original deposit creation intent, reference, fingerprint and idempotency key immutable.
- Approval records a decision and does not itself prove a financial change.
- A 404 or missing list result alone is not proof of a successful void.
- Contact limits use the existing 100-character remark split: address in Remarks 1–2, phone in Remark 3, email in Remark 4.
- Every financial value uses checked integer cents. No automatic unmatching, refund, hard deletion or blind retry.
- Reservation and Prepare Checkout retain their separate purposes and card sets.
- Notification channel/provider/verified recipients remain unconfigured. In-app approvals work without external delivery. This plan does not authorize sending alerts or performing a live receipt correction/void for testing.
- Existing published baseline: `a68664f56e38bfb74e32972c14becdc6e6938449`, source tree `4ca4bc209a899e2d1cf005c200f2a355c5afc1de`. Recheck remote head and actual schema before executing.

## Review Focus

- An N3 receipt disappears or loses cancellation evidence: preserve Needs review, never treat absence as a void (Tasks 2, 4).
- The bill-to details or walk-in mapping changes between request and approval: compare the approved proposal and receipt identity explicitly, never substitute current booking contact silently (Tasks 1, 3, 4).
- An Owner approves twice or two tabs submit simultaneously: one atomic decision/execution claim, no duplicate accounting document (Tasks 3, 4).
- Void succeeds but replacement fails: stop counting the confirmed void immediately and expose the partial result across all views (Tasks 4, 5).
- A retired payment method remains on a historical receipt: preserve its saved label, require a currently enabled verified method for a proposed replacement (Tasks 2, 3, 5).

## File boundaries and shared types

Create `src/lib/receipt-controls.ts` for public DTOs, state transitions and comparisons; `receipt-controls-evidence.server.ts` for N3 detail/journal normalization; `receipt-controls-store.server.ts` for database transactions; `receipt-controls-execution.server.ts` for execution/readback; `effective-receipts.server.ts` for all financial consumers; `receipt-controls-client.ts` for same-origin queries; and separate request/review UI components. Do not extend the already large deposit store with this subsystem.

Shared types, defined in Task 1:

- `ReceiptControlState = pending | rejected | approved_awaiting_n3 | applying | applied | failed | needs_review`.
- `ReceiptContactFields = {customerName, remark1, remark2, remark3, remark4: string}`; reuse the existing contact mapping rules.
- `ReceiptSnapshot = {receiptId, docCode, documentDate, customerId, currency: string; amountCents: number; paymentLines: Array<{accountId, code, savedName: string; amountCents: number}>; contact: ReceiptContactFields; documentState: active | voided | unknown; matchingState: unmatched | matched | refunded | unknown; sourceFingerprint, verifiedAt: string}`. Unknown evidence never authorizes execution.
- `ReceiptControlProposal = {kind: correction; amountCents: number; accountId: string; contact: ReceiptContactFields} | {kind: void}`. The first correction UI accepts one payment method; existing multi-method receipts remain visible but require manual review until a verified split-correction contract exists.
- `ReceiptControlRequestDTO = {id, reservationId, bookingReference, depositId, reason, requestedByLabel, requestedAt: string; state: ReceiptControlState; original: ReceiptSnapshot; proposal: ReceiptControlProposal; comparison: ReceiptComparison; executionMode: manual | direct | void_replace; canApprove, canReject, canVerify: boolean; outcomeMessage: string | null}`.
- `ReceiptComparison = {fields: Array<{label, original, requested: string}>; depositDeltaCents, balanceDeltaCents: number}`.
- `EffectiveReceipt = {depositId, originalReceiptId, receiptId, docCode, documentDate, currency: string; amountCents: number; paymentLines: ReceiptSnapshot['paymentLines']; state: active | voided | needs_review; verifiedAt: string | null; replacementOf: string | null; creationAmountCents: number}`.
- `ReceiptControlActor = {tenantId, n3UserKey, n3Token: string; role: HotelRole}` is server-only and assembled from `requirePermission`; never returned in a DTO or persisted with the token.
- Test helper `receiptSnapshot(overrides?: Partial<ReceiptSnapshot>): ReceiptSnapshot` in `src/lib/__tests__/fixtures/receipt-controls.ts` returns a complete sample MYR50, unmatched, active receipt. Use synthetic contacts and account IDs.

### Task 1: Validate proposals and explain the change

**Files:** Create `src/lib/receipt-controls.ts`, `src/lib/__tests__/receipt-controls.test.ts`, `src/lib/__tests__/fixtures/receipt-controls.ts`. Modify `src/lib/receipt-contact.server.ts` only to extract a browser-safe pure formatter into `src/lib/receipt-contact.ts`; preserve the server reader's signature and existing tests.

**Interfaces:** Produce `validateReceiptControlProposal(input: unknown, original: ReceiptSnapshot): ReceiptControlProposal`, `compareReceiptControl(original: ReceiptSnapshot, proposal: ReceiptControlProposal): ReceiptComparison`, and `canTransitionReceiptControl(from: ReceiptControlState, to: ReceiptControlState): boolean`. Formatter produces `formatReceiptContact({name,company,address,phone,email}: Record<string,string>): ReceiptContactFields` with company followed by guest name, surrogate-safe address splitting and no truncation.

- [ ] Write tests asserting `compareReceiptControl(receiptSnapshot(), correction8000).depositDeltaCents === 3000`, `.balanceDeltaCents === -3000`, Amount field displays RM50.00 → RM80.00, and void deltas are -5000/+5000. Add rejection assertions for 0, negative, fractional cents, unsafe integers, more than RM1,000,000, missing account, unknown/matched/refunded original, and unchanged proposals. Pin 100/101/200/201-character address boundaries and surrogate pairs. Assert client-supplied customer ID/currency/tenant are rejected, not copied.

```ts
it("shows the RM50 to RM80 deposit and balance differences", () => {
  const original = receiptSnapshot();
  const proposal: ReceiptControlProposal = {
    kind: "correction",
    amountCents: 8000,
    accountId: original.paymentLines[0].accountId,
    contact: original.contact,
  };
  expect(compareReceiptControl(original, proposal)).toMatchObject({
    depositDeltaCents: 3000,
    balanceDeltaCents: -3000,
  });
  expect(compareReceiptControl(original, { kind: "void" })).toMatchObject({
    depositDeltaCents: -5000,
    balanceDeltaCents: 5000,
  });
});
```

- [ ] Run `bun run test src/lib/__tests__/receipt-controls.test.ts` and existing receipt-contact tests; confirm new assertions fail for missing exports while existing contact tests remain green.
- [ ] Implement the types/functions above. Allowed state transitions: pending→rejected/approved_awaiting_n3/needs_review; approved_awaiting_n3→applying/needs_review; applying→applied/failed/needs_review; failed→needs_review after uncertain recovery; needs_review→rejected/applied only by explicit Owner reconciliation; applied/rejected are terminal. No browser transition is accepted directly.
- [ ] Run the focused tests and type checking; assert contact payload behavior is unchanged for ordinary deposit creation.
- [ ] Commit these files with message `Add validated receipt correction comparisons and state contract`.

### Task 2: Establish authoritative N3 evidence and capabilities

**Files:** Create `src/lib/receipt-controls-evidence.server.ts`, `src/lib/__tests__/receipt-controls-evidence.test.ts`, `docs/HH_RECEIPT_CONTROL_N3_CONTRACT.md`. Reuse `src/lib/n3-receipts.server.ts` read operations, `src/lib/deposits-store.server.ts` detail/journal validation, and `src/lib/receipt-contact.ts` from Task 1.

**Interfaces:** Produce `readReceiptControlEvidence(actor: ReceiptControlActor, depositId: string, deps?: EvidenceDeps): Promise<ReceiptSnapshot>`, `receiptControlCapabilities(): {directEdit: boolean; voidReplace: boolean; manual: true}`, and `verifyReceiptControlResult(original: ReceiptSnapshot, proposal: ReceiptControlProposal, evidence: ReceiptSnapshot | null): verified | mismatch | insufficient`. `EvidenceDeps` injects scoped deposit lookup and the existing `N3ReceiptsClient` for tests.

- [ ] Write tests for authenticated tenant/deposit lookup before any N3 call; active unmatched receipt + balanced journal; customer/currency/account/reference mismatch; 401 session invalidation; missing contact/cancellation/matching fields; 404/network loss; and disabled historical account accepted for original evidence but refused for the proposed account. Assert fingerprints exclude `verifiedAt` and include amount/accounts/contact/document/matching/journal evidence so time alone never makes a request stale.
- [ ] Run `bun run test src/lib/__tests__/receipt-controls-evidence.test.ts`; confirm failures for absent evidence implementation.
- [ ] Implement read-only normalization from established envelopes, with unknown states for unsupported evidence. Inspect official QNE API documentation or an authorized existing read-only tenant probe for update/void contracts. Record exact method/path, field semantics, journal effects, concurrency and reconciliation support in the contract document; if unsupported/unproven, explicitly record capabilities as false and use manual mode. Do not guess write paths or create a receipt to obtain a fixture. Store sanitized field fixtures only; no tokens/contact identities from live responses. The capability function defaults to false for both automated modes and requires both verified contract support and server feature/tenant gates to enable them.
- [ ] Run evidence tests; prove every discovery/probe path is GET-only. An absent contract is a supported manual-mode outcome, not permission to fabricate cancellation evidence.
- [ ] Commit with message `Add read-only receipt evidence and explicit N3 control capabilities`.

### Task 3: Durable requests, decisions and execution claims

**Files:** Create `supabase/migrations/20261002110000_hh_receipt_controls.sql`, `src/lib/receipt-controls-store.server.ts`, `src/lib/__tests__/receipt-controls-store.test.ts`, `src/lib/__tests__/receipt-controls-api.test.ts`, `src/routes/api/hotel/reservations.$id.deposits.$depositId.requests.ts`, `src/routes/api/hotel/receipt-controls.ts`, and `src/routes/api/hotel/receipt-controls.$requestId.decision.ts`. Modify `src/lib/rbac.ts` and `src/lib/audit.server.ts`.

**Interfaces:** Produce `createReceiptControlRequest(actor, {reservationId,depositId,clientRequestId,reason,proposal}, deps?): Promise<ReceiptControlRequestDTO>`, `decideReceiptControlRequest(actor, {requestId,decision: approve | reject,expectedVersion,note?}, deps?): Promise<ReceiptControlRequestDTO>`, `listReceiptControlRequests(actor, {state?,limit,offset}, deps?): Promise<{items: ReceiptControlRequestDTO[]; total:number}>`, and `claimReceiptExecution(actor, requestId, step: verify | edit | void | replace): Promise<{executionId:string; claimed:boolean}>`. `deps` injects database/evidence; real actor values are session-controlled.

- [ ] Write tests: blank reason or reason over500 UTF-16 units is rejected; duplicate request key/same fingerprint returns original; changed body under same key is conflict; one active request per receipt; simultaneous approval gets one decision; Owner self-approval records both actor fields; Front Desk can request and see its own outcomes but cannot retrieve another request or decide/claim; Housekeeper/cross-tenant/unauthenticated callers denied; origin check before mutation; forged actor/tenant/status rejected; N3 changed since request produces Needs review without execution. A newly hidden account or changed walk-in mapping must hold approval.
- [ ] Run `bun run test src/lib/__tests__/receipt-controls-store.test.ts src/lib/__tests__/receipt-controls-api.test.ts`; observe the expected failures.
- [ ] Implement additive tables: `hotel_receipt_control_requests` (immutable original/proposal, version, current state, request fingerprint, tenant/client-key uniqueness), `hotel_receipt_control_decisions` (append-only actor/outcome), `hotel_receipt_control_executions` (unique request/step claim and result), `hotel_receipt_versions` (append-only effective financial evidence), and `hotel_receipt_alert_outbox` (tenant/request/event/version unique key, pending delivery). Enforce a trimmed nonempty reason of at most500 UTF-16 units, tenant-linked foreign keys, integer-cent bounds, one-active-request partial uniqueness including Needs review, row-locked compare-and-set decisions, and service-role-only transaction functions. Revoke public/anon/authenticated access, retain RLS and an empty search_path. Do not alter existing creation columns or insert settings implicitly. Add `hotel:receipt_controls:request` for Owner/Front Desk, `:approve` and `:execute` for Owner, and role-filtered reads. Audit event details contain request IDs/outcome codes only; sensitive snapshots remain in protected tables. Queue creation and alert outbox insertion are one transaction. Task 6 extends the existing outbox for dispatch, avoiding a forward schema dependency.
- [ ] Run local SQL integration tests against the authorized test database and verify rollback leaves the previous schema/data usable. Verify migration history and actual schema before a production application. Run route tests and permission matrix tests; do not represent mocked transaction tests as concurrency proof.
- [ ] Commit with message `Add atomic receipt requests and Owner decisions`.

### Task 4: Execute or verify approved actions without duplicate money

**Files:** Create `src/lib/receipt-controls-execution.server.ts`, `src/lib/__tests__/receipt-controls-execution.test.ts`, `src/routes/api/hotel/receipt-controls.$requestId.verify.ts`, and `src/routes/api/hotel/receipt-controls.$requestId.execute.ts`. Modify the N3 adapter only if Task 2 established a supported write contract. Keep ordinary deposit creation unchanged.

**Interfaces:** Produce `executeReceiptControl(actor: ReceiptControlActor, requestId: string, deps?: ExecutionDeps): Promise<ReceiptControlRequestDTO>` and `verifyReceiptControl(actor: ReceiptControlActor, requestId: string, deps?: ExecutionDeps): Promise<ReceiptControlRequestDTO>`. `ExecutionDeps` consumes Task 2 evidence/capabilities and Task 3 claims/store transactions; replacement creation receives the frozen approved contact/customer/currency/account/amount, never the booking's current bill-to. Execution is initiated by an authenticated Owner request; no N3 token is persisted for a background worker.

- [ ] Write tests: manual approval stays Approved awaiting N3; only an expected corrected receipt and its journal complete an action; missing receipt/404 never confirms void; unexpected direct edit becomes Needs review; expired token cannot execute; one claimed operation under simultaneous calls; ambiguous write response becomes Needs review and readback without re-posting; confirmed void plus failed replacement excludes the original, keeps audit trail, and warns; replacement uses a new immutable operation reference and counts once. Assert rejection/approval alone preserve totals.
- [ ] Run `bun run test src/lib/__tests__/receipt-controls-execution.test.ts`; confirm missing orchestrator failures.
- [ ] Implement the manual path first: Open in N3, then Verify; verification records version evidence atomically without pretending to execute a financial write. Enable direct/void-replacement only under Task 2's proven capabilities and existing financial gates. Recheck source fingerprint and restrictions immediately before claim. Record confirmed void evidence before attempting replacement. Allocate a fresh replacement creation intent, bind it to the approved request, and persist confirmation with the new N3 identity/reference. Do not reuse or modify the original deposit idempotency key. Atomic claims prevent repeat requests; uncertain outcomes require readback, not a new post. A receipt with insufficient void/journal proof remains Needs review even when manually deleted in N3.
- [ ] Run execution, ordinary deposit-create/reconciliation and journal verification regressions; assert no direct-write call in manual mode and no automatic refund/unmatch calls in any mode.
- [ ] Commit with message `Add verified receipt outcomes and explicit manual N3 recovery`.

### Task 5: Share effective evidence across screens and add approval UI

**Files:** Create `src/lib/effective-receipts.server.ts`, `src/lib/receipt-controls-client.ts`, `src/components/ReceiptControlRequestDialog.tsx`, `src/components/ReceiptApprovalQueue.tsx`, `src/lib/__tests__/effective-receipts.test.ts`, `src/lib/__tests__/receipt-controls-render.test.ts`. Modify `src/components/DepositsCard.tsx`, `src/routes/index.tsx`, `src/routes/api/hotel/reservations.$id.deposits.ts`, `src/routes/api/hotel/reservations.$id.folio.ts`, `src/lib/folio-store.server.ts`, `src/lib/checkout-preview.server.ts`, `src/lib/recorded-deposits.ts`, `src/lib/folio-view.ts` and the print route as needed for effective document dates.

**Interfaces:** Produce `listEffectiveReceipts(tenantId:string, reservationIds:readonly string[], deps?: EffectiveReceiptDeps): Promise<EffectiveReceipt[]>` and `projectEffectiveReceiptSummary(rows:readonly EffectiveReceipt[], currency:string): {total:number|null; count:number; hasUnconfirmed:boolean}`. Initial legacy posted rows retain recorded evidence until verified versions exist; reporting must separately require document-date/live evidence. Consumers must not mix original and replacement totals. Browser queries are tenant/session keyed and use only same-origin APIs; completion invalidates deposit, folio, reservation-list, checkout, approvals and financial-report queries.

- [ ] Write tests: effective RM80 replaces original RM50 in all consumer projections; confirmed void yields zero active contribution; partial replacement failure remains a visible warning; unmatched unknown evidence never becomes zero; mixed currencies yield unavailable; original and replacement never both count; historical saved payment aliases remain stable. Render assertions check Original/Requested/difference/reason, admin self-approval, print link, own-request status, restriction copy and no financial queue for Housekeeper.
- [ ] Run the effective/renderer tests and related folio/list/checkout regressions; confirm the new shared projection fails before wiring.
- [ ] Implement batch reads with tenant/page scoping and one effective version per deposit. Keep creation records immutable. Add Request correction and Request void beside Print in N3, mandatory reason and safe amount/account/contact entry. Owner Dashboard queue offers Review, Approve and Reject; only the Review panel exposes approval after original/proposed/delta and mode are displayed. Manual mode says “Approved. Complete the change in N3, then verify.” A Needs review request stays open until Owner rejects or verifies evidence; it blocks a conflicting second request. Preserve existing separate reservation/checkout cards and present confirmed void/history rather than removing rows.
- [ ] Check actual components in the browser with synthetic data: RM50→80 request review, rejected request, self-approval and manual verification, phone layout, focus/keyboard support, no accidental double-submit. No real N3 transaction. Run full tests, type check, production build and changed-file lint; independently review the branch before release.
- [ ] Commit with message `Add receipt approval screens and shared effective deposit figures`.

### Task 6: In-app alerts and a delivery outbox without financial retries

**Files:** Create `supabase/migrations/20261002110100_hh_receipt_alert_outbox.sql`, `src/lib/receipt-alerts.server.ts`, `src/lib/receipt-alert-delivery.server.ts`, `src/lib/__tests__/receipt-alerts.test.ts`, and `src/components/ReceiptAlertStatus.tsx`. Modify `ReceiptApprovalQueue.tsx` to show delivery status. Create `docs/HH_RECEIPT_CONTROLS_RELEASE_CHECKPOINT.md`.

**Interfaces:** Produce `enqueueReceiptAlert(tx, {tenantId,requestId,event: pending | decision | execution_failure,version:number}): Promise<void>`, `dispatchReceiptAlerts({tenantId,provider:ReceiptAlertEmailProvider|null,limit:number}, deps?): Promise<{sent:number;failed:number;disabled:number}>`, and provider contract `send({recipient:string,subject:string,text:string,idempotencyKey:string}): Promise<{messageId:string}>`. Provider selection/recipient configuration is an explicit separate setup dependency; the default provider is null and transport remains disabled. No arbitrary provider URL or recipient from a browser request.

- [ ] Write tests asserting same request/event/version queues once; financial decision survives delivery failure; configured verified Owner recipients only; disabled/unconfigured delivery shows disabled rather than Sent; failed send retry does not call any receipt API; and message contains reference/link but no amount/contact/token/raw identity. Decision updates do not subscribe a user automatically.
- [ ] Run `bun run test src/lib/__tests__/receipt-alerts.test.ts`; confirm expected missing service failures.
- [ ] Extend Task 3's tenant-scoped service-role-only outbox with atomic delivery claims, bounded retries/backoff and recorded failure codes. Keep its unique event/version keys. Add Dashboard status and queue badges. External email adapter is injectable and disabled until the user selects a channel, provider and verified recipients; record that unconfigured state in the release checkpoint. Do not install a new mail provider or send test alerts as a side effect of receipt implementation. WhatsApp/push remain outside this release.
- [ ] Run alert and financial regressions, full verification and source/schema preflight. Apply the two compatible additive migrations together before enabling request routes. Publish only the tested tree and verify serving deployment. Document manual-vs-automatic capability, migration versions, notification configuration and signed-in acceptance limitations; perform no live correction/void to demonstrate the feature.
- [ ] Commit with message `Add receipt approval alert outbox and delivery status`.

## Self-review and execution handoff

The six tasks cover request/approval, N3 capability discovery, immutable audit/execution evidence, effective consumer figures, phone-accessible in-app alerts and disabled external delivery. Each Review Focus case is pinned to named tests. Monthly reporting is a separate plan and starts after Task 5's effective projection and Task 6's release are verified. Supported N3 automation and external notification setup are explicit capability dependencies, not assumed successes.

Execution method has not been chosen. Review this plan together with its approved spec before implementation. Recommended method: Native, because most tasks share one receipt-state/evidence contract and the existing deposit flow must be changed coherently; use an independent whole-branch review before release.

## Progress (2026-10-02)
- [x] Task 1 pure contract + formatter
- [x] Task 2 GET-only evidence + capabilities (manual only)
- [x] Task 3 migrations staged in db/migrations-pending/ (NOT applied; PGlite 26/26); store service, RBAC, audit, routes
- [x] Task 4 manual execute (no N3 write) + GET-only verify with atomic claim/complete
- [x] Task 5 effective overlay wired into deposits list, folio/print statement, reservation list totals, checkout verification; request dialog + Owner queue
- [x] Task 6 outbox delivery with transport disabled (alerts settle as "disabled"); status UI
- [ ] Release: review + apply migrations, then signed-in end-to-end check against the real database
