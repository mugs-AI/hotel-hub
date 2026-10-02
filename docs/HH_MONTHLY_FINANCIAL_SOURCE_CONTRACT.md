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
- Known limit: a receipt redated externally by more than 2 days outside its creation month is not found as a candidate.

## Effective projection
Uses `computeReceiptOverlay` (the repaired receipt-controls projection): a confirmed void excludes the original even if the replacement failed; only the latest replacement counts, once; Needs review warns without resurrecting money.

## Limits (no partial totals as complete)
- Local paging 500 rows by stable id, cap 100,000; any page error or cap → Unavailable.
- N3 checks: max 3 in parallel, max 100 per request (over → Unavailable `verification_cap`), no new check after 20 s (→ Unavailable `verification_budget`); whole source stops at 40 s.
- Mismatch/external edit → row Needs review; N3 unreachable → Unavailable; expired session → 401.
- Mixed currency or unsafe cent totals → Needs review with no amount.
- Server cache: 30 s per tenant/month/timezone/revision (latest version, request and deposit change), only for non-Unavailable snapshots. Client queries are invalidated after receipt approval/verify.

## Indexes
Reads filter `hotel_receipt_versions (tenant_id, state, verified_at)` and deposits `(tenant_id, status, created_at)`. No index was added; add one in a separate additive migration after review if query plans need it.
