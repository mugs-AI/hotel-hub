# Booking Sources and separate payer bills

9 October 2026. Written design approved by the Owner's "Approved all" at
12:41 Malaysia time; scoped implementation plan approved with the two independent
deposit-module switches at13:09. Not implemented or deployed.
Priority: resolve the existing RM50 → RM65 correction first, using its existing
request. Preserve completed billing tasks and the parked automatic candidate.

## Intended result and architectural change

The Owner requests source-specific N3 customers, collection controls, guest print
titles and descriptions, and two separate bills when an OTA owes room charges
while the guest owes extras. Commission, remittance differences and receipt
surplus remain accountant-owned in N3. This revises the previous single-customer,
single-bill checkout design and its all-bills-settled close condition.

Recommended approach: split by payer within one reservation. A single N3 document
cannot implement the requested two customer debtors. Separate reservations would
complicate room operations and duplicate stay information. Keep one stay and
durable, separately recoverable billing legs.

## Booking Sources settings

Owner-only source editing retains existing name, active flag, code and order.
Add:

| Field | Meaning |
| --- | --- |
| Room collection mode | Guest pays hotel, or source/OTA owes hotel |
| Source customer account | Verified N3 customer ID plus visible code/name, used for OTA room bill |
| Guest customer account | Verified N3 customer for guest charges; Walk-in supplies the default for guest extras |
| Guest document title | Configurable source title, e.g. Agoda Sales |
| Guest item description | Configurable room description, e.g. Accommodation booked through Agoda |
| Show room prices on guest copy | Default off for OTA-paid rooms, on for guest-paid rooms |

Walk-in/Phone/WhatsApp default to guest collection. Agoda and other sources can
default to source collection when configured that way. Source name alone never
establishes payment responsibility: Agoda Property Collect and prepaid bookings
differ, and website bookings can be guest-paid. At reservation entry confirm the
collection mode; permitted source configurations supply its default. Only Owner
can change payer/customer after stay entry, with audit and before billing freezes.

Move the Default Walk-in customer control from N3 Integration to Booking Sources.
Forward-compatible migration copies the existing mapping without deleting its
legacy value until all dependent readers support the source mapping. Existing
reservations retain their saved customer/policy; do not silently reassign them.
Missing or stale mapping prevents financial dispatch with an actionable error.

Customer debit mapping is separate from the stock/service revenue credit mapping.
Retain verified item/account/tax mapping: do not hardcode 100-0100 for every extra
charge or infer tax from the example amounts. N3 IDs are authoritative; displayed
codes alone are not sufficient API identifiers.

## Example: RM300 OTA room and RM80 guest extras

| Bill leg | Customer | Amount in N3 | Guest print | Receive payment |
| --- | --- | --- | --- | --- |
| OTA rooms | 700-A001 AGODA | RM300 under the configured price/tax basis | Agoda Sales; configured item description; room prices suppressed | Hidden and rejected server-side |
| Guest extras | 700-7001 walk-in/guest customer | RM80 under its item/tax basis | Sales Invoice; normal descriptions and prices | Available for outstanding guest amount |

Room amount is not changed to RM211.66 or zero. Accountant handles the difference
between gross room amount and source remittance in N3. Suppression affects only
the guest copy; accounting copy and N3 payload retain exact amounts and taxes.
Custom print title does not change the formal N3 document type or tax/e-Invoice
requirements. Preserve legally required invoice fields on formal documents;
use a separate guest accommodation statement when suppression is inappropriate.

Guest receipt funds cannot automatically match an OTA customer's room bill.
Existing guest deposits belong to the guest leg; leftover funds remain visible
for accountant treatment under the approved carry-forward report design.

Settings amendment13:09: Room Advance Payments and Refundable Security Deposits
have independent collection switches, allowing either/both/neither. AdvanceOff
does not disable payment of a billed guest balance or use of an existing verified
advance. SecurityOff preserves returns of already held cash. Source collection
mode remains an independent payer control; it cannot enable a disabled deposit
module or turn security cash into an OTA/customer receipt. Existing tenants keep
advanceOn/securityOff until Owner changes their policy. See the approved security
specification for the complete switch matrix.

## Document numbering and posting

Use tenant-scoped, transactionally reserved HotelHub numbers, separate sequences
for bills, receipts and refunds. Example booking BK260920001 can link bills
SI261000001 (OTA) and SI261000002 (guest), an OR sequence and a refund sequence.
Number reservation is stable through retries; no reused numbers across stays.

Store HotelHub number, N3 UUID and actual returned N3 document code separately.
Keep booking and leg identity in stable references. The inspected OpenAPI DTOs
expose docCode and runningNumberId; presence does not prove Create retains a
caller-assigned code. Require a bounded accepted N3 test for each document type
before promising identical HH/N3 numbers. If N3 assigns another code, keep and
display both instead of claiming our number was accepted. Existing OR2610/001 is
never renumbered as part of the urgent correction. Refund series introduces no
new refund creation function.

Prefer a proven Sales Invoice contract for source credit sales; reuse Post-to-AR
Cash Sale only if its accepted contract supports that payer and credit behavior.
Do not guess a document type from the guest print title.

Each leg has frozen lines, customer, collection mode, titles, amount/tax facts,
reference and its own durable dispatch attempt. If OTA creation succeeds and
guest creation fails, preserve the first bill and recover/check the second.
Timeout or unknown write outcome triggers read-only recovery; never repeat both
POSTs. Closure requires every intended leg to be proven and correctly linked.

## Checkout policy

Guest charges must be verified settled before checkout. A source-paid room bill
must be verified issued to the correct source debtor; its unpaid source receivable
may remain for accountant reconciliation. Do not mark that bill Paid or pretend
its outstanding balance is zero. This explicit source-debtor policy supersedes
the prior all-bills-settled rule only for the correctly configured source leg.
Create a durable accountant case for outstanding OTA receivables with monthly
carry-forward and historical as-at print support. Other unpaid/unverified bills
continue to block checkout. Enforce payer restrictions in server and close RPC.

## Checks and release boundaries

Verify source mapping upgrade, frozen defaults, guest/source collection variants,
wrong debtor rejection, two bills/tax totals, guest print privacy, normal extras
print, deposit customer isolation, partial dispatch recovery, duplicate actions,
guest-unpaid close rejection and outstanding OTA close/report behavior. Accepted
N3 fixtures and a bounded sandbox proof are required for new write/number contracts;
mock tests do not establish vendor support.

Reuse completed existing intent/evidence/dispatch work. Add compatible migration
and dependent readers without editing applied migrations or protected generated
files by hand. Review branch work, operational schema activation, N3 proof,
main integration and public publication remain separately verified lanes.
Prior authorization persists; this written specification needs review because it
changes the approved billing/checkout architecture, not because existing work
needs approval again. The scoped implementation plan follows that review, using
the previously selected inline execution method.

Primary payment-model source: https://partnerhub.agoda.com/how-do-i-identify-property-collect-bookings/
API snapshot inspected: `.superpowers/sdd/2026-10-08-n3-billing-settlement/current-sales-schema.json`.
