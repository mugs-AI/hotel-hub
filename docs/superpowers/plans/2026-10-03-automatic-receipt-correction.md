# Automatic Receipt Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply approved or authorized direct amount/contact corrections to N3 exactly as proposed, prove the accounting result, and refresh every dependent HotelHub view.

**Architecture:** Add tenant approval policies, generation-2 receipt authorization and a durable one-dispatch ledger alongside the existing manual flow. Separate local folio contact proposals from N3 receipt corrections; both consume the contact policy. Keep N3 automation dormant until Owner-run conditional-write/accounting proof and separately reviewed activation; use revision polling for cross-session refresh.

**Tech Stack:** Existing TypeScript, React 19, TanStack Start/Query, Vitest, Bun lockfile, Lovable Cloud PostgreSQL/service-role RPCs, N3 HTTP transport and Lovable hosting. No new product dependency, browser identity or hosting provider.

**Spec:** `docs/superpowers/specs/2026-10-03-automatic-receipt-correction-design.md`, approved by Owner on 03/10/2026 after review commit `c41808f093331089d46477677ba7e4bcf7d1faf3`.

## Global Constraints

- DirectBuild repository coding/testing on a review branch is the delivery method.
- No Lovable AI Build message, alternative hosting, Supabase identity replacement, or exposed N3 token.
- Database apply, code merge, runtime deployment, N3 writes, feature activation and public publishing retain separate gates.
- Admin in UI means the existing Owner role. Policy does not grant financial roles.
- Deposit changes require Admin approval: default ON. Billing-contact changes require Admin approval: default OFF.
- Combined receipt changes use approval if ANY affected category requires it.
- Original deposit intent remains immutable; repeated completion returns the same result and cannot append a duplicate.
- Never automatically repeat a financial POST.
- Do not retroactively execute existing approved manual requests, including the RM65 request.
- Sales/Collections stay Unavailable until authoritative final billing exists.
- Monthly figures use N3 receipt dates; more than 100 verification candidates remains Unavailable.
- Protected baseline `a68664f56e38bfb74e32972c14becdc6e6938449`: `AGENTS.md`, `package.json`, `bun.lock`, `src/start.ts`, `src/integrations/*`, `src/lib/hotel-store.server.ts`.
- Use DD/MM/YYYY display, property timezone, responsive layouts and existing stage/account/field bounds. Alert transport, void/replacement/refund/unmatching remain disabled.

## Review Focus

- First contact edit when no saved bill-to row exists: compare the displayed primary-guest fallback and current reservation stage; never approve an obsolete fallback (Task 3).
- Policy changes between preparation and dispatch: tightening holds an unapproved direct action; relaxation never executes an old manual/pending proposal (Tasks 2/5).
- Browser retries after a lost success response: return/reconcile the existing attempt without another Update or double-counted MYR65 (Tasks 5/7).
- Amount and contact changed together: the unchanged account stays eligible under amount-change rules, and either ON policy requires approval (Tasks 1/4).
- N3 success after the Owner's response deadline or role revocation: retain an unknown hold, then allow only a newly authorized Owner's GET reconciliation (Tasks 5/8).

---

## Starting state, execution choice and gates

Planning input review `c41808f093331089d46477677ba7e4bcf7d1faf3`, tree
`6689a6f13572c8ba3747b01b9e5fa3d3836d3a2b`; main and Lovable latest `734ac405c82e653a7098ce0ef22d51586382bd9d`.
Project/workspace match the locked IDs, ready/agentFinished. Shared Cloud backend
`fkakhdzelilnejyehwfk`, Supabase stack; no staging established. Fresh SQL confirms
folio migration `20260929090000` and receipt migrations `20261002053219` /
`20261002053302`. Existing request/bill-to columns exist; proposed new tables and
generation/revision columns do not. Existing manual RM65 is not a test fixture.

This document is a plan, not an execution authorization. Owner has chosen direct
repository delivery, but has not selected native versus subagent execution for
this plan. Recommend **native execution** to retain context across the tightly
coupled policy/claim/proof interfaces, followed by one independent whole-branch
review. Offer subagent-driven execution as the alternative; do not spawn workers
while writing/self-reviewing this plan.

After plan review and method selection, reverify main/review/Lovable and use the
existing isolated review worktree under the worktree skill. Preserve new drift;
do not restart prior work or rewrite pushed history. Before Supabase implementation,
read current official changelog and relevant grants/RLS/RPC docs. This planning
turn has not installed tools or run product tests. `node_modules` exists, but Bun,
PostgreSQL/psql, Docker and Supabase CLI were not found on current PATH. Recover
approved runtime tooling without changing product dependencies. Lack of disposable
PostgreSQL blocks real SQL proof, not independent pure/server/client implementation.

| Gate | Concrete candidate required | Allowed after its approval |
| --- | --- | --- |
| Plan execution | This plan plus chosen execution method | Review-branch product code, new migration file and isolated tests; automation dormant |
| Schema apply | Exact additive SQL/hash, disposable SQL/race proof, fresh Cloud target/history and compatibility report | Apply new migration once via Lovable's backend controller; verify schema/grants/old rows |
| Source merge/runtime | Exact tested SHA/tree and protected diff; backend readiness or fail-closed compatibility | Merge/sync and separately verify deployed runtime; no automatic feature activation |
| Sandbox proof | Exact designated non-production company, fixture IDs, before/after payloads and proof-tool candidate | Owner executes only those scoped N3 test writes/readbacks |
| Activation/public release | Proven conditional-write/accounting contract, measured hosting deadline, exact source/schema/config and UAT | Enable tested tenant/capability and publish only within approved release scope |

Sandbox proof may require an Owner-approved deployed proof runtime and installed
attempt schema. Keep production automation OFF throughout. No separate Supabase
login is presumed. A review-branch push does not merge, deploy SQL or publish.

## Shared contracts and file boundaries

Create `src/lib/hotel-change-controls.ts` for browser-safe contracts:

```ts
type ChangePolicy = { revision: string; depositApprovalRequired: boolean; contactApprovalRequired: boolean };
type ChangeCategories = { deposit: boolean; contact: boolean };
type ChangeTarget = "n3_receipt" | "folio_bill_to";
type ChangeRoute = "no_change" | "approval" | "owner_execution" | "direct";
type BillToChangeDTO = { id: string; reservationId: string; bookingReference: string;
  version: number; state: "pending" | "applied" | "rejected" | "needs_review";
  original: FolioBillTo; requested: FolioBillTo; reason: string;
  requestedByLabel: string | null; requestedAt: string; canApprove: boolean; canReject: boolean };
type BillToReadDTO = { billTo: FolioBillTo; effectiveRevision: string; pending: BillToChangeDTO | null };
type BillToSaveInput = { billTo: FolioBillTo; expectedRevision: string; clientRequestId: string; reason?: string };
type BillToSaveResult = BillToReadDTO & { outcome: "applied" | "pending" | "no_change" };
type ChangeRevisionDTO = { revision: string };
type ChangePolicyInput = { expectedRevision: string; depositApprovalRequired: boolean; contactApprovalRequired: boolean };
```

Move the existing `FolioBillTo` type from its route into this module; re-export from
the route for compatibility. Reuse `HotelRole`, `ReceiptControlActor`,
`ReceiptSnapshot`, `ReceiptControlProposal`, `ReceiptControlRequestDTO` and
`VersionPayload`. Revisions are decimal strings, not lossy JS bigint numbers.

Create `src/lib/receipt-automation.ts` for non-sensitive DTOs:

```ts
type ReceiptAutomationMeta = { generation: 2; policy: ChangePolicy;
  authorizationKind: "manual_approval" | "direct_policy" | null;
  authorizedBy: string | null; authorizedAt: string | null; categories: ChangeCategories };
type ReceiptAutomationDTO = ReceiptControlRequestDTO & { automation: ReceiptAutomationMeta | null;
  canApply: boolean; canCheckResult: boolean };
type ReceiptApplyResult = { request: ReceiptAutomationDTO;
  outcome: "applied" | "on_hold" | "needs_review"; code: string };
```

Legacy DTOs get `automation:null` and preserve manual behavior. Browser DTOs never
contain raw receipt bodies, session token, Update payload or proof permit.

Create `src/lib/receipt-automation-store.server.ts` with `ReceiptAutomationDb`:
`get(tenantId:string,requestId:string)`, `create(actor,record:AutomationCreateRecord,policy:ChangePolicy)`,
`authorize(actor,requestId,expectedVersion,kind,expectedPolicyRevision)`,
`reserveDispatch(actor,requestId,expectedVersion,payloadHash,expectedPolicyRevision)`,
`hold(actor,requestId,expectedVersion,code)`,
`settle(actor,requestId,attemptId,claimedVersion,result)`.
`get/create/authorize/hold/settle` return a server-only `AutomationRequestRow`
(`RequestRow` plus `ReceiptAutomationMeta` and `attempt: EditAttempt|null`).
`reserveDispatch` returns `{ attempt: EditAttempt; dispatchGranted: boolean }`.
`EditAttempt` contains ID, claim version, payload hash and phase
`reserved|confirmed|rejected|unknown`. `settle.result` is a union of
`{kind:"verified",version:VersionPayload,contact:ReceiptContactFields}`,
`{kind:"unknown",code:string}` or `{kind:"rejected_no_write",code:string}`.
ClaimedVersion and identity fence all settlement; unknown never releases dispatch.
`AutomationCreateRecord` contains reservationId/depositId/clientRequestId/fingerprint/
reason as strings, original:ReceiptSnapshot, proposal:ReceiptControlProposal and
comparison:ReceiptComparison. All are validated/server-derived before DB create;
create rejects void and binds deposit to reservation/tenant. Authorization kind
is `manual_approval|direct_policy`; versions are numbers and policy revision strings.

Server methods accept `ReceiptAutomationActor` (existing actor plus server-resolved
`n3TenantKey:string`), validated by the HTTP boundary. A caller cannot assign
financial authority by passing role strings in JSON. Inject clocks/transport/DB
into orchestration for deterministic tests; production wiring remains server-only.

### Task 1: Independent policy and generation-2 contracts

**Files:** Create `src/lib/hotel-change-controls.ts`, `src/lib/receipt-automation.ts`,
`src/lib/__tests__/hotel-change-controls.test.ts`; modify `src/lib/receipt-controls.ts`
only for backward-compatible automation DTO typing.

**Interfaces:** Produce `defaultChangePolicy():ChangePolicy` (revision `"0"`,
deposit true/contact false), `classifyReceiptChanges(original:ReceiptSnapshot,
proposal:ReceiptControlProposal):ChangeCategories`,
`routeChange(role:HotelRole,target:ChangeTarget,categories:ChangeCategories,
policy:ChangePolicy):ChangeRoute`. A void proposal is excluded from automatic routing.

- [ ] Write failing tests covering the full spec actor/target matrix, no-op,
  amount/account category, contact-only, combined switches and Housekeeper denial.
  Pin default and combined behavior:
  ```ts
  expect(defaultChangePolicy()).toEqual({ revision: "0", depositApprovalRequired: true, contactApprovalRequired: false });
  expect(routeChange("owner", "n3_receipt", {deposit:true,contact:true},
    {revision:"1",depositApprovalRequired:false,contactApprovalRequired:true})).toBe("approval");
  expect(routeChange("front_desk", "n3_receipt", {deposit:true,contact:false},
    {revision:"1",depositApprovalRequired:false,contactApprovalRequired:false})).toBe("owner_execution");
  ```
- [ ] Run `bunx vitest run src/lib/__tests__/hotel-change-controls.test.ts`; expect
  failure for missing exports, not setup/network failure.
- [ ] Implement the shared contracts and pure functions; compare canonical validated
  values, classify changed account as deposit, deny Housekeeper and unsupported void.
- [ ] Rerun the command; all policy assertions pass. Commit this isolated contract task.

### Task 2: Additive SQL policies, claims and atomic completion

**Files:** Create migration with `supabase migration new hh_automatic_receipt_controls`
at execution time (record exact generated path in task evidence, never guess version);
create `scripts/test-hh-change-controls-postgres.sh`,
`src/lib/__tests__/receipt-automation-postgres.test.ts`,
`src/lib/__tests__/fixtures/hh-change-controls-prerequisites.sql`.
Modify `docs/HH_RECEIPT_SQL_VALIDATION.md` with exact isolated commands/results.

**Interfaces:** Produce service-only RPCs `hotelhub_change_policy_set`,
`hotelhub_receipt_control_v2_create`, `hotelhub_receipt_control_v2_authorize`,
`hotelhub_receipt_control_v2_reserve`, `hotelhub_receipt_control_v2_hold`,
`hotelhub_receipt_control_v2_settle`, `hotelhub_bill_to_change_save`,
`hotelhub_bill_to_change_decide`. JSON parameters map 1:1 to shared store methods;
tenant/actor/expected version are separate typed SQL parameters, not inferred from
JSON. Policy SET takes tenant, Owner actor, expected policy revision and both booleans.
Bill-to SAVE takes tenant/reservation/actor/role, expected effective revision,
current fallback fingerprint, requested contact, reason and client UUID; DECIDE
takes tenant/request/Owner actor/version and approve/reject. Return canonical rows.

- [ ] Write disposable PostgreSQL assertions for ON/OFF defaults, cross-tenant FKs,
  denied anon/authenticated RPC access, conflicting client UUID, one active target,
  direct authorization without approved_at, metadata immutability, policy tightening,
  duplicate reserve, unknown rejection/recovery refusal and atomic version/audit/revision.
  Assert `dispatchGranted` is true once across two synchronized connections and
  repeated verified settle leaves exactly one version with `amount_cents=6500`.
- [ ] Run `HH_TEST_PG_URL=<isolated-local-url> bunx vitest run src/lib/__tests__/receipt-automation-postgres.test.ts`
  after the harness checks loopback socket/host, a disposable `hh_test_` database
  and an explicit test marker. Expect missing new objects/functions. Reject Cloud
  hosts and ordinary SUPABASE_URL/DATABASE_URL. If no local PostgreSQL is available,
  report BLOCKED and continue independent tasks; never substitute shared Cloud.
- [ ] Implement the one new migration: policy, attempt, local proposal and revision
  tables; request generation defaults 1 for old clients, new immutable policy/authorization
  metadata and nullable `verified_contact` on receipt versions. Local bill-to gets
  an effective revision with safe default 0. Generation-2 direct mode is inserted
  explicitly by its RPC. Legacy rows/modes/approvals/versions stay unchanged.
- [ ] Protect old decide/claim/complete/verify/recover RPCs against generation-2
  rows in the additive migration, preserving generation-1 behavior. Extend the
  guard for new immutable metadata. New authorization transitions lock request and
  policy; reserve rechecks current approval requirements under the same locks.
  Unknown/reserved attempts block rejection and active-index release permanently
  until conclusive settlement. Existing alert outbox stays disabled; new local
  audit/financial decisions are transactional, including direct authorization.
- [ ] Implement the isolated harness: minimal tenant/reservation/deposit/audit parent
  fixture matching actual baseline contracts, followed by the immutable folio and
  receipt/outbox SQL and new migration. Create roles explicitly. Use psql processes
  with barriers/locks, not sleeps, for duplicate reservation and stale completion.
- [ ] Rerun isolated assertions and inspect schema/grants/search_path/constraints;
  expected all pass, no skipped races. Save migration SHA256 and commit. The
  migration file is staged source only; applying it to Cloud requires its own gate.

### Task 3: Policy adapter and controlled local bill-to service

**Files:** Create `src/lib/hotel-change-controls-store.server.ts`,
`src/lib/folio-bill-to-controls.server.ts`, `src/routes/api/hotel/change-controls.ts`,
`src/routes/api/hotel/bill-to-changes.ts`,
`src/routes/api/hotel/bill-to-changes.$requestId.decision.ts`,
`src/lib/__tests__/folio-bill-to-controls.test.ts`,
`src/lib/__tests__/hotel-change-controls-api.test.ts`;
modify `src/routes/api/hotel/reservations.$id.folio.bill-to.ts` and its route test.

**Interfaces:** Produce `readChangePolicy(tenantId:string):Promise<ChangePolicy|null>`
(null only for absent installation; other errors throw),
`setChangePolicy(actor:ReceiptControlActor,input:ChangePolicyInput):Promise<ChangePolicy>`,
`readBillTo(actor,reservationId:string):Promise<BillToReadDTO>`,
`saveBillTo(actor,reservationId:string,input:BillToSaveInput):Promise<BillToSaveResult>`,
`decideBillTo(actor,input:{requestId:string;expectedVersion:number;decision:"approve"|"reject"}):Promise<BillToChangeDTO>`.
Use injected reservation/fallback/DB dependencies in tests. Owner queue pages 50,
maximum 100 per request; FrontDesk list only its own requests. No N3 transport.

- [ ] Write failing tests: contact ON produces pending, keeps old printed values,
  bypass attempt using old flat PUT cannot save directly; OFF retains authorized
  Owner/FrontDesk local editing, alien IDs/Housekeeper/checked-out stage fail.
  First-edit fallback changes before approval produce conflict, not overwritten guest
  details. Unicode/trim/length/email rules retain 160/200/600/60/254 bounds.
  `expect(onResult.outcome).toBe("pending")`; `expect(onResult.billTo.name).toBe("Original")`;
  `expect(offResult.outcome).toBe("applied")`; `expect(n3Calls).toEqual([])`.
- [ ] Run `bunx vitest run src/lib/__tests__/folio-bill-to-controls.test.ts src/lib/__tests__/hotel-change-controls-api.test.ts src/lib/__tests__/folio-bill-to-route.test.ts`; expect contract failures.
- [ ] Implement service-only adapters using Task 2 RPCs. Fingerprint current guest
  fallback when row absent and lock/recheck current reservation/fallback before
  approval. Installed policy read error fails closed. Missing installation retains
  labelled legacy local behavior and disables new settings, never infers a previously
  configured ON switch is OFF. Any legacy flat PUT on an installed policy returns
  a version-required error; new client uses BillToSaveInput. Atomic save/approval
  includes audit/revision; failed audit cannot leave an applied unrecorded change.
- [ ] Implement authenticated no-store GET/PATCH policy endpoints (GET existing
  app access; PATCH fresh Owner/hotel:setup), same-origin mutations, strict payload
  allowlist and CAS conflicts. Add local queue/decision endpoints under existing
  request/approve role permissions, resolving tenant from session.
- [ ] Rerun tests and isolated bill-to RPC cases; all pass. Commit local workflow.

### Task 4: Dormant, bounded N3 Update contract and transport

**Files:** Create `src/lib/n3-receipt-update.server.ts`,
`src/lib/receipt-automation-gates.server.ts`,
`src/lib/__tests__/n3-receipt-update.test.ts`,
`src/lib/__tests__/fixtures/receipt-automation.ts`;
modify `src/lib/n3-receipts.server.ts`, `src/lib/receipt-controls-evidence.server.ts`
only for bounded transport injection/strict Update preflight; document evidence in
`docs/HH_RECEIPT_CONTROL_N3_CONTRACT.md` without asserting proof yet.

**Interfaces:** Produce `N3UpdateContract` with preserved-field allowlist,
conditional-write mapping and proven no-write rejection codes;
`ReceiptAutomationActor = ReceiptControlActor & { n3TenantKey:string }` in the
server-only gates module; `PreparedReceiptUpdate = {body:unknown;payloadHash:string}`
in the Update module;
`productionUpdateContract():N3UpdateContract|null` initially null;
`buildReceiptUpdatePayload(raw:unknown,original:ReceiptSnapshot,proposal:ReceiptControlProposal,
contract:N3UpdateContract):PreparedReceiptUpdate`;
`updateN3Receipt(actor:ReceiptAutomationActor,prepared:PreparedReceiptUpdate,limit:{deadlineAt:number;signal:AbortSignal}):Promise<N3Outcome>`;
`canAutoUpdate(actor,schemaReady:boolean,contract:N3UpdateContract|null,env):boolean`.
Fixed path `/api/ARReceipts/Update?confirmedForBankRecon=false&confirmedForKnockOff=false`.
Test fixtures export `UPDATE_CONTRACT_TEST_ONLY`, `RECEIPT_50_RAW`,
`RECEIPT_50`, `PROPOSAL_65` and positive/negative final journal envelopes.

- [ ] Write failing tests for preserved IDs/doc/date/reference/customer/currency and
  non-proposed fields, same account MYR65 total/line agreement, contact-only field
  mapping, conflicting aliases, split/unknown shapes, reconciled/matched/refunded/
  cancelled state and missing conditional token. Existing pure journal parser
  must still reject forged correlation/null identity. Preserve disabled historical
  account only for contact-only, revalidate it for an amount change.
  `expect(buildReceiptUpdatePayload(RECEIPT_50_RAW, RECEIPT_50, PROPOSAL_65, UPDATE_CONTRACT_TEST_ONLY).body).toMatchObject({totalAmount:65})`;
  `expect(canAutoUpdate(owner,false,null,{})).toBe(false)`.
- [ ] Run `bunx vitest run src/lib/__tests__/n3-receipt-update.test.ts src/lib/__tests__/receipt-controls-evidence.test.ts`; expect missing adapter failures, existing evidence tests unchanged.
- [ ] Implement canonical payload construction from server-read evidence; map only
  proven DTO fields and refuse unpreservable unknown content, missing reconciliation
  evidence or unproven conditional writes. Conditional mapping in production stays
  unavailable until Owner proof; do not guess that updatedAt enforces concurrency.
- [ ] Extend the existing fixed transport to accept a deadline/AbortSignal for new
  reads/Update without changing default behavior of deposit Create. Preserve private
  GL WeakMap provenance. Bound actual fetch/body read to remaining time and response
  cap. No route invokes Update until contract, flag, schema and immutable N3 tenant
  allowlist all pass, using server `n3TenantKey` and existing `isDepositWriteEnabled`.
- [ ] Rerun tests; prove arbitrary paths/tokens/flags never originate from browser
  and production contract remains null. Commit dormant adapter.

### Task 5: One-click authorization, dispatch and GET-only reconciliation

**Files:** Create `src/lib/receipt-automation-store.server.ts`,
`src/lib/receipt-automation-execution.server.ts`,
`src/lib/receipt-automation-deps.server.ts`,
`src/lib/__tests__/receipt-automation-execution.test.ts`,
`src/lib/__tests__/receipt-automation-api.test.ts`;
modify existing receipt create/decision/execute/verify/recover routes, store DTO
mapping, HTTP actor/error boundary and execution dispatcher. Add
`src/routes/api/hotel/receipt-controls.$requestId.check-result.ts`.

**Interfaces:** Consume Tasks 1/2/4. Produce
`applyReceiptCorrection(actor:ReceiptAutomationActor,input:{requestId:string;expectedVersion:number;
action:"approve"|"apply"},deps:ReceiptAutomationDeps):Promise<ReceiptApplyResult>`,
`checkReceiptCorrectionResult(actor,requestId:string,deps):Promise<ReceiptApplyResult>`.
Deps expose Task 2 DB adapter, policy/gates, current receipt/evidence/account readers,
prepared Update transport, fresh Owner revalidation and clock/deadline. DTO helper
`toAutomationDTO(actor,row):Promise<ReceiptAutomationDTO>` adds explicit action caps.
Production deps provide `requireFreshReceiptOwner(actor:ReceiptAutomationActor):Promise<void>`
using the existing uncached `readN3Users` and pure `decideEffectiveRole` with the
server session identity; do not rely only on the 60-second cached Owner result.
Do not modify the established login or protected authentication foundation.

- [ ] Write failing tests with injected DB/transport: approval ON and direct Owner
  both Update once then prove MYR65; FrontDesk may create but never send Update;
  double click/concurrent browser/retry returns held/existing attempt; false journal
  or contact mismatch cannot append a version. Current policy tightened before
  reserve holds; relaxed policy/old manual request never auto-runs.
  Assert sentCalls===1, effectiveAmountCents===6500, versions.length===1 on success;
  after timeout and repeated apply assert sentCalls remains 1 and check-result
  makes only GET calls. Inject success then local DB failure and prove later GET
  settlement appends once. Late results/stale claim cannot complete newer state.
- [ ] Run `bunx vitest run src/lib/__tests__/receipt-automation-execution.test.ts src/lib/__tests__/receipt-automation-api.test.ts`; expect missing orchestrator failures.
- [ ] Implement DB methods against new RPCs, keeping legacy store interfaces intact.
  New creation snapshots categories/policy and generation; no-op returns no request.
  Mode selection never changes an existing row. Reject forged automation metadata.
- [ ] Implement approve/apply: resolve fresh Owner and immutable tenant key, gates,
  authorization, strict fresh preflight and payload; revalidate Owner immediately
  before reserve/send. Commit dispatch reservation before one POST. Loss of Owner
  authority denies dispatch; an already-dispatched attempt stays held. Strict
  business envelope plus proposal/journal proof alone enables atomic completion.
  No automatic timer, page mount, request poll or retry sends financial writes.
- [ ] Wire existing endpoints by generation: legacy retains manual behavior;
  generation-2 Approve orchestrates; Owner Apply handles policy-direct requests;
  check-result is reconciliation only. Old Verify/recover refuse generation-2 at
  server and SQL boundaries. Unknown/restricted outcomes return safe actionable
  codes with current DTO, never raw N3 values. No financial claim is auto-released
  after 300 seconds. Server deadline must come from later measured runtime budget;
  production automation denies missing budget configuration.
- [ ] Rerun targeted, existing receipt-store and isolated race tests. Commit pipeline.

### Task 6: Settings, compact Dashboard and honest contact/deposit UI

**Files:** Create `src/lib/hotel-change-controls-client.ts`,
`src/components/ChangeControlSettings.tsx`, `src/components/BillToApprovalQueue.tsx`,
`src/lib/__tests__/change-controls-ui.test.ts`;
modify `src/routes/settings.tsx`, `src/routes/index.tsx`,
`src/components/ReceiptApprovalQueue.tsx`, `src/components/ReceiptControlRequestDialog.tsx`,
`src/components/DepositsCard.tsx`, `src/components/FolioBillToCard.tsx`,
`src/lib/receipt-controls-client.ts`, `src/lib/folio-bill-to-client.ts`.

**Interfaces:** Produce `changePolicyKey(identity:string)`,
`useChangePolicy():{policy:ChangePolicy|null;available:boolean;error:unknown}`,
`saveChangePolicy(input:ChangePolicyInput):Promise<ChangePolicy>`,
`saveFolioBillTo(reservationId:string,input:BillToSaveInput):Promise<BillToSaveResult>`.
Receipt clients use ReceiptAutomationDTO/ReceiptApplyResult while legacy responses
normalize to automation:null. Bill-to hook returns BillToReadDTO; no optimistic
effective updates for pending proposals. Settings displayed defaults from Task 1.

- [ ] Write failing render/action tests: both independent labelled switches in
  Settings Operations, Owner-only editing; compact comparison visible before
  Approve, no Review/checkbox prerequisite, Approve once calls orchestration and
  displays Applying then explicit outcome. Missing capability disables new toggles
  with a short explanation; legacy request/Verify controls remain clear.
  Contact pending shows Original as effective and Proposed separately; local Save
  OFF works without N3 permission. Housekeeper receives no queue or monetary UI.
- [ ] Run `bunx vitest run src/lib/__tests__/change-controls-ui.test.ts src/lib/__tests__/receipt-controls-store.test.ts src/lib/__tests__/receipt-auth-switch-cache.test.ts`; expect new interaction contracts to fail.
- [ ] Implement controls and queue, including full changed-contact comparison,
  accessible full values, reason/requester/time and final right-aligned action on
  desktop; stack at 375px. Use Apply for Owner-execution-required and Check N3
  result for uncertainty; normal automatic success has no manual Verify. Legacy
  manual cards keep explicit instructions rather than promise automatic writes.
- [ ] Wire local contact proposal/reason/effective revision and pending Owner queue.
  Preserve an unsaved draft across unrelated revision refresh, but discard it on
  identity/reservation change; show conflict if effective data changed. Verify
  print reads effective local bill-to only. Do not add a deposit editor to checkout.
- [ ] Rerun tests and intercepted-fixture desktop/mobile browser interaction
  checks; screenshots are simulated UI evidence, not live N3 acceptance. Commit UI.

### Task 7: Shared effective projection and cross-session revision refresh

**Files:** Create `src/lib/hotel-change-revision.server.ts`,
`src/lib/hotel-change-revision-client.ts`, `src/routes/api/hotel/change-revision.ts`,
`src/lib/__tests__/hotel-change-revision.test.ts`;
modify `src/components/AppShell.tsx`, `src/lib/receipt-controls-client.ts`,
`src/lib/folio-bill-to-client.ts`, `src/lib/financial-reporting-store.server.ts`,
`src/lib/__tests__/receipt-auth-switch-cache.test.ts`,
`src/lib/__tests__/financial-reporting-store.test.ts` and add affected projection
cases to existing folio/deposit/checkout tests only where the reader changes.

**Interfaces:** Produce `readChangeRevision(tenantId:string):Promise<string|null>`
(null only missing installation) and `useHotelChangeRevision():void` mounted once
in AppShell. Query key `["hotel-change-revision",identity]`; GET returns only
ChangeRevisionDTO, no-store, existing app permission but Housekeeper denied financial
revision. `billToKey(identity:string|null,id:string)` replaces tenant-only key.
The observer is disabled for Housekeeper before fetching; AppShell mounting does
not create a recurring forbidden request or expose financial revision metadata.

- [ ] Write failing timer/QueryClient tests: two distinct actor identities observe
  revision change, all seven existing financial-effect prefixes invalidate once;
  local bill-to/policy keys also refetch. Poll interval is 2,000ms when visible,
  hidden/signed-out stops, focus/reconnect fetches; same revision is a no-op.
  Failed auth clears policy/bill-to/proposal/revision queries and mutation drafts;
  FrontDesk receives no Owner finance/request-queue refetch. Very large decimal
  revision strings compare losslessly. Failed period hides prior amounts/export.
- [ ] Run `bunx vitest run src/lib/__tests__/hotel-change-revision.test.ts src/lib/__tests__/receipt-auth-switch-cache.test.ts src/lib/__tests__/financial-reporting-store.test.ts`; expect missing revision behavior failures.
- [ ] Implement local metadata GET observer with a shared query, no N3 calls and
  no autonomous mutation. Increment revision atomically in Task 2 state/completion
  paths; append revision to existing financial cache key while preserving its
  deposit/request/version components. Missing installation retains legacy cache;
  read failure is unavailable, not a false unchanged revision.
- [ ] Ensure all existing effective readers consume one confirmed MYR65 version:
  deposits, folio/print/balance/excess, reservation list/detail, departures, checkout,
  dashboard and receipt reports/export. Tests assert MYR65 once, never MYR115;
  unresolved/unknown never displays proposed MYR65 as effective. Preserve N3 dates,
  100/101 candidate boundary, Sales/Collections unavailable, and unchanged stay stage.
- [ ] Rerun tests and two intercepted authenticated browser sessions through mounted
  requester/Owner views, including auth failure and lost-response reconciliation.
  Record refresh latency rather than promise zero delay. Commit refresh behavior.

### Task 8: Prepare dormant Owner proof tool and bounded evidence

**Files:** Create `src/lib/receipt-update-proof.server.ts`,
`src/routes/api/hotel/receipt-update-proof.ts`,
`src/components/ReceiptUpdateProofPanel.tsx`,
`src/lib/__tests__/receipt-update-proof.test.ts`;
modify `src/routes/settings_.n3-financial-verification.tsx`,
`docs/evidence/HH_AUTOMATIC_CORRECTION_OWNER_PROOF_20261003.md`.
Extend the Task 2 additive migration during review development for a service-only
`hotel_receipt_update_proof_permits` ledger; never amend it after actual apply.

**Interfaces:** Produce `prepareReceiptUpdateProof(actor,input:{caseId:string;receiptId:string;
approvedPackageHash:string},deps):Promise<{permitId:string;summary:unknown}>` and
`runReceiptUpdateProof(actor,permitId:string,deps):Promise<{outcome:string;safeReport:unknown}>`.
Permit binds fixed sandbox tenant key, receipt ID, exact payload hash/case, Owner,
expiry and one dispatch. Distinct proof config cannot enable production capabilities.
No free-form endpoint or browser ARReceiptDto. Durable claims and GET readback are
shared; a stale-payload concurrency probe is explicitly labelled proof-only.

- [ ] Write failing tests: default proof route disabled, production/non-designated
  tenant and real booking IDs refused, payload change/expired permit denied, repeat
  execution sends once, safe report contains no token/contact body. Simulate outside
  change: conditional rejection PASS; accepted stale overwrite FAIL and contract
  remains null. Owner revocation after prepare denies send; late outcome holds.
- [ ] Run `bunx vitest run src/lib/__tests__/receipt-update-proof.test.ts`; expect missing permit/route failures.
- [ ] Implement server-owned allowlisted test packages and fresh Owner-only panel.
  Proof runtime remains disabled unless a separate approved package/config exists.
  UI displays exact company/receipt/date/before/after and requires explicit execution
  of the scoped case. It never asks Owner for credentials/raw API JSON or repeats
  earlier unrelated Cash Sale/refund UI proofs. No request against BK260920001 /
  OR2610/001 is prepared. Unknown proof sends use GET-only result inspection.
  A conditional-write mapping under investigation may run only inside the exact
  permitted sandbox probe; it never populates productionUpdateContract or bypasses
  production gates. The stale-payload case deliberately tests upstream rejection;
  failure is recorded as unsupported, not accepted as a successful correction.
- [ ] Generate sanitized report with source/hash, fixed IDs, account/customer journal
  checks, conditional-write verdict, dispatch/version count and measured runtime.
  Use `docs/evidence/HH_AUTOMATIC_CORRECTION_OWNER_PROOF_20261003.md` matrix; all cases
  currently NOT RUN. Payload/journal personal evidence stays access-controlled.
- [ ] Rerun unit and isolated permit-race tests. Commit dormant tool. Do not run
  signed-in N3 writes: hand exact package to Owner only at its own approval gate.

### Task 9: Whole-branch validation, review and separate release candidates

**Files:** Create `docs/HH_AUTOMATIC_CORRECTION_CANDIDATE.md`,
`docs/evidence/HH_AUTOMATIC_CORRECTION_GATES_20261003.txt`;
update README, recovery checkpoint and change-impact map with implemented versus
activated state. Record exact dated evidence path at execution time.

**Interfaces:** Consume every completed task and export a reviewable source/tree,
new migration path/hash, schema-compatibility report, proof-package manifest and
explicit lane status. This task grants no side-effect authorization.

- [ ] Run fresh targeted tests and disposable PostgreSQL grants/race tests. Any
  unavailable SQL/tooling is a documented blocking gap; no synthetic PASS. Include
  old manual Verify/recover/RM65 immutable-mode regression after the new migration.
- [ ] Run actual project gates: `bun run test`,
  `bunx --package @typescript/native-preview tsgo --noEmit`, `bun run lint`,
  `bun run build`, `git diff --check`. Use approved runtime packages without changing
  package/lock files. Record command, exit, counts/skips and existing warnings;
  unknown/dormant feature tests use fixtures, not a live backend.
- [ ] Verify protected-baseline exact diff, no secrets/generated auth drift, unchanged
  applied SQL, no external alert provider or new N3 path outside bounded Update.
  Inspect complete diff and desktop/mobile results. Obtain one independent whole-
  branch review using the selected execution workflow; resolve findings and rerun
  only affected checks. Do not claim signed-in live acceptance from intercepted UI.
- [ ] Commit handover to remote review branch, verify exact tree and clean local
  checkpoint. Present candidate before merge/schema/publish gates. Preserve all
  audit/attempt data and fail-closed behavior when old code is deployed with new
  schema or capability OFF. Neither code rollback nor disabling policy reverses N3.
- [ ] After separate gates, record Owner sandbox outcomes; only proven upstream
  conditional-write semantics permits populating productionUpdateContract in a
  newly reviewed candidate. Failure/absence keeps automatic Update disabled.
  Measure managed runtime budget, allocate total execution deadline below it and
  prove late completion/reconciliation. No invented numeric hosting limit.
- [ ] After approved schema apply, inspect actual history/RLS/grants/RPCs and schema
  compatibility without rewriting protected generated types. After approved source
  merge verify Lovable main sync. After approved publish record deployment/source
  and signed-out smoke, then Owner performs signed-in two-device amount/contact
  acceptance. Mark DB APPLIED, CODE MERGED, RUNTIME VERIFIED, PUBLISHED and LIVE
  ACCEPTED separately. Existing legacy RM65 resolution is a separate user action.

## Plan self-review and next action

Coverage: policies/roles (1–3), local/contact distinction (3/6), storage/security/
legacy (2/5), bounded N3/unknown/concurrency (4/5/8), UI/refresh/readers (6/7),
SQL/browser/full regression and rollout/rollback (2/8/9). Review Focus cases are
pinned to their owning tests. Names, DTO shapes and policy revisions agree across
tasks; no service accepts browser financial payloads or fabricated approval.
Missing tooling and upstream contract are explicit proof blockers, not unspecified
implementation decisions. No product code, migration apply or N3 operation is
performed by saving this plan.

Next gate: Owner reviews this plan and chooses native or subagent-driven execution.
Once confirmed, complete the review-branch dormant implementation and independent
checks without repeatedly requesting its already-granted authorization. Stop only
at concrete independent database, N3 test-write, merge/activation/publishing gates
or a genuinely unavailable capability that blocks the next dependent task.
