# HotelHub staff checkout authority — source checkpoint

Date: 14/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: **Yes** — add as a dated recovery reference. Retain the
master, billing transport, payment and matching checkpoints. This is not a release
or a claim that billing or Complete Checkout is finished.

## Preserved source

Branch: `review/hh-reconstruction-20261011`.
Starting checkpoint: `db811aa`.
Reviewed/tested product commit: `64b0711bc245e2f0fe9dd3df4f9e7cb92aad561a`.
Product tree: `1e3ddf7372311e7ddae8ed70104aef0afb9568b3`.
A following documentation-only commit records this handover; resolve HEAD before
resuming. Do not replay the completed authority changes.

Current GitHub main (fresh `git ls-remote`) and Lovable source both remain at
`e8341907a470d0d1e3a39a22413249becf73cd57`. Lovable reports ready/agentFinished.
This broad source branch contains earlier unreleased work and is not a clean
main-based publication candidate. Existing untracked adoption/temp paths remain
preserved. Protected launch/store/integrations/package/lock files are unchanged.

## Implemented in source

Ordinary checkout permission now covers Owner and Front Desk consistently through
HTTP authorization, the settlement/source coordinators and stores, recovery proof
persistence and fixed N3 transport. Prepare Checkout already consumes that same
permission; its mounted payment form is verified for Front Desk.

A staff member uses their own current N3 token for bill, receipt, allocation and
recovery reads/writes. Resuming an Owner-created intent rereads using the staff
session; Owner-read provenance cannot be reused. Missing sessions and denied
upstream rights stop progression. A denied or uncertain Create remains a saved
attempt, rather than permission to POST it again. Status GET remains read-only.

These changes preserve separate controls:

- Housekeeper cannot operate financial checkout.
- Setup, payer overrides, receipt approval, adjustments and reports stay Owner-only.
- Source-room debt cannot be collected by the guest payment action.
- Individual source/guest legs cannot close a stay independently.
- Current master, bill, split-payment and automatic-allocation contracts remain
  independently unavailable. No contract, snapshot or activation flag was enabled.

## Candidate SQL, not installed

The installed CLI generated
`20261014151614_hh_staff_settlement_authority.sql`. It depends on the existing
uninstalled settlement and source-billing schemas; this file is not a standalone
production migration and is not permission to apply the dependency chain.

Eleven existing ordinary writer definitions retain their previous bodies with
only the reviewed actor/role guard substitutions. A new private operator helper
resolves and locks an active Owner/Front Desk role within the exact tenant. Source
freeze derives the read role from that database result. The original Owner helper
is unchanged; refund numbering still requires Owner. Existing service-only RPC
ACLs are preserved; the new helper has no public/browser/service execute grant.

Fresh SELECT-only inspection through the exact existing Lovable project found
**zero installed settlement/source-billing functions**. Latest returned migration
version is `20261012075339`. This is actual catalog/history evidence, not inference
from repository files. No operational schema, data, grant or migration was changed.
Backend access remains through Lovable; no separate Supabase account is required.

## Fresh verification and review

- Baseline with the correct external test tools: 3,088 passed / 22 skipped.
- Role/API regressions observed RED before implementation; focused core lane:
  136 passed.
- Disposable staff SQL regressions observed RED; final 10 SQL tests pass, including
  the existing proof/recovery/close/rollback checks executed with Front Desk role.
- Additional disposable source-ledger checks pass, including staff freeze and
  replay returning the same two leg identities/numbers with staff audit identity.
- Final full suite: **3,113 passed / 22 skipped / 0 failed**, 219 files passed and
  three skipped, with explicit DOM and PGlite lanes enabled.
- TypeScript, changed-file ESLint, production build and whitespace checks pass.
- Protected-file comparison is unchanged. All eleven SQL replacement bodies were
  independently compared with their predecessors after the intended substitutions.
- One independent reviewer found no Critical, Important or Minor findings. The
  reviewer did not rerun tests; the checks above were run by the implementing agent.

The first baseline command used an obsolete PGlite path and failed three import
suites; correcting the external runner path restored the baseline. During TDD,
tests exposed a SQL keyword/variable collision in the new helper; the variable was
renamed and missing/inactive/foreign/Housekeeper rejection tests pass. A temporary
SQL regression-runner comment split was also corrected. None reached live data.

Full lint was not rerun: the previously recorded 307 legacy formatting errors
remain unresolved and full lint is **not** described as passing. The earlier minor
payment-form behavior during background refetch remains deferred; fresh server
validation still governs posting. No new review findings were deferred.

## Rulings and remaining boundaries

Ruling: advance the approved independent staff-authority slice while master
acceptance remains pending. Cost if wrong: source permissions might be mistaken
for live capability. Therefore SQL installation, publication and financial
activation remain separate, and billing is not called complete.

Ruling: retain the reviewer's unjudged live boundaries as pending. They include
installed-schema grants, real N3 rights and contracts, current-master acceptance,
native concurrency, split payments, external matching, source whole-stay close and
whole-plan acceptance. Cost if wrong: an unproven financial or room-release action
could be enabled prematurely. PGlite does not establish native multi-session
locking or live accounting acceptance.

## Next permitted work

Continue the approved current master/payer adapters, confirmation/source-leg
mounting, matching, accountant carry-forward and whole-stay close integration.
Remaining Task4 scope is not complete merely because these authority layers pass.

The supplemental evidence still required is currency `88669` plus the three
previously referenced control, income and tax accounts; customer numeric status
semantics also need authoritative acceptance. Do not repeat the successful 38
room/master captures or completed journal proof jobs unnecessarily. Keep missing
posting/GL/INV/single/split/concurrency contracts closed until the specific bounded
Owner-operated acceptance jobs are authorized and proven.

No shared push, PR, main merge, database apply, runtime-setting change, N3 call or
financial transaction, Lovable AI Build message, deployment or publication occurred.
