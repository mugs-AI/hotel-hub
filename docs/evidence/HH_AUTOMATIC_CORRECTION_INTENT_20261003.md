# Automatic deposit/contact correction — clarified Owner intent

Date: 03/10/2026, Malaysia. Upload to Project Sources: No.
Status: REQUIREMENT CLARIFIED; architectural design/contract proof pending.
No product implementation, database change, N3 operation or release performed.

## Current source and authority

Remote main and Lovable latest both verified as
734ac405c82e653a7098ce0ef22d51586382bd9d; Lovable ready, agentFinished=true,
workspace JRQygHE7tZl2GgPN8a8N, project d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76.
Local review started c8b2a2c0cd767d5f19d206ad978bca6a8b780299, clean.
Existing configured backend fkakhdzelilnejyehwfk / Lovable Cloud and hosting
remain. No new DB or public HTTP read occurred in this requirements clarification.

Owner now explicitly requires automatic N3 receipt modification after approval,
or direct automatic application for a small hotel's boss acting at Front Desk.
Deposit and billing-contact controls must be independent property settings.
This supersedes the prior allow/block-editing interpretation in
HH_RECEIPT_VERIFY_AND_EDIT_OPTIONS_DIAGNOSIS_20261003.md. Do not implement the
old design merely because it was explained in Chinese. No new design or exact
financial transaction was approved by this clarification alone.

## Intended product flow

- Controlled: staff submits RM50 → RM65; Dashboard shows complete comparison;
  one explicit Owner Approve triggers a durable execution claim, one bounded
  N3 Update, receipt/journal readback and only then the effective version.
- Direct: allowed operator saves; the same claimed Update/readback pipeline
  runs without a second human approval. Boss using Owner identity is the initial
  intended direct-mode actor. Do not silently widen existing financial-write
  roles, tenant authority or N3 permissions.
- User sees applying, proven success or a visible failure/Needs review. In the
  normal proven-success flow no separate manual Verify click is required.
- Reservation, deposits, prepared/printed folio, checkout, Dashboard/monthly and
  reports consume the same verified effective projection. Cross-session refresh
  is required; invalidating only the Admin browser is insufficient.

Proposed interpretation to confirm in design: two independent Require approval
switches, deposit ON and billing-contact OFF, following earlier requested defaults.
ON means request → Owner Approve → automatic execution. OFF means authorized
direct save → automatic execution. OFF does not mean forbidden or unrestricted.
If a separate prohibition is required, model it explicitly rather than overloading
these approval switches. Contact policy must cover local guest-folio saves and
N3 receipt-contact changes without treating the two as identical data stores.
For a combined amount/contact change, any changed category requiring approval
routes the whole proposal through approval; never split it to bypass control.

## Current implementation gap and public contract inspection

receiptControlCapabilities() still returns directEdit=false, voidReplace=false,
manual=true. N3ReceiptsClient has receipt Create and evidence GETs, not Update.
Existing approved requests, including RM65, are immutable manual-mode requests.
Do not retrospectively auto-execute them or change their execution mode when
settings/feature activation later changes.

The official unauthenticated sales-v1 OpenAPI was freshly fetched from
https://openapi.account.qne.cloud/doc/sales-v1.json on 03/10/2026. It lists
Fetched OpenAPI SHA256: 0d01ddd02952f17b71603bb72bffe2139b1bf5a24ccafef659efd1f18b3989f2.
POST /api/ARReceipts/Update with ARReceiptDto and boolean confirmation query
parameters confirmedForBankRecon / confirmedForKnockOff, both default false.
Response documentation distinguishes HTTP success from business-code failure.
ARReceiptDto exposes id/docCode/docDate/referenceNo/customer/currency, total,
details/multiPayments, contact, cancellation, refund and knockoff fields.

Listed fields/endpoints are not HotelHub tenant mutation proof. Preservation,
payment-line/header totals, contact mapping, journal replacement, concurrency,
unknown response/retry behavior and restrictions remain unproven through the
HotelHub API. An updatedAt field alone is not evidence of optimistic concurrency.
Existing N3 receipt-edit/void/replacement controls must remain disabled until
approved sandbox API Update/readback proof and reviewed activation. Never force
bank reconciliation or knockoff confirmation merely to make an update pass.

## Next design and proof boundaries

This is an architectural upgrade: automatic financial execution, direct-mode
authorization, independent policies, local billing proposals, durable claims,
reconciliation and cross-user refresh need a coherent reviewed design before
implementation. Prepare the design and exact Owner-operated sandbox proof list
after conceptual approval, then an implementation plan. Preserve the owner's
instruction to hand N3 jobs to them; no N3 login or credentials in chat.

Proof should use an explicitly designated non-production receipt, not assume
BK260920001 / OR2610/001 is disposable. Record exact before/after receipt and
balanced bank/customer journal, unchanged identity/reference/date, prohibited
states, and handling of uncertain results without repeat financial POSTs.
Prior Cash Sale/refund/knockoff UI tests do not prove AR Receipt Update API semantics.

No automatic Update may ship active until proof and separate activation/release
gates pass. Void, replacement, refunds, unmatching, Sales/Collections source
activation and alerts remain outside this amount/contact correction scope.
DB apply, code merge, runtime/public publish and N3 writes remain separate lanes.
