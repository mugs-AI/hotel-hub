# HotelHub — sequential N3 checkout and QA acceptance matrix

Date: 15/10/2026, Asia/Kuala_Lumpur. QA revision 2 after reviewing all 14 documents.
Upload to Project Sources: **Yes** — use this active QA file in the THREE-file billing pack with `HH_BILLING_CURRENT_CHECKPOINT.md` and `HH_BILLING_HISTORY_ARCHIVE.md`. The 12 older billing notes are preserved inside the history archive; do not retain them as competing current instructions after the complete pack is installed. Keep all unrelated/permanent sources.

## Approved workflow

The Owner approved option 2 on 15/10/2026: **Post to N3 → Match Deposit → Receive Payment**. Front Desk performs all ordinary actions in HH with their own N3 rights. Existing accounting deposits remain existing N3 ORs; never recreate them. Security cash remains separate.

Example: post a RM1,000 CashMemo with Post to AR, verify its immutable ID/detail/GL; match this booking's existing RM50 receipt; verify RM950 outstanding; collect the actual RM950 into the selected account(s), verify the new OR, then match that OR to the same bill. Only exact verified settlement can permit the later room-release workflow.

Receive Payment remains unavailable while eligible deposits need matching. No linked deposit skips step 2. A deposit that fully settles the bill requires no balance receipt. Excess, refund, unexplained external allocations and unknown outcomes require explicit review; they are not zero-balance shortcuts.

One explicit Receive Payment click can issue two sequential bounded HH requests: receipt creation/readback, then matching. The second request requires the server's current `apply_balance` action, the same bill/intent/tenant/currency, the newly saved exact-amount receipt, an advanced revision and the original current session/booking. Each server request retains its existing authorization, current N3 reads, contract gate and durable dispatch claim. This is not an N3 atomic transaction. There is no continuation from page load, polling, Refresh or an uncertain result.

If receipt creation succeeds but matching fails, HH retains the receipt and directs **Check N3 result**. Recovery never repeats collection. An explicit saved-receipt application action remains for interrupted flows; it creates no receipt. Complete Checkout remains a separate action after financial proof.

## Source and live boundaries

Starting checkpoint: `29cbc1b928ed360f2340151a9354f183fa4dce6c`, branch `review/hh-reconstruction-20261011`.
Initial sequence source commit: `6d4f80fe688ffdd11ec43f7502ec47d954c70ff7`. Resolve the final checkpoint for any later review fixes.

Lovable inspection recorded during the preceding implementation (not repeated in this document review): existing HotelHub project ready/agent finished at `e8341907a470d0d1e3a39a22413249becf73cd57`; existing Lovable-managed database enabled. SELECT-only catalog inspection found **zero** installed `hotelhub_settlement_*` / `hh_source_billing_*` functions. No separate Supabase account is required. Source code and tests do not install that backend or publish the UI.

N3 bill/receipt/allocation and split-payment gates remain closed in production source. No financial operation, operational database change, runtime activation, shared push, merge, deployment, publication or Lovable AI Build is performed by this source package. The specifically requested 38+4 master captures are complete and must not be repeated just to satisfy obsolete instructions. Necessary future current reads during posting are separate runtime validation.

Remaining release-critical work includes actual folio/deposit/payer adapter mounting, source/guest leg UI integration, accepted bill/receipt/matching/GL semantics, installed schema/grants/runtime, durable external-matching integration and signed-in acceptance. This matrix does not certify those unfinished lanes.

## How to use the matrix

Sections A–L retain the original **120 workflow cases**, with their IDs unchanged. Section M adds **20 document, evidence and recovery cases** identified by this 14-file QA review: **140 named cases in total**. These are a comprehensive working checklist, not a claim that no further edge case can ever emerge. They are **not 140 passed tests or a live-acceptance certificate**. Each row states the required result and the lane needed to establish it. Related source regressions can pass while N3/runtime or installation acceptance remains pending.

Lanes: **Source** = isolated automated logic/coordinator tests; **UI** = mounted component plus signed-in desktop/mobile acceptance; **N3** = designated Owner-operated API proof and independent readback; **DB** = disposable native concurrency plus installed-schema/grants verification; **Integration** = all affected layers/readers. Do not treat a synthetic response as vendor proof.

## A. Identity, permission and tenant boundaries

| ID | Edge case | Required result | Lane | Priority | Full-case acceptance |
|---|---|---|---|---|---|
| A01 | Owner has HH access and N3 create/update rights | Ordinary posting/payment/matching uses that Owner's session. | N3/UI | P0 | NOT CERTIFIED |
| A02 | Front Desk has HH access and N3 create/update rights | Same ordinary flow using staff's own token; no Owner delegation. | N3/UI | P0 | NOT CERTIFIED |
| A03 | Housekeeper opens action route directly | Deny before claiming or sending any financial request. | Source/DB | P0 | NOT CERTIFIED |
| A04 | Allowed HH staff lacks N3 bill-create rights | Show the denial; do not move to deposit matching. | N3 | P0 | NOT CERTIFIED |
| A05 | Staff can create OR but cannot update matching | Retain created OR; block matching/recollection and show recovery. | N3/UI | P0 | NOT CERTIFIED |
| A06 | Expired/revoked N3 session before a step | Deny, clear stale financial authority and require relaunch. | Source/N3 | P0 | NOT CERTIFIED |
| A07 | N3 returns 401 after a write may have happened | Preserve uncertainty, stop further writes and end the session. | N3 | P0 | NOT CERTIFIED |
| A08 | Tenant A requests tenant B booking/intent | Deny without disclosing documents, amounts or existence. | Source/DB | P0 | NOT CERTIFIED |
| A09 | Role/allowlist removed during a pending operation | Subsequent action revalidates authority; never reuse earlier permission. | Integration | P0 | NOT CERTIFIED |
| A10 | Browser supplies tenant, actor, token or Owner role fields | Reject unsupported authority fields; use server session only. | Source | P0 | NOT CERTIFIED |

## B. Folio, payer and freeze consistency

| ID | Edge case | Required result | Lane | Priority | Full-case acceptance |
|---|---|---|---|---|---|
| B01 | Rate/extra changes after preview | Require a fresh folio review; do not post stale amounts. | Source/Integration | P0 | NOT CERTIFIED |
| B02 | Another device changes the frozen folio | Reject digest/revision mismatch; preserve already posted documents. | Source/DB | P0 | NOT CERTIFIED |
| B03 | Wrong or inactive customer/stock/UOM/tax/account | Stop before dispatch with an actionable mapping failure. | Source/N3 | P0 | NOT CERTIFIED |
| B04 | Stock and standalone UOM disagree | Refuse the line; never substitute a different unit. | Source | P0 | NOT CERTIFIED |
| B05 | Scalar and nested income/control/tax account disagree | Refuse; do not select whichever copy is convenient. | Source | P0 | NOT CERTIFIED |
| B06 | Tax rate or per-line cents differ from current mapping | Refuse silent repricing; preserve reviewed commercial totals. | Source/N3 | P0 | NOT CERTIFIED |
| B07 | Discounts, rounding, service charges or levies present | Preserve each mapped component and exact-cent bill total. | Source/N3 | P0 | NOT CERTIFIED |
| B08 | Exact reversal pair plus unrelated equal-valued line | Suppress only the reversal pair; retain the unrelated charge. | Source/UI | P0 | NOT CERTIFIED |
| B09 | Zero/negative/unsupported folio total | Use an explicitly supported path or review; never fabricate a positive receipt. | Source/N3 | P0 | NOT CERTIFIED |
| B10 | Bill-to/payer changes after freeze | Require the permitted correction flow; never rewrite a posted debtor silently. | Integration | P0 | NOT CERTIFIED |

## C. Bill posting and acknowledgement

| ID | Edge case | Required result | Lane | Priority | Full-case acceptance |
|---|---|---|---|---|---|
| C01 | Normal RM1,000 guest folio | One N3 bill with exact customer/currency/items/tax/AR posting. | N3 | P0 | NOT CERTIFIED |
| C02 | HTTP 200 with business-error envelope | Treat as rejection/uncertainty as specified; never assume success. | Source/N3 | P0 | NOT CERTIFIED |
| C03 | Success reply lacks document ID | Retain attempt; use accepted exact-reference recovery or review. | Source/N3 | P0 | NOT CERTIFIED |
| C04 | Timeout after N3 saved the bill | No second Create; GET-only recovery of that bill. | N3 | P0 | NOT CERTIFIED |
| C05 | Double click/reload while bill is dispatching | Durable claim permits at most one bill dispatch. | Source/DB/UI | P0 | NOT CERTIFIED |
| C06 | Document detail correct but GL missing/unproven | Do not mark the bill verified or unlock matching. | N3 | P0 | NOT CERTIFIED |
| C07 | GL debits/credits or revenue/tax accounts disagree | Stop with contradiction; no payment can cover an incorrect bill. | Source/N3 | P0 | NOT CERTIFIED |
| C08 | CashMemo appears as INV in receipt matching | Prove exact immutable target relationship; a code/label alone is insufficient. | N3 | P0 | NOT CERTIFIED |
| C09 | N3 uses a non-RFC document GUID | Accept valid N3 GUID shape without weakening local UUID rules. | Source/N3 | P0 | NOT CERTIFIED |
| C10 | Database outcome/proof save fails after N3 write | Preserve the dispatch fence; reconcile without creating another bill. | Source/DB | P0 | NOT CERTIFIED |

## D. Deposit ownership and eligibility

| ID | Edge case | Required result | Lane | Priority | Full-case acceptance |
|---|---|---|---|---|---|
| D01 | No linked deposit | Skip Match Deposit; collect the full verified guest outstanding. | Source/UI/N3 | P0 | NOT CERTIFIED |
| D02 | RM50 deposit against RM1,000 bill | Apply existing OR; verify RM950 outstanding; create no new deposit OR. | N3 | P0 | NOT CERTIFIED |
| D03 | Several deposits on different dates/accounts | Process deterministically with separate durable claims; verify the aggregate. | Source/N3 | P0 | NOT CERTIFIED |
| D04 | Deposit exactly equals bill | Match and verify zero; no Receive Payment OR. | N3/UI | P0 | NOT CERTIFIED |
| D05 | Deposits exceed the bill | Never over-allocate; show retained surplus/refund review; no automatic refund. | Source/N3/UI | P0 | NOT CERTIFIED |
| D06 | Same walk-in customer used by another booking | Foreign booking receipt is ineligible despite matching customer ID. | Source/DB | P0 | NOT CERTIFIED |
| D07 | Same receipt linked twice or GUID case differs | Deduplicate/reject corrupt links; never spend twice. | Source/DB | P0 | NOT CERTIFIED |
| D08 | Cancelled, refunded or externally changed deposit | Re-read and refuse stale/unsupported available amounts. | N3 | P0 | NOT CERTIFIED |
| D09 | Deposit customer/currency differs from bill | Refuse cross-customer/currency allocation. | Source/N3 | P0 | NOT CERTIFIED |
| D10 | Security cash retained locally | Exclude it from N3 accounting-deposit allocation and collection totals. | Integration | P0 | NOT CERTIFIED |

## E. Match Deposit behaviour and API semantics

| ID | Edge case | Required result | Lane | Priority | Full-case acceptance |
|---|---|---|---|---|---|
| E01 | Click Receive Payment before matching | UI disabled; direct server request also denied before any claim/write. | Source/UI | P0 | NOT CERTIFIED |
| E02 | Refresh or reopen the page at deposit step | GET-only status; no automatic allocation. | Source/UI | P0 | NOT CERTIFIED |
| E03 | Receipt has unrelated earlier allocations | Preserve every unrelated row using proven vendor semantics. | N3 | P0 | NOT CERTIFIED |
| E04 | Allocation endpoint replaces rather than appends | Submit the correct supported complete state; never erase prior matches. | N3 | P0 | NOT CERTIFIED |
| E05 | Endpoint appends rather than replaces | Do not duplicate existing matches; use a separately verified payload strategy. | N3 | P0 | NOT CERTIFIED |
| E06 | Same allocation submitted repeatedly | Establish exact repeat semantics; HH never retries an uncertain POST blindly. | N3 | P0 | NOT CERTIFIED |
| E07 | Another N3 user changes the same receipt | Establish a supported server-side stale/conflict rule; HH locking alone is insufficient. | N3 | P0 | NOT CERTIFIED |
| E08 | First of several deposits matched, second times out | Retain first success and second uncertainty; no balance collection yet. | N3/UI | P0 | NOT CERTIFIED |
| E09 | Prior withholding/refund/special matching fields exist | Preserve proven semantics or refuse for review; do not discard fields. | Source/N3 | P0 | NOT CERTIFIED |
| E10 | Match success response but readback contradicts it | Keep the step unverified and collection disabled. | N3 | P0 | NOT CERTIFIED |

## F. Balance calculation and collection readiness

| ID | Edge case | Required result | Lane | Priority | Full-case acceptance |
|---|---|---|---|---|---|
| F01 | RM1,000 bill minus verified RM50 allocation | Show and require RM950, based on current N3 outstanding. | Source/N3 | P0 | NOT CERTIFIED |
| F02 | Deposit has been received but not allocated | Do not treat receipt creation alone as bill settlement. | Source/N3 | P0 | NOT CERTIFIED |
| F03 | Bill balance changed on another device | Refresh and reconfirm payment; refuse stale entered total. | Source/UI | P0 | NOT CERTIFIED |
| F04 | Allocation rows do not explain bill outstanding | Block with conservation mismatch; do not infer zero. | Source/N3 | P0 | NOT CERTIFIED |
| F05 | Bill reports zero without attributable matching | Do not permit final checkout solely from zero balance. | Source/N3 | P0 | NOT CERTIFIED |
| F06 | Outstanding is missing, negative, NaN or out of bounds | Unavailable/review, never zero fallback. | Source | P0 | NOT CERTIFIED |
| F07 | Receipt correction pending/unknown | Refuse stale effective deposit amounts and dependent settlement. | Integration | P0 | NOT CERTIFIED |
| F08 | Part-payment or overpayment at final collection | Refuse in the approved exact-balance first version; do not silently alter scope. | Source/UI | P0 | NOT CERTIFIED |
| F09 | Date changes at Malaysia midnight | Use actual receipt date/property timezone independently of bill date. | Source/N3 | P0 | NOT CERTIFIED |
| F10 | N3 read timeout during balance verification | Keep amount unverified; do not offer a fresh collection. | Integration | P0 | NOT CERTIFIED |

## G. Payment amounts, accounts and split entry

| ID | Edge case | Required result | Lane | Priority | Full-case acceptance |
|---|---|---|---|---|---|
| G01 | One actual bank/cash payment | Verify selected active eligible account and exact amount. | Source/N3 | P0 | NOT CERTIFIED |
| G02 | Blank/zero/negative amount | Refuse before dispatch. | Source/UI | P0 | NOT CERTIFIED |
| G03 | More than two decimals/exponent/hex/ambiguous format | Refuse; no rounding or coercion into a different payment. | Source/UI | P0 | NOT CERTIFIED |
| G04 | Sum differs by RM0.01 | Refuse and show exact required balance. | Source/UI | P0 | NOT CERTIFIED |
| G05 | Duplicate accounts or aliases for same immutable ID | Refuse duplicate lines, including case variants. | Source | P0 | NOT CERTIFIED |
| G06 | Inactive/non-leaf/wrong-currency/non-bank-cash account | Refuse; never use the N3 default as a fallback. | Source/N3 | P0 | NOT CERTIFIED |
| G07 | Alias renamed or account hidden after earlier deposit | Preserve historical identity; revalidate new selection eligibility. | Integration | P0 | NOT CERTIFIED |
| G08 | Split RM400 cash + RM550 bank | One OR with exact lines and balanced GL, only after split API proof. | N3 | P0 | NOT CERTIFIED |
| G09 | Split contract unverified or too many payment lines | Display restriction; no first-account fallback or extra ORs. | Source/UI | P0 | NOT CERTIFIED |
| G10 | Choices load slowly/fail or selected account disappears | Block submission and support scoped Refresh without losing the draft. | Source/UI | P0 | NOT CERTIFIED |

## H. Saved balance receipt followed by matching

| ID | Edge case | Required result | Lane | Priority | Full-case acceptance |
|---|---|---|---|---|---|
| H01 | Explicit Receive Payment succeeds | Verify new OR, then one apply_balance request with returned revision. | Source/UI/N3 | P0 | NOT CERTIFIED |
| H02 | Receipt result is unknown/blocked | No follow-on matching; retain saved attempt for reconciliation. | Source/UI | P0 | NOT CERTIFIED |
| H03 | New receipt has wrong amount, remainder or allocation | Stop; never match contradictory evidence. | Source | P0 | NOT CERTIFIED |
| H04 | Response omits/duplicates the newly saved receipt | Stop continuation; no guessed receipt identity. | Source | P0 | NOT CERTIFIED |
| H05 | Response refers to another tenant/booking/intent/bill | Refuse continuation; never apply another document. | Source | P0 | NOT CERTIFIED |
| H06 | Allocation gate remains closed after receipt saved | Keep saved receipt and matching pending; do not collect again. | Source/UI | P0 | NOT CERTIFIED |
| H07 | Matching request times out or returns malformed data | Mark payment saved/matching unresolved; GET-only check before any next write. | Source/N3 | P0 | NOT CERTIFIED |
| H08 | Matching returns a permission error or 401 | Preserve receipt; stop sequence; explain rights/relaunch without another OR. | Source/N3/UI | P0 | NOT CERTIFIED |
| H09 | Normal newly created OR can carry knockoff[] | Evaluate exact Create/readback/GL semantics separately; schema presence is not acceptance. | N3 | P0 | NOT CERTIFIED |
| H10 | Successful matching | Re-read same bill/OR/GL/allocations; require exact verified zero outstanding. | N3 | P0 | NOT CERTIFIED |

## I. Interruptions, retries and durable recovery

| ID | Edge case | Required result | Lane | Priority | Full-case acceptance |
|---|---|---|---|---|---|
| I01 | Internet lost before a write reaches N3 | Saved claim remains recoverable; classify outcome with evidence, not assumption. | Integration | P0 | NOT CERTIFIED |
| I02 | Response lost after N3 commits | Reconcile immutable ID/exact accepted reference; no blind financial retry. | N3 | P0 | NOT CERTIFIED |
| I03 | Exact-reference lookup yields zero or several candidates | Review; no guess and no automatic replacement document. | Source/N3 | P0 | NOT CERTIFIED |
| I04 | Crash between response and local outcome save | Dispatch fence survives; recover same document. | DB/N3 | P0 | NOT CERTIFIED |
| I05 | Crash between saved receipt and matching request | Reopen with existing receipt; explicit recovery/application, no collection. | Source/UI | P0 | NOT CERTIFIED |
| I06 | Tab closed/notebook sleeps during request | Server intent remains authoritative; reopen and inspect saved result. | Integration | P0 | NOT CERTIFIED |
| I07 | Browser Back/reload/remount | No mount-time receipt/allocation POST. | Source/UI | P0 | NOT CERTIFIED |
| I08 | Two clicks before React renders pending state | Synchronous guard and durable server claim prevent duplicate collection. | Source/DB/UI | P0 | NOT CERTIFIED |
| I09 | Lease expires while request outcome remains unknown | Never clear the financial fence merely because time elapsed. | DB/N3 | P0 | NOT CERTIFIED |
| I10 | Database proof save/local checkout fails after settlement | No additional bill, receipt or matching write to compensate blindly. | DB/Integration | P0 | NOT CERTIFIED |

## J. Navigation, identity changes and consistency windows

| ID | Edge case | Required result | Lane | Priority | Full-case acceptance |
|---|---|---|---|---|---|
| J01 | Switch booking while receipt request is pending | Do not continue matching in the new booking; retain original recovery state. | Source/UI | P0 | NOT CERTIFIED |
| J02 | Switch tenant while a response is pending | No follow-on write and no old money in new tenant's screen. | Source/UI | P0 | NOT CERTIFIED |
| J03 | Switch user within the same tenant | Do not continue the old user's payment sequence under the new session. | Source/UI | P0 | NOT CERTIFIED |
| J04 | Sign out/relaunch during either request | Clear active authority; inspect original saved attempt after authorized relaunch. | Integration | P0 | NOT CERTIFIED |
| J05 | Original view/input object changes during awaited response | Follow original copied scope/amount/intent, never mutable caller values. | Source | P0 | NOT CERTIFIED |
| J06 | Old response arrives after timeout/navigation | Do not change another booking's result or resume writes. | Source/UI | P0 | NOT CERTIFIED |
| J07 | Two HH devices use the same intent/revision | Atomic claim/revision checks allow one transition; loser refreshes. | DB | P0 | NOT CERTIFIED |
| J08 | N3 accountant externally unmatches a receipt | Current consistency checks invalidate settlement/checkout readiness. | Source/N3 | P0 | NOT CERTIFIED |
| J09 | Read fingerprints change during verification | Refuse a mixed-time proof; no stale zero-balance success. | Source/N3 | P0 | NOT CERTIFIED |
| J10 | Cached successful view followed by failed refresh | Hide stale financial authority and do not authorize collection from cache. | Source/UI | P0 | NOT CERTIFIED |

## K. Guest/source bill legs and partial success

| ID | Edge case | Required result | Lane | Priority | Full-case acceptance |
|---|---|---|---|---|---|
| K01 | Walk-in/property-collect booking | Guest bill uses verified guest debtor and its own AR control mapping. | Integration/N3 | P0 | NOT CERTIFIED |
| K02 | Source-prepaid room plus guest extras | Two distinct bill legs/customer debts; no combined debtor document. | Integration/N3 | P0 | NOT CERTIFIED |
| K03 | Guest leg posts, source leg times out | Preserve successful guest bill; recover only uncertain source leg. | Source/N3 | P0 | NOT CERTIFIED |
| K04 | Source leg posts, guest leg is rejected | Preserve source bill; do not repost it when resolving guest leg. | Source/N3 | P0 | NOT CERTIFIED |
| K05 | Guest deposit belongs to a different debtor than source room | Never apply it to the source's receivable. | Source/N3 | P0 | NOT CERTIFIED |
| K06 | Each bill leg has a different customer control account | Obtain each leg's own verified accounting graph. | Source/N3 | P0 | NOT CERTIFIED |
| K07 | Source receivable remains open at guest checkout | Allow only the explicitly approved source-credit/whole-stay rule and accountant case. | Integration | P0 | NOT CERTIFIED |
| K08 | Staff attempts source-leg Receive Payment | Deny unsupported source collection; ordinary guest payment remains separate. | Source | P0 | NOT CERTIFIED |
| K09 | OTA remittance less than gross sales | Preserve gross bill; no automatic commission, CN or write-off in HH. | Integration | P0 | NOT CERTIFIED |
| K10 | Guest copy hides source-paid prices | Preserve official N3 accounting amounts and correct guest extras/print projection. | UI/Integration | P0 | NOT CERTIFIED |

## L. Final checkout, readers and operational effects

| ID | Edge case | Required result | Lane | Priority | Full-case acceptance |
|---|---|---|---|---|---|
| L01 | Verified guest settlement but Close not clicked | Booking/rooms remain in their current operational state. | Source/DB | P0 | NOT CERTIFIED |
| L02 | Any unknown/remainder/refund/unsettled guest leg | Complete Checkout blocked; no room release. | Integration | P0 | NOT CERTIFIED |
| L03 | Whole-stay close spans several rooms | All releases and Dirty/DND handoff succeed atomically or none do. | DB | P0 | NOT CERTIFIED |
| L04 | Another stay now owns an affected allocation | Refuse stale close; never release another guest's room. | DB | P0 | NOT CERTIFIED |
| L05 | Close replay after a lost response | Return saved outcome; no further financial documents. | DB/Integration | P0 | NOT CERTIFIED |
| L06 | Reservation/folio/Departures/Prepare Checkout | Refresh consistent verified balances and document references. | Integration/UI | P0 | NOT CERTIFIED |
| L07 | Dashboard/Monthly Finance/export | Allocation is not new cash or revenue; use N3 receipt dates and complete evidence. | Integration | P0 | NOT CERTIFIED |
| L08 | Print/reprint/review | No financial POST; retain frozen charge/tax/payer facts and DD/MM/YYYY dates. | Source/UI | P0 | NOT CERTIFIED |
| L09 | Narrow/mobile screen, keyboard and disabled steps | Ordered actions, clear focus/status and readable recovery guidance. | UI | P1 | NOT CERTIFIED |
| L10 | Rollback/release/schema mismatch | Do not publish dependent UI before backend parity; Git rollback never reverses N3 money. | Integration | P0 | NOT CERTIFIED |

## Execution and evidence rules

**P0:** release-blocking financial/security/ownership/settlement/recovery integrity. **P1:** usability acceptance; still required before claiming that area accepted. A priority is not permission to expand scope or perform N3 writes.

Every A–L row is **NOT CERTIFIED** for its full required lanes. Related isolated regressions passed in the recorded source run, but that does not establish the whole case's DB/N3/deployed/UI outcome. No new app suite or financial test was run for this document review. Before changing a row to PASS record: case ID and variant, exact candidate, environment/tenant designation without secrets, role, preconditions, action, actual result, test command or proof-job ID, evidence location, timestamp and reviewer. A total test count alone cannot certify a case.

Recorded related source regression pointers (partial coverage only):

| Case IDs | Related existing source regression | Boundary still unproven |
|---|---|---|
| D01, E01 | `settlement-coordinator.test.ts`: no-linked-deposit skip; direct collection-before-matching refusal | Installed production wiring, actual N3 receipts and UI |
| H01, H02, H03, H04, H05, H06, H07 | `settlement-payment-sequence.test.ts`: receipt→match; blocked/contradictory receipts; scope, gate and failed matching | N3 vendor behaviour, live matching and durability |
| I07, I08, J01, J03 | `settlement-payment-mounted.test.ts`: no mount-time matching, double click, booking/user switch | Signed-in runtime/browser and real network interruption |
| J05 | `settlement-payment-sequence.test.ts`: original copied bill/intent before awaited response | Production source policy and credential lifecycle |
| F03, F08, G09 | Existing payment/coordinator tests: changed balance/confirmation and independently closed split gate | Accepted actual collection/multi-payment contract |

Do not interpret this pointer table as a full coverage map or invent PASS for unlisted cases. Retain the historical logs referenced in the archive separately; private raw exports are not contained in these Markdown files.

### Boundary variants recovered from the 14-file review

These are variants of existing A–L cases, not extra inflated pass counts:

- **B03/B05:** customer numeric 0 active; inactive/prospect/suspended, string/missing/unknown status rejected; scalar/nested account/currency/type conflicts refused; EXP is not universal income or collection account.
- **B04/B06:** only three standalone UOMs were independently captured; remaining nested-UOM replay is not a fresh live read. Tax rate 0.08 means 8%; no silent folio repricing.
- **B03/F10/J06:** current-master graph boundaries: 30-second operation deadline, shared 2 MB and 128 distinct reads, before/at/above limit and expired evidence during receipt proof. Do not confuse these with capture's 20-record/30-second/1 MB limits.
- **C03/I03:** exact reference recovery with missing/duplicate/ambiguous candidates, incomplete query evidence or unknown Create identity; no guessed lookup or blind second Create.
- **C06/C07:** an Approved status, temporary/computed journal or balanced rows without committed document identity do not by themselves establish authoritative posted GL.
- **E09/D08:** partial prior allocations, refund links, withheld tax, spent remainder, externally cleared/reapplied rows and cancellation metadata need disjoint conservation; never count a refund twice.
- **G10:** saved-ID helper's 200/201 active-room and 200/201 add-on read limits, absent exact count and truncated rows; fail rather than return partial mappings. These are helper read caps, not BEC room entitlement limits.
- **A07/J04/J06:** same user relaunches with a changed credential/session; late 401, abort or body completion must not mint new provenance, mutate returned reports or continue another identity's write.
- **K02/K07/L02:** source-only booking versus source-room/guest-extra split, source receivable carried forward under the approved rule, and no unsupported zero guest receipt.
- **L02/L03:** retained no-show source is separate: today/future/occupied/wrong tenant/stale revision denied; pending receipt corrections or active financial claims block it; release only eligible reserved rooms atomically, preserving deposits/security cash/housekeeping facts. Native/installed acceptance is still pending.

## M. Document, evidence and recovery edge cases

These review outcomes describe document validation only, never app acceptance.

| ID | Edge case | Required result | Priority | Review outcome |
|---|---|---|---|---|
| M01 | One of the 14 inputs omitted from review | Inventory and hash every input; report omission instead of claiming a complete audit. | P0 | CHECKED: all 14 read |
| M02 | Historical text omitted or altered while combining | Preserve all 14 originals exactly and verify length/hash round-trip. | P0 | CHECKED: exact byte preservation |
| M03 | Only the short summary is uploaded, then older files removed | Do not retire originals until current checkpoint, full archive and QA are all installed. | P0 | PENDING OWNER UPLOAD |
| M04 | Current checkpoint and archive give competing next actions | Current checkpoint governs status; all archived instructions are explicitly inactive. | P0 | ADDRESSED in proposed pack |
| M05 | Old capture-missing request reappears in search | Retain historical text but explicit supersession says requested 38+4 captures complete. | P0 | ADDRESSED in current checkpoint |
| M06 | Old helper “not published” heading overrides a later release | Preserve dated candidate and later release chronology separately. | P0 | ADDRESSED; no fresh release audit claimed |
| M07 | Synthetic tests mistaken for live N3/installed DB proof | Keep source, schema, runtime, financial and client acceptance separate. | P0 | ADDRESSED; live acceptance open |
| M08 | Test totals presented as per-case PASS | Require per-ID execution/evidence; preserve NOT CERTIFIED without it. | P0 | ADDRESSED; per-case execution remains open |
| M09 | An old public release approval is reused for a new payload | Preserve scope/candidate identity; seek only genuinely missing new-lane authority. | P0 | ADDRESSED; no new release authorised |
| M10 | A candidate migration is mistaken for installed SQL | Preserve exact historical filenames/dependencies/history evidence; inspect actual backend before apply. | P0 | CHECKED: full source text retained |
| M11 | Narrow helper and broad billing branch confused | Retain both source identities and exclusions; do not merge broad work as release-ready. | P0 | ADDRESSED in checkpoint/archive |
| M12 | A deferred minor or old lint debt disappears in summary | Carry every unresolved recorded limitation until verified resolution. | P1 | CHECKED: prior recorded limitations retained |
| M13 | Local repository/workspace later inaccessible | Provide a durable downloadable text archive; do not rely solely on a scratch path. | P0 | ADDRESSED by full archive deliverable |
| M14 | Archive assumed to include raw JSON/code/SQL/test logs | Explicitly identify those external artifacts as outside this text-only archive. | P0 | OPEN: external artifact availability not audited |
| M15 | A future correction overwrites the sole current copy | Keep stable filenames and file version history; snapshot reviewed originals in archive. | P0 | ADDRESSED by versioned replacements |
| M16 | Source removal accidentally includes requirements or independent QA | Remove only the named 12 after full-pack upload; retain all other sources and QA. | P0 | PENDING OWNER ACTION; nothing removed |
| M17 | Chat attachments are mistaken for actual installed Project Sources | Do not claim upload/removal completion without a verified inventory or Owner confirmation. | P0 | OPEN: Owner reports no changes |
| M18 | Duplicate same-name current files or conflicting versions | Keep one active current checkpoint and one active QA; replace, rather than append dated copies. | P1 | PENDING OWNER UPLOAD |
| M19 | Metadata/source cleanup triggers app/database/N3 operations | Documentation-only changes; no financial call, schema apply, AI Build or publication. | P0 | CHECKED: documentation-only package |
| M20 | “All edge cases” treated as a guarantee of exhaustive coverage | Maintain a growing risk-based checklist with variants and evidence; do not invent completeness. | P1 | ADDRESSED; 140 named cases, not exhaustive proof |

## Automated regression evidence and unresolved acceptance

This continuation adds 42 automated test cases across the new payment-sequence suite, mounted payment screen and coordinator regressions. The existing broader source tests remain in the full run; their coverage must not be presented as live N3 acceptance.

- `settlement-payment-sequence.test.ts`: original-scope snapshot; one receipt then one matching request with returned revision; no writes after leaving; changed identity/scope; closed gate; unknown receipt; missing/wrong/duplicate receipt evidence; matching failure; bypassed deposit order; changed payment total.
- `settlement-payment-mounted.test.ts`: visible three steps/disabled collection; Match Deposit unlocks the form; explicit one-click continuation; saved-payment failure guidance; no mount-time application; late booking/user responses; double-click guard; existing payment drafts, split gate, accounts and confirmation checks.
- `settlement-coordinator.test.ts`: direct bypass of deposit matching denied before another claim/write; no-deposit booking offers full-balance collection; existing immutable identity/recovery/conservation tests retained.

Fresh baseline: **3,177 passed / 22 skipped / 0 failed**.
Pre-review sequence source: **3,204 passed / 22 skipped / 0 failed**, 223 files passed / 3 skipped. TypeScript and changed-file ESLint exit 0; one pre-existing FastRefresh warning remains. Existing full-repository lint debt is not fixed or called green. Final build/review/checkpoint results are appended after completion.

Critical acceptance still pending: real HH CashMemo/Post-to-AR and committed GL; matching target identity; allocation preservation/replace/append/repetition/stale-conflict semantics; single/split receipt creation/readback; exact settlement and installed backend/runtime/signed-in UI. Previously completed N3 UI accounting exercises and successful master captures are retained and must not be repeated.

Prepared QNE clarification is not sent: whether UpdateCustomerKnockoff appends/replaces; supported stale/conflict mechanism and exact rejection; how approved committed document/GL and refund/spendable remainder are authoritatively established. The public DTO exposes no explicit revision field; this is not proof that QNE has no supported concurrency protection. No vendor message is authorized or sent here.

## Final verified checkpoint and review

Reviewed product source: **`a33a8b784582a0f16031690a272f6fb8e78a09a7`**.
Product tree: `91063c05eb82ef693174dbd25ecddb5e8bc63869`.
A following documentation-only commit records this report and the execution ledger. Resolve branch HEAD on resumption; preserve the existing worktree and unfinished plan.

Final full source run: **3,219 passed / 22 skipped / 0 failed**, 223 test files passed / 3 skipped. Explicit DOM and disposable PostgreSQL WASM lanes were enabled. Focused sequence/mounted/coordinator run: **87 passed**. TypeScript, five-file ESLint, production build and whitespace checks exit 0. The one pre-existing component FastRefresh warning and prior full-repository lint debt remain. Protected files, packages/lockfiles, SQL and deployment configuration are unchanged in this continuation.

Independent read-only review found **0 Critical / 2 Important / 1 Minor** in the initial sequence candidate. Both Important issues were reproduced before fixing: omission/change of earlier deposit rows; contradictory state/action responses that could continue matching or reoffer collection. The fix also checks the final bill/receipt amounts and advanced revision, and distinguishes verified saved receipt failure from an unverified payment outcome so UI never claims confirmed money from a contradictory DTO. Fifteen review-regression cases are RED→GREEN; all 87 focused cases and the full suite pass. No second review is claimed.

One pre-existing mounted navigation assertion failed during implementation because an unmounted component stopped retaining its original booking's recovery warning. The new current-session check now prevents further writes/foreign UI updates while retaining recovery only in the original same-session booking draft. All mounted regressions pass. The stricter final revision check also exposed a test fixture that did not advance revision after matching; corrected that fixture to model the existing durable server transition, without relaxing the production check. The intermediate failing full run is not counted as a pass; the final 3,219-pass run includes this correction.

**Deferred Minor:** the third-step descriptive text is generic for a valid saved balance receipt whose allocation gate remains closed (`balance_dispatched`, no allowed actions). It should identify saved-payment/checking status more explicitly. The current receipt remains listed, collection stays disabled, and no automatic remount matching occurs. The separate verified-receipt matching-failure alert is implemented and tested. This wording issue is retained rather than presented as complete UI acceptance.

Rulings made in this continuation:

1. Reuse the approved plan and server coordinator. An explicit payment interaction may make two sequential bounded HH requests only under current server authority and original-session continuity; it does not prove N3 atomicity. Cost if wrong: source UX could be mistaken for financial activation, so all original API proof gates stay closed.
2. Keep production adapters, source-leg mounting, installed/native schema/grants, real own-role N3 rights/accounting/GL/refund/concurrency semantics, browser/mobile/print/reader acceptance and complete room handoff pending. The review and source fixtures certify none of those live lanes. Cost if wrongly promoted: unproven accounting or room-release behaviour would be exposed.

No repeat of the already requested master captures is needed. Next engineering work remains actual production folio/deposit/payer mounting and assembling the complete additive backend/runtime release packet. Designated Owner-operated API acceptance must resolve existing-deposit allocation preservation/conflict handling and newly created balance-receipt matching. This report neither issues those transactions nor grants their activation/publication authority.
