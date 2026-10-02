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
- **Exact journal.** A balanced posting is not enough. Every payment-account debit must equal its saved line, account for account. There must be exactly one customer (AR) credit equal to the total. Every line must name this document and reference, and there must be no unexplained lines. Otherwise `journalExact = false`. That holds approval and makes a verify insufficient.
- **Void.** `VOID_JOURNAL_CONTRACT_PROVEN = false`. A cancellation flag alone never verifies a void, so it always lands in Needs review for manual accounting confirmation. Missing cancellation, matching or refund data is treated as unknown, never false.
- **Database.** All foreign keys are compound and tenant-scoped. Two additive unique keys are added to deposits: (tenant_id, id) and (tenant_id, reservation_id, id). The reason must be 1–500 UTF-16 units, enforced at the RPC and by a CHECK. Execution mode and approval are immutable.
  - Claim requires `approved_at`, so Hold never sets it.
  - Complete is fenced to the claim's request version.
  - A failed outcome may record only confirmed void evidence.
- **Alerts.** Claim issues a fresh `claim_token`, and settle must present it. Transport stays disabled.
- **Official public sales-v1 OpenAPI.** It is reachable, and GET includes the current knockoff. The mutation paths listed in it do not establish concurrency, idempotency or void journal semantics. Automation stays off.
