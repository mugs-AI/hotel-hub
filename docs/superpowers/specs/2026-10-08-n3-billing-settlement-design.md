# HH1.0 N3 billing, receipt allocation and safe checkout design

Date: 08/10/2026, Asia/Kuala_Lumpur. Upload to Project Sources: **No**.
Status: written specification awaiting Owner review; not implementation or release approval.
Repository: mugs-AI/hotel-hub. Review baseline: `1b5a27be2506ff7720bea148793fcacb8f60f76d`.

## Purpose and accepted direction

The client needs a usable hotel system on 01/11/2026. The approved priority is a complete N3 billing/receipt knock-off vertical, financially safe checkout and housekeeping handoff, then access cards, BEC and whole-client acceptance. Direct repository coding/testing on a review branch is the delivery method. Keep Lovable hosting and Lovable Cloud backend; never send Lovable AI Build messages. Existing approvals cover the direction and discovery, not new financial transactions or this newly written specification.

Success means a prepared HotelHub folio becomes exactly one authoritative N3 Cash Sale posted to AR; eligible linked receipts reduce that bill exactly once; an explicitly received positive balance is posted and matched; fresh document and journal evidence proves settlement; one fenced local transaction closes the stay and hands every vacated room to housekeeping as Dirty. All readers show the same confirmed facts. A local approval, estimated balance or HTTP success is insufficient.

Keep receipt correction as a separate workstream. Its automatic Update contract is currently null, new automatic-control SQL remains unapplied, and the legacy RM65 request is not a billing proof fixture. Deposit/contact approval switches do not grant Front Desk an N3 write role. This first settlement writer and final close are Owner-only; existing Front Desk checkout viewing remains available. The small-hotel boss uses Owner. No implicit customer-master edit.

## Verified starting point and recovery

- Fresh remote review is `1b5a27b`; main and Lovable latest commit are `734ac405c82e653a7098ce0ef22d51586382bd9d`. Backend is Lovable Cloud with Supabase enabled, configured reference `fkakhdzelilnejyehwfk`; a review branch is not a separate database environment.
- Applied migration history includes `20261002053219` and `20261002053302`, not `20261003120216` or historical checkout candidate `20260930210000`. Public hotel tables include folios, deposits, receipt controls and housekeeping handoffs, but no checkout posting ledger. Folio status accepts only open/prepared. Existing reservation status supports checked_out; this alone is not a settlement mechanism.
- Checkout preview is GET-only, derives the prepared folio total and exposes `financialPostingEnabled: false`, with `n3Outstanding: null`. Its receipt classifier expects entirely unapplied receipts. Do not weaken that original creation/preview proof to accommodate matching.
- Historical checkout SHA `a92d9234f8aceaa34c6e4a34976d8956225f3ef4` returns GitHub 404 and is absent from both local repositories. No checkout writer was located in current files or the 20 remote branch names. This does not prove every historical artifact never existed. If recovered later, reconcile before adopting; do not recreate an old migration under its old version.
- All 18 newly attached active sources match the canonical 07/10 source pack byte for byte. Existing uncommitted product work is preserved. Three existing checkout test files pass, 115 tests; they prove the current read-only behavior using local fixtures/mocks, not N3 settlement.

## Approach selection

| Approach | Trade-off | Decision |
| --- | --- | --- |
| Add a durable settlement service around existing folio, deposit and housekeeping primitives | Adds one focused ledger and guards affected writers; supports uncertain writes and independent proof | Selected |
| Make the preview POST several N3 operations directly | Small initial UI change, but no durable crash recovery or frozen input boundary | Rejected |
| Depend on recovered historical checkout implementation | May reduce work if recovered, but source/provenance and applied schema are currently unavailable | Reconcile if recovered; not a dependency |

## First accepted vertical and exclusions

Support one tenant currency, one checked-in reservation including multiple rooms, one positive final bill, previously verified reservation-linked receipts, and a single-account balance receipt. Amounts use checked integer minor units. The existing prepared folio is the only charge calculator; never add room nights a second time.

Preserve independently closed gates for split API writes, refund, unmatch, void, replacement and automatic correction. Negative/zero final folios, an unresolved excess receipt remainder, unsupported tax/adjustment/rounding mapping, incomplete historical charge evidence, or disputed receipts remain Needs review and cannot final-close through this vertical. No automatic write-off or forged zero bill. Previously completed N3 Cloud UI exercises are retained evidence, not repeated acceptance jobs; API-specific proofs below are different, still missing evidence.

## Components and interfaces

| Unit | Inputs and outputs | Existing reuse / boundary |
| --- | --- | --- |
| Settlement snapshot builder | Server tenant/reservation/actor; immutable folio, stay, contact, mappings and receipt snapshot with digest | Prepared-folio calculator and current tenant settings; GET never prepares or writes |
| Fixed N3 billing transport | Approved immutable intent, server token; bounded typed operation outcome with dispatch metadata | Existing receipt transport limits/auth discipline; add fixed CashSales and knock-off operations, no caller URLs |
| Strict evidence provers | Bound transport results and expected snapshot; confirmed / contradiction / unavailable | Strict deposit/receipt journal guards; do not copy first-field-wins legacy preview helpers |
| Durable settlement store | Atomic claim, snapshot digest, dispatch fence, immutable attempts and verified evidence | New additive tables/RPCs; original deposit intent remains immutable |
| Settlement coordinator | Current Owner session and reservation ID; next safe step or read-only recovery result | Server-derived scope; no financial facts accepted from browser |
| Settlement view and close | Stored evidence plus fresh reads; confirmed balances and fenced local close | Existing query readers, reservation events and housekeeping handoff conventions |

Keep focused modules rather than inserting a second money workflow into the large folio store. Existing `checkout-preview.server.ts`, `checkout-money.ts`, `folio-store.server.ts`, `deposits-store.server.ts`, `n3-receipts.server.ts` and reservation-operation RPCs provide reusable primitives. The new service must not depend on the unapplied automatic-receipt migration or the uncommitted change-revision work being live.

## N3 contract and activation gates

Fresh official sales-v1.json SHA256 is `d9375f8fac7af01fe5f6fc8828ab948f433151bf1d48a610df10c00077404143`. Six selected operation objects are unchanged from the local 03/10 copy. Static schemas are not authenticated runtime proof.

| Operation | Known static shape | Proof required before its writer is enabled |
| --- | --- | --- |
| POST `/api/CashSales/Create` | CashSaleDto; `isPostToAR`; stock lines in `itemDetails`; successful data ID | Accepted tenant payload, exact taxes/charges and Post-to-AR journal; no embedded payment causing a second bank debit |
| GET `/api/CashSales/{key}` and `/GLPosting?key=...` | UUID key, generic response schema | Bound document/customer/currency/date/reference/lines/taxes; exact AR debit, sales/tax credits and balanced GL |
| POST `/api/ARReceipts/UpdateCustomerKnockoff` | Flat ARKnockoffItemDto array grouped by receiptDocId; OR rows; positive paymentAmount saved | Current CashSale-to-INV immutable relationship, replace/append semantics, preservation of earlier rows, partial allocation, repetition and external-concurrency behavior |
| POST `/api/ARReceipts/Create` | Required customerId/currencyId/docType; selected account; omit details | Single-account positive balance create, exact detail and bound bank debit/customer credit; no assumed split support |
| GET receipt detail and GL | Detail includes knockoff, outstanding/refund values | Exact allocation identities, full remainder conservation and unchanged pre-existing allocations/refunds |

Customer, currency, stock, UOM and tax schema IDs are integers; bill/receipt IDs and accountId are UUIDs. Normalize by the actual field contract rather than requiring UUIDs everywhere. Preserve lossless int64 revision evidence. Do not guess an INV target from a document number: historical examples show a Cash Sale header UUID as INV target, but current authenticated linkage still requires proof. `data: 1`, `success: true`, or `updatedAt` alone proves neither accounting nor safe concurrent mutation.

The allocation DTO has no documented conditional revision parameter. A HotelHub mutex cannot prevent a separate N3 operator changing a receipt. Require evidence of N3-side stale/concurrent validation before activation; if that safety cannot be established, keep matching disabled and report this exact launch blocker. Do not send an empty allocation array to guess clearing semantics. No new Owner financial test is authorized by this spec: prepare a bounded job with exact tenant/documents/amounts and get its separate transaction approval first.

## Durable identity, freeze and dispatch

Create one immutable billing intent for tenant + reservation + frozen folio revision. Store server actor, currency, document date, exact line/master-ID snapshots, payment/account facts, stable reference within N3's 50-character limit, and a content digest. References contain no guest PII. Each write step has a separate durable dispatch claim and attempt identity. Enforce scoped unique keys and composite tenant/reservation/document relationships in SQL, not just application filters.

Before the first financial dispatch, freeze the reservation's financial revision. Every writer affecting charges or identity must participate: folio preparation/refresh/add-on/quantity/adjustment/reversal/tax profile; rate/room/date/late-checkout actions; cancellation/status changes; deposit creation/correction/void; and bill-to changes. Snapshot active posting mappings and reject conflicting settings changes at dispatch. Claim and freeze are atomic; do not hold an SQL transaction open over N3 network calls. Shared reservation guards must be enforced inside existing mutation RPCs and any direct-update paths, including approved requests applied later.

Never thaw automatically when a lease expires, a process crashes or a POST outcome is uncertain. Before any dispatch a still-unused intent may be abandoned atomically. After dispatch, replacement requires proven absence plus an independently approved recovery contract; timeout or no match in a bounded search is not proof of absence. Changes after a verified posted bill belong to a separately approved financial adjustment flow, not silent snapshot rebuilding.

## Settlement flow

1. **Freeze and preview.** Verify current Owner/tenant, checked-in stay, prepared folio, complete charge history, active line/master mappings, eligible deposits and exact account facts. Present the bill total, verified deposit candidates and estimated remaining payment distinctly from an authoritative N3 balance.
2. **Post bill once.** Claim one Cash Sale Post-to-AR dispatch. Prove the created UUID, full detail and journal against the snapshot. No receipt allocation proceeds until the bill and its AR target are independently confirmed.
3. **Apply eligible deposits.** Use only immutable receipt IDs already linked to this reservation. A shared walk-in customer is not booking ownership. Freshly prove each receipt and existing allocations/refunds. Allocate no more than its proven unapplied remainder or the bill's current outstanding. Stable ordering uses N3 receipt date and immutable ID. Preserve every prior allocation; foreign or contradictory evidence blocks. A confirmed allocation already belonging to this exact intent is recovery evidence, not permission for another POST.
4. **Receive positive balance explicitly.** After matched deposits are verified, display the current N3 remaining amount. Owner confirms actual payment and selects the real eligible account; re-read/re-validate before claim. Create one unapplied balance receipt using the proven remaining amount, verify through the unchanged creation proof, then match it to the verified bill. Do not label this receipt a reservation deposit or collect merely because checkout opened.
5. **Prove settlement.** Use a separate post-allocation prover. Check the exact bill, each allocated receipt, customer/currency, journal identity, unchanged unrelated allocations/refunds, and conserved balances. Receipt amount = allocations + proven refunds + unapplied remainder; bill total = verified allocations + outstanding. Zero outstanding alone is insufficient. Missing refund evidence is not zero. Re-read changed fingerprints within a bounded window; ongoing inconsistency produces Needs review.
6. **Close locally once.** Only fresh, internally consistent settlement proof allows the close RPC. Atomically compare expected reservation/folio/intent revisions; persist immutable close evidence; move checked_in to checked_out; release all occupied allocations; clear DND and mark every actually vacated room Dirty; record reservation/audit events and complete the housekeeping handoff. Validate tenant scope and no other occupant for every room. Any failure rolls back all local effects. Replay returns the same close outcome.

After external settlement but failed local close, recover the existing settlement and retry only the fenced local close. Never repeat bill, receipt or allocation POSTs. Access-card revocation is a later integration, with its own outcome/recovery; this spec does not invent a device API.

## Failure, recovery and security

HTTP/business errors before dispatch may be rejected normally. After dispatch, timeout, transport loss, 5xx, malformed/contradictory response or 401 leaves an unknown outcome, persists the attempt and prevents repeat dispatch. A 401 also terminates the session. Read-only recovery uses saved IDs, or an exact stable-reference search with complete identity checks; ambiguous/multiple/no results remain unresolved. No prefix match, recreated reference or blind financial POST retry.

Bind document/GL transport evidence to exact operation, token/tenant and requested immutable ID; client JSON cannot manufacture trusted provenance. Contradictory aliases, nested IDs, dates, accounts or amounts fail closed. Never use a cancellation flag/timestamp as proof of cancelled GL entries. Keep raw tokens, cookies, guest PII and full journals out of repository evidence. Preserve N3-only server authentication, current Owner allowlist, HttpOnly session and tenant isolation; no new Supabase user login or generic auth.uid() role path.

New tables/RPCs require explicit service grants, browser denial and tenant scope tests. Supabase's announced 30/10/2026 public-table default-grant change affects newly created tables, not existing table grants; verify deployed access explicitly. Do not broadly change default privileges. Database application, code merge, function/runtime deployment, N3 write authorization and public publishing remain separate lanes. No standalone Edge Function deployment is presumed in this TanStack Start/Nitro application.

## Product readers and financial reporting

Use a separate settlement DTO after posting rather than forcing matched receipts through the old unapplied-only preview classifier. Show working, awaiting payment, Needs review and confirmed results with persisted attempt status. A click during work returns the same attempt; cross-device recovery is server-owned. No forever spinning Verify button. Keep Prepare Checkout's cards distinct from Reservation deposit editing; normal folio print remains fast/read-only.

Confirmed facts refresh Reservation/detail/list and deposit ledger, Owner queue/Dashboard, folio/print, Departures, Prepare Checkout, Monthly Finance/export and housekeeping/calendar. Use server-confirmed revisions and query invalidation/re-read; never optimistically display financial success. Authentication/scope/period failure clears stale money. Implement a bounded read-only cross-device refresh supported by the deployed settlement schema, not an assumed unpublished revision endpoint.

Sales/Collections remain Unavailable until their authoritative N3 posted sources and complete period reads are accepted. Sales use final posted N3 bill dates and appropriate reversals; Collections use N3 receipt dates and supported reversal/refund policy. Allocation is not new revenue or cash and must not be counted again. Distinguish deposit receipts from balance receipts by immutable purpose. The existing monthly receipt >100 verification-candidate rule remains Unavailable, never a partial total. Preserve Owner/property/person scope and historical receipt-date semantics.

## Acceptance evidence

| Layer | Required cases and evidence |
| --- | --- |
| Pure money/provers | Exact cents/tax/rounding, master ID types, nested aliases/conflicts, wrong IDs/tenant/customer/currency/date/account, missing refunds, receipt conservation, cancellation flags rejected |
| Coordinator with mocked N3 | Bill/deposit/balance/zero settlement; duplicate clicks and two devices; each crash boundary; unknown POST then GET recovery; after-write401; no-match recovery stays blocked; no financial retries |
| SQL integration | Two tenants, composite scope, unique claims, guarded old mutation RPCs/direct paths, concurrent claims, stale revisions, browser denial/service grants; multi-room close rollback/replay and DND/Dirty consistency |
| UI/readers | Owner vs Front Desk, stale auth/period clearing, existing fast folio print, matched receipt settlement view, correction controls independent, exact once refresh/no optimistic money; month >100 guard |
| Approved N3 API sandbox proof | Exact bill/Post-to-AR GL and INV linkage; single account receipt/GL; allocation preservation/partial/repetition/concurrency semantics; balance receipt and zero outstanding; sanitized provenance and current GET evidence |
| Release | Review candidate SHA; full required unit/type/style/build checks and applicable SQL tests; separately approved DB/runtime/public lanes; signed-in end-to-end checkout then all-room Dirty handoff and reporting reconciliation |

Baseline 115 tests are not this acceptance matrix. Activation requires both meaningful automated evidence and the specific missing API proof. If a gate fails, the corresponding writer remains disabled and the launch readiness report states the blocker.

## Delivery order and next stage

After written-spec approval, create the implementation plan for this single billing/settlement vertical, using direct review-branch coding and testing. Order: pure contracts/provers and fixture baselines; additive ledger plus all mutation fences; fixed disabled transports/coordinator and recovery; settlement/readers/atomic close; separately approved API proof; full acceptance and exact candidate release evidence. Then access-card integration, BEC default 30-room lot enforcement, and whole-client UAT/cutover. This is dependency order, not a promise of completion by a date without passed gates.

Keep existing automatic-correction work parked with its own execution ledger and approvals. Do not merge unrelated pending local changes into this billing candidate. Before implementation, verify remote state again and establish isolation without resetting either local repository.

## References and self-review

- `docs/project-sources/2026-10-07/03-HOTELHUB_N3_FINANCIAL_POSTING_KNOCKOFF_MASTER_RECORD.md`: accepted accounting flow and completed Owner UI evidence.
- `docs/HH_MONTHLY_FINANCIAL_SOURCE_CONTRACT.md`, `docs/HH_RECEIPT_CONTROL_N3_CONTRACT.md`, `docs/HH_RECEIPT_SQL_VALIDATION.md`: retained controls.
- `docs/evidence/HH_N3_BILLING_DISCOVERY_20261008.json`: dated read-only state, public contract hash and baseline tests.
- Official API: https://openapi.account.qne.cloud/doc/sales-v1.json
- Grant change: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically

Self-review completed: no placeholder requirements; current behavior separated from proposed design; historical UI proof separated from missing API proof; role, uncertain-write, receipt remainder, journal, monthly cap and release gates preserved. Unproven contracts have explicit closed-gate outcomes rather than guessed implementation requirements. No product code, SQL application or financial transaction is claimed by this document.
