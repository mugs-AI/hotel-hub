# Owner receipt edit proof tool

Dormant test capability under Settings → N3 Financial Verification. The existing
inquiry remains read-only; the separate test panel can update one designated OR.

No active package is shipped. A reviewed server-owned package must identify the
non-production company, immutable receipt/customer/account IDs, document/date/
reference, exact before/after cents, source reference, expiry and measured runtime
budget. The browser cannot supply financial payloads, account changes or arbitrary
endpoints. Receipts linked to HotelHub bookings are refused.

Prepare reads current receipt and exact journal, validates identity and eligible
unmatched status, and stores a service-only permit bound to the payload hash and
Owner. It sends no N3 write. Run reserves the permit atomically, refreshes Owner
permission, calls the existing bounded same-receipt Update adapter once and reads
back the same receipt and journal. Only verified readback is reported as verified.

An unknown/lost/late outcome keeps the permit held. Check performs GET evidence
only; it never repeats Update. Reload reads authoritative permit status: prepared
permits retain an explicit Run action, while reserved/unknown permits expose Check.
Only a verified terminal test permits selecting the next approved test.

The report excludes tokens, raw contact and payment payloads. reservationCount
counts a durable claim, not proof of an actual upstream POST. conditionalWrite is
always not_proven: balanced/readback evidence does not prove upstream atomic CAS.
A recovery duration is the duration of that operation, not hosting-budget proof.
Proof configuration never activates production automation.

The proof ledger is included only in the existing unapplied migration candidate.
Code review/push is separate from Cloud schema apply, runtime deployment, test
package designation, Owner N3 execution and production activation/public release.
All live test outcomes remain NOT RUN until independently captured.
