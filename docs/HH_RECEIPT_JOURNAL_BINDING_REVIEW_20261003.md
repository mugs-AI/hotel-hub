# Receipt journal binding investigation and bounded design — 03/10/2026

Status: DESIGN FOR OWNER REVIEW. No acceptance change implemented.
Main and Lovable remain 7449e9cdf4e3afa750396af7e808f0c0e11f4e0d.
Review parent d422a78a3a02e54e73e13b5950cd41ca49a31169; working tree clean.
Target remains HH1.0 HotelHub / mugs-AI/hotel-hub / main / locked Lovable project.
Automatic edit/void/replacement, alerts, DB and publishing gates remain intact.

## Investigation outcome
Owner's live popup proves a supported journal document-number field is null.
Exact amounts/accounts/reference do not show mismatches in that result.
Original deposit verifier does not require row docCode; receipt controls do.
The recent diagnostic did not introduce that requirement.

Fresh unauthenticated official sales-v1 download:
https://openapi.account.qne.cloud/doc/sales-v1.json
SHA256 0d01ddd02952f17b71603bb72bffe2139b1bf5a24ccafef659efd1f18b3989f2,
identical to the previous authoritative snapshot.
GET /api/ARReceipts/GLPosting documents query key as string/uuid, AR Receipts
resource, doc type AROR. Its response is generic ApiResponseMessage with varying
Data shape. The general GLTransactionDto schema permits null docCode.
GET /api/ARReceipts/{key} describes one AROR including current allocations and
uses a required UUID path key. It includes receipt identity in the detail DTO.

Limits: GLPosting does not reference a typed GLTransactionDto response or
explicitly guarantee row-to-receipt identity. A nullable general schema alone
does not prove an acceptable journal. No raw signed-in journal fixture was
captured, and no N3 operation was performed on the Owner's behalf.

## Proposed bounded change
Replace only the null row-number assumption with an explicit, server-owned,
correlated receipt-read proof; retain all substantive accounting checks.
This changes the accepted evidence contract, so it needs review before coding.

Proposed conditions for an explicit-null row (all must hold):
1. Server derives the immutable receipt UUID from tenant-scoped saved deposit.
   Receipt detail must independently match that UUID, saved receipt number,
   HotelHub reference, customer, currency, valid date, amounts and payment lines.
2. Journal comes from the fixed ARReceipts GLPosting GET with exactly that key
   under the same authenticated N3 context; the transport retains internal
   operation/requested-key provenance. No browser-supplied binding boolean/key.
   Response must satisfy existing strict HTTP/business-envelope checks.
3. Every journal row retains the exact nonempty saved HotelHub reference.
   Debits must match the exact bank/payment accounts and cents; one customer AR
   credit must equal the total. Conflicts/unexplained accounts fail.
4. Supported non-null document-number aliases must agree and equal the saved
   receipt number. Explicit null can use correlated proof; absent/blank/invalid
   aliases stay blocked. Never copy header identity into journal rows.
5. Re-read receipt detail after journal GET and require unchanged financial
   identity/content; timeout/error/change fails closed. This reduces acceptance
   of a journal read across an intervening N3 edit.
6. Source fingerprint binds the proof method/key plus actual normalized evidence.
   Unbound pure parser calls retain the current strict rule.

This would apply consistently wherever receipt-control evidence is consumed
(request, approval preflight, manual Verify and monthly receipt verification).
No special bypass for one booking or Owner. No new write endpoint or automatic
execution. Void proof remains false. Approval alone cannot alter totals.

## Engineering review cases before any candidate
- Current null-number reproduction passes only with complete correlated proof.
- Missing/wrong key/provenance, stale second detail, alien tenant/customer,
  wrong bank/reference/currency/amount, business failure and transport failure
  all stay refused without a request/version write.
- Conflicting/present wrong row number stays refused even with valid proof.
- Absent/blank/invalid number stays refused; no hidden receipt-header fallback.
- Owner/staff projection and stale-session isolation remain unchanged.
- Existing valid numbered journals retain behaviour; cancellation alone never
  proves void; automated financial execution and alerts remain disabled.
- Full fixture suite, type/style/build and protected-baseline comparison.
- Independent review of the amended financial evidence contract and exact diff.
- Merge and publish remain separate later approvals, not implied by design review.
- Signed-in live acceptance must be verified; fixture success is not live proof.

## Decision needed
Owner review must decide whether this correlated GET evidence is accepted as
the receipt-to-journal binding for explicit-null document-number rows, or whether
vendor confirmation/sanitized response proof is required first. Do not label the
unproven response semantics as a vendor guarantee.

This design grants no permission to Send Request, approve a financial correction,
edit or void a receipt, deploy a function, run a migration or publish.
