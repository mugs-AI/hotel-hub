# HotelHub N3 financial posting and knock-off master record

Version: 07/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: **Yes** — replace the same logical source; keep one active copy.

Accounting authority: **N3**. Single active master. Historical proof below retains
its original scope; it does not prove current HotelHub API/full settlement.

## Current production and approved target

Guarded Owner deposit → N3 AR Receive Payment is implemented. Original BK260920001/
OR2610/001 RM 50 is recorded posted. Published correction flow approves a proposal,
then Owner changes N3 and HotelHub GET-verifies. Approval alone changes no money.
A cancellation flag/timestamp alone cannot prove journal cancellation.

Approved October target: deposit approval ON, contact approval OFF, independent
Settings. One Owner Dashboard click claims one correction, dispatches one bounded
N3 Update, strictly proves receipt/journal, publishes one effective version and
refreshes all readers. Owner approval OFF applies directly through the same pipeline.
Front Desk gains no N3 write role through a switch. Small-hotel boss uses Owner.
Local folio bill-to, selected receipt contact and N3 customer master are distinct;
no implicit master/all-receipts edit. Mixed change needs approval if any category ON.

Automatic review source incomplete/dormant; new SQL unapplied, production Update
contract null. Void/replacement/refund/unmatch retain separate OFF gates. Never
retroactively execute an old manual request.

Latest local07/10 evidence: RM 60 rejected; RM 65 legacy manual request needs_review,
original 5000/proposed6500, n3_result_mismatch. No fresh signed-in N3 receipt/journal
during refresh; external current amount/root mismatch cannot be inferred.
Published optional-null/nested/casing compatibility remains strict against conflicts.
Read repository Owner diagnostic/null-field/mismatch evidence; don't weaken proof.

## Approved final flow, still incomplete

Deposit → Cash Sales/CashMemo Post-to-AR → eligible receipt allocations →
one positive balance receipt/match → exact charge/receipt/GL/outstanding read-back →
consistent zero outstanding → fenced local checkout/allocation release/Dirty handoff.
Eligible excess refund needs its own proven Customer Refund contract.
Cash Sale/allocation/balance/refund/final close are not accepted complete HH verticals.
Prepare Checkout remains read-only.

## Durable money and account controls

Stable tenant intent before POST, atomic one-claim dispatch, server-derived current
actor/tenant/customer/account/currency/date/reference/value. Immutable IDs control
authority; code/name/aliases are display snapshots. Validate business success
envelope as well as HTTP. Timeout/transport loss/5xx/malformed or contradictory
success means unknown. Preserve IDs, GET-only reconcile, never blind financial
POST retry. After-write401 preserves uncertainty and ends session. Approval,
local status orHTTP success cannot replace receipt/journal proof.

Exact document/customer/reference/currency/date/amount/payment accounts and applied/
unapplied evidence plus balanced selected bank/cash debit/customer credit required.
N3 Update must prove safe stale-write/concurrency, not merely have updatedAt.
Original intent immutable; effective versions separate, audited actor/outcome/time.

Operator selects actual active leaf Current Assets Bank/Cash account. Server
verifies immutable ID, tenant/currency, BCA group and BAC/CAC special type. No
default routing guesses. AliasDUIT NOW/QR DuitNow/CashNote never renames N3/reroutes.
Show/Hide blocks new hidden selections, retains old snapshots/replay/reconciliation.
Single uses selected header account. Split positive distinct lines sum exactly to
receipt; verify every debit and single customer credit. Split API gate remains OFF
until its own HotelHub proof. Future balance receipts follow same account rules.

N3 tax code/rate authoritative:0.08=8%,0.10=10%. Missing/ambiguous blocks readiness.
Tax/levy/service charge/rounding/discount/adjustment distinct. Immutable folio
snapshots survive later settings. Codes are not immutable IDs.

## Folio and all readers

Prepared folio is not a posted N3 charge or settlement. Normal print opens new tab,
does not automatically start slow N3 verification; optional verified balance read-only.
Hide exact reversed original/negative pair on guest screen/print, retain audit and
unrelated equal amount lines. Discount final detail; disabled charges omitted.

Confirmed versions refresh Reservation ledger/summaries, Owner queue/Dashboard,
folio/print, Departures, Prepare Checkout and Monthly Finance/export once.
Monthly uses N3 receipt dates; >100 candidatesUnavailable, never partial total.
Owner/property/person scope; auth/period failure hides stale money.
Sales/Collections unavailable until authoritative final posted source; prepared
folio estimates/partial receipts cannot substitute.

## Contracts and remaining proof

| Operation | Public contract known | Required remaining proof |
| --- | --- | --- |
| ARReceipt Create/detail/GL | UUID, single/multi DTO, omitdetails | Tenant/runtime exactproof; split separate |
| ARReceipt Update | updatedAt int64, two confirmed override flags | Atomic stale rejection, exact after GL, bounded runtime |
| CashSales Create/detail/GL | isPostToAR, customer/currency/lines/tax | Tenant charge/journal/recovery |
| UpdateCustomerKnockoff | Flat OR allocation array | Exact INV relationship, partial/clear/reapply/race/repetition |
| Customer Refunds Create/detail/GL | Original OR linkage/payment account | Caps/remainder/double-refund/recovery |
| Final checkout | Local required contract | Settled mappings then fenced close/Dirty |

Public sales-v1.json fetched07/10, four operations unchanged versus03/10 despite
whole document hash change. Static API is not authenticated financial proof.
Owner performs N3 sign-in and bounded specifically approved jobs; Codex prepares/
reviews, never requests credentials or repeats completed Cloud UI tests.

## Historical Owner accounting evidence — retained

### Historical N3 matching evidence and provenance (reconciled 26/09/2026)

The Product Owner identifies **MUGS Perfect Software Sdn Bhd** as the N3 company in which the earlier financial workflow was tested. That company attribution is owner-reported here; the original tenant identifier and complete transaction exports are not preserved in this active source pack. Do not substitute the later **MUGS AI LAB TEST SDN. BHD.** sandbox for this historical company.

The previously supplied Desktop/CSV examples establish the following business relationships in their exported data:

| Historical example | Observed relationship | Evidence boundary |
|---|---|---|
| `OR-001-test` ↔ `CS-001-TEST` | AR receipt knock-off `docId` matched the Cash Sales immutable header ID; knock-off type `INV`. | Historical export/sample; not proof of a HotelHub Cloud API write. |
| `OR-002-test` | RM 288 remained unapplied. | Historical export/sample; not a current outstanding-balance query. |
| `RF-003-test` | Customer Refund linked to an original AR receipt by immutable ID. | Historical export/sample; not proof of the Cloud API refund-create payload. |

Earlier N3 Cloud read-only verification could retrieve AR Receipts, Cash Sales and Customer Refund resources. It did not establish a successful Cloud API POST/read-back for Cash Sale with Post to AR, partial allocation, clear/reallocation or refund. A HotelHub automated test uses the historical Cash Sales document number and ID shape as a fixture; passing that test does not establish the original test tenant, live payload or settlement result.

The first 01D attempt in the separate **MUGS AI LAB TEST SDN. BHD.** sandbox stopped at a Cash Sale stock-availability warning before a document was created. The item involved belonged to another project's test data; no stock adjustment or repeat of the historical MUGS Perfect Software business test is required by this record. The owner subsequently performed the Cloud UI exercise documented below.

### Owner-run N3 Cloud UI sandbox evidence, 26/09/2026

The six owner-supplied screenshots show the **MUGS AI LAB TEST SDN. BHD.** tenant `9AC-0D9-2F1`, customer `700-7001` / `777 - HOTEL WALK IN CASH`, and these saved documents. This is separate from historical **MUGS Perfect Software Sdn Bhd** evidence.

| Document / step | Visible evidence | Limit |
|---|---|---|
| Cash Sale `CS2609/001`, detail ID `67061318-d280-40d2-4b04-08df1bbcda65` | `Posted to AR` enabled; room item `777-ROOM-201`, quantity 1, price MYR 300.03, `SVT-8%` tax MYR 24.00, net MYR 324.03. Journal debits customer MYR 324.03 and credits sales MYR 300.03 and SST MYR 24.00. | Initial requested MYR 300.03 was a pre-tax price, not the charge total. |
| Receive Payment `OR2609/001`, detail ID `91efa246-6a37-4c5b-09c3-08df1bbcf6a7` | MYR 100.01 payment, `CASH IN HAND`; initial edit view showed MYR 100.01 unmatched and the Cash Sale as type `INV`. Saved view reports update success, MYR 60.01 applied to `CS2609/001`, Cash Sale outstanding MYR 264.02, receipt unmatched MYR 40.00. Owner's additional Account Journal screenshot supplied 27/09/2026 shows Dr `700-0400 CASH IN HAND` MYR 100.01 and Cr `700-7001 777 - HOTEL WALK IN CASH` MYR 100.01; total debits and credits each MYR 100.01. | Confirms partial matching and balanced receipt posting in Cloud UI; no separate current Cash Sale/receipt GET or API mutation payload is attached. |
| Customer Refund `RF2609/001`, detail ID `d6122a6c-bea6-4c75-5a90-08df1bc00ad4` | Saved MYR 40.00 refund by `CASH IN HAND`; `OR` knock-off row points to `OR2609/001`, payment MYR 40.00, refund unmatched MYR 0.00. Journal debits customer MYR 40.00 and credits cash MYR 40.00. | Shows UI refund from receipt remainder, not a settled Cash Sale or a proven API refund/create contract. |

Arithmetic of the visible state: MYR 300.03 + MYR 24.00 tax = MYR 324.03 charge; MYR 324.03 − MYR 60.01 applied = MYR 264.02 charge outstanding; MYR 100.01 − MYR 60.01 applied − MYR 40.00 refunded = MYR 0.00 receipt remainder, subject to current detail read-back. No screenshot shows clearing and reapplying the allocation, a balance receipt, zero charge outstanding, duplicate-reference behavior, or HotelHub checkout. Do not label this a complete settlement or claim that the original MYR 240.02 expectation passed.

### Additional owner-run N3 Cloud UI evidence, 27/09/2026

Five later screenshots from the same sandbox tenant show a second Receive Payment, `OR2609/002` (visible detail URL ID `b9693b99-80d4-4e4e-f427-08df1c477428`), for MYR 150.00. N3's Multi-Payment tab records MYR 70.00 to `700-0310 MAYBANK` and MYR 80.00 to `700-0320 PUBLIC BANK BERHAD`, with the single Deposit To field disabled. Its Account Journal debits Public Bank MYR 80.00 and Maybank MYR 70.00, and credits customer `700-7001` MYR 150.00; total debit equals credit MYR 150.00. A later saved view shows MYR 150.00 applied to `CS2609/001`, leaving that Cash Sale MYR 114.02 outstanding and this receipt with MYR 0.00 unmatched. Customer Account Inquiry independently displays the sequence CS +324.03, OR001 −100.01, RF +40.00, OR002 −150.00 = MYR 114.02 debit. The separate Cash in Hand inquiry shows OR001 +100.01 less RF −40.00 = MYR 60.01; the OR002 receipt belongs in the two bank accounts, not cash. These are owner-run Cloud UI and inquiry observations, not HotelHub/API POST proof. The earlier MYR 264.02 figure is the state **before** OR002 allocation, not the final visible state.

**Further owner screenshots, 27/09/2026:** The owner-designed N3 print previews put the AR Receipt's immutable UUID in the printed heading. The receipt detail URL carries the same UUID. This gives an N3 UI operator a way to obtain the receipt ID without backend database access. The reporting preview task URL/id is a report task, not the AR Receipt's immutable ID. The owner explicitly confirms `OR2609/002` knocked off `CS2609/001`; its print preview Payment Details also shows `INV CS2609/001` paid MYR 150.00. The OR002 print heading shows `b9693b99-80d4-4e4e-f427-08df1c477428`.

| Receipt | UUID in N3 detail URL / print heading | N3 UI accounting evidence | Allocation evidence |
|---|---|---|---|
| `OR2609/003` | `31332632-f07c-4d15-a0ba-08df1ca67797` | MYR 10.00 single payment to `700-0320 PUBLIC BANK BERHAD`; journal Dr Public Bank MYR 10.00, Cr `700-7001` customer MYR 10.00; balanced. | No knock-off row; unmatched MYR 10.00 in UI. |
| `OR2609/004` | `bcadfb7d-ce89-4234-a0c1-08df1ca67797` | MYR 15.00 multi-payment: `700-0310 MAYBANK` MYR 7.00 and `700-0320 PUBLIC BANK BERHAD` MYR 8.00. Journal Dr Maybank MYR 7.00, Dr Public Bank MYR 8.00, Cr customer MYR 15.00; balanced. | No allocation on this receipt; unmatched MYR 15.00. Its displayed `CS2609/001` row remains outstanding MYR 114.02. |

These are **completed N3 UI tests** for the account selection, split payment, printed ID and balanced double entries. Do not ask the owner to repeat them or provide a Create response JSON for documents created in the UI. They do not establish that HotelHub called `POST /api/ARReceipts/Create`, what that call returned, or that HotelHub read it back. No HotelHub receipt was posted in this evidence set. HotelHub must obtain `data.id` from its own successful Create response when it posts, then perform its own authenticated `GET /api/ARReceipts/{key}` and `GET /api/ARReceipts/GLPosting?key={UUID}` checks. The owner may hand over an N3 UI URL or custom print with the UUID for review; there is no need for database access. Resolve customer/account immutable IDs with the relevant tenant API lookups; account codes and labels shown in the UI are not UUIDs. Keep the split writer disabled until the separate HotelHub API Create/read-back proof is completed. The unapplied OR003/OR004 receipts do not themselves reduce the displayed CS001 outstanding MYR 114.02.

### Accounting and Deposit To rule accepted 26/09/2026

The owner requires HotelHub staff to **choose** the actual N3 Deposit To account on every Receive Payment (both reservation deposit and checkout balance collection), rather than silently using N3 `/New`'s default. Eligible choices are N3 Chart of Account codes under **Current Assets**, with **Special Account Type = Bank Account or Cash Account**. QNE's N3 Chart of Accounts guidance confirms these two Special Account Types under Current Assets: https://support.qne.com.my/support/solutions/articles/81000410437-how-to-setup-the-chart-of-account-in-cloud-accounting-system . A code/name alone is insufficient; resolve the immutable N3 account ID and verify group, special type, active/posting eligibility, currency and tenant on the server at preview and immediately before posting. The selected account must represent where the guest actually paid. Refund **Payment By** must likewise resolve an eligible actual disbursement bank/cash account; it need not be the same account unless that is the real disbursement. Do not map a sales, tax, AR control, generic deposit, or rounding account into Deposit To. If any required account attribute cannot be confirmed, block the write.

**Payment-method decision, 27/09/2026:** Settings lets an Owner assign tenant-scoped HotelHub display labels to eligible N3 account IDs, e.g. `700-0310 MAYBANK` shown as `QR DuitNow`, and an actual cash account shown as `CashNote`. This does not rename the N3 Chart of Accounts, change the account ID, or assume that all QR payments use one bank account. The owner's suggested `700-0410 CASH IN HAND` code is an example label mapping; the supplied sandbox journal actually uses `700-0400 CASH IN HAND`, so the live tenant account ID/code must be selected and verified. The collecting operator chooses the display label/account; preview shows N3 code/name and amounts, while the selection list shows both alias and N3 code/name. The current deposit write permission is Owner-only; Front Desk can view the ledger but cannot post until a separately approved role change. If a guest splits payment, HotelHub must support one N3 Receive Payment with multiple positive account/amount lines summing exactly to the receipt total (for example, MYR 70.00 Maybank + MYR 80.00 Public Bank = MYR 150.00), then verify each debit and the one customer AR credit. A single method uses the chosen `accountId` at the receipt header. In N3 multi-payment mode the Deposit To header is disabled; the published `ARReceiptDto` exposes `isMultiPayment` and `multiPayments[]`, and `ReceiptMultiPaymentDto` exposes `accountId` and `amount`. The tenant's precise Create acceptance/read-back for these fields still needs API proof. Store immutable account IDs and per-line amount snapshots in HotelHub's durable intent; aliases remain display-only and later renaming must not rewrite historical payment facts.

The screenshot journals give an exact accounting reconciliation for this scenario:

| Event | Debit | Credit | Evidence / expected check |
|---|---:|---:|---|
| `CS2609/001` Post to AR | Customer AR MYR 324.03 | Sales MYR 300.03; SST MYR 24.00 | Journal screenshot; debit = credit MYR 324.03. |
| `OR2609/001` receipt | `700-0400 CASH IN HAND` MYR 100.01 | `700-7001 777 - HOTEL WALK IN CASH` MYR 100.01 | Owner's 27/09/2026 Cloud UI Account Journal screenshot; debit = credit MYR 100.01. |
| MYR 60.01 receipt allocation | No second receipt or sale posting | No second receipt or sale posting | Validate actual N3 allocation journal/read-back and prevent duplication; screenshot proves resulting open amounts, not a journal entry. |
| `RF2609/001` refund | Customer AR MYR 40.00 | Cash in Hand MYR 40.00 | Journal screenshot; debit = credit MYR 40.00. |

Across the original three owner-supplied Cloud UI journal screenshots, aggregate customer AR was MYR 324.03 − MYR 100.01 + MYR 40.00 = **MYR 264.02 debit** before OR002. Net cash from OR001/RF001 was MYR 60.01. OR002 then knocked off MYR 150.00, and CS001 showed MYR 114.02 outstanding. The later OR003/OR004 bank receipts are unapplied. These UI results do not prove HotelHub API posting behavior.

The 26/09/2026 files-only correction resolved the N3 `/ARReceipts/New` default `accountId` via `GET /api/AccountCodes/{id}`. The 27/09/2026 stage lists eligible account choices from the tenant's leaf query, then re-verifies **each selected ID** with account detail before preview or create. It requires active leaf (`hasChildren: false`), same currency, `accountType.typeCode: BCA` (Current Assets), and `specialCode: BAC` (Bank Account) or `CAC` (Cash Account). QNE's [chart import guidance](https://support.qne.com.my/support/solutions/articles/81000413241-how-to-import-chart-of-account-by-excel-template) publishes these type/special codes. Missing, contradictory, or unavailable data blocks the create before the local intent claim. Preview displays verified account code/name and line amount. The unrelated read-only `evaluateGlAccount` classifier still uses legacy `SpecialType` fields and must not be treated as the write gate. Tenant leaf-query response shape still needs runtime proof before release.

The deposit fixture now models a synthetic BCA/BAC active leaf returned from account detail, with negative cases for wrong group, wrong special type, inactive, non-leaf, currency/ID mismatch and non-success envelope. This is contract-shaped test data, not a tenant read-back or accounting proof.


## Continuation and evidence

Read current receipt N3 contract/SQL validation, monthly source/release contract,
automatic spec/plan/execution ledger and dated baseline. Complete pre-refresh
master archived verbatim. Old local-only/initial-deposit/September current-head
statements are historical. Resume existing approved work; legacy RM 65 isn't a
proof fixture. No N3 transaction performed by this refresh.
