# HotelHub ordinary receipt workflow — UAT preparation, 11 October 2026

Upload to Project Sources: **No**. This is repository-local test/recovery evidence.
The reusable receipt/BEC Project Source supplied earlier remains the reference.

## Outcome and boundaries

Continued the already approved normal receipt acceptance work, without rebuilding
deposits or rerunning the completed OR2610/002 financial proof. Added one offline
route-through-transport acceptance suite. No application behavior, migration,
database data, runtime configuration or financial authorization was changed.

Live GitHub main and Lovable both read back
`6ac17dee7b503b96daf89015afdc9fb3995e1b68` (PR9). Lovable reports ready,
agentFinished=true and published=true. No builder was launched. Local work started
from `d684165` in the existing review worktree. Unrelated changes are preserved.

Normal automatic editing was **not enabled**. The deployment controls were not
modified; no new direct runtime environment-value inspection is claimed.

## Fresh read-only Cloud inspection

Exact existing HotelHub project: `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`.
All operational queries in this continuation were SELECT only.

| Item | Observed state |
|---|---|
| Linked HotelHub deposits | One: BK260920001 / OR2610/001, saved amount RM50 |
| Open request on that deposit | Generation 1, manual, needs_review, n3_result_mismatch, version 12 |
| Original request | d79ccc11-86ae-4730-b07d-4770e604f833, proposal RM65 |
| OR2610/002 linked deposit rows | Zero |
| Generation-2 automatic requests | Zero |
| Normal receipt edit attempts | Zero |
| Verified receipt-version projections | Zero |

The saved RM50 deposit is NOT a fresh N3 receipt amount readback. The urgent
OR2610/001 correction is not resolved by this preparation. Preserve its request,
receipt identity and audit history. Never create a replacement OR to disguise it,
convert it into security cash, or promote its legacy request into automation.

OR2610/002's earlier verified RM65 -> RM50 -> RM65 proof remains historical.
It is a standalone disposable N3 document, not an HH-linked normal Edit fixture.
Do not press Next approved test or re-run its completed proof package.

## Additional acceptance evidence

`src/lib/__tests__/receipt-normal-route-transport.test.ts` executes actual request,
decision and Check-result route handlers, HTTP origin/body validation, automatic
request creation, DTO capabilities, normal execution dependencies, coordinator,
payload builder, receipt/GL evidence and fixed N3 HTTP client.

The external service, session/Owner lookup, storage, account eligibility and alert
delivery are synthetic. The fetch interceptor has no real-network fallback.
Test configuration values are local process stubs restored after each test; they
do not activate Cloud or authorize any production financial write.

| Case | Expected and observed |
|---|---|
| Owner, approval OFF | One Update to the same OR, fresh receipt/GL/stable receipt verification, then confirmed projection |
| Owner, approval ON | Request pending, zero Update until Owner approves |
| Front Desk, approval ON | Request pending, Owner approval required |
| Front Desk, approval OFF | Still cannot financially execute; Owner route rejects with 403 |
| Lost Update reply | Held, repeated approval sends nothing, explicit Check uses GET only and settles once |
| Corrupt payment detail | HTTP200 and balanced GL do not authorize corrected totals |
| External contact change | Fresh pre-dispatch fingerprint rejects stale request without Update |
| External description change | Latest non-financial description preserved from fresh full DTO |
| Runtime OFF / cross-site request | Approval refused; cross-site request rejected before N3 calls |

Focused suite: **9/9 passed**. Whole repository: **2,244 passed, 38 skipped, zero
failed**. TypeScript and changed-test ESLint pass. No new production build was
needed or run: product source is unchanged from the published UI checkpoint.

Independent bounded reviewer also ran 9/9 and found no Critical/Important issue.
Minor limits: the role/session mock does not independently mutation-prove every
deeper Owner freshness defense; the fetch fixture does not assert authorization
headers or cancellation-signal plumbing. Existing lower-level suites remain
separate evidence. This new suite does NOT establish native SQL concurrency,
live runtime adequacy, remote atomic conditional updates, signed-in browser/mobile
acceptance, or real normal-workflow UAT.

Initial harness errors were corrected (wire proposal uses `amount`, not persisted
`amountCents`; nullable fixture contact typing). A too-broad stale-description
expectation was corrected to test actual contact fingerprint rejection, with a
separate assertion proving preservation of latest description. No product fix or
new RED-to-GREEN product regression is claimed.

## Next controlled live UAT — not activated

1. Use only **9AC-0D9-2F1 / MUGS AI LAB TEST SDN. BHD.**
2. A new disposable booking and **HH-created RM50 advance receipt** are needed.
   Create the booking in HH and use its existing Add deposit flow, not N3 Add,
   security cash, OR2610/001 or the unlinked OR2610/002. Record its exact BK, OR
   and immutable IDs. If Add deposit is disabled or uncertain, stop and report
   that state; do not bypass the control or retry an uncertain receipt creation.
3. Send the resulting BK/OR identifiers for read-only eligibility inspection.
   Do not click Edit/Save change or change N3 yet.
4. Before a live correction, a separately reviewed bounded activation must limit
   the ordinary workflow to that exact tenant + linked reservation + deposit +
   receipt. Current normal execution gates are tenant-level, not receipt-level;
   simply setting DIRECT_EDIT=true would enable more than the one intended test.
   Therefore this preparation does NOT provide a safe instruction to toggle it.
5. Proposed next bounded build: add a server-owned, expiring receipt-scoped UAT
   authorization using the existing normal pipeline. Global normal editing stays
   OFF; all other receipts and legacy requests stay blocked/manual. No financial
   retries or schema change. This proposal is not implemented or published here.
6. After exact fixture/gate approval and release, test Front Desk request -> Owner
   approval, Owner direct-save under an explicitly approved policy case, fresh
   receipt+GL readback and the second-session confirmed projection. Amount cases
   and any temporary policy changes must be explicitly bounded in the packet.
7. Any uncertain result: stop financial clicks; Owner uses Check N3 result. No
   repeat Update, duplicate OR, or attempt deletion. Disable the scoped UAT gate
   on expiry/failure, while keeping read-only recovery accessible.

No merges, pushes, publications, deployments, Cloud writes, migrations or N3
writes occurred in this continuation. Billing/security cash and BEC were not
changed. The core UAT deadline remains 20/10/2026; BEC must not displace required
booking/deposit/billing completion.
