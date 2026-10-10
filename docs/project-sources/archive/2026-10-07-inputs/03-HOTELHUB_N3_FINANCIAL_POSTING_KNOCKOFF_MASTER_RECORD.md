# HOTELHUB_N3_FINANCIAL_POSTING_KNOCKOFF_MASTER_RECORD

## Current Financial Integration Record

**Pack version:** 28/09/2026, local receipt/journal read-back candidate  
**Finance-specific accepted checkpoint:** `75ceac11089936778b672c438d3a103b4715609a` (posting-mappings parity; not checkout settlement)  
**Accounting source of truth:** N3  
**27/09/2026 local source checkpoint:** Local commit `b32a519` contains the rebuilt N3 bank/cash account selector, Owner display labels, immutable payment-line snapshots, matching migration `20260927120000_hh_payment_accounts_and_lines.sql`, and a separate split-posting gate. Local build and TypeScript passed; 116 focused financial tests passed and changed-file lint has no errors. GitHub `main` now points to `495b90d900a44bc9b5297d24ca07529b45aff23e` (three equivalent fast-forward commits created through the GitHub integration). Its final tree `719e5932b501bda74d88a6937806e3726b27922d` exactly matches the tested local `b32a519` tree. The commit IDs differ because the connected integration created new GitHub commits. No migration, deployment or HotelHub N3 Create occurred. N3 Cloud UI evidence for split receipt and balanced journals remains distinct from HotelHub API proof. Keep split posting disabled pending tenant Create/read-back and GL verification. The 23/09 repository/deployment pointers below remain historical audit snapshots.

**28/09/2026 production schema repair:** Owner approved the matching `20260927120000_hh_payment_accounts_and_lines.sql` migration after Lovable Server logs identified a missing `hotel_settings.payment_account_aliases` column in published HotelHub. Applied exactly this migration to project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76` in one transaction and recorded ledger version `20260927120000`. Verified `payment_account_aliases` JSONB NOT NULL default `{}`, `hotel_reservation_deposits.payment_lines` nullable JSONB, and deposit immutable-fields trigger function now refuses changes to payment lines. No existing HotelHub deposit rows; no N3 writes, app code publish, or separate `20260925160000` migration. Owner live UI verification is pending. The local receipt/journal read-back candidate remains unshipped and split posting remains disabled.

**Source continuity check, 27/09/2026:** `b32a519` and its migration were freshly verified locally. Earlier `83facd3` was absent, so it was rebuilt. The published GitHub `main` is now `495b90d`, with the same tree as the tested local checkpoint; use that published SHA for future continuity checks. The Owner’s business decision and N3 UI screenshots retain their own evidence scope.

**Owner workflow decision, 27/09/2026:** Do not log in to N3 or operate N3 Cloud/API on the Owner’s behalf in future HotelHub work. Hand every N3 job to the Owner as a short, exact test list with expected account debits/credits and required read-back evidence. Codex handles HotelHub source, safe local checks, and analysis of the Owner’s returned N3 results. Never request N3 credentials in chat or repeat the Owner’s completed Cloud UI matching/refund tests. The attempted N3 browser sign-in was rejected once, with four attempts remaining; no API receipt was created.

**28/09/2026 local candidate, unverified against tenant API:** Product Owner approved a bounded receipt-and-journal read-back build only. Candidate branch `hh-receipt-journal-readback`, local commit `72fa776973bc7f6c25d0f33f58db6c7164854710`, based on tested `b32a519`. On N3 Create success, HotelHub now GETs the receipt by returned immutable UUID and `GET /api/ARReceipts/GLPosting?key={UUID}`. It requires exact customer, reference, currency, total, unapplied state and selected payment accounts in receipt detail, plus selected bank/cash debits and one customer credit with balanced totals in the journal before setting local status `posted`. An unreadable, missing or contradictory read-back is `unknown`, retaining the receipt UUID/doc code, with no repeat Create; Owner `Check N3 Result` re-reads by UUID or exact-reference discovery and verifies the same evidence. A 401 after Create preserves `unknown` and ends the session. This is a fail-closed parser for documented routes; the public GLPosting response example does not establish the tenant's journal-row JSON shape. Local focused tests 42/42, TypeScript, changed-file lint, diff check and production build passed. No N3 call, migration, push, merge, deployment or release occurred. Do not describe this as live accepted or enable the split writer. Next proof must use an owner-run HotelHub/N3 sandbox flow, with no request for backend database IDs and no repetition of completed N3 UI tests.

**28/09/2026 batched local integration (not released):** The receipt detail and balanced GLPosting read-back guard from `72fa776` was carried onto the current `9832d5b` GitHub-main tree along with a separately staged dashboard/display-name improvement; combined local branch `hh-batch-next` at `d0d0fc9705d7f1422fe1a18114825792641e2691`. The financial diff itself is the prior receipt safety guard: after a HotelHub AR Receipt Create, require exact receipt identity/account/payment read-back and balanced selected bank/cash debits against customer credit before `posted`; uncertain evidence remains `unknown` without another Create. 79 focused integrated tests, typecheck and build passed. No tenant N3 Create/GLPosting response has been observed through HotelHub, no remote push or deployment for this branch, and split posting stays disabled. The distinct safe UI release candidate `hh-dashboard-names` excludes this finance change. Next Owner N3 job is only one HotelHub sandbox single-account receipt posting and N3 UI receipt/journal read-back; Codex does not log into N3 or repeat completed N3 UI manual tests.

## 1. Current truth

### Implemented N3 financial mutation

`Reservation deposit → N3 AR Receive Payment (AROR)`

It is behind server-side authority, feature gating, durable local intent, tenant controls, strict outcome handling and GET-only reconciliation.

### Implemented/read-only capability

- AR Receipt defaults, exact-reference list/detail and normalized evidence;
- selected Cash Sales/Customer Refund/GL/account evidence reads;
- checkout preview/readiness;
- optional verified deposit balance;
- configured tax-code rate reads;
- guest folio calculation and printing from prepared HotelHub evidence.

### Not accepted as a complete production vertical

- Cash Sales/CashMemo create with Post to AR;
- prior-deposit allocation/knock-off;
- balance AR Receive Payment plus matching;
- Customer Refund create;
- deallocation/reversal recovery;
- final atomic settlement, checked-out status and room release.

Read evidence is not write authority. Document creation is not settlement.

### Historical N3 matching evidence and provenance (reconciled 26/09/2026)

The Product Owner identifies **MUGS Perfect Software Sdn Bhd** as the N3 company in which the earlier financial workflow was tested. That company attribution is owner-reported here; the original tenant identifier and complete transaction exports are not preserved in this active source pack. Do not substitute the later **MUGS AI LAB TEST SDN. BHD.** sandbox for this historical company.

The previously supplied Desktop/CSV examples establish the following business relationships in their exported data:

| Historical example | Observed relationship | Evidence boundary |
|---|---|---|
| `OR-001-test` ↔ `CS-001-TEST` | AR receipt knock-off `docId` matched the Cash Sales immutable header ID; knock-off type `INV`. | Historical export/sample; not proof of a HotelHub Cloud API write. |
| `OR-002-test` | RM288 remained unapplied. | Historical export/sample; not a current outstanding-balance query. |
| `RF-003-test` | Customer Refund linked to an original AR receipt by immutable ID. | Historical export/sample; not proof of the Cloud API refund-create payload. |

Earlier N3 Cloud read-only verification could retrieve AR Receipts, Cash Sales and Customer Refund resources. It did not establish a successful Cloud API POST/read-back for Cash Sale with Post to AR, partial allocation, clear/reallocation or refund. A HotelHub automated test uses the historical Cash Sales document number and ID shape as a fixture; passing that test does not establish the original test tenant, live payload or settlement result.

The first 01D attempt in the separate **MUGS AI LAB TEST SDN. BHD.** sandbox stopped at a Cash Sale stock-availability warning before a document was created. The item involved belonged to another project's test data; no stock adjustment or repeat of the historical MUGS Perfect Software business test is required by this record. The owner subsequently performed the Cloud UI exercise documented below.

### Owner-run N3 Cloud UI sandbox evidence, 26/09/2026

The six owner-supplied screenshots show the **MUGS AI LAB TEST SDN. BHD.** tenant `9AC-0D9-2F1`, customer `700-7001` / `777 - HOTEL WALK IN CASH`, and these saved documents. This is separate from historical **MUGS Perfect Software Sdn Bhd** evidence.

| Document / step | Visible evidence | Limit |
|---|---|---|
| Cash Sale `CS2609/001`, detail ID `67061318-d280-40d2-4b04-08df1bbcda65` | `Posted to AR` enabled; room item `777-ROOM-201`, quantity 1, price MYR300.03, `SVT-8%` tax MYR24.00, net MYR324.03. Journal debits customer MYR324.03 and credits sales MYR300.03 and SST MYR24.00. | Initial requested MYR300.03 was a pre-tax price, not the charge total. |
| Receive Payment `OR2609/001`, detail ID `91efa246-6a37-4c5b-09c3-08df1bbcf6a7` | MYR100.01 payment, `CASH IN HAND`; initial edit view showed MYR100.01 unmatched and the Cash Sale as type `INV`. Saved view reports update success, MYR60.01 applied to `CS2609/001`, Cash Sale outstanding MYR264.02, receipt unmatched MYR40.00. Owner's additional Account Journal screenshot supplied 27/09/2026 shows Dr `700-0400 CASH IN HAND` MYR100.01 and Cr `700-7001 777 - HOTEL WALK IN CASH` MYR100.01; total debits and credits each MYR100.01. | Confirms partial matching and balanced receipt posting in Cloud UI; no separate current Cash Sale/receipt GET or API mutation payload is attached. |
| Customer Refund `RF2609/001`, detail ID `d6122a6c-bea6-4c75-5a90-08df1bc00ad4` | Saved MYR40.00 refund by `CASH IN HAND`; `OR` knock-off row points to `OR2609/001`, payment MYR40.00, refund unmatched MYR0.00. Journal debits customer MYR40.00 and credits cash MYR40.00. | Shows UI refund from receipt remainder, not a settled Cash Sale or a proven API refund/create contract. |

Arithmetic of the visible state: MYR300.03 + MYR24.00 tax = MYR324.03 charge; MYR324.03 − MYR60.01 applied = MYR264.02 charge outstanding; MYR100.01 − MYR60.01 applied − MYR40.00 refunded = MYR0.00 receipt remainder, subject to current detail read-back. No screenshot shows clearing and reapplying the allocation, a balance receipt, zero charge outstanding, duplicate-reference behavior, or HotelHub checkout. Do not label this a complete settlement or claim that the original MYR240.02 expectation passed.

### Additional owner-run N3 Cloud UI evidence, 27/09/2026

Five later screenshots from the same sandbox tenant show a second Receive Payment, `OR2609/002` (visible detail URL ID `b9693b99-80d4-4e4e-f427-08df1c477428`), for MYR150.00. N3's Multi-Payment tab records MYR70.00 to `700-0310 MAYBANK` and MYR80.00 to `700-0320 PUBLIC BANK BERHAD`, with the single Deposit To field disabled. Its Account Journal debits Public Bank MYR80.00 and Maybank MYR70.00, and credits customer `700-7001` MYR150.00; total debit equals credit MYR150.00. A later saved view shows MYR150.00 applied to `CS2609/001`, leaving that Cash Sale MYR114.02 outstanding and this receipt with MYR0.00 unmatched. Customer Account Inquiry independently displays the sequence CS +324.03, OR001 −100.01, RF +40.00, OR002 −150.00 = MYR114.02 debit. The separate Cash in Hand inquiry shows OR001 +100.01 less RF −40.00 = MYR60.01; the OR002 receipt belongs in the two bank accounts, not cash. These are owner-run Cloud UI and inquiry observations, not HotelHub/API POST proof. The earlier MYR264.02 figure is the state **before** OR002 allocation, not the final visible state.

**Further owner screenshots, 27/09/2026:** The owner-designed N3 print previews put the AR Receipt's immutable UUID in the printed heading. The receipt detail URL carries the same UUID. This gives an N3 UI operator a way to obtain the receipt ID without backend database access. The reporting preview task URL/id is a report task, not the AR Receipt's immutable ID. The owner explicitly confirms `OR2609/002` knocked off `CS2609/001`; its print preview Payment Details also shows `INV CS2609/001` paid MYR150.00. The OR002 print heading shows `b9693b99-80d4-4e4e-f427-08df1c477428`.

| Receipt | UUID in N3 detail URL / print heading | N3 UI accounting evidence | Allocation evidence |
|---|---|---|---|
| `OR2609/003` | `31332632-f07c-4d15-a0ba-08df1ca67797` | MYR10.00 single payment to `700-0320 PUBLIC BANK BERHAD`; journal Dr Public Bank MYR10.00, Cr `700-7001` customer MYR10.00; balanced. | No knock-off row; unmatched MYR10.00 in UI. |
| `OR2609/004` | `bcadfb7d-ce89-4234-a0c1-08df1ca67797` | MYR15.00 multi-payment: `700-0310 MAYBANK` MYR7.00 and `700-0320 PUBLIC BANK BERHAD` MYR8.00. Journal Dr Maybank MYR7.00, Dr Public Bank MYR8.00, Cr customer MYR15.00; balanced. | No allocation on this receipt; unmatched MYR15.00. Its displayed `CS2609/001` row remains outstanding MYR114.02. |

These are **completed N3 UI tests** for the account selection, split payment, printed ID and balanced double entries. Do not ask the owner to repeat them or provide a Create response JSON for documents created in the UI. They do not establish that HotelHub called `POST /api/ARReceipts/Create`, what that call returned, or that HotelHub read it back. No HotelHub receipt was posted in this evidence set. HotelHub must obtain `data.id` from its own successful Create response when it posts, then perform its own authenticated `GET /api/ARReceipts/{key}` and `GET /api/ARReceipts/GLPosting?key={UUID}` checks. The owner may hand over an N3 UI URL or custom print with the UUID for review; there is no need for database access. Resolve customer/account immutable IDs with the relevant tenant API lookups; account codes and labels shown in the UI are not UUIDs. Keep the split writer disabled until the separate HotelHub API Create/read-back proof is completed. The unapplied OR003/OR004 receipts do not themselves reduce the displayed CS001 outstanding MYR114.02.

### Accounting and Deposit To rule accepted 26/09/2026

The owner requires HotelHub staff to **choose** the actual N3 Deposit To account on every Receive Payment (both reservation deposit and checkout balance collection), rather than silently using N3 `/New`'s default. Eligible choices are N3 Chart of Account codes under **Current Assets**, with **Special Account Type = Bank Account or Cash Account**. QNE's N3 Chart of Accounts guidance confirms these two Special Account Types under Current Assets: https://support.qne.com.my/support/solutions/articles/81000410437-how-to-setup-the-chart-of-account-in-cloud-accounting-system . A code/name alone is insufficient; resolve the immutable N3 account ID and verify group, special type, active/posting eligibility, currency and tenant on the server at preview and immediately before posting. The selected account must represent where the guest actually paid. Refund **Payment By** must likewise resolve an eligible actual disbursement bank/cash account; it need not be the same account unless that is the real disbursement. Do not map a sales, tax, AR control, generic deposit, or rounding account into Deposit To. If any required account attribute cannot be confirmed, block the write.

**Payment-method decision, 27/09/2026:** Settings lets an Owner assign tenant-scoped HotelHub display labels to eligible N3 account IDs, e.g. `700-0310 MAYBANK` shown as `QR DuitNow`, and an actual cash account shown as `CashNote`. This does not rename the N3 Chart of Accounts, change the account ID, or assume that all QR payments use one bank account. The owner's suggested `700-0410 CASH IN HAND` code is an example label mapping; the supplied sandbox journal actually uses `700-0400 CASH IN HAND`, so the live tenant account ID/code must be selected and verified. The collecting operator chooses the display label/account; preview shows N3 code/name and amounts, while the selection list shows both alias and N3 code/name. The current deposit write permission is Owner-only; Front Desk can view the ledger but cannot post until a separately approved role change. If a guest splits payment, HotelHub must support one N3 Receive Payment with multiple positive account/amount lines summing exactly to the receipt total (for example, MYR70.00 Maybank + MYR80.00 Public Bank = MYR150.00), then verify each debit and the one customer AR credit. A single method uses the chosen `accountId` at the receipt header. In N3 multi-payment mode the Deposit To header is disabled; the published `ARReceiptDto` exposes `isMultiPayment` and `multiPayments[]`, and `ReceiptMultiPaymentDto` exposes `accountId` and `amount`. The tenant's precise Create acceptance/read-back for these fields still needs API proof. Store immutable account IDs and per-line amount snapshots in HotelHub's durable intent; aliases remain display-only and later renaming must not rewrite historical payment facts.

The screenshot journals give an exact accounting reconciliation for this scenario:

| Event | Debit | Credit | Evidence / expected check |
|---|---:|---:|---|
| `CS2609/001` Post to AR | Customer AR MYR324.03 | Sales MYR300.03; SST MYR24.00 | Journal screenshot; debit = credit MYR324.03. |
| `OR2609/001` receipt | `700-0400 CASH IN HAND` MYR100.01 | `700-7001 777 - HOTEL WALK IN CASH` MYR100.01 | Owner's 27/09/2026 Cloud UI Account Journal screenshot; debit = credit MYR100.01. |
| MYR60.01 receipt allocation | No second receipt or sale posting | No second receipt or sale posting | Validate actual N3 allocation journal/read-back and prevent duplication; screenshot proves resulting open amounts, not a journal entry. |
| `RF2609/001` refund | Customer AR MYR40.00 | Cash in Hand MYR40.00 | Journal screenshot; debit = credit MYR40.00. |

Across the original three owner-supplied Cloud UI journal screenshots, aggregate customer AR was MYR324.03 − MYR100.01 + MYR40.00 = **MYR264.02 debit** before OR002. Net cash from OR001/RF001 was MYR60.01. OR002 then knocked off MYR150.00, and CS001 showed MYR114.02 outstanding. The later OR003/OR004 bank receipts are unapplied. These UI results do not prove HotelHub API posting behavior.

The 26/09/2026 files-only correction resolved the N3 `/ARReceipts/New` default `accountId` via `GET /api/AccountCodes/{id}`. The 27/09/2026 stage lists eligible account choices from the tenant's leaf query, then re-verifies **each selected ID** with account detail before preview or create. It requires active leaf (`hasChildren: false`), same currency, `accountType.typeCode: BCA` (Current Assets), and `specialCode: BAC` (Bank Account) or `CAC` (Cash Account). QNE's [chart import guidance](https://support.qne.com.my/support/solutions/articles/81000413241-how-to-import-chart-of-account-by-excel-template) publishes these type/special codes. Missing, contradictory, or unavailable data blocks the create before the local intent claim. Preview displays verified account code/name and line amount. The unrelated read-only `evaluateGlAccount` classifier still uses legacy `SpecialType` fields and must not be treated as the write gate. Tenant leaf-query response shape still needs runtime proof before release.

The deposit fixture now models a synthetic BCA/BAC active leaf returned from account detail, with negative cases for wrong group, wrong special type, inactive, non-leaf, currency/ID mismatch and non-success envelope. This is contract-shaped test data, not a tenant read-back or accounting proof.

### Remaining Cloud API write/read-back proof ledger

On 26/09/2026 the owner supplied the official [N3 Open API Swagger](https://openapi.account.qne.cloud/doc/index.html) and [N3 Reporting Open API Swagger](https://openapi-reporting.account.qne.cloud/doc/index.html). Their public definition links expose the full [Sales & AR OpenAPI JSON](https://openapi.account.qne.cloud/doc/sales-v1.json), [GL & Banking OpenAPI JSON](https://openapi.account.qne.cloud/doc/gl-v1.json), and Reporting `reports-v1.json` from the reporting Swagger page. These are accessible without asking the owner for an export. Static published API contract inspection is now **done**. The separate `api.qne.cloud` Optimum API (Build 2019) is not this N3 Cloud contract. No authenticated tenant Cloud API POST or tenant read-back was performed in this inspection; static examples do not establish tenant-specific posting, retry, or accounting outcomes.

Published contract details relevant to HotelHub:

| N3 endpoint | Documented request/read-back behavior | Implementation consequence |
|---|---|---|
| `POST /api/CashSales/Create` | `CashSaleDto` contains `isPostToAR`, item details, customer/currency, and total/tax/outstanding fields. Success example has `code: "0000"`, `data.id` and `data.docCode`. `GET /api/CashSales/{key}` and `GET /api/CashSales/GLPosting?key={id}` exist. | Use immutable ID for document and balanced journal read-back; verify actual tax/AR amount. |
| `POST /api/ARReceipts/Create` | `ARReceiptDto` schema marks `currencyId`, `customerId`, `docType` required, although the published create example omits `docType`; confirm the tenant's accepted value. Example sends `accountId`, `totalAmount` and optional `knockoff[]`; description expressly says **omit `details`** because posting lines are generated from total and knockoff. The model also exposes `isMultiPayment`, `multiPayments[]` (`ReceiptMultiPaymentDto` with `accountId`, `amount`, and optional description/reference/bank-charge fields). Allocations cannot exceed total; refund (`RF`) lines are rejected here. Success example returns `data.id`, `data.docCode` and `data.knockoff`. | Local `buildDepositPayload` now sends numeric customer/currency IDs and top-level `totalAmount`, omits `details`, with empty `knockoff[]`. The staged correction uses the operator-selected `accountId` for a single line, or `isMultiPayment` and `multiPayments[]` for a split receipt. The separate split-write gate is off. Tenant acceptance, read-back and journal balance remain unproven; the guarded writer is **not accepted for live posting**. |
| `POST /api/ARReceipts/UpdateCustomerKnockoff` | Flat `ARKnockoffItemDto[]`, grouped by `receiptDocId`; only `receiptDocType: "OR"` processed. Each saved match identifies target `docType` (invoice/debit note), immutable `docId`, and positive `paymentAmount`; success example returns `code: "0000", data: 1`. | Cloud UI showed Cash Sale as `INV` in the receipt grid, but exact tenant clear/reapply and repeated-call behavior still need proof. Do not assume an empty array clears previous matches. |
| `POST /api/CustomerRefunds/Create` | Example sends `accountId`, `totalAmount`, and `knockoff[]` referring to original `OR` by immutable `docId` and `paymentAmount`; description expressly says omit `details`. Response example has refund ID/docCode. `GET /api/CustomerRefunds/{key}` and `/GLPosting?key={id}` exist. | Refund remaining unapplied receipt only up to verified available amount; read back Dr customer AR / Cr actual payment bank/cash. |
| `GET /api/AccountCodes/{id}` and `GET /api/AccountCodes/Leaf/Query` | `AccountCodeDto` includes `specialCode`, `accountType.typeCode`, `parentId`, `hasChildren`, `isActive`, and immutable `id`; leaf query is paged with rows in `data.value`. `GET /api/ChartOfAccounts/Tree` also exists. | The local selector filters leaf rows and the writer independently validates every operator-selected account through detail GET; tenant runtime response shape remains to be proven. The read-only `SpecialType` classifier is separate. |

Every JSON response needs business-envelope checking (`code: "0000"` and coherent `data`), not HTTP status alone. The local correction applies this to `/New`, account detail, receipt list and receipt Create; a contradictory Create 2xx remains **unknown** for GET-only reconciliation rather than being treated as posted or safely retryable. GET detail and GL Posting are the published document and journal verification routes; this build did not add a posting-journal read-back gate. The reporting host is separate, uses the same PAT/My Apps JWT, and offers `POST /api/ReportTasks/Export` for direct PDF (`format: "pdf", mode: 0`, inline `task.reportType` plus filter); binary response is saved as the PDF. `mode: 1` is a URL/email paid-subscription path. Reporting also exposes receipt/invoice matching, collection, customer ledger, and GL inquiries; report export is available without a manual Cloud UI export request. These reporting POSTs are read/export operations, not financial document mutations.

| Mutation | Required exact proof before HotelHub writes | Read-back and journal gate |
|---|---|---|
| Post-to-AR Cash Sale | Immutable customer, stock/service line, UOM, tax code/rate, quantity/price, `isPostToAR`, server reference, document date, currency and response identity. | Detail by immutable ID: actual MYR324.03 gross, MYR24.00 tax, AR flag and initial outstanding; journal Dr AR = Cr sales + tax. |
| Deposit/balance AR receipt | Server-selected customer/currency and verified Current Assets Bank/Cash account ID in header; `totalAmount`, optional `knockoff[]`, stable reference; omit `details`. Confirm tenant acceptance of unapplied empty `knockoff[]`. | Immutable ID, account ID, MYR amount, available amount and journal Dr selected bank/cash / Cr AR. |
| Partial match, clear, reapply | Exact target Cash Sale immutable ID (`INV` relationship), receipt ID, line identity, allocation amount, update/clear request shape, repeated-call and concurrency behavior. | Both document details agree on allocation and available/outstanding balances; verify whether N3 emits any journal on allocation or reversal, with no duplicated receipt/sale posting. |
| Customer refund | Exact original OR immutable ID and available unmatched amount, actual eligible Payment By account, cumulative cap, response identity and stable reference. | Refund detail points to original OR, reduces refundable remainder once, journal Dr AR / Cr selected bank/cash. |

For every stage, reconcile unknown outcomes by GET before retry. Verify duplicate-reference policy and safe void/cleanup separately. Complete HotelHub checkout only after all immutable document relationships, account journals and zero N3 charge outstanding agree. The latest owner screenshots end with MYR114.02 outstanding after OR002, so they cannot pass that final gate.

**Proof rule:** Reuse these historical examples for the accounting relationship and the now available official N3 Cloud OpenAPI for field-level design. The receipt builder, selected account eligibility gate, aliases, and split intent are staged only in local source. Before enabling HotelHub writes, establish tenant-specific write/read-back, double-entry, and safe retry evidence for each missing step. Label owner-reported provenance, historical export behavior, published API contract, local build, Cloud GET evidence, Cloud POST evidence and HotelHub live acceptance separately. Never promote one category into another merely because IDs or document numbers look alike.

## 2. Approved target flow

1. Deposit → N3 AR Receive Payment.
2. Checkout bill → N3 Cash Sales/CashMemo with Post to AR.
3. Match eligible prior deposit receipt(s) to the checkout AR item.
4. If outstanding remains, create one stable balance Receive Payment and match it.
5. Re-read charge, receipts, allocations and outstanding.
6. Only when N3 confirms zero outstanding with no contradiction, complete HotelHub checkout and release the room.
7. Refund eligible excess through the proven N3 Customer Refund/AR Refund contract.

This is approved intent, not proof that all writes exist.

## 3. Proven deposit safety pattern

Every current/future financial mutation must preserve these controls:

1. Create a stable tenant-scoped local intent before calling N3.
2. Claim the intent atomically so double-click and concurrent workers cannot both POST.
3. Derive tenant, actor, customer, account, currency, dates, document type, reference and authoritative values on the server.
4. Use immutable N3 IDs as authority; names/codes are display/search aids.
5. Use deterministic reference/correlation only where the N3 contract supports it.
6. GET-preflight exact immutable/reference evidence when safe.
7. Treat a compatible existing document as reconciliation, not a duplicate-create opportunity.
8. Accept success only when required immutable identity and non-contradictory fields are proven.
9. Preserve `unknown` for timeout, transport loss, 5xx, malformed 2xx, missing identity or contradictory evidence.
10. Never blindly POST again after an unknown side effect.
11. Reconcile with read/GET operations and audit every transition.

## 4. Proven AR Receipt paths in current lineage

Default N3 base URL: `https://openapi.account.qne.cloud`

| Purpose | Method | Path |
|---|---:|---|
| AR receipt defaults | GET | `/api/ARReceipts/New` |
| Exact-reference preflight/reconcile | GET | `/api/ARReceipts/List?...referenceNo eq 'HH-…'` |
| Receipt detail | GET | `/api/ARReceipts/{id}` |
| Create reservation deposit | POST | `/api/ARReceipts/Create` |

These paths prove only the accepted HotelHub AR Receipt behavior. They do not prove CashMemo create, allocation or Refund create.

## 5. Required local evidence

Financial records must retain safe tenant-scoped evidence including:

- local intent/deposit UUID;
- tenant and source reservation;
- immutable source line/snapshot identifiers;
- amount and currency snapshot;
- stable request/idempotency key;
- deterministic HotelHub reference;
- state such as `submitting / posted / failed / unknown / reconciled`;
- immutable N3 document ID;
- N3 human document code/number;
- N3 customer/account/currency snapshots;
- actual actor;
- sanitized error/outcome code;
- timestamps and reconciliation evidence.

The local mapping proves HotelHub ownership/intent. Current N3 detail proves accounting truth. Both are required.

## 6. Outcome taxonomy

| Outcome | Meaning | Required action |
|---|---|---|
| Deterministic failure | N3 clearly rejected and no side effect is plausible | Mark failed with actionable safe error |
| Authentication expiry | 401 or proven invalid session | Preserve uncertain intent, revoke session, relaunch, reconcile |
| Refusal | 403 | Deny; do not reinterpret as normal user or retry |
| Unknown side effect | Timeout, connection loss, 5xx, malformed/contradictory success | Mark unknown, stop mutation, GET reconcile |
| Proven success | Immutable identity and expected fields agree | Store mapping and verify downstream state |

## 7. Folio is not settlement

The folio is a prepared guest statement. It does not prove:

- an N3 charge exists;
- a receipt is allocated;
- a refund exists;
- N3 outstanding is zero;
- the reservation may be checked out.

Normal printing intentionally uses prepared HotelHub folio data and makes no automatic N3 deposit-verification request. This removed the observed 90–120 second blocking path; Product Owner UAT measured 11 seconds. `Load verified deposit balance` is optional, read-only and may wait for N3.

## 8. Tax and mapping truth

- Canonical applied migration `20260916120000_hh_golive_01c_posting_mappings_parity` records `hotel_financial_settings.posting_mappings` as nullable `jsonb` with no default.
- The migration ledger, live schema, generated TypeScript Row/Insert/Update shapes and server access were verified in parity at SHA `75ceac11089936778b672c438d3a103b4715609a`.
- Existing mapping values were not rewritten; pre/post data fingerprint remained `877463277c124111f1f3a5503a108f94`.
- A posting-mapping setting is preparation for future posting only. Editing it never rewrites an existing folio-line snapshot and does not itself authorize an N3 write.
- The selected N3 tax-code rate is authoritative.
- N3 decimal fractions normalize consistently: `0.08 → 8%`, `0.10 → 10%`.
- Internally, `800bp = 8%` and `1,000bp = 10%`.
- Missing, invalid or ambiguous rates block readiness; never guess.
- Browser sends immutable mapping IDs, not entire mutable upstream objects.
- Server re-reads/canonicalizes the mapping and returns the saved authoritative settings.
- A successful settings response immediately replaces the browser settings/readiness cache.
- Fixed levies, service charge, discounts and adjustments remain distinct concepts; do not label them all as tax.

## 9. Allocation rules to prove

Before implementing knock-off, prove:

- exact endpoint, method and payload;
- allocation identity/evidence;
- charge outstanding and receipt available amount;
- partial allocation;
- multiple receipts to one charge;
- one receipt to several charges, if allowed;
- concurrency and repeat-call behavior;
- cancellation, deallocation and reversal;
- rounding and currency behavior;
- exact detail/read-back evidence.

Required future invariants:

```text
sum(valid allocations to charge) <= charge amount
sum(valid allocations from receipt) <= N3-confirmed available amount
Paid requires N3 outstanding = 0 and no unresolved mismatch
```

Excess deposit is valid unapplied money requiring a decision; it is not permission to over-allocate.

## 10. Refund rules to prove

Before implementing Customer Refund, prove:

- create/new/detail contract and document type;
- customer/currency/account requirements;
- relationship to original receipt/charge;
- whether allocation must be undone first;
- partial/full and cumulative refundability;
- cancellation/reversal behavior;
- exact-reference recovery;
- approval roles;
- double-refund prevention and audit.

## 11. Partial-failure posture

| Failure | Safe posture |
|---|---|
| Charge create timeout | Unknown; reconcile before retry |
| Charge exists, local save failed | Recover mapping; do not recreate |
| Receipt create timeout | Unknown; reconcile |
| Receipt exists, allocation failed | Preserve receipt; do not recreate |
| Some allocations succeeded | Reconcile each; do not restart blindly |
| Refund create uncertain | Reconcile by stable evidence; no duplicate |
| Local says Paid, N3 disagrees | Financial exception; block checkout |
| N3 says Paid, local mapping stale | Verify/repair local mapping; do not collect again |

## 12. Capability status

| Capability | Classification |
|---|---|
| Deposit AR Receive Payment | Local contract correction built / gated; tenant API POST and journal unproven |
| Deposit GET reconciliation | Implemented |
| Historical OR ↔ Cash Sales / unapplied OR / refund linkage examples | Verified in supplied Desktop/CSV examples; MUGS Perfect Software tenant attribution owner-reported; original full exports absent from active pack |
| N3 Cloud AR Receipt, Cash Sales and Customer Refund resource reads | Read-only observed; no mutation authority |
| N3 Cloud UI Cash Sale Post to AR, partial receipt knock-off, refund of unmatched receipt remainder, later multi-payment OR | Owner screenshots dated 26–27/09/2026 in MUGS AI LAB TEST tenant; MYR324.03 charge, OR001 MYR60.01 allocation, MYR40.00 refund, OR002 MYR150.00 split bank receipt and allocation; all four document journals shown balanced; latest charge outstanding MYR114.02 |
| Folio tax calculation/display | Implemented / live corrected |
| Guest folio print | Implemented / fast-path accepted |
| Posting-mappings schema/type parity | Accepted at SHA `75ceac11089936778b672c438d3a103b4715609a` |
| Verified deposit balance | Optional read-only operation |
| CashMemo/Post-to-AR create | Required / not accepted |
| Allocation/knock-off | Published request contract available; tenant clear/reapply unproven |
| Balance receipt and matching | Required / not accepted |
| Refund create | Published request contract available; tenant POST unproven |
| Final settlement | Required / incomplete |

## 13. Current single next action

Next: prepare the exact selected single and split receipt API proof steps for the Owner in the designated N3 sandbox; the Owner performs all N3 login, API calls and journal read-back, then Codex reviews the returned evidence against the published `495b90d` code. Keep split posting disabled until that proof, then release matching code and migration together through the separate release process. Prior Cloud UI matching and refund tests need no repetition.
