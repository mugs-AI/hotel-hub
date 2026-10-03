# Receipt Verify feedback and editing-option diagnosis

Date: 03/10/2026, Asia/Kuala_Lumpur. Upload to Project Sources: No.
Status: READ-ONLY DIAGNOSIS COMPLETED; product implementation not started.
New compact Dashboard/edit-options design remains for Owner confirmation.

## Source and observed state

Remote main and Lovable latest: 734ac405c82e653a7098ce0ef22d51586382bd9d.
Project d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76 / workspace JRQygHE7tZl2GgPN8a8N
matched, ready, agentFinished=true. Review starting HEAD:
c67b61c3b1bb26b27d841ed583af7c520f6ad3d3, worktree/index clean.
Lovable Cloud status: enabled=true, stack=supabase. Existing operational backend
and runtime remain. Published deployment 3480110d-0dd7-4ad1-8ad7-b3843ab39be5 is
established by the preceding publication record, not a fresh HTTP check here.

Both Owner screenshots were recovered through authorized upload IDs and visually
inspected. Dashboard shows Needs review, original RM50 / requested RM65 and
“N3 does not show the approved change.” Reservation shows local bill-to editing.
Guest contact data in the screenshot is not duplicated into repository evidence.

## Actual request history and cause

Project-scoped SELECT at 2026-10-03T09:27:49.429889Z was constrained to the saved
BK260920001 reservation/deposit; execution joins used its tenant and request.

| Proposal | Current state | Recorded Verify attempts |
| --- | --- | --- |
| RM50 → RM60 | Rejected, version 9 | 3 completed; all n3_result_mismatch |
| RM50 → RM65 | Needs review, version 12, manual | 5 completed; all n3_result_mismatch |

New request created 09:12:02Z, approved 09:13:29Z. Verify completed at 09:13:43Z,
09:13:57Z, 09:14:07Z, 09:17:08Z and 09:17:11Z. Effective verified versions: zero.
Owner confirmed **No, only in HotelHub**: the receipt was not saved as RM65 in N3
before Verify. The manual-completion step was missing. Approval authorizes the
proposal; it does not call N3 Update. Verify compares readback and holds mismatch
without updating financial totals. Exact upstream mismatch fields were not
captured by the coordinator in a signed-in N3 session; the stored result is not
a raw receipt/journal transcript.

Trace: ReceiptApprovalQueue → verifyReceiptControl → POST Verify → N3 evidence
reader → verifyReceiptControlResult → verifyAtomic. Checks retain identity,
amount, payment account, contact, matching and exact journal proof. Client
onSuccess clears errors/invalidates queries but gives no new per-attempt outcome
feedback. The persistent message is easy to overlook; repeated mismatches look
unchanged even though each is recorded. No coordinator Verify/write was run.

## Local billing and Owner-selected option meaning

FolioBillToCard uses the separate folio/bill-to PUT route: reservation-edit
permission, tenant scope and confirmed/checked_in stage, then local
hotel_folio_bill_to save and audit. It does not edit an N3 receipt. Receipt
approvals do not currently gate it. ReceiptControlRequestDialog separately
supports explicit saved N3 receipt contact-change proposals.

Owner selected **Allow or block editing**, not require/bypass approval.
Requested defaults: billing-contact editing OFF; existing deposit changes ON.
Billing must govern both local guest-folio edits and new receipt contact changes.
Actual hotel_settings column inspection found neither flag. Durable options need
a reviewed additive migration; do not fake columns or use browser-only flags.
Do not repurpose payment alias/visibility JSON. Keep protected hotel-store/auth
foundation unchanged via a separate policy adapter unless a specific exception
is reviewed and authorized.

## Bounded proposal for confirmation

- Existing Dashboard: complete Original → Requested comparison visible by
  default, no Review/acknowledgement checkbox. Approve last on the desktop row;
  stack on mobile. Clicking Approve records the explicit Owner decision on
  visible values. Preserve server preflight, versions, tenant/role, audit and
  one-open-request controls. Approval still does not edit N3.
- Approved requests: Open receipt in N3 using the existing immutable receipt
  deep-link pattern, then Verify N3 change. Show Checking… and fresh verified,
  mismatch, insufficient-evidence or error feedback; disable duplicate clicks
  during the call. Never mark Applied or alter totals without exact proof.
- Owner Settings: Allow billing-contact edits OFF; Allow existing deposit
  corrections ON. Billing OFF blocks local folio saves and new receipt contact
  changes, through both UI and server. Deposit OFF blocks new correction/void
  requests, not new deposit entry. ON retains all existing guards. Preserve
  saved values/history/printing and finish/reject/recovery of outstanding
  requests so disabling a feature cannot strand approved work.
- Prepare/test policy API/UI and additive migration on review. DB apply, merge
  and publishing remain separate gates. Verify tenant/role and forged-request
  denial, disabled controls, old requests, repeats, feedback and affected folio,
  checkout/monthly readers/caches.

No product code, database/data, secret, package, auth, main or public release
change occurred. Automatic N3 edit/void/replacement stays off. Journal proof,
monthly N3 dates and >100 Unavailable, Sales/Collections Unavailable and disabled
alerts remain. These repository notes require no Project Sources upload.
