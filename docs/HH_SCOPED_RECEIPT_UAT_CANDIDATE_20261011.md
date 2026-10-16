# HH ordinary receipt workflow — dormant scoped UAT candidate

Date: 11/10/2026. Upload to Project Sources: **No** — technical release/test packet.
Friday decisions and remaining roadmap are separately provided in
docs/project-sources/HH_FRIDAY_DECISIONS_AND_REMAINING_ROADMAP_20261011.md (Yes).

## Scope and checkpoint

Continued the existing automatic-receipt plan after local a4dac29. No new
repository, deposit implementation, execution package or Lovable AI build.
Existing actual-route acceptance work is extended rather than repeated.

Verified live GitHub main/Lovable at start of this continuation:
6ac17dee7b503b96daf89015afdc9fb3995e1b68. Ready, agentFinished=true,
published=true. This source candidate is **not pushed, merged or published**.
No database/migration/runtime/N3 changes or external financial requests occurred.
All new HTTP test traffic is intercepted with no real-network fallback.

Known existing fixture: BK260924001 / OR2610/003 / RM70, shown in the user's
screenshots and identified by the prior SELECT-only Cloud inspection. This
supersedes the old preparation instruction to create a new RM50 fixture. Do not
repeat OR2610/002's completed proof or create another booking/deposit.

## Dormant manifest

| Binding                  | Fixed value                                          |
| ------------------------ | ---------------------------------------------------- |
| Test company             | 9AC-0D9-2F1 / MUGS AI LAB TEST SDN. BHD.             |
| HH tenant                | 075e94a3-3876-4293-8ec5-3c541c028a09                 |
| N3 tenant key            | ca75ed66-69ac-40d9-92f1-f6b3a8780fdd                 |
| Reservation              | cab3c4fd-ad27-498b-8681-15b32f114abe                 |
| Deposit                  | 6d4995db-80d6-43f7-a032-1848b3e3e069                 |
| N3 receipt               | e0f206a5-43b6-49fb-18d1-08df276e8ec7                 |
| OR / reference           | OR2610/003 / HH-6d4995db80d643f7a0321848             |
| Customer                 | 1382639 / 700-7001                                   |
| Bank account             | c3c22459-c2b7-4c43-8e43-8b52a9adabda / 700-0310      |
| Currency / document date | MYR / 2026-10-11                                     |
| Candidate transitions    | RM70 → RM85, RM85 → RM70; amount only                |
| Candidate fixed expiry   | 13/10/2026 20:00 Malaysia time; no automatic renewal |

This is source preparation, **not approval to activate or execute these amounts**.
The separate server flag HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED must be exactly true;
unset/false is OFF. Normal HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT must stay OFF.
Existing execution budget, deposit writer, both tenant allowlists, production
Update contract and control policy are still required. Creation uses server-loaded
deposit metadata; execution repeats the saved original/proposal identity binding.
No browser-selected tenant/receipt/endpoint can authorize a write.

Only an authorized Owner can dispatch. Front Desk can create a pending request
under existing policy, with no financial write. Normal creation/approval, fresh
Owner lookup, fresh full DTO/fingerprint, durable single-POST claim, preserved
payload, receipt/detail/GL/stable readback and projection remain the same pipeline.
Expiry/disable is checked before work and again after reservation before POST.

The source restricts allowed transitions within the candidate window; it does not
claim a two-dispatch lifetime cap across distinct new requests. A live packet must
bound the agreed cases and turn the scoped flag OFF after them. There is no new
schema or automatic activation toggle in the UI.

## Replay and fail-closed fixes

Independent review found two Important problems in the first candidate, both now
fixed and covered by actual route tests:

1. New selected-fixture requests denied by expiry/bad stored binding, or a void
   proposal, could fall through to legacy manual persistence. An explicit route-
   identity guard now rejects them with automation_unavailable. Other receipts
   retain their manual workflow.
2. POST retries were routed by current eligibility rather than saved generation.
   Persisted-key lookup now runs first, validates actor/booking/deposit/fingerprint
   against the saved original and returns the appropriate generation's DTO.
   Applied/pending/unknown generation-2 replay remains available after disable or
   expiry; generation-1 stays manual and is never upgraded. Replay does not read
   or write N3, create/authorize a request, or resend a financial mutation.

Second-gate test disables the lane after durable reservation: zero POSTs, durable
held attempt and read-only recovery. A Minor replay body-validation bypass was
also fixed: strict accepted keys are checked before replay; regression included.

## Fresh verification

- Initial new gate RED: 19 failed because gate functions did not exist.
- Review-boundary RED: 8 failed / 16 passed, exposing fall-through/replay problems.
- Final entire repository: **2,279 passed, 38 skipped, zero failures**.
- Included focused gate + ordinary route cases: **44 passed** (19 gate, 25 route).
- TypeScript noEmit, all six changed TypeScript files' ESLint and formatting pass.
- Local production build passes. This is **not a Lovable AI build or deployment**.
- Independent bounded reviewer: both Important findings resolved; no remaining
  Critical/Important. Identified Minor body validation addressed and tested.
- Product-path diff whitespace passes. Broad dirty-worktree whitespace check still
  reports two pre-existing markdown hard-break spaces in the untouched protocol;
  that unrelated work is preserved. No whole-repository lint-clean claim.

Logs: .superpowers/sdd/2026-10-03-automatic-receipt-correction/scoped-uat-red.log,
scoped-uat-boundaries-red.log, scoped-uat-suite.log, scoped-uat-build.log.

Synthetic tests establish code behavior under controlled observations. They do
not prove signed-in/mobile acceptance, actual hosting budget, upstream atomic
conditional writes, cash-module concurrency or a live ordinary OR correction.
Existing SQL is unchanged; previous native SQL evidence is not a fresh run.

## Next actions

1. Owner keeps OR2610/003 at RM70; no receipt edits or repeat proof clicks now.
2. Before a release, refresh actual main/Lovable identity and compare candidate
   product tree; preserve local history and unrelated changes. Do not merge the
   stale security-cash branch over current receipt releases.
3. Review one exact publication/activation/live-test packet, including amounts,
   policy case, expiry, writer prerequisites and same-fixture eligibility. No
   normal tenant-wide edit activation. If the proposed expiry has passed, hold
   live work and explicitly agree a replacement window rather than auto-renew.
4. After accepted release/activation only: ordinary Front Desk request → Owner
   approval, approved Owner direct-save case, same-OR readback and second-session
   HH projection. Stop on uncertainty; Owner uses Check N3 result, never repeats
   Update or deletes an attempt.
5. Disable scoped gate after the approved cases/failure/expiry. Keep GET-only
   recovery. Proceed to integrate already-written security cash source and the
   approved billing/report packages; do not redo completed work.

Original urgent BK260920001/OR2610/001 stays separate: saved legacy request
needs_review / n3_result_mismatch / version12, not a fresh N3 amount readback.
Owner/accountant resolves that same OR using its manual Verify N3 change path.
No duplicate receipt, extra RM15 entry correction or security-cash conversion.
