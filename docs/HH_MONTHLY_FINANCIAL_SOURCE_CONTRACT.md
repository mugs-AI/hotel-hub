# HotelHub monthly financial source contract

All reads are server-side, Owner-only (`hotel:financial_reports:view`) and scoped to the session tenant. No read posts, matches, refunds or modifies anything in N3.

## Sources
| Source | Status | Basis |
|---|---|---|
| Deposits (receipts) | Supported | Posted HotelHub deposits (immutable HH reference + saved N3 receipt id) and verified receipt versions from receipt controls. A shared walk-in customer or bank account alone never qualifies. |
| Sales | Unavailable (`final_billing_source_not_connected`) | No verified posted-sales source. Prepared folios are never sales. |
| Other collections (settlements/direct payments) | Unavailable | Same. Collections is therefore Unavailable; Deposits stays independently complete. |

## Dating
- Original receipts: N3 document date from a GET-only evidence read (`readReceiptControlEvidence`: receipt detail + GL posting). Local creation time is used only to choose candidates (property month ± 2 days), never as the date.
- Corrected/replacement receipts: verified version `document_date`.
- Void activity: confirmed void `verified_at`, converted to the property-local date; amount is the last confirmed effective amount just before the void (RM50 → RM80 → void = RM80).
- Month discovery (option (a), coordinator-verified against official sales-v1 OpenAPI): GET `/api/ARReceipts/List?$filter=docDate ge <start> and docDate lt <endExclusive>&$orderby=docDate desc,docCode desc&$skip&$top=100`, response `data.value` + `data.count`, official `code "0000"` envelope only. Server-built, validated, encoded; never browser input. Pages must keep the same count, stay in range (out-of-range => `n3_filter_ignored`), keep docDate desc order, contain no duplicate ids and end exactly at count; max 20 pages. Any failure => Unavailable.
- Candidates = saved HotelHub deposits whose exact immutable N3 receipt id is listed, or whose stored version receipt id is listed, or whose stored version/void event is dated in the month. Ownership is never inferred from customer, bank or reference prefix. List rows are discovery only: `isCancelled` never confirms a void; list reference/currency contradicting the saved receipt => Needs review. Replacement receipts remain Unavailable.
- Void events keep event time separate from proof; `VOID_JOURNAL_CONTRACT_PROVEN` stays false, so no void is newly confirmed from isCancelled/cancelledDate.
- Live contract status: implemented from documentation and tested with mocks only; the live N3 filter has NOT yet been exercised by a signed-in GET probe.

## Effective projection
Uses `computeReceiptOverlay` (the repaired receipt-controls projection): a confirmed void excludes the original even if the replacement failed; only the latest replacement counts, once; Needs review warns without resurrecting money.

## Limits (no partial totals as complete)
- Local paging 500 rows by stable id, cap 100,000; any page error or cap → Unavailable.
- N3 checks: max 3 in parallel, max 100 per selected-month candidate set (over → Unavailable `verification_cap`), no new check after 20 s (→ Unavailable `verification_budget`); whole source stops at 40 s.
- Mismatch/external edit → row Needs review; N3 unreachable → Unavailable; expired session → 401.
- Mixed currency or unsafe cent totals → Needs review with no amount.
- Server cache: 30 s per tenant/month/timezone/revision (latest version, request and deposit change), only for non-Unavailable snapshots. Client queries are invalidated after receipt approval/verify.

## Indexes
Reads filter `hotel_receipt_versions (tenant_id, state, verified_at)` and deposits `(tenant_id, status, created_at)`. No index was added; add one in a separate additive migration after review if query plans need it.
