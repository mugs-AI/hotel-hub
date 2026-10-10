# N3 receipt control contract evidence

Date: 2 October 2026. Read-only discovery; no N3 write was made.

## Source

Official QNE Open API document `https://openapi.account.qne.cloud/doc/sales-v1.json`
(linked from the HotelHub development brief). Fetched with an unauthenticated GET.
No tenant probe, receipt creation, edit or void was performed to gather it.

## Operations listed for AR Receipts

| Method | Path | Summary in document |
| --- | --- | --- |
| GET | `/api/ARReceipts/{key}` | One receipt including current knockoff allocations (used today) |
| GET | `/api/ARReceipts/GLPosting?key=` | Posting journal (used today) |
| GET | `/api/ARReceipts/List` | List (used today for reference matching) |
| POST | `/api/ARReceipts/Create` | Create (used today by deposit creation only) |
| POST | `/api/ARReceipts/Update?confirmedForBankRecon&confirmedForKnockOff` | Body `ARReceiptDto`; summary is only "UpdateAsync"; responses 200/400 |
| POST | `/api/ARReceipts/Void?confirmedForBankRecon` | Body `CancelModel`; summary is only "VoidAsync"; responses 200/400 |
| POST | `/api/ARReceipts/Devoid` | Reverses a void; no semantics documented |
| DELETE | `/api/ARReceipts` | Body `GuidKeysModel` (hard delete) |

## What is not established

- Update: whether the document number, reference and date are kept; whether the
  posting journal is reversed and re-posted; optimistic concurrency (no version
  or ETag field is documented); idempotency for retries; behaviour for matched,
  bank-reconciled or e-Invoiced receipts; the meaning of the two `confirmed…` flags.
- Void: the `CancelModel` fields required, journal reversal evidence, the
  readback representation of a voided receipt, and idempotency.
- Delete is a hard delete and is never used: a missing receipt is not void evidence.

Paths exist, but the field semantics, journal effects, concurrency and
reconciliation behaviour are not proven. These calls also have not been tried
against an approved test company.

## Decision

`receiptControlCapabilities()` returns `{ directEdit: false, voidReplace: false, manual: true }`.
Automated modes need all three of the following. The code ignores the
environment variables until a reviewed change turns them on:

1. This document records the proven contract, with sanitized readback fixtures.
2. `HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT=true` or `HOTELHUB_RECEIPT_CONTROL_VOID_REPLACE=true`.
3. The tenant is in the existing deposit-write allow-list.

Until then: approval leads to "Approved — complete in N3". The Owner opens the
receipt in N3, makes the approved change, then presses Verify. HotelHub reads the
receipt and GL posting (GET only). It records a new effective version only when
the receipt matches the approved proposal and the journal balances to the new
amount. Missing (404), unknown cancellation/matching, an unbalanced or mismatched
journal, or an ambiguous response leave the request in Needs review.

## Review fixes (2026-10-02, independent review of 15bf)

- **Confirmed contribution is kept separate from the Needs review flag.** An unresolved request only adds a warning. It never brings back a receipt whose void was confirmed. Only the latest replacement row counts, and it counts once. A later voided replacement is never revived.
- **Evidence binding.** Every read checks the saved immutable receipt id, document code, HotelHub reference, customer, currency and document date. The total must be positive, in safe cents, and equal to the sum of the payment lines.
- **Exact journal.** A balanced posting is not enough. Every payment-account debit must equal the verified receipt payment line, account for account. There must be exactly one customer (AR) credit equal to the total. Every line must carry the exact HotelHub reference, with no unexplained lines. Document codes must match, except explicit-null row codes under the Owner-approved correlated-read contract below. Otherwise `journalExact = false`. That holds approval and makes a verify insufficient. Original deposit creation lines stay immutable; current receipt lines may reflect a separately approved manual correction, which must still match its proposal on Verify.
- **Void.** `VOID_JOURNAL_CONTRACT_PROVEN = false`. A cancellation flag alone never verifies a void, so it always lands in Needs review for manual accounting confirmation. Missing cancellation, matching or refund data is treated as unknown, never false.
- **Database.** All foreign keys are compound and tenant-scoped. Two additive unique keys are added to deposits: (tenant_id, id) and (tenant_id, reservation_id, id). The reason must be 1–500 UTF-16 units, enforced at the RPC and by a CHECK. Execution mode and approval are immutable.
  - Claim requires `approved_at`, so Hold never sets it.
  - Complete is fenced to the claim's request version.
  - A failed outcome may record only confirmed void evidence.
- **Alerts.** Claim issues a fresh `claim_token`, and settle must present it. Transport stays disabled.
- **Official public sales-v1 OpenAPI.** It is reachable, and GET includes the current knockoff. The mutation paths listed in it do not establish concurrency, idempotency or void journal semantics. Automation stays off.

## Explicit-null document codes — approved design, 03/10/2026

Owner approved implementation/testing of `HH_RECEIPT_JOURNAL_BINDING_REVIEW_20261003.md`.
This is an amended application evidence rule, not a new vendor guarantee. The
generic GLPosting response contract does not explicitly promise row identity.
Owner's live diagnostic established a null supported row code; full raw live
response was not captured. A candidate is not live until separately merged/published.

Only explicit JSON null in all present supported aliases can use alternate binding:
the tenant-scoped saved receipt must have a nonzero UUID and saved document code;
receipt detail must independently match saved identity/reference/customer/currency;
the real fixed GET transport must privately bind the exact response object to
the same receipt key and N3 session token. No body flag can assert this provenance.
Every journal reference must be the exact server-generated HH reference, all
debits and the single customer credit must match verified receipt amounts/accounts,
and every present non-null document alias must be readable, agreeing and correct.
Absent, blank, malformed, mismatched and conflicting evidence remains blocked.
Header identity is never inserted into a journal line.

A second receipt detail GET must match the first normalized payload exactly
(object key order ignored). Business errors, authentication failure, timeout,
network/malformed data or any content change refuse acceptance. The fingerprint
includes the correlation method, immutable key and actual normalized journal
identity evidence. Unbound pure parser calls keep the original strict rule.

The same evidence reader serves request/preflight/Verify/monthly receipts.
Existing proposal, stale-fingerprint, role/tenant, matching/refund and cancellation
guards remain. Automatic financial writes and void-journal proof remain disabled.
Extra cost: one detail GET per otherwise valid correlated null-code receipt;
no new month-discovery read or candidate-limit change. Signed-in live acceptance
is still pending. Existing date validation checks ISO shape rather than full
calendar validity; reviewer noted this inherited limitation for separate follow-up.

## 03/10/2026 dormant Update implementation

Review adapter uses only the fixed Update endpoint, both bank reconciliation and
knock-off overrides false. Production contract returns **null**. Synthetic
`FIXTURE_ONLY` conditional-write mapping is test evidence, never production proof.
Missing schema/contract/flag/N3 tenant allowlists/measured execution budget denies
production automation. No N3 POST has been executed by the coordinator.

Payload builder preserves all allowlisted source fields and refuses unknown or
conflicting fields, split receipts, absent reconciliation evidence, cancellation,
matching/refunds and missing conditional token. The current narrow adapter accepts
same-account amount/contact updates; changing payment account is held until an
account-ID/code preservation mapping is proven. This is an explicit implementation
limit, not permission to overwrite an account code. Money-change account eligibility
is rechecked by orchestration; contact-only keeps the established historical account.

New deadline-aware transport bounds fetch/body reads and byte size; existing deposit
Create defaults and private journal provenance remain unchanged. Synthetic targeted
run: 60 tests passed; TypeScript and targeted lint exit 0. Upstream conditional-write
and accounting semantics, native database concurrency and managed runtime deadline
remain activation blockers.
