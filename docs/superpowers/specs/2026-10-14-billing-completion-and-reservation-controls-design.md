# HotelHub billing completion and reservation controls

Date: 14/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: **No** — approved design and engineering scope.
Status: approved by the user on 14/10/2026. Bounded reservation controls have source implementation; billing/no-show architectural extension awaits execution-plan review. No release is claimed.

## Intent and continuity

Complete the existing billing module before door access: an authorised Front Desk
user confirms the final folio, HH posts the correct N3 bill, records actual payment,
verifies settlement and completes checkout. Each open reservation has independent
action state. Make Change rate optional, simplify information buttons, and prevent
check-in against an expired stay.

The 08/10 billing, 09/10 separate-payer and accountant plans remain the foundation.
Reuse their durable intents, dispatch fences, money/proof helpers, split bill legs,
saved-document checker and immutable accountant cases. The new request extends
billing beyond the earlier Owner-only writer. The 12/10 staff amendment covered
deposits only; it does not silently enable billing through existing code.

Observed on 13/10 UTC: GitHub main and Lovable latest both
`ce4c12d028df33894499b718f162468eb9d638b2`, published project ready.
Preserved broad review source is local `d19ace3cb0fa9226a74825d83d108d231348607b`.
They have different product content. Later implementation must integrate the
already released staff-deposit and payment-account fixes without replacing the
unfinished billing source or removing its settlement fences.

Keep the existing Lovable-managed backend and N3-only identity. No separate
Supabase account, new application dependencies, Lovable AI Build or door API.
Protected files and pushed history remain governed by MDB-01.

## Findings, with evidence boundaries

| Area              | Observed root cause or missing integration                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reservation tabs  | `WorkTabs` navigates one route outlet. Unkeyed `Detail`/`ReservationActionsCard` keep ordinary component state while the reservation ID changes. The action form follows the tab; submitting uses the newly selected booking's URL. No cross-booking database write was established. |
| Expired check-in  | Both installed check-in RPC overloads enforce early-arrival rules but contain no departure-date upper bound. SELECT-only inspection found no dedicated no-show function.                                                                                                             |
| Information icons | The shared `CardInfoPopover` trigger adds a white circular fill and an outer border.                                                                                                                                                                                                 |
| Rate approval     | One existing property-wide reservation exception policy applies to all five operations. Owner applies directly; Front Desk follows Owner approval or direct mode. There is no rate-only enable flag.                                                                                 |
| Live billing      | Folio is preparation-only. The broad source has durable foundations, but `liveSettlementDeps.snapshot` remains unavailable, financial contract gates are closed and source whole-stay `canClose` remains false.                                                                      |
| Backend           | SELECT-only inspection found none of the proposed settlement, billing-leg, accountant or security-cash tables. The staff-receipt migration is present. New files are not evidence that billing schema is installed.                                                                  |

No test result is claimed by these observations. Existing historical test counts
remain attributable to their own commits. No operational record, N3 document,
schema, runtime secret or public release was changed during this investigation.

## 1. Independent reservation state

Retain an action draft per explicit `reservation:{immutable ID}` workspace key,
using the existing `useWorkspaceDraft` mechanism. Store action type, date/time,
reason, selected room and new rate together. Key transient child components by
reservation ID so pending mutation state, errors and confirmation cannot follow a
different reservation. Scope pending-approval notes and timeline state as well.

Switching A → B → C → A restores A's own draft. Cancelling B clears only B.
Closing a tab discards its draft. No storage schema is needed. A callback started
for A updates A's captured identity; it cannot reset or submit B's draft.

## 2. Action meanings and rate controls

**Late checkout:** set a later departure time on the same saved departure day,
in property time. It does not add an overnight stay. Existing server validation
requires a time later than standard checkout. A fee is a separate explicit,
properly mapped folio charge; the button is not evidence of an N3 charge.

**Extend stay:** move departure to a later date, subject to room availability.
Additional nights are prepared by the existing folio calculator, with no duplicate
nights. Availability, folio refresh and stale revision errors remain visible.

**Change rate:** change the selected reservation room's agreed nightly rate with
a reason. The existing operation approval policy continues to apply. Add an
Owner-only **Enable Change rate** setting, default ON to preserve current behavior.
OFF hides the button and denies new rate-change requests and application of pending
rate changes at the server. Existing requests/history remain visible; Owner can
reject them. This setting does not change other operation approval rules.

After financial freeze/posting, stay/rate changes follow existing billing fences
and an approved adjustment process. A rate edit does not silently rewrite a posted
bill or historical captured room-night prices.

## 3. Information buttons

Remove the background and outer border from every shared information trigger.
Keep its touch target, accessible name, keyboard operation and focus indicator.
Use a readable light icon on dark/gradient headers and teal on light cards.
The help popover itself retains its readable panel background.

## 4. Expired stays and no-shows

There is no universal midnight cancellation rule. Oracle's PMS documentation
provides configurable end-of-day no-show processing and rolling-arrival policies.
Cancellation can release room inventory while deposit treatment remains separate.
These are examples of hotel-system behavior, not a Malaysian legal requirement or
proof of HH's current behavior.

Proposed initial policy:

- Block new standard and early check-in when the property's current date is on
  or after departure. Early-check-in authorisation does not bypass this limit.
  Return **Stay dates have expired. Update the booking dates and check room
  availability before check-in.** Validate both installed RPC overloads in the locked SQL transition as well
  as the server/UI. Preserve replay of an already completed check-in.
- A confirmed booking whose arrival is overdue appears for arrival review.
  Front Desk can use **Mark no-show and release rooms**, with reason and explicit
  confirmation, only after the arrival day has passed. The transaction locks the
  booking, checks revision/status, records the event and releases only that
  booking's reserved allocations. Checked-in/occupied stays are ineligible.
- Keep room condition independent: an unused room is not automatically marked
  Dirty or Ready. Actual occupancy/readiness and competing allocations still
  determine availability.
- Keep deposits, OR identities and audit history. Create the appropriate
  accountant exception for unallocated advance/refund review. No automatic N3
  fee, refund, void or receipt deletion follows a no-show action.
- Correct a late arrival's dates and availability explicitly before checking in.
  Already checked-in historical fixtures require operational review; this package
  does not bulk-cancel them or release occupied rooms.

Automatic no-show processing remains OFF and is a separate optional property
policy to configure after the manual transition is accepted. It requires a real
night-audit cutoff, late-arrival hold/exemption, scheduler, duplicate-run protection
and reviewed catch-up scope. This design does not choose a cutoff or retrospectively
cancel every old booking. The manual path provides the initial room-release action.

## 5. Confirmed folio, billing and actual payment

Use the existing service/store/evidence boundaries. Mount the approved source
settings, pre-freeze payer attribution and separate leg coordinator through scoped
HTTP/client/UI adapters. The frontend submits identities and revision/confirmation;
the server derives customer, lines, tax, amount, date and reference.

| Front Desk step                | Required saved result and next action                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Review and confirm final folio | Show all charges, taxes and payer breakdown; freeze the exact revision. Confirmation initiates one durable post per bill leg. Opening, refreshing or printing never posts.                             |
| Post and verify N3 bill        | Preserve returned N3 UUID/code separately from HH number. Verify detail and GL. Show Posted only after proof; otherwise show saved-attempt recovery.                                                   |
| Apply eligible advance         | Use only verified ORs linked to this booking and the correct customer leg. Display verified applied amount and remaining guest balance.                                                                |
| Enter actual payment           | Select eligible bank/cash account(s), enter received amount(s), review total and confirm actual receipt. Amounts must equal the freshly proven positive guest balance in this first checkout vertical. |
| Post and verify receipt        | Create one durable N3 OR for that actual payment, verify all bank/cash debits and the customer credit, then verify matching to the correct bill. A bill post itself does not prove cash received.      |
| Print and complete checkout    | Fresh proof of every guest bill's zero outstanding permits one fenced local close; release all occupied allocations, clear DND and mark vacated rooms Dirty for housekeeping.                          |

Support one method and the previously approved split-method receipt UI/intent
contract. Split lines are positive and sum exactly to the receipt total; immutable
account IDs are freshly verified. Its distinct N3 Create/readback contract must be
accepted before its writer activates. Partial payment and overpayment are outside
the earlier first-vertical acceptance scope; the UI must explain the required
remaining amount rather than discard or fabricate actual payment.

For source/OTA collection, post the gross room bill to the configured source
customer, and guest extras to the guest customer. Front Desk receive-payment is
hidden and denied for the source leg. The guest bill must be settled; a verified
issued source receivable may remain with an immutable accountant case. Commission
and source remittance reconciliation remain accountant-owned. Guest price hiding
and custom titles do not change the formal N3 document type or accounting copy.

Front Desk performs ordinary bill/payment/checkout actions in HH using their own
authenticated N3 identity and permitted N3 operations. Expand every relevant
RBAC, HTTP, transport, claim/prove and close boundary consistently. Housekeeper is
denied. Owner-only Settings, approval, payer overrides, financial adjustments,
refund policy and accountant reports remain Owner-only. No Owner token delegation.

Exceptions show the exact saved booking/document and next action. Ordinary success
refreshes reservation, folio, checkout, departures and housekeeping readers from
confirmed facts. Financial reports remain unavailable where complete authoritative
N3 period reads are unproven; an allocation is not another receipt or sale.

## N3 proof and matching boundary

The fixed public API still provides CashSales Create with `isPostToAR`, ARReceipts
Create, document/GL reads and UpdateCustomerKnockoff. The schema response retrieved
13/10 UTC hashed `d9375f8fac7af01fe5f6fc8828ab948f433151bf1d48a610df10c00077404143`.
Static DTOs do not prove current committed GL, source-credit behavior or write
concurrency. Existing journal captures/checker work is preserved and not repeated.

Complete current master/mapping adapters and accept the specific bill, balance
receipt, split-payment and CashSale-to-INV relationships. The documented existing
receipt allocation DTO has no accepted conditional-write mechanism. Automatic
matching remains closed until N3-side concurrent/stale-write safety is established.
An HH mutex and a successful post-read cannot prevent an external N3 stale write.

The approved interim exception route is accountant **Match in N3 → Check N3
result**. Integrate its privately bound evidence with settlement and whole-stay
close; the current coordinator rejects otherwise unowned external allocations.
This fallback is explicit, not a claim that fully automatic Front Desk settlement
is ready. The release packet must identify unresolved vendor proof and acceptance
as blockers. Never enable a writer merely to remove an unavailable message.

Each unknown dispatched result persists and prevents automatic reposting. Recovery
uses saved identities and accepted exact-reference lookup only; no-match is not
proof that creation failed. A 401 ends the session and stops subsequent operations.

## Acceptance and release

| Boundary         | Evidence required                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tabs             | Mounted A/B/C round-trip with independent drafts, cancellation, pending result and correct submission URL; closing one tab clears only its draft.                                                                  |
| Controls         | Owner/Front Desk approval/direct behavior; Change rate disabled in UI and forged route; transparent icons readable on header/card and keyboard accessible.                                                         |
| Dates/no-show    | Property midnight, departure-day limit, early override refusal, already-completed replay, stale/alien booking, concurrent check-in/no-show, occupied-room denial, linked deposits retained.                        |
| Billing          | Guest/source payer and master validation, confirmation versus read/print, exact taxes/cents, frozen input and two-leg partial recovery, duplicate clicks/devices and unknown POST recovery.                        |
| Payment          | Positive full-balance single/split entry, sum/account/currency validation, source-leg denial, own N3 role, detail/GL proof and no optimistic totals.                                                               |
| Settlement/close | Exact external-match proof, guest unpaid refusal, linked surplus/source cases, fresh revision fences, two close calls, all-room rollback and Dirty/DND handoff.                                                    |
| Reports/print    | Source guest privacy, actual document identities, immutable historical statements, carry-forward, unavailable amounts and CSV formula escaping.                                                                    |
| Release          | Exact candidate/tree and protected blobs; relevant regression/full tests, types/lint/build, disposable native PostgreSQL concurrency; separately accepted backend, N3 and signed-in browser/mobile/print evidence. |

Implementation continues through the already selected inline DirectBuild method.
This written extension requires design review before new implementation. Existing
approved plans are reused, with the new role/confirmation/control delta reconciled
at the planning stage. No approvals for old deposit work are being requested again.
Code review/push, main merge/sync, SQL installation, runtime activation, financial
proof transactions and public publication remain separate MDB-01 lanes.

## Research references and self-review

- Oracle: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_endofday_procedures.htm
- Cancellation/inventory/deposit separation: https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.1/ocsuh/t_managing_reservation_cancellation.htm
- Reinstatement/dates/availability: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.1/ocsuh/t_managing_reservations_reinstating_no_show_reservations.htm
- N3 official API: https://openapi.account.qne.cloud/doc/index.html and https://openapi.account.qne.cloud/doc/sales-v1.json
- Existing repository: 08/10 settlement design/plan, 09/10 source-billing and
  accountant design/plans, saved-document and staff-deposit checkpoints.

Self-review: proposed behavior is separated from observed/live state; no historical
test count or financial proof is promoted. Initial manual no-show policy has no
arbitrary midnight job. Existing checked-in bookings and receipts are protected.
Rate enable and approval are independent. Source-issued/guest-settled close and
Front Desk own-identity requirements are explicit. Unproven N3 behavior has a
closed-gate outcome. Door access remains the next package.
