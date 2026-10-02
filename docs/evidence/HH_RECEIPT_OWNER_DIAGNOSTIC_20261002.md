# Owner receipt diagnostic evidence — 02/10/2026

Input main: `33167f94f8667d1b030b7ab562623723630251e2`.
Review branch: `review/hh-receipt-diagnostic-20261002`.
This follow-up changes documentation only; no financial transaction or release.

## Observed evidence

Owner screenshots identify BK260920001 / OR2610/001. The opened dialog shows the
RM50.00 original and `journal_row_doc_code_missing`. No successful prior request
is needed to open the dialog. The warning is produced by the GET readiness check.
The generic “request was not created” wording also appears before submission;
it does not prove a POST occurred. Backend request count remains zero.

Original screenshot SHA-256 hashes (images are not committed because they also
contain unrelated signed-in display/contact/booking information):

- Popup: `91a5ffbfbd4d9513fe561d9c028dd55b91a3a8dbcf100841b406ea44b73867a8`.
- Deposits card: `f077fd50784089bebd1b60bd3d6b207c653a07ac20731bf6f892baba2374053c`.

Project-scoped SELECT reconfirmed posted MYR50.00, unchanged update timestamp,
and zero requests, decisions, executions and versions. Table names actually used
are `hotel_reservation_deposits` and `hotel_receipt_control_*`; an initial SELECT
against the wrong name `hotel_deposits` failed without changing anything.

## Public contract read

Source: <https://openapi.account.qne.cloud/doc/sales-v1.json>.
Unauthenticated GET; no tenant transaction. First 20-second download was incomplete
and rejected as invalid JSON; a bounded retry completed and parsed successfully.
Full fetched document SHA-256:
`0d01ddd02952f17b71603bb72bffe2139b1bf5a24ccafef659efd1f18b3989f2`.

Relevant excerpt only:

```json
{
  "ARReceipts/GLPosting GET 200 schema": {
    "$ref": "#/components/schemas/ApiResponseMessage"
  },
  "GLTransactionDto.properties": {
    "docCode": { "type": "string", "nullable": true },
    "referenceNo": { "type": "string", "nullable": true },
    "accountId": { "type": "string", "format": "uuid", "nullable": true },
    "account": { "$ref": "#/components/schemas/AccountCodeLookupDto" },
    "debit": { "type": "number", "format": "double" },
    "credit": { "type": "number", "format": "double" }
  }
}
```

This establishes public schema metadata, not the failing signed-in response.
It does not authorize assuming receipt detail identity supplies absent row identity.

## Focused independent verification

```text
node node_modules/vitest/vitest.mjs run \
  src/lib/__tests__/receipt-journal-shape.test.ts \
  src/lib/__tests__/receipt-controls-evidence.test.ts \
  src/lib/__tests__/receipt-controls-store.test.ts

Vitest 4.1.10: 3 files passed; 97 tests passed; 0 failures; exit 0.
Existing missing-docCode test confirms that receipt detail does not fill row identity.
No production credentials or live-write flags supplied. Fixtures only.
```

Missing capability: signed-in upstream GET journal capture for the affected
receipt. Preserve envelope/row keys and null/blank fields; redact secrets and
contact information. Preserve bindings with consistent placeholders if needed.
Until then: failed field identified, root cause unconfirmed, correction remains P1.

## Owner N3 detail and print follow-up — 23:17 MYT

Two additional screenshots show the saved Receive Payment and Official Receipt
print for OR2610/001 in the Owner-designated MUGS AI LAB TEST company. Both show
MYR50.00, date 01/10/2026, customer 700-7001 and the HotelHub booking description.
The detail shows MAYBANK and the HotelHub reference; the print and detail URL
carry the same immutable receipt UUID. These are Owner-supplied N3 UI evidence,
not an agent API read. They show no correction, approval, void or refund.

A fresh project-scoped SELECT compared the screenshot UUID, receipt number and
reference with the scoped saved deposit: all three comparisons returned true.
The deposit remains posted MYR50.00; request count remains zero. Fresh GitHub
main and Lovable latest SHA remain `33167f94f8667d1b030b7ab562623723630251e2`,
and Lovable project/workspace still match the locked target.

Screenshot SHA-256 hashes:

- N3 detail: `456f2aaf089a93967d8e31624d1225be7e90b1374471f9a4ef1ee28ca2127e53`.
- N3 print: `00fcec1508bd069005c8ee0bcbe1eb7f7058bc087654c4a0494b9e2ee2f96534`.

The screenshots establish the receipt header/print identity. They do not show
Account Journal rows or the GLPosting API JSON. A header receipt number is not
proof that each API journal row supplies that number. The failing predicate
and root-cause uncertainty therefore remain unchanged; do not weaken the check.

The newly attached Project Sources retain historical September source pointers.
Their financial master explicitly assigns N3 login/operations to the Owner and
distinguishes Cloud UI proof from API proof. The attached MDB protocol/adoption
bytes match the originals already in this branch. The latest explicit DirectBuild
decision continues to control delivery, while all financial/release gates stay.
No old next-action instruction authorizes another receipt Create or replay of
completed matching/refund tests. Uploaded sources were read, not rewritten.

Next supporting evidence: Owner opens Account Journal for this existing receipt
and captures all debit/credit rows. Expected entries are Dr actual Maybank
700-0310 MYR50.00 / Cr customer 700-7001 MYR50.00. This read-only screenshot can
confirm displayed accounting and row document/reference evidence; it will not
alone prove the upstream JSON shape. Ask for a menu screenshot if the journal
action cannot be found, rather than asking the Owner for credentials or raw tokens.
No application source, database, N3, merge, deployment or publication change occurred.
