# HotelHub billing API proof jobs — 08/10/2026

Status: **jobs prepared; Owner-operated GET console evidence received;
financial operation contracts not accepted**. Repository implementation/test
approval does not authorize these N3 transaction lanes. All production billing
contract gates remain closed. No credentials or guest journals belong here.

Upload to Project Sources: **No** — repository execution evidence.

Latest continuation: 08/10/2026, following the22:05Malaysia resume instruction.
The6/6 journal capture and GUID compatibility correction are complete; neither
needs repetition. The result register below supersedes its earlier observations.

Authority: approved settlement specification and implementation plan, Tasks2,
5–7 and9–12. Historical Cloud UI billing/receipt examples remain historical;
do not repeat them or use the disputed BK260920001 / OR2610/001 receipt.

Public schema inspected: `https://openapi.account.qne.cloud/doc/sales-v1.json`;
earlier08/10/2026 snapshot SHA256
`d9375f8fac7af01fe5f6fc8828ab948f433151bf1d48a610df10c00077404143`.
The schema establishes request shapes, not current tenant response/GL,
CashSale-to-INV identity, completeness, or atomic concurrency behavior.

Current public documentation was re-read directly, without authentication or any
tenant API operation, from the scopes advertised by `/doc/index.json`:

| Official document | Current SHA256 |
| --- | --- |
| `/doc/sales-v1.json` | `75d19091a0667cf75353a5b9259a39d3572cbe1a82b5b7eec5d64e2bc3ed9a2c` |
| `/doc/gl-v1.json` | `64599720fd623e12895c4bf13eb071cade0ac9d0c548545f8b2d94b43927fa4b` |
| `/doc/stock-v1.json` | `5914d9d9948d50f24ad19a3dae1061c1e3a93b58619e0f7383fd01012e0b3cc6` |
| `/doc/platform-v1.json` | `d84df24e89fa26e2462d45628b18cc34cd6aaeb5f21ea4e808f83ce6790a68d1` |

The changed sales-document hash is a fresh snapshot, not proof of an API behavior
change or an accepted contract. Raw public schema copies remain execution scratch;
raw Owner exports are not committed.

## Target manifest required before execution

| Field | Current value / requirement |
| --- | --- |
| N3 environment and tenant | Owner designated test company **9AC-0D9-2F1 — MUGS AI LAB TEST SDN. BHD.**; matched by the uploaded Owner-console GET bundle. This identifies the test company, not permission for new financial transactions or proof of a disposable cleanup target. |
| Current actor | Owner session launched through N3; record only permitted user/tenant identity hashes. Never request or persist a token. |
| Reservation / intent | New explicitly designated synthetic stay and UUID intent; immutable receipt links must belong to this stay. |
| Customer / currency | Exact current integer IDs, MYR, rate1; record current active master/read evidence. No sample IDs from API documentation. |
| Stock / UOM / tax | Exact active integer IDs for every prepared charge kind; current account mappings and approved tax treatment, including derived charges. |
| Bank / cash account | Exact active leaf GUID account ID/code/currency; selected by Owner. |
| Existing deposit | One exact designated synthetic receipt GUID, amount/date/payment/header + bound GL + refund + all allocations captured before any write. |
| Bill / invoice target | Created bill GUID plus independently proven immutable INV relationship; same-ID INV is an unaccepted candidate, not an assumption. |
| Proposed limits | Synthetic bill MYR500.00, deposit MYR50.00, balance MYR450.00, with each exact amount and document date explicitly approved for the target. These are limits for proposed jobs, not permission to spend or post. |
| Date boundary | Separate approved deposit30/09/2026 and bill08/10/2026 scenarios only if that tenant permits these dates; otherwise record its permitted dates and test the boundary using sanitized fixtures. Never silently backdate. |
| Cleanup | Separately authorized lane after evidence capture; no automatic clear/unmatch/refund/void/delete. |

Freeze this manifest, payloads, prior-state hashes and per-lane authorization
before dispatch. Any changed target, amount, account or payload needs a new
manifest. Stop on uncertain outcomes; do not create a replacement reference.

## Lane G — signed-in GET diagnostics and master contracts

Read only, separately authorized and scoped to the manifest's exact IDs.
Current known fixed reads are:

* `GET /api/AccountCodes/{accountUUID}`
* `GET /api/CashSales/{billUUID}` and `/api/CashSales/GLPosting?key={billUUID}`
* `GET /api/ARReceipts/{receiptUUID}` and `/api/ARReceipts/GLPosting?key={receiptUUID}`

The current public schemas identify these exact master-detail GET operations:

| Master | Fixed path | ID type / required acceptance |
| --- | --- | --- |
| Customer | `/api/Customers/{id}` | int32; exact customer and current AR-account relationship |
| Currency | `/api/Currencies/{id}` | int32; actual currency and applicable rate contract |
| Stock | `/api/Stocks/{id}` | int32; active stock and its full current mapping graph |
| UOM | `/api/UOMs/{id}` | int32; active UOM belongs to the exact stock |
| Tax | `/api/TaxCodes/{id}` | int32; active/output tax, applicable rate and account relationship |
| GL account | `/api/AccountCodes/{id}` | GUID; active leaf, code/currency/type and current posting role |

These are documented paths, not newly implemented readers or accepted current
tenant shapes. The current TaxCode DTO constrains `rate` to0..1; do not confuse
that field with a displayed percentage or infer applicability from a list label.
Master values must come from the approved prepared-folio manifest and current
bound server reads, not guessed IDs, sample documentation, historical CS lines
or the Owner's uploaded JSON. Customer/currency inactivity semantics and exact
AR/sales/tax ledger relationships still require current-response acceptance.
No generic caller URL, browser endpoint, invented master read, or environment
gate is permitted. Capture actual headers, aliases, null/missing/cancelled
semantics, currency rates, account codes, timestamps and pagination rules in
private evidence; sanitize fixtures for the repository. Tokens stay in the
current server session. A401 ends the session and hides all money.

Implement and test the production `SnapshotDeps` adapter using these accepted
shapes and the prepared folio as the only charge calculator. Revalidate frozen
sources and current masters on resume while retaining the frozen bill date.
Persist the faithful prepared folio print projection with its immutable intent;
future settings must not reprice a frozen/closed stay. Normal print makes no
live N3 request. The version1 frozen prepared-folio capture/read foundation is
now implemented in `settlement-folio.server.ts`, and the snapshot builder binds
a supplied `folioProjection` into the immutable digest. It is not live wiring:
the current production adapter remains unavailable and must supply accepted
prepared presentation facts. Mount the read adapter only after schema/adapter
acceptance; missing packets or RPC/cache errors must never reprice a frozen stay.
See `HH_N3_FROZEN_FOLIO_CHECKPOINT_20261008.md`. Production adapter/print
integration and browser acceptance are still pending.

## Lane B — one CashSale Post-to-AR

Permitted write after separate approval: **one**
`POST /api/CashSales/Create`, exactly the server-generated
`buildCashSalePayload(snapshot, intent)`:
`customerId`, `currencyId`, `currencyRate`, frozen `docDate`,
`referenceNo=HH-B-{intentUUIDWithoutHyphens}`, `isPostToAR=true`, immutable
bill-to contact and every prepared `itemDetails` row with position, integer
stock/UOM/tax IDs, quantity, unit/subtotal/tax/net amounts and description.
No embedded bank payment. Persist the exact payload digest and dispatch fence
before POST. Response ID is only a locator until GET proof succeeds.

Required detail + GL assertions: exact UUID/code/type/reference/customer,
currency/rate/date/contact, all line mappings/amounts/taxes, total50000cents,
initial outstanding50000cents; exactly balanced customer AR debit and expected
sales/tax credits, no bank debit. Prove the INV target relationship independently.
Different target ID/type requires a reviewed adapter change and tests; do not
weaken the existing prover to make it pass.

## Lane R — one purpose-specific balance receipt

Precondition: bill and owned deposit allocation proven, fresh bill outstanding
45000cents and verified selected bank/cash account. Permitted write after
separate approval: **one** `POST /api/ARReceipts/Create` using
`buildBalanceReceiptPayload`: `docType=AROR`, receipt business date, integer
customer/currency IDs, currencyRate1, reference from the same intent, selected
account UUID, totalAmount450.00 and `formatReceiptContact` fields. Omit details,
split/multi-payment and embedded knockoff rows.

Required detail + GL: exact linked UUID/reference/customer/currency/date,
single selected account, amount45000cents, zero refund, empty initial allocations,
remainder45000cents, exact bank debit/customer AR credit. Original receipt
creation guards remain intact. The receipt is settlement-purpose, never a second
deposit or allocation-as-cash event.

## Lane A — preservation and partial allocation

Before approval capture fresh bill detail/GL and receipt detail/GL, exact header,
refund and complete normalized prior allocation rows. Use separate designated
fixtures for pre-existing unrelated allocations and partial remainder cases.

Permitted write: one exact flat row array to
`POST /api/ARReceipts/UpdateCustomerKnockoff` for the designated receipt only.
Each row contains integer `customerId`, `receiptDocType=OR`, exact receipt UUID,
`docType=INV` (or a previously proven preserved DN), target UUID and positive
`paymentAmount`. Current candidate submits every preserved prior row plus the
new owned target amount. Whether the vendor replaces or appends must be proved,
not inferred from `data=1`. Proposed deposit increase is at most5000cents and
the fresh bill outstanding; partial fixture has a separately approved smaller
amount. Never send an empty row set or an unrelated receipt.

Read back both documents and journals: immutable header/refund/payment/journal
unchanged, every unrelated prior allocation unchanged, one exact intended delta,
receipt conservation and bill conservation exact. Repetition testing is a
separate explicitly bounded write authorization, never automatic recovery.
Unexpected append/clear/repeat behavior fails this lane and leaves gates closed.

## Lane C — N3-side stale and concurrent rejection

This is a separate non-production authorization with exact fixtures, request
count and payloads. Two externally competing callers use the same pre-state
and incompatible updates. A stale request must be rejected atomically by N3;
exactly one intended state change is allowed and unrelated rows must survive.
HotelHub database locking is not evidence of N3-side safety against another
accounting client. The current public flat-array request does not expose a
proven version/fence parameter. Obtain vendor evidence of a supported atomic
mechanism before running the race; without it **both allocation gates stay
closed**, even if preservation/partial/repetition examples pass.

## Lane M — complete monthly discovery and recovery identity

GET-only, separately approved. Prove complete current bill/receipt date-range
pagination and immutable reservation/intent document links. A ledger alone
cannot establish completeness. Test date changes, cancelled/reversed/refunded
documents, duplicate pages, mixed currencies, all pages and101 candidates;
partial data returns Unavailable with no totals/export. Prove exact-reference
search completeness/uniqueness before enabling unknown-create lookup. Zero
search results are never proven non-dispatch. Existing matched deposits need
the allocation-aware detail/GL proof adapter without relaxing creation guards.

## Acceptance and stop rules

* On timeout, malformed success,500, lost response,401, contradictory read, or
  failed local outcome/proof persistence: preserve the saved fence, mark Needs
  review and perform only bounded exact-ID/reference GET recovery. No second POST.
* Accept only fresh authenticated reads bound to tenant/reservation/person/token,
  exact IDs and snapshot. Repository JSON is a fixture, not a runtime proof brand.
* Each accepted operation needs its separate reviewed evidence hash. Allocations
  also require the accepted atomic concurrency hash and supported preservation
  mode. No browser/environment switch can activate an unproven operation.
* Re-run strict transport/prover/coordinator tests with sanitized accepted shapes,
  including contradictions. No accepted response shape exists at this checkpoint.
* Final readiness additionally requires fresh bill outstanding0, every linked
  receipt remainder0, no refund/unknown dispatch, owned allocations equal the
  bill total, then separately authorized runtime close/replay and all-room Dirty/
  DNDoff/cross-device/Monthly/export verification. API response success alone is
  insufficient.

## Owner GET evidence received — 08/10/2026, 18:13 Malaysia

Bundle schema5d0.3, run `20261008T101353-oxg675`, dates26/09–27/09,
no optional filters. Original attachment SHA256:
`7af5f30224bca23a2ecab7842c53711f9adad01cb7c07b7c1970189ebc521c95`.
The attachment stays private; this repository records selected non-secret facts
and synthetic regression fixtures, not the raw customer/accounting bundle.

Four receipt details, one cash-sale detail and one refund detail returned
HTTP200/envelope0000. Two INV rows target the same immutable UUID as
CS2609/001; RF2609/001 targets OR2609/001 by immutable UUID. Correct matched
payments are60.01,150.00 and40.00 respectively; `amount` in these rows is the
original target document total, while `paymentAmount` is the matching amount.
Bill324.03 less210.01 matching leaves114.02, consistent with its current detail.
Same numeric customer identity and MYR/rate1 are observed in these detail DTOs.
These documents have no new settlement-intent reference or proven stay ownership.

The legacy console had incorrectly displayed324.03 twice and100.01 for the
refund match, dropped numeric customer identity and failed to classify actual
`specialCode=BAC/CAC`, `isActive=true`, `hasChildren=false` GL rows. The review
candidate now corrects these diagnostic interpretations without creating any
runtime proof authority. Missing/contradictory payment fields display unavailable;
different known customers are a mismatch. Legacy explicit payment aliases remain
supported, but plain target `amount` is no longer promoted to an applied amount.

Refunded OR2609/001 has invoice matching60.01, refund40.00, an RF knockoff row,
and reported outstanding40.00. This does not establish spendable remainder:
100.01−60.01−40.00 is0.00. The strict current prover rejects unsupported RF
allocation rows and inconsistent refund/remainder conservation. Do not drop
the RF row, subtract the refund twice, or weaken the prover to make this DTO pass.
Accept the vendor's current refund/outstanding semantics and bound journal
evidence before admitting this historical shape into a production adapter.

| Lane | Current acceptance |
| --- | --- |
| G | Partial: current detail/account-list shapes and immutable links observed;6/6 journal responses now captured and balanced. Current master-detail set, persisted-posting semantics and customer-ledger mapping remain unaccepted. |
| B | Historical Post-to-AR flag/INV same-ID example observed; no new intent-owned create/detail/journal proof. |
| R | Historical single/split receipt details observed; no purpose-bound balance receipt or GL proof. |
| A | Existing matching payments observed; no before/after preservation, replacement/append or repetition proof. |
| C | No vendor atomic stale/concurrency mechanism or race evidence. Allocation gates stay closed. |
| M | One bounded historical list page observed; no accepted full-period pagination, intent-owned discovery, reversals or refund policy. |

Result register: G **partial GET evidence only**; B/R/A/C/M **not accepted**.
No new financial proof job, N3 writer gate, transaction or cleanup was executed
by Codex. This update records the Owner's completed reads; do not repeat their
old transactions or use the disputed OR2610/001 correction as a fixture.

## Completed evidence and exact remaining questions

The latest Owner bundle is schema5d0.4, run`20261008T133334-1le2bt`, SHA256
`e359b6b25f6a89d877dd1540ed4ac3c7f3206364e5540d6c768d11a1301c9db5`.
All six selected journal reads returned200/0000 with complete captures. All15
rows reconcile their document's debit/credit totals, including CS324.03 and
RF40.00. Capture transport failure is resolved; do not request another identical
export. The published diagnostic release receipt is
`HH_N3_JOURNAL_RUNTIME_FIX_20261008.md` on the separate journal-release branch;
this billing branch records acceptance in `HH_N3_JOURNAL_ACCEPTANCE_20261008.md`.

The current public `DocumentStatus` enum defines2 as Approved, alongside
0Draft/1WaitingForApproval. That resolves the enum's documented label; it does
not establish when actual GL postings exist. OR/CS captures still have zero row
IDs, default dates, null document codes and zero scalar currency fields despite
positive nested currency. RF physical fields differ. The SalesInvoices GL
operation expressly permits live or temporary park/post data; that other
operation's wording cannot establish ARReceipt/CashSale behavior. Keep strict
posting proof unavailable rather than silently replacing missing fields.

Current `UpdateCustomerKnockoff` remains an array request. Its advertised
parameters are empty; the allocation DTO advertises no explicit revision,
timestamp, ETag or comparison token. A response of1 still does not prove
preservation or a stale-update fence. This is absence of a documented mechanism,
not a claim that QNE has no supported mechanism.

The remaining QNE clarification is precise and requires no new test transaction:

1. **Posted GL identity:** for Approved OR/CS with park/post disabled, does
   GLPosting contain actual committed entries or calculated rows? Explain zero
   IDs/default dates/null codes and the customer-ledger rows with no account ID.
   Specify the supported read and exact identity/account mapping that proves
   committed posting for the requested document.
2. **Refund/remainder:** for OR100.01 applied to INV60.01 and refunded40.00,
   why are both refundAmount and outstandingAmount40.00? Specify the supported
   spendable-remainder rule and how the RF knockoff participates so the refund
   cannot be counted twice.
3. **Atomic matching:** what supported request/header/version mechanism causes
   UpdateCustomerKnockoff to reject a stale allocation atomically? Specify how
   unrelated existing matches survive competing N3 clients and the exact stale
   rejection result. A HotelHub lock or read-after-write check is insufficient.

These questions are prepared, not sent. New creates, rematching, refund, void,
unmatch, cleanup and race tests remain separately bounded lanes. The old500/50/
450 proposal above is not a new instruction to create documents tonight.

## Resume register

| Work | Current state / next dependency |
| --- | --- |
| Tasks1–8 and durable proof/close foundations | Completed; preserve and do not reimplement |
| GUID and taxed CashSale header compatibility | Completed on billing review branch;2,280tests passed,20existing skips in the last code checkpoint |
| Current master/snapshot adapter | Pending accepted exact master responses and prepared-folio mapping provenance |
| Journal/refund and matching acceptance | Pending the three vendor answers above; all operation gates unavailable |
| Frozen print mounting | Foundation complete; schema/current snapshot acceptance required before mounting |
| Monthly/matched-deposit and exact-reference adapters | Pending complete discovery/provenance and accepted financial semantics |
| Desktop/mobile browser inspection | Still unverified; the prior local browser download failed, not a passed UI check |
| Operational schema, full billing merge/publish/UAT | Separate unperformed lanes; code tests do not prove live readiness |

This continuation changes only proof instructions and the execution register.
No code, dependency, SQL or operation gate changes, new tests/builds, tenant N3
requests, database writes/migration, deployment, public publish or AI Build.
Last code verification remains the GUID checkpoint, not a new test claim.

Ruling: use the newly documented master paths to specify pending reads, while
retaining the unavailable production adapter — schema fields do not establish
current tenant mappings — cost if wrong: activation is delayed rather than
posting from a guessed relationship.
Ruling: accept the documented status2 label only, without equating approval with
committed posting — the schema does not establish that implication for these
GL endpoints — cost if wrong: vendor posting verification remains pending.
