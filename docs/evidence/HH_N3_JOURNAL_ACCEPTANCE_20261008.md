# Owner journal evidence and taxable bill correction — 08/10/2026

Upload to Project Sources: **No** — repository continuation checkpoint.

## New live diagnostic evidence

Owner run20261008T133334-1le2bt, schema5d0.4, at21:33:34 Malaysia,
test company9AC-0D9-2F1,26/09–27/09/2026, no optional filters.
Original attachment SHA256:
`e359b6b25f6a89d877dd1540ed4ac3c7f3206364e5540d6c768d11a1301c9db5`.
Raw private export remains outside Git. All six journal responses are HTTP200,
code0000, captured, untruncated; sourceIncomplete=false. The corrected diagnostic
transport now works in the Owner's live session. This establishes capture success,
not accounting contract activation.

Decimal arithmetic independently checked every journal row:

| Document | Rows | Debit MYR | Credit MYR | Observed entries |
| --- | ---: | ---: | ---: | --- |
| OR2609/001 | 2 | 100.01 | 100.01 | Cash debit100.01; customer credit100.01 |
| OR2609/002 | 3 | 150.00 | 150.00 | Bank debits80.00+70.00; customer credit150.00 |
| OR2609/003 | 2 | 10.00 | 10.00 | Bank debit10.00; customer credit10.00 |
| OR2609/004 | 3 | 15.00 | 15.00 | Bank debits8.00+7.00; customer credit15.00 |
| CS2609/001 | 3 | 324.03 | 324.03 | Customer debit324.03; sales credit300.03; tax credit24.00 |
| RF2609/001 | 2 | 40.00 | 40.00 | Customer debit40.00; cash credit40.00 |

Local debit/credit amounts also equal those totals, nested currency MYR/local=true.
Actual `sanitizedSample` detail payloads, list rows, comparisons, account eligibility
and refund-link state exactly match the21:11 export. No transaction was repeated.
Receipt applications remain60.01 and150.00 to the same cash-sale UUID, leaving
324.03−60.01−150.00=114.02 outstanding. Refund40.00 links to the original receipt.

## Observed contract limits

OR/CS journal rows have id0, docCode=null, docDate0001-01-01, currencyId0 and
currencyRate0 despite positive nested currency ID and real postDate. Customer
ledger rows may lack accountId/account; customer identity is nested or numeric.
RF rows have nonzero journal IDs, actual document code/date and currencyRate1.
The public snapshot describes OR/CS GLPosting only with a generic envelope;
it does not establish whether these specific responses are computed previews or
persisted postings. Do not call them previews as a fact, or invent persisted IDs.
Neither replace zero scalar fields with nested values nor map `fromAccount` to
the debit/credit account: it can describe the counterpart.

The supplied OR2609/001 detail still reports refund40.00 and outstanding40.00,
with an RF40.00 knockoff and INV60.01 application on receipt100.01. Spendable
remainder cannot be inferred from that outstanding field. Strict receipt
conservation/refund checks remain unchanged; all financial gates remain closed.

## Completed bounded billing correction

N3 CashSale detail has subtotalAmount=totalAmount=300.03, taxTotalAmount24.00,
netTotalAmount324.03, with matching separate local totals and no discount/rounding.
The bill prover incorrectly treated totalAmount/netTotalAmount as equal aliases.
It now requires both independently: pre-tax total equals the frozen charge
subtotal sum, net total equals frozen payable amount. Optional local counterparts
must match their corresponding totals. Existing subtotal/tax/line/GL checks remain.
Receipt amount aliases retain their original strict equality behavior.

New synthetic tests preserve observed financial values with replaced identities.
They exercise authenticated client-bound mocked GET outcomes and synthetic exact
journals; they do not accept the real journal physical shape or enable a gate.
Three assertion failures reproduced before correction,58focused assertions passed
afterward. Full2261passed20skipped0failed; TypeScript/build exit0. Scoped two-file
lint passed after formatting-only cleanup. Known full-lint170baseline errors and
38warnings remain historical; no claim of a globally clean lint run.

One fresh read-only delta review:0Critical/0Important/0Minor; no second review.
Reviewer did not run checks. Declined-to-judge rulings: vendor journal shape,
zero IDs/year1/null headers/current-customer ledger mapping, vendor allocation
atomicity and production readiness remain outside this header-only correction;
cost of treating them as accepted is false accounting authority. Executor owns
the test/type/build/lint evidence. Existing broader reviews were not repeated.

Ruling: use separate mandatory bill pre-tax/payable amounts, never a preferred
alias fallback — accepted diagnostic fields have different semantics — cost if
wrong: an unsupported header remains unavailable, rather than posting wrong money.
Ruling: preserve strict journal/refund/gate boundaries while retaining the new
balanced evidence — capture cannot establish missing vendor semantics — cost if
wrong: activation waits; no financial write is authorized by this fixture.

## Checkpoint and remaining work

Resumed existing isolated billing branch at localab2cd9c3d4411f083a01e0c2fe6d1e432bf75dd7,
remotef4a6c4c686788af6b874e041c265d42da644d3f8, tree365bb73cd125b13a23964af2e34355749f4dcc04.
Only the two bill-proof/test files and this evidence document are included.
Tasks1–8 remain completed; Tasks9/10/11 production adapter/reader integration
and activation are partial. Candidate SQL and parked corrections are preserved.
This correction stays on the billing review branch: no main merge or publication.
No database operation, migration, N3 request/write, secret/dependency change,
Lovable AI Build or deployment occurred in this continuation.

No further identical console query or recreated transaction is needed now.
The remaining safe implementation lane is the reviewed current-master/customer
ledger and journal adapter, followed by frozen print/monthly/recovery integration.
It must use fresh server-bound reads, not uploaded JSON as proof. Required vendor
facts remain: persisted-posting verification for OR/CS, exact refund/remainder
semantics, and an atomic stale-update rejection mechanism for allocation.
Proving all amounts balance does not supply atomic concurrency.

The precise vendor questions are:

1. For existing OR/CS documents, does GLPosting return calculated lines or persisted
   postings when row IDs are0 and docDate is0001-01-01? Which fixed read verifies
   actual posted entries and their immutable document relationship?
2. After a receipt100.01 is applied60.01 and refunded40.00, why are refundAmount
   and outstandingAmount both40.00? Which field/rule proves spendable remainder
   without double counting the RF knockoff and refundAmount?
3. Does UpdateCustomerKnockoff atomically reject stale updates using a supported
   version/If-Match/compare-and-swap fence? What exact supported request and
   rejection behavior preserves unrelated allocations against other N3 clients?

These questions are prepared only; Codex has not sent any message to others.
Do not activate allocation or repeat existing writes to manufacture acceptance.
