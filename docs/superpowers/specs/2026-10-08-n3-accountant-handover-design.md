# HotelHub accountant handover and N3 recovery proposal

Date: 08/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: **No** — proposed design; not an installed product policy.
Status: **written design approved by the Owner on 09/10/2026; scoped implementation
plan pending review. No production behavior or financial activation change is claimed**.
Scope: revised receipt surplus/refund handover, persistent accountant exception
list, read-only verification and actionable N3 recovery. Preserve the existing
billing work and its durable dispatch/proof/close foundations.

## Intent and the Owner's selected checkout rule

The Owner requested different tests of the Gemini proposals, including a small
in-app diagnostic; refunds/remaining receipt credit should be handled by the N3
accountant, with a list printable across subsequent months; HotelHub should
explain receipt conflicts and direct an Owner/accountant to the relevant N3 action.
When offered the two checkout policies, the Owner selected **Bill settled first**.

Consequently, the guest's bill must have fresh, scoped, verified zero outstanding
before checkout. A separate remaining credit/refund-review case can stay open for
accounting after the hotel stay closes. There is no Owner override for an unpaid,
unverified or contradictory guest bill. Releasing rooms cannot label an accounting
exception resolved or create a zero balance.

Approved source-billing amendment (09/10/2026): a correctly configured source-paid
room leg may retain a verified OTA receivable after hotel checkout, with a linked
accountant case. Guest-paid legs must still have verified zero outstanding. See
`2026-10-09-source-billing-design.md`; the OTA bill is issued, not falsely marked paid.

These are separate outcomes: **guest bill settled / hotel stay closed** and
**receipt accounting case open/resolved**. Leftover OR credit is not a second guest
payment. HotelHub does not create refunds, write-offs, journal adjustments, voids,
unmatches or reallocation cleanup to eliminate it. The N3 accountant chooses the
appropriate accounting treatment. A journal's ledger effect alone is not taken
as proof that an OR/invoice matching relationship changed.

## Findings from different tests

The isolated probe in `docs/evidence/HH_N3_RECOVERY_COUNTEREXAMPLES_20261008.mjs`
ran with Node; all six checks completed, network calls 0 and production changes 0.
Its JSON records exact results. This models counterexamples; it does not model
undocumented N3 behavior as fact and is not part of the 2,280-test code result.

| Probe | Result and implication |
| --- | --- |
| Clerk inserts a match after HH reads, before HH submits a replacement array | HH preserves only its stale prior rows, deletes the clerk's new row and passes its own post-write fingerprint. Read/merge/write cannot guarantee preservation. |
| Each competing writer verifies immediately after its own update | Both can pass; the later update removes the earlier match. A post-write check detects some races, not all. |
| Model with server-enforced conditional version | Stale mutation is rejected before overwrite; clerk's rows survive. This identifies the required server property, not proof N3 implements it. |
| OR100.01, INV60.01, RF40.00, refundAmount40.00 | Invoice-only allocation plus refund gives0.00; summing the RF row again gives−40.00. Gemini's formula requires disjoint categories and a verified DTO contract. |
| Same balanced success/Approved observation in committed and calculated worlds | Proposed checks pass both. They prove numerical consistency, not persistence on their own; this is not an assertion that real N3 GLPosting is a preview. |
| Empty/empty/populated GET observations after one create | Bounded GET polling handles a delayed observation without another financial POST. The model does not establish N3's actual delay. |

Missing/null refundAmount remains unknown. An empty or missing refundDetails array
does not prove zero refunds without accepted completeness semantics. Neither a
successful mock nor a balanced imported file becomes runtime financial authority.

## Recommended practical matching path

Three approaches were considered:

| Approach | Trade-off |
| --- | --- |
| N3 matching plus HH verification and accountant list (recommended fallback) | Avoids HH issuing an allocation replacement under an unaccepted concurrency contract; the accountant performs matching in N3 and HH verifies the exact result. |
| HH automatic matching with a server-enforced stale-update contract | Offers the shortest eventual workflow, but cannot safely activate from read-back checks alone. Keep the existing implementation preserved and gated. |
| Report only, with no verified bill-settlement requirement | Simplifies accounting handover but permits unpaid checkout; excluded by the Owner's selected rule. |

Provide **Match in N3 → Check N3 result** as the safe available fallback. HH does
not POST an unverified replacement/merge allocation array just to discover whether
it succeeds. N3 Customer Knock Off is the accountant's supported workflow; this
proposal delegates its mutations to N3, without claiming N3 itself never conflicts.

Existing HH automated matching code remains preserved and gated. It can be enabled
later only after a separately accepted atomic stale-update/preservation contract.
The new manual path does not fabricate a successful HH allocation dispatch when
none happened. Its provenance identifies externally performed matching and the
fresh N3 observations that verify it. No new browser/environment activation toggle.

Manual reconciliation must bind exact bill/OR GUIDs, reservation/intent ownership,
tenant, actor, customer, currency, date, amount and document status. A common walk-in
customer does not link another booking's OR to this stay. Verify the actual bill
target and owned matches; unknown/missing/contradictory document or accounting
evidence blocks the guest bill's settled status. Keep unrelated prior matches
intact; never silently adopt a different OR merely because its code/customer fits.

The existing snapshot/mapping and GL proof requirements remain. Further testing
can establish an accepted current GL adapter; choosing manual matching removes
the HH allocation-POST concurrency dependency for that path, not the need for
truthful bill/receipt reads. Existing CashSale and balance-receipt create gates
remain closed until their own evidence is accepted.

## Proposed in-app read-only test

Extend the existing Owner-only Financial Verification surface with **Check saved
documents**, scoped to the selected existing bill/ORs. No arbitrary URL, create,
match, refund, correction or automatic repair operation. A wrong tenant/session
or browser-supplied ownership claim is rejected server-side.

Show distinct checks for exact identity/ownership, status, detail/line money,
observed debit-credit consistency, bank/customer/sales/tax relationships, bill
outstanding and evidence completeness. Label a balanced observed journal as such;
do not call it committed solely because its sums balance. Optional missing scalar
headers cannot be replaced with convenient nested values without accepted rules.

If GL is initially absent, perform only bounded fixed-ID GET retries, at most
three observations with 1s then 2s between them. All calls share the existing total
budget, cancel on 401/auth/scope loss or navigation, and obey body/read caps. These
two waits are backoff between observations, not financial POST retry. Once the
budget/attempt limit expires, show **Waiting for verification** with the existing
saved attempt and explicit read-only recovery. HTTP404/empty data does not prove
that the create failed or authorize a replacement. Do not invent a persisted
Awaiting_Verification database state just for this display message.

Capture a safe error/result packet: booking, exact document references, operation,
attempt ID, timestamps and business/status codes; no token, cookie, secret, guest
contact text or raw private journal in Git. Background GET never records financial
success optimistically or resolves an accountant case by itself.

## Accountant exception list and print behavior

Create an Owner-accessible **Accountant review** list, derived from durable scoped
cases rather than only the selected month's transaction rows. Front Desk receives
the minimum booking-level recovery message; financial report/export remains Owner
only under the existing RBAC. An N3 accountant without HH access can receive the
printed/exported report from the Owner; no new local login or automatic sharing.

Each row records booking/stay dates, original OR/bill date and number, immutable
references, currency, issue category, source-observed values/availability, first
seen, last checked, case age, status, accountant notes and the next N3/HH action.
Do not advertise an unverified raw outstandingAmount as spendable credit or total
unknown values as zero. Refund treatment remains N3-owned; report observed refund
and balance facts distinctly with their verification state.

Default **Open as at [date]** includes all unresolved cases originating on or before
that date, including prior months. October cases stay visible in November/December
until actually resolved, independent of hotel checkout. A current month alone
must not silently filter them out. Allow status, original date, booking/OR and
age filters, and history including resolved cases. Reports do not double-count
the original receipt as new cash/sales in every month it remains open.

Persist immutable case events/snapshots for historical as-at reporting; later
resolution must not rewrite an earlier statement. An HH note or **Reviewed** flag
is acknowledgment only. Resolution needs fresh accepted N3 document evidence and
an audited actor/reason; changed N3 facts can reopen a case. GET may return a
read-only current comparison, while an explicit Owner reconciliation persists a
new observation/event. Do not mutate cases or mark them resolved from a report GET.

Print/export clearly states the as-at date, generation/check time and unavailable
items. Reprinting a saved statement uses its immutable snapshot; printing a new
statement uses its newly verified as-at basis. No financial audit purge at month
end. On auth/scope/read failure hide stale balances and disable a misleading
complete export; case existence may still be listed as pending/unavailable.

## Twelve proposed error categories and guidance

This groups HH recovery behavior; it is not an exhaustive list of every QNE error
code. Preserve unfamiliar vendor codes as **Other N3 error** with safe details.

| Category | User/N3 action and HH recovery |
| --- | --- |
| Expired session | Relaunch HH through N3; check the same saved attempt, never repeat collection. |
| Role/permission denied | Ask the authorized Owner/accountant to review N3 permissions; no role bypass. |
| Wrong tenant/customer/currency or unowned OR | Confirm the exact booking/documents; correct the source through the reviewed process, not arbitrary rebinding. |
| Draft/unapproved/cancelled/voided/bounced document | Accountant reviews the actual N3 document status; HH rechecks the same identity. No blind replacement. |
| OR already used elsewhere/insufficient available funds | Accountant reviews all existing matches in N3; HH must not clear unrelated allocations or collect twice. |
| Bill already paid/no remaining amount | Check existing matching and reuse verified settlement; do not create another balance receipt. |
| Refund, surplus or unclear refund history | Keep an accountant case open; accountant handles the N3 accounting treatment. Guest bill still requires settled proof. |
| Missing/inconsistent/late GL observation | Read-only bounded checks then Waiting for verification/Needs review; no repeat create. |
| Concurrent/stale N3 matching | Use N3 matching fallback; refresh exact current facts. HH stops, not blindly re-merges. |
| Invalid/inactive account/tax/stock/period configuration | Accountant/admin fixes the relevant N3 configuration; revalidate immutable mappings before any new authorized dispatch. |
| Local freeze/revision/busy/duplicate attempt | Refresh/recover the existing intent; no silent thaw or new reference. |
| Timeout/5xx/malformed response/other business error | Preserve an unknown dispatched result; inspect the existing N3 document first and retain the safe error packet. |

Messages must distinguish a rejected **pre-dispatch** request from an **unknown
post-dispatch** outcome. Examples: “This receipt has other matches. Ask your N3
accountant to review OR…. Return here and select Check N3 result.” and “N3 has not
confirmed the saved action. Check the existing document; do not collect again.”

## Owner-assisted test available now — read only

Use 9AC-0D9-2F1 MUGS AI LAB TEST SDN. BHD. and the already existing September test
documents. No new receipt, bill, refund, rematching, journal adjustment or cleanup.

1. In N3 open Reporting → Reports/Report Center → General Ledger; choose a journal
   or General Ledger report covering the existing September documents. The exact
   report layout may vary; use the recorded document/posting dates if filters differ.
2. Locate CS2609/001, OR2609/001 and RF2609/001 by exact document number. Export the
   report to PDF/Excel or capture the relevant rows with the report/date context.
3. Compare against the captured API observations: CS has AR debit324.03, sales
   credit 300.03 and tax credit 24.00; OR has cash debit/customer credit 100.01; RF has
   customer debit/cash credit 40.00. Record any missing/different rows; do not repair
   them as part of this test. A combined General Ledger report is a different check
   from pressing a document's GL Journals preview again.
4. Open the same OR and Customer Knock Off read-only; inspect the existing INV 60.01
   and RF 40.00 relationships and reported refund/outstanding values. Do not Save
   or change matches. Share the report/captures here for comparison.

This adds independent observed evidence and may support adapter acceptance. A
single report still does not establish all future API semantics, completeness,
or atomic matching. No concurrent-write job is required for the manual fallback;
if an automatic mode is pursued, any race test requires its exact separately
approved financial manifest, not this read-only job.

## Implementation impact and verification contract

Review changes together across evidence/coordination/allocation/manual provenance,
settlement DTO/card, durable store/SQL close proof and case persistence, report
server/client/export and reader invalidation. Current close SQL/prover require
zero receipt remainder; do not simply delete that assertion. Revised close proof
must bind the settled bill, owned matches and any separately persisted accountant
case so omitted/unknown financial evidence cannot be hidden by a leftover flag.
Do not require an unsupported spendable-balance computation just to list an
unresolved accounting case; its unknown state is explicit and cannot fund a match.

Additive service-only case schema, tenant/role authorization, idempotent event and
close fencing, native single/multi-session verification and exact type/schema
parity are part of implementation. Live application is a separate authorized
lane. Keep protected integration/dependency files and parked changes unchanged.

Acceptance must cover settled bill with residual OR and open case; unpaid bill
cannot close; manual N3 match produces no fictitious HH POST/claim; same-customer
foreign OR rejected; null/refund overlap remains unavailable; no-case omission;
October-to-November/December carry-forward; historical print unchanged after
resolution; resolved/reopened/audited cases; unauthorized/alien tenant/stale session;
timeout/empty GL/401 bounded recovery; busy/crash/replay; all-room Dirty/DNDoff
atomic handoff; no duplicate collection; desktop/mobile and all-reader refresh.

Implementation begins only after this written revised policy/spec is reviewed,
then its scoped plan is prepared. All current gates remain unchanged meanwhile.

## Sources and evidence limits

- Existing approved settlement plan/spec and current code, HEAD 2d81529.
- Current official `/doc/sales-v1.json`, `/doc/gl-v1.json`, `/doc/stock-v1.json`,
  `/doc/platform-v1.json` snapshots/limits in HH_N3_BILLING_API_PROOF_JOB_20261008.md.
- HTTP conditional-write semantics: https://www.rfc-editor.org/rfc/rfc9110.html
  section13.1.1. This does not establish QNE support for If-Match.
- QNE manual customer matching: https://support.qne.com.my/support/solutions/articles/81000420635-how-to-use-customer-knock-off-
- QNE GL reports: https://support.qne.com.my/support/solutions/articles/81000410621-what-are-the-gl-reports-available-on-cloud-accounting-system-
- QNE receipt form/journal view: https://support.qne.com.my/support/solutions/articles/81000412633-record-your-payment-collections-in-cloud-accounting-system

Two newly attached files failed to load: HH_DEPOSIT_VERIFICATION_CHECKPOINT.md and
MDB-01_HOTELHUB_ADOPTION.md. They are not treated as read/updated in this proposal;
retry is requested. Existing repository/conversation governance remains intact.

No production code/gate change, new full build, migration, operational DB/N3
request/write, main merge, publish/deployment or Lovable AI Build in this design
inspection. Public documentation reads and isolated offline probes only. Current
code's 2,280 passed / 20 skipped result is historical, not a new run for this proposal.
