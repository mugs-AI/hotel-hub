# Refundable security cash custody

09/10/2026, Asia/Kuala_Lumpur. Upload to Project Sources: **No** — engineering
specification, not a released policy. Owner approved the in-chat workflow at
12:41 and the written specification with independent module switches at13:09
Malaysia time. No code, schema, N3 write or public activation is claimed.

## Goal and scope

For the small Malaysian hotel, distinguish Room Advance Payment, which follows
the existing N3 receipt/settlement flow, from Refundable Security Deposit, which
is guest cash held at reception. A room advance may itself be refundable: purpose,
not the word refundable, determines the record type.

Create a separate optional cash-custody workflow with numbered receipt, secure
storage, return acknowledgment, shift reconciliation and long-lived exception
report. HotelHub does not automatically POST these collections or returns to N3.
The accountant receives reports and decides the appropriate bookkeeping in N3.
Cash custody is not room income, an AR receipt, a receipt available for knock-off,
or an accounting exemption. Do not change the disputed OR2610/001 RM50→RM65 into
a security record or alter any existing N3 receipt.

Cash-only is the selected property policy. Research supports it as a practice at
some Malaysian hotels, not as a universal legal rule. HASiL's refundable-deposit
e-Invoice treatment does not eliminate accounting/source-document records.

## Independent module switches — Owner-approved amendment13:09

Settings → Deposits has two independent booleans: `roomAdvanceEnabled` and
`securityDepositEnabled`. They are not a radio selector and not one shared
deposit/refund toggle. Owner/Admin may enable Room Advance Payments only,
Refundable Security Deposits only, both, or neither when no deposit is required.

| Room Advance | Security Deposit | New collections permitted |
| --- | --- | --- |
| On | Off | N3 room advance only |
| Off | On | Local refundable security cash only |
| On | On | Both, in separate cards/receipts/ledgers |
| Off | Off | No new advance/security collection |

Existing tenants default to advanceOn/securityOff to preserve their current N3
payment behavior. Security may be enabled after its custody workflow is installed;
a switch cannot override missing schema or an unaccepted financial capability.
Disabling either stops new collections in that module, not its existing records,
returns, accounting reports or read-only recovery. Existing N3 advances can still
be verified/matched to a guest bill; security holdings can still be returned.
Never permit a fresh collect action by calling a hidden endpoint directly.

Room Advance Payments Off does not disable ordinary checkout payment of a billed
guest balance. Security-only mode does not use the security cash as that payment.
The N3 refund option and both collection switches are separate controls. Enabling
security cash returns never enables an N3 refund writer.

## Settings and roles

- Security module default off for existing tenants. Enabling does not reclassify old money.
- Default amount RM50 per room per stay, Owner-configurable in safe positive cents.
  This is a selected starting policy, not an industry or statutory rate.
- Accepted method: Malaysian cash notes. No card/bank selection or invented cash
  receipt for a transfer. An incorrectly collected noncash deposit becomes an
  Owner exception with its actual payment evidence, not a normal cash holding.
- No automatic use towards bills. The setting remains disabled in this phase;
  future conversion to bill payment needs a separately accepted workflow.
- Owner and Front Desk may collect, print/reprint and return the full currently
  held amount. Owner controls settings, waivers, corrections and deductions.
- Housekeeping can provide room/key inspection facts through its permitted role;
  it cannot change money. Do not introduce local user accounts or bypass N3 access.
- The existing N3 refund option does not disable Return Security Cash. They are
  different operations with visibly different labels and records.

## Check-in and physical storage

Disclose the amount, cash-only policy, inspection conditions and return procedure
before arrival, including on applicable OTA booking policies. Collection is not
required to create a reservation. A required security policy needs collection or
an audited Owner waiver before check-in; Front Desk cannot silently waive it.

Count notes with the payer. Record tenant, reservation and room-stay identity,
actual payer/authorized return recipient, amount/currency, receipt number, staff,
Malaysia timestamp and envelope/storage reference. Room number is a display
snapshot; do not use it as the permanent identity when rooms change.

One room holding per room-stay permits a multi-room reservation to release and
return individual holdings without ambiguity. Show the combined booking total,
but do not duplicate a single holding for every guest. A room change moves the
link/display and records an event; it creates no second collection.

Reserve a tenant-scoped security series such as SD261000001 atomically with the
record. A repeated collection request with the same key/body returns the same
record; a different body with that key is a conflict. No record deletion or
number reuse. Give the guest a receipt titled Security Deposit Receipt with
"Refundable security deposit — held separately from room payment", hotel/contact,
booking/rooms, cash amount, payer, terms and collection time. It is not an N3 OR
or an imitation validated e-Invoice. Reprints show Copy and retain the number.

Place labelled envelopes in a locked compartment separate from sales and petty
cash. A receipt clipped to notes is compatible with this procedure, but the
HotelHub record is the audit source. Never spend the held cash or silently lend
it to another drawer. Record storage changes and signed handover.

## Return, inspection and exceptions

Departure inspection checks damages, missing items and keys separately from
post-departure housekeeping Ready status. Full return requires a clear check,
or an Owner-authorized inspection waiver with reason. Settle guest bills through
their existing verified path; security cash never reduces that outstanding amount.

Return Security Cash loads the remaining holding from the server; Front Desk
cannot type a smaller amount or choose a different payment method. Show the
receipt/room/payer and cash amount before confirmation. Check recipient authority
and record guest acknowledgment and returning staff/time.

Physical handover needs two steps: reserve a unique return operation, then record
cash handed over with acknowledgment. A second user cannot reserve/finish another
return. An interrupted reserved return stays pending confirmation; it cannot be
automatically retried or marked returned by time expiry. Owner inspects the paper
acknowledgment and cash count to complete or release an unperformed reservation.
Releasing requires an audited reason and fences the old operation version.

Owner deductions require itemized reason, supporting evidence, disclosed terms,
guest acknowledgment or explicit dispute status. Refund the undisputed balance;
retain a separately identified disputed amount/case. A deduction is not silently
posted as income. If cash moves to the hotel cash drawer, record the actual
approved movement separately and link the accountant's charge/document reference
when available; no N3 financial POST occurs in this module.

If a receipt is lost, verify the saved record and recipient identity; do not
collect again or automatically forfeit. Record Owner approval for an exception.
If the guest leaves before return, preserve the cash, recipient and open case.
No automatic month-end forfeiture. Bank-return exceptions are accountant-owned
and evidence-backed; this phase does not build a cashless refund writer.

Normal checkout includes cash return. An Owner may close hotel operations with
a documented unresolved security case when the guest has left or the amount is
disputed. This does not bypass unpaid/unverified guest-bill gates, mark the cash
returned or erase the case. Closed room-stay records remain linked for follow-up.

## Immutable events and cash reconciliation

Separate service-side tables store policy, holdings, money events, return
operations, exceptions and shift statements. Composite tenant/reservation/room
keys, version-fenced operations, safe cents and immutable events apply. Browser
inputs never establish tenant, staff or authorization. Financial events are not
subject to housekeeping's 30-day purge.

Held balance derives from events, not an editable textbox. Corrections require
Owner, reason, actual cash count and an additive adjustment event; preserve the
original receipt and all later balances. No negative holding or over-return.

Keep physical cash held and cash eligible for return distinct. Example: RM50 cash
with approved RM20 deduction, not yet moved, means physical held50, guest-returnable30
and deduction pending disposition20. Returning30 leaves physical20 pending its
approved actual transfer. Never subtract the deduction twice or treat approval
alone as physical money movement.

At each shift change two staff count envelopes and sign a statement. If only one
person is on duty, record single-person count explicitly as awaiting Owner review;
do not invent a second signer. A shortage/surplus is an exception, not a balancing
entry. Owner reconciles it without rewriting earlier statements.

Expected closing held cash = opening held cash + actual collections − cash
returns − approved actual transfers. Storage transfers within security custody
change location only, not the property total. An approved deduction still in its
envelope remains physically held and separately marked pending disposition;
deduction approval alone does not decrease physical cash.

## Reports and UI

Reservation shows separate cards/actions for Room Payments and Security Deposit.
Checkout shows room settlement and security return independently. Hide new collect
actions when the corresponding module is off; retain actions for existing holdings.
Do not show N3 Print/Verify for these
local receipts. Existing N3 financial totals remain unchanged.

Front Desk sees permitted booking/shift custody work; Owner sees property-wide
cash held, returns, deductions, unresolved cases and reconciliation/export.
Reports include as-at time, beginning balance, individual receipts/rooms/payers,
movements, counted cash, variance, signers and status. Open cases carry forward
across months and stay closure; historical statements are immutable. Printing a
report neither returns cash nor resolves a case. Do not expose unnecessary ID
numbers/contact data on the report or store new identity-document images.

## Acceptance and boundaries

Verify all four module-switch combinations and module-off compatibility; no N3 calls on any security action; cash-only
validation; duplicate collection/return; wrong tenant/role/recipient; room changes;
multi-room release; lost receipt; Owner deduction/waiver; interrupted physical
return; correction history; two/single-person shift handover; shortages; month
carry-forward and immutable as-at reports; no inclusion in sales/AR matching;
independent N3 refund setting; disabling collection preserves existing return,
matching/recovery and checkout-balance payment; mobile receipt/checkout layout and printing.

Reuse the approved accountant-report presentation patterns, keeping security
cash facts distinct from uncertain N3 receipt balances. Preserve all existing
worktrees and protected files. Local code/migration preparation, operational
application and public release remain separately verified. Implementation plan
follows review of this written specification using the preserved native method.

## Research supporting the selected workflow

- Z Hotel cash deposit: https://www.zhotel.my/index.php/doc/cash-deposit
- Crest Wave policy: https://www.crestwavehotels.com/hotel-policies-house-rules
- French Hotel Ipoh policy (cash/card variation): https://frenchhotel.com.my/Policies.pdf
- HASiL General FAQ, questions54/57: https://www.hasil.gov.my/wp-content/uploads/lhdnm-e-invoice-general-faqs.pdf
- HASiL sufficient records: https://lampiran2.hasil.gov.my/pdf/pdfam/PR4_2000_Rev.pdf

Public guest policies do not establish the hotels' private envelope/drawer SOP.
The custody, handover and confirmation controls above are our proposed design.
