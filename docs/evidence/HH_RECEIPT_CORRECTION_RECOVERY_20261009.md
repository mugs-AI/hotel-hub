# Receipt correction recovery — 9 October 2026

Read-only inspection of the existing HotelHub application and database. No N3
financial call, database write, migration, merge or publication performed.

## Observed checkpoint

- Lovable and remote main both identify `974cb476e95d2b99c4b3236969d06719130209b5`.
  Lovable is ready, its agent has finished. Review branch remains
  `45ad0536444e12c428502f1c1f0be0b7cbac97e2`; inspected local billing tree was clean
  at `03d82df0cbe6548a2d28863d381455e55e4aa762`.
- Live receipt request OR2610/001: original 5000 cents, proposed 6500 cents,
  manual execution, approved 3 October, needs_review, version 12,
  `n3_result_mismatch`. No non-verification execution rows and no corrected
  effective version. This establishes HotelHub has not dispatched the update;
  it is not a fresh observation of today's receipt amount in N3.
- Original and proposed payment account are the same: 700-0310 MAYBANK.
  Contact fields are unchanged; receipt date is 1 October 2026.
- Pinned Lovable execution source explicitly supports manual N3 change followed
  by GET-only verification. Approval and Execute cannot update the N3 receipt.
- The parked automatic candidate has `productionUpdateContract() === null`.
  Synthetic conditional-write fixtures are not an accepted N3 contract. Existing
  parked uncommitted files were preserved.

## Fastest recovery of this existing request

Owner/accountant opens tenant 9AC-0D9-2F1 MUGS AI LAB TEST SDN. BHD. in N3,
locates the original OR2610/001 and confirms it belongs to BK260920001.
If it still shows RM50 and this was a wrong amount entry, amend the same receipt
to RM65 and its MAYBANK payment line to RM65. Preserve date, customer,
document number, HotelHub reference and contact fields. Check the current receipt
first: if already RM65, do not edit or create another receipt. If reconciled,
matched, refunded or cancelled, stop and let the accountant resolve the restriction
in N3; do not blindly remove those links.

After saving, inspect the receipt and journal: MAYBANK debit RM65 and customer
credit RM65. Then return to the existing approved HotelHub request and select
Verify N3 change. It must become Applied with a verified RM65 effective version;
a failed verification needs receipt/detail and journal evidence. Do not reapprove,
create another correction or create an extra RM15 OR for an entry correction.
An actual additional RM15 payment is a different transaction.

## Verification performed

Existing focused tests, no new test or product code:

`vitest run src/lib/__tests__/receipt-controls-store.test.ts -t 'Owner approval moves|execute never writes|exact N3 readback applies|unchanged N3 receipt'`

Result: 4 passed, 52 unselected tests skipped, exit 0. These validate manual-flow
behavior with fixtures, not live N3 mutation or the entire suite. No build run.

## Remaining work

The urgent live amount is unresolved until N3 readback verifies RM65. Automatic
correction still needs an accepted real Update contract, accounting readback,
conflict protection, bounded runtime and separately verified schema activation.
Do not activate the existing dormant candidate solely to satisfy urgency.
Booking Sources split billing is a new architectural change, described separately
in `docs/superpowers/specs/2026-10-09-source-billing-design.md`; not implemented.
