# Owner live receipt acceptance and Late Checkout diagnosis

Date: 03/10/2026. Upload to Project Sources: No.
Status: READ-ONLY DIAGNOSIS; product code unchanged in this continuation.
Review branch: review/hh-receipt-diagnostic-20261002.
Input review: 0d388ee5be369656ebfdb1ec29c33b123fff4e44.
Fresh remote main and Lovable latest: af6c47732dd79a2f944b34576b48abc53783e703.
Main tree: face85a1a4cdb3c657445e148f0342efb4efd201.
Project/workspace match existing locked identity; Lovable reports ready.
Cloud database enabled, stack supabase. No separate Supabase login used.
Receipt migrations 20261002053219 and 20261002053302 freshly present; not reapplied.
Prior release deployment 65124126-ce79-41bb-855b-27f9ef12a969 remains the last
recorded serving proof; public deployment was not rechecked in this continuation.

## Owner evidence and actual backend state

All eight Owner attachments were recovered and viewed. The 052516/052542/052631
screenshots show the request created and pending; 053418 shows "Approved — complete
in N3"; 053448 shows the N3 receipt/journal still MYR50; 053558/053722 show Monthly
Finance and Prepare Checkout MYR50. These are Owner actions, not coordinator actions.

A scoped read-only SQL SELECT confirmed BK260920001 / OR2610/001:

- Deposit: posted MYR50.00, unchanged since 01/10/2026.
- Request 59014639-39ef-46b6-a0c2-6e8329b0e70b: original 5000 / proposed 6000 cents,
  reason "guest request", manual mode, approved_awaiting_n3, version 2.
- Owner self-approval audited 03/10/2026 05:33:54.6141 UTC, outcome approved_manual.
- Executions: 0; verified receipt versions: 0.
- Reservation checked_in, arrival 20/09/2026, departure 25/09/2026;
  expected_check_out_at NULL; no saved Late Checkout requests.

This newer request reason differs from the earlier failed "guest no small notes"
attempt. Request creation and approval now have live Owner acceptance evidence.
Manual N3 completion and successful Verify remain pending; full financial correction
acceptance/P1 is not closed.

Approval authorizes a proposal; it is not a financial posting.
receiptControlCapabilities is directEdit:false, voidReplace:false, manual:true.
The approved manual workflow is recorded in HH_RECEIPT_CONTROL_N3_CONTRACT.md.
Therefore N3, deposits, Monthly Finance and Prepare Checkout correctly remain RM50.
There is no evidence for updating any of them to RM60 before actual N3 change plus
exact verification. Do not patch totals or introduce an automatic N3 Update call.

Sanitized SQL observation is stored next to this note as
HH_OWNER_RECEIPT_STATE_20261003.json. No guest/contact/token data is included.

## Late Checkout diagnosis

Screenshot052957 selects native datetime 10/03/2026 01:28PM (3 October 2026),
while the saved departure date is 25 September 2026. The action is offered for
confirmed/checked_in stages, so the still-checked-in reservation is not terminal.

Source trace:

- ReservationOperations opens the flow with detail empty; there is no default
  populated by HotelHub. datetime-local is unrestricted by departure date and its
  native browser date picker can suggest today's date. Do not claim the app
  automatically saved today's time.
- POST operations validates property-local time against the reservation departure
  date and standard checkout, before operation persistence.
- validateLateCheckoutWindow rejects a different date as late_checkout_out_of_range
  (HTTP 400); an early/equal time is late_checkout_not_later.
- opFetch preserves API error strings. operationErrorMessage has neither of these
  mappings, so either refusal displays the observed generic retry message.
- No Late Checkout request or expected-checkout timestamp was saved for this booking.

The chosen date violates a confirmed rule and the missing message is a confirmed
UI defect. The screenshot does not expose the exact HTTP response; no signed-in
live response/log was captured, so do not exclude an additional server failure
solely from the screenshot. No live POST was sent to reproduce it.

Late Checkout changes a time on the existing departure day. A real additional-day
stay uses Extend Stay and its availability/folio controls. Changing the date rule
would hide additional room nights and is outside a UI fix. No date, stay extension,
charge or financial action was performed.

## Dependency review

Receipt invalidateReceiptEffects already covers receipts, deposits, folio,
reservations, departures, checkout-preview and financial-reporting. Approval
invalidates reads but cannot make an unposted proposal effective.

Operation useInvalidateReservation refreshes operations, timeline, reservations
(including the actual tenant-scoped detail key through the broad prefix) and
reservation-calendar. It does not explicitly invalidate departures, checkout-preview
or folio. A mounted checkout disables focus refetch. These are dependencies to
cover in the bounded operation candidate, not the cause of the current valid50.

Stable cross-workflow guidance is in HH_CHANGE_IMPACT_MAP.md and linked from README
and DirectBuild governance. It strengthens source-based engineering continuity;
it changes no product or financial approval boundary.

## Checks and next action

Existing focused Vitest run: four files, 36 passed, 0 failed, exit 0:
run-5d2-3-checkin, run-5d2-2-operations, wp1-ops-ux,
hh-golive-01i-uat-corrections. They establish current timezone/date rules and
existing operation UX; they do not constitute tests of an unimplemented fix.
No full suite/build repeated for this documentation-only continuation.

Bounded design to present in chat: compact time/reason row (stack on narrow screens),
fixed displayed departure date with a time input resolved in property timezone,
specific refusals and Extend Stay guidance, truthful manual receipt approval
instructions, plus refresh/tests for affected operation readers. Preserve server
validation, approval policy and all frozen financial behavior. Implementation
requires approval of this newly presented bounded design; prior financial release
approvals do not approve new artifacts or side effects.
