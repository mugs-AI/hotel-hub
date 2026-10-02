# HotelHub receipt correction, void approval and alerts

Status: written design for user review. Concept approved on 2 October 2026; backend implementation and notification delivery have not started.

## Intended outcome

Staff can request a correction or void of a HotelHub deposit receipt. The Owner sees exactly what will change before approving. Every action remains traceable. HotelHub changes financial figures only after authoritative N3 evidence confirms the result. The user explicitly permits Owners to approve their own requests.

“Admin” uses HotelHub's existing Owner role. No additional administrator role is introduced. Reservation and Prepare Checkout retain their separate purposes and card sets.

## Request and review

Each posted receipt offers Request correction and Request void beside Print in N3. A reason is required. Requests include booking reference, guest, original receipt number, requester and time. Amount and payment account are editable request fields; saved Bill-to customer name/address/phone/email may also be proposed. Customer account identity, currency, receipt identity and matching state are server-controlled.

The server reads and saves a versioned N3 receipt snapshot before accepting the request. It validates the proposed payment account against N3 and the property's configured choices. Amounts use integer cents. Contact limits use the existing 100-character remark split: address in Remarks 1–2, phone in Remark 3, email in Remark 4. Excess length is rejected before approval or posting.

The approval panel displays only changed fields as Original → Requested. Example:

| Field | Original | Requested |
| --- | --- | --- |
| Receipt | OR2610/001 | OR2610/001, if N3 permits direct editing |
| Amount | RM50.00 | RM80.00 |
| Deposit to | DuitNow | Cash |

The server also displays the change in total deposits and provisional balance. For this example: deposits increase RM30.00 and the remaining balance decreases RM30.00. A void of RM50.00 decreases deposits RM50.00 and increases the provisional balance RM50.00. These are forecasts until N3 confirmation.

One active request is allowed per receipt. Duplicate submissions reuse the same request ID. A new N3 snapshot is checked at approval: if the receipt, matching, refund or amount state has changed, the request becomes Needs review and cannot execute against the stale snapshot.

## Approval and execution

The Owner Dashboard has a tenant-wide queue with Review, Approve and Reject. Front Desk can see its requests and their outcomes but cannot approve or execute. Owners may self-approve as requested; the audit log records requester and approver separately even when they are the same person.

States are Pending approval, Rejected, Approved awaiting N3, Applying, Applied, Failed and Needs review. Approval records a decision and does not itself prove a financial change. A worker must claim an approved execution atomically before any outbound financial write. Outcomes that may have reached N3 become Needs review and are reconciled by readback rather than retried automatically.

Before implementing automated execution, verify the official N3 AR Receipt update/void contract, required fields, permission errors, posting journal effects, concurrency support, and idempotency/reconciliation behavior. The current adapter exposes read/create only; it does not establish an update, delete or print API. Do not infer write endpoints from a browser URL or from N3 UI support.

Use direct correction when its contract is verified and N3 permits the receipt's current state. Otherwise use a verified void-and-replacement workflow. The request clearly identifies whether the receipt number will remain or a replacement number will be issued. A matched, refunded or otherwise restricted receipt is held for review; HotelHub does not silently unmatch, refund or alter another document.

If no supported write contract can be verified, approval leads to Approved awaiting N3 with an explicit Open in N3 action. An authorised Owner performs the approved change in N3, then HotelHub checks the result. This manual path is clearly labelled and does not claim automatic execution.

“Delete” is presented as Request void, with the original receipt retained in the audit/reporting history. A 404 or missing list result alone is not proof of a successful void. N3 confirmation must establish cancellation or the verified equivalent and its journal effect. A hard-deleted document with insufficient evidence remains Needs review.

## Financial evidence and recovery

Keep the original deposit creation intent, reference, fingerprint and idempotency key immutable. Store effective receipt versions and void/replacement evidence separately; do not overwrite the creation intent to make reconciliation pass. Update the effective version only after a matching N3 receipt and posting journal have been checked.

All consumers use the same effective projection: deposit card, reservation list, prepared/printed folio, checkout verification, monthly figures and reports. They exclude confirmed voids, count confirmed replacements once, and retain unconfirmed amounts as warnings rather than making up zero. A direct N3 edit outside HotelHub must be detected during readback and held for review rather than silently accepted.

Void-and-replacement has two distinct accounting steps. Once a void is confirmed, the original no longer counts, even if replacement fails. A replacement counts only after its own confirmation. The UI displays the partial result and stops automatic retries; it never hides a real void until a replacement succeeds.

## Audit, permissions and storage

Add tenant-scoped financial-request, decision, execution and receipt-version records through additive migrations. Server-authenticated tenant/actor/role values control every read and write. Browser requests cannot supply an approver, tenant, N3 token, execution status or authoritative original amount. Owner enforcement applies to server endpoints as well as visible buttons.

Audit records include original and proposed snapshots, reason, requester, approver, timestamps, execution IDs, N3 document identities and outcomes. Stored snapshots contain only required financial/contact fields. Tokens and raw guest identity numbers are excluded. Sensitive details are never written to ordinary logs or notification payloads. No physical receipt-history deletion is offered.

## Phone alerts

The in-app Dashboard queue is authoritative. Email is the proposed first phone-accessible channel; the user has not yet chosen a channel or supplied verified recipients. Notification settings require enabled Owner recipients and a configured delivery provider before activation. No alerts are sent during implementation or to guessed addresses.

An outbox sends one alert for a new pending request and relevant decision/execution failures. Delivery is deduplicated independently from receipt execution, so retrying an alert never repeats a financial action. Alerts include receipt/booking reference and a signed-in Dashboard link; full guest contact details and N3 credentials stay out of the message. Failed delivery remains visible to Owners without losing the approval request.

WhatsApp and web push are later adapters after provider/recipient configuration. Web push requires subscriptions and user permission; iPhone web-app push requires installation to the Home Screen. The financial workflow does not depend on notification permission or successful delivery.

## Verification and acceptance

- An RM50.00 → RM80.00 request displays both amounts, the account change and the independently checked RM30.00 effect before approval.
- Front Desk, Housekeeper, another tenant and forged actor/approver requests cannot approve or execute.
- Owner self-approval works and is explicitly audited.
- Concurrent decisions/executions do not produce duplicate writes; stale, matched and refunded receipt changes cannot execute.
- Rejected, failed and uncertain requests do not alter effective totals without N3 evidence.
- Direct edits, confirmed voids and partial void/replacement outcomes agree across card/list/folio/checkout/report views.
- A 404 does not mark a receipt voided. N3 timeouts are reconciled without blind retries.
- Alert retries cannot create or change receipts; notification failures leave requests in the Dashboard.

Implement this subsystem before monthly reporting so reports consume a settled receipt-version contract. Review this written design before preparing its implementation plan.

## References

- Existing `n3-receipts.server.ts`, `deposits-store.server.ts`, `recorded-deposits.ts`, `rbac.ts` and checkout verification code.
- [QNE customer reports and Receipt Voucher printing](https://support.qne.com.my/support/solutions/articles/81000412636-customer-reports-report-types-in-n3-ai-accounting).
- [WebKit iPhone/iPad web push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
