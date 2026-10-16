# HotelHub — Friday decisions, solutions and remaining roadmap

Date: 11/10/2026. Friday discussion: 09/10/2026, Malaysia time.
Upload to Project Sources: **Yes**. This is an approved-decision recap and dated
delivery checkpoint. It supplements existing product sources; it does not replace
stricter financial controls, authorize a test transaction, or claim pending work
is deployed. Effort estimates expire when scope or accepted API evidence changes.

## Friday's decisions and their implementation meaning

| Decision                                                          | HotelHub solution                                                                                                                                                                                                                         | Accounting boundary                                                                                                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two different deposit purposes                                    | Separate **room advance** and **refundable security cash** workflows.                                                                                                                                                                     | Advance is a payment against the guest bill, with an N3 OR. Security cash is held for return and does not reduce the room bill.                                                    |
| Either, both, or neither deposit module                           | Independent Owner Settings switches. Existing advance ON, new security cash OFF. Disabling collection preserves existing records, returns, verification and reports.                                                                      | Switching advance OFF does not disable receiving the guest's checkout balance.                                                                                                     |
| Deposit is not compulsory for every reservation                   | Allow a booking without an advance. A configured required security deposit at check-in needs collection or an audited Owner waiver.                                                                                                       | Do not invent an OR for money that has not been received. Phone/WhatsApp booking does not itself prove payment.                                                                    |
| Security deposit uses cash notes and a hand-receipt style process | Numbered HH security receipt; labelled envelope/storage record; room inspection; fixed full-return amount; Owner-only deductions; handover and shortage reporting.                                                                        | No automatic N3 collection/return for this selected workflow. This is property policy, not a general legal/accounting exemption. Accountants decide their independent bookkeeping. |
| Refund normally handled by accountant                             | N3 refund function OFF by default; persistent accountant exception report, with prior-month carry-forward.                                                                                                                                | Returning held security cash is a distinct operation and must remain possible. An advance can also need a refund; purpose, not the word “deposit”, determines its workflow.        |
| Receipt entry mistakes must be correctable                        | Edit the same N3 receipt identity, verify the result, and update HH's confirmed snapshot/audit.                                                                                                                                           | A genuine additional payment is a new receipt; correcting RM50 recorded for RM65 received must not create another OR or another RM15 payment.                                      |
| Booking Source determines the payer                               | Add source customer account, collection mode, guest customer, print title, room-line description and guest-copy price visibility to Booking Sources. Preserve prior mapping compatibility and freeze the selected payer on a reservation. | Agoda/website names alone do not determine who pays: prepaid/source-owes and property-collect/guest-pays are different cases.                                                      |
| Source-paid room and guest extras have different debtors          | One reservation can issue two independently tracked bill legs. Example: RM300 room to Agoda 700-A001; RM80 extras to guest 700-7001.                                                                                                      | Do not put two customer debts in one document. Use verified item/revenue/tax mappings; no universal hard-coded revenue account.                                                    |
| OTA commission reconciliation belongs to accountant               | Keep the gross room charge, such as RM300. Accountant reconciles an RM211.66 remittance in N3.                                                                                                                                            | HH does not change gross sales to the net remittance or calculate commission settlement automatically.                                                                             |
| Configurable OTA guest presentation                               | “Agoda Sales” and an admin-defined room-line description; hide source-paid room prices on the guest copy. Guest extras use the ordinary invoice title and visible prices.                                                                 | A guest display title does not change the formal N3 document type; the official accounting copy retains required values.                                                           |
| HH-controlled document references                                 | Prepare durable HH series and booking references; retain N3 UUID and returned document code separately.                                                                                                                                   | Accepting custom document codes needs a real API contract test. Never renumber existing ORs to create the appearance of compliance.                                                |
| Accountant list must still print months later                     | Durable open-as-at cases, original document dates, age, last verified facts, next action and immutable report snapshots.                                                                                                                  | Unknown balance is not zero. Carrying a case into another month is not new revenue or another receipt.                                                                             |
| Front Desk needs practical conflict guidance                      | Show the affected booking/OR and a specific N3 action, then **Check N3 result** after the accountant acts.                                                                                                                                | A timeout or ambiguous reply never authorizes a repeat financial POST.                                                                                                             |

## Why the original receipt change stalled; the practical solution

The original published OR2610/001 flow approved a **manual** request and then
verified N3. That path did not send an N3 receipt Update. Approval alone therefore
could not change RM50 to RM65. This was not proof that N3 cannot edit receipts.

The later updater now uses fresh full-document GET, preserves the parent receipt
and latest unrelated DTO fields, overlays the allowed correction, sends one Update
per durable request, and independently reads receipt details and GL afterward.
OR2610/002's real RM65 → RM50 → RM65 proof completed on 11/10; an observed
single-payment child-ID replacement was accounted for without changing the parent.
That proof does not establish N3 atomic conditional writes or editing every other
document type.

The Custom Bill Entry reference supports reusing the full-DTO update pattern.
It does not justify deleting HH storage. **Recommended: keep the current HH
updater, rather than rebuild the deposit module.** N3 remains accounting authority;
HH retains the reservation-to-receipt link, verified projection, policy/approval,
audit and uncertain-attempt state. Show stale/unknown evidence honestly.

Remaining ordinary-workflow UAT uses the already HH-created **BK260924001 /
OR2610/003 / RM70**. The user screenshots and saved read-only Cloud inspection
identify this exact fixture. No additional booking or RM50 receipt is required.
The prepared scoped lane is dormant, while normal editing remains OFF. Proposed
RM70 → RM85 → RM70 and a time window are candidate tests, not live approval.

Urgent **BK260920001 / OR2610/001** remains a separate legacy manual exception:
last saved request needs_review, n3_result_mismatch, version 12. Saved HH RM50 is
not a fresh N3 amount readback. Owner/accountant checks the same OR, amends if
required, then uses HH **Verify N3 change**. Do not duplicate or convert it to
security cash, and do not upgrade that request into automatic execution.

## Status: Friday source completion versus today's live product

- Security cash and the two deposit switches were source-complete and tested on
  the existing billing review branch on Friday. Saved checkpoint: 2,349 passed,
  20 skipped; typecheck/build passed. Native multi-session cash checks and signed-in
  mobile/printing were still pending. These are historical results on a different
  branch, not today's receipt-suite count or proof of live cash activation.
- Security cash review source must be integrated additively with current main.
  Prepared cash/control migrations were not applied at that Friday checkpoint;
  verify actual history before any later application. Do not rebuild this module.
- Booking-source billing and accountant handover designs/plans were approved;
  their final integrations are not completed merely because the plans exist.
- Billing foundation already has snapshot, durable dispatch, freeze, proof and
  coordinator work. Current-master adapters, accepted live posting/settlement,
  reporting and close integration remain. Do not restart the foundation.
- Current live receipt UI release: PR9/main
  6ac17dee7b503b96daf89015afdc9fb3995e1b68. Source-only test preparation after this
  release is not published. BEC and access-card hardware remain separate packages.

## Remaining roadmap and effort

Estimates are focused engineering/testing hours, **not elapsed builder time or
guaranteed dates**. They exclude waiting for Owner live UAT, vendor contracts,
hardware and release coordination. Each packet includes implementation/verification
where applicable; completed source is reused. Unknown API behavior can add time.

| Order | Remaining package                                                                                                                             | Estimated effort                    | Completion evidence                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Finish/review dormant receipt gate, release the exact approved fixture packet, ordinary Owner/Front Desk UAT and original exception follow-up | 2–4 hours                           | Same OR readback, correct HH projection, denied other receipts, safe interrupted recovery. Normal editing remains OFF until separately accepted. |
| 2     | Integrate existing security cash and switches; native concurrency/schema validation; mobile receipt/return/handover UAT                       | 6–10 hours                          | Existing cash preserved; inspection/return/shortage/race cases, correct drawer and report totals.                                                |
| 3     | Booking Sources payer settings, split bill legs, guest print rules and document references                                                    | 8–14 hours                          | Walk-in/property-collect/OTA cases, correct customer per bill, correct room/extras print, partial success recovery.                              |
| 4     | Finish production billing adapters, verified posting and balance receipt, safe settlement/checkout, required bill correction contracts        | 12–20 hours                         | Guest bill settled before close; legitimate source receivable carried forward; same-document correction proven separately by type.               |
| 5     | Accountant review list, monthly/as-at carry-forward and print/export                                                                          | 4–6 hours                           | Old cases visible next month, unknown values labelled, no double counting, historical statement retained.                                        |
| 6     | Access card hardware integration and physical UAT                                                                                             | 8–16 hours after working kit/SDK    | Real issue/read/write, room change/extend/checkout and old-card behavior. Hardware availability/protocol is an unresolved dependency.            |
| 7     | BEC commercial bridge and room-lot controls                                                                                                   | 4–8 hours after BEC contract/access | Default 30-room lots, configured limits, tenant/permission behavior and bridge validation. BEC is commercial control, not only room operations.  |
| 8     | Integrated regression, client setup, training instructions and hands-on UAT fixes                                                             | 8–12 hours                          | Two-session booking/deposit/billing/cash/room readiness plus real mobile and printer cases.                                                      |

Total: **52–90 focused hours**, plus **8–16 hours defect buffer**. Required
guest/finance/cash/report/UAT work excluding hardware and BEC: **40–66 hours**,
plus the buffer. Do not turn this estimate into a claim that all packages can be
delivered automatically in nine calendar days.

Target hands-on UAT/training: **20/10/2026**. Client launch: **01/11/2026**.
Suggested sequencing, conditional on accepted evidence:

1. 12/10: finish receipt UAT preparation; integrate existing security cash source.
2. 13–16/10: source billing, production settlement/checkout and accountant reports.
3. 17–19/10: integrated two-device/mobile/printer verification, defect correction
   and freeze a known client training candidate. Card/BEC work can finish here only
   when their dependencies are ready and it does not displace financial acceptance.
4. 20/10: hands-on client UAT/training using the verified candidate. Report any
   unaccepted package explicitly; do not silently remove approved requirements.
5. 21–31/10: resolve UAT defects, complete conditional integrations and verify
   release readiness for 01/11. These dates are a target schedule, not a promise.

For settlement concurrency, read/merge/write plus a post-read is **not** atomic
conflict prevention. Until an accepted server-side stale-write contract exists,
use accountant **Match in N3 → Check N3 result**. A verified source-paid room bill
can retain an OTA receivable; guest-paid bill legs still need verified zero
outstanding before checkout. Keep automated matching gated, not rebuilt.

## What the Owner needs to do now

1. Keep BK260924001 / OR2610/003 at RM70. Do not repeat the OR2610/002 test.
2. Do not activate normal editing or edit the test receipt in N3 while the exact
   ordinary-workflow test packet is being prepared.
3. Upload this MD to HH Project Sources: **Yes**. It records Friday's decisions,
   subsequent solution and dated remaining roadmap; upload is not automatic.
4. For the original urgent OR2610/001, use its separate Owner/accountant manual
   verification path. Do not use OR2610/003 as evidence that OR2610/001 is resolved.

Source anchors: hh-billing/docs/superpowers/specs/2026-10-09-security-deposit-design.md;
2026-10-09-source-billing-design.md; 2026-10-08-n3-accountant-handover-design.md;
hh-billing/docs/evidence/HH_SECURITY_CASH_PUSH_20261009.md;
hh-review/docs/HH_NORMAL_RECEIPT_UAT_PREPARATION_20261011.md. Folder names are existing
local worktrees of mugs-AI/hotel-hub, not newly created products.
