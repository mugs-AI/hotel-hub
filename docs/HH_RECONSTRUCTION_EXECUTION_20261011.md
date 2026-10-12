# HotelHub controlled reconstruction — execution ledger

Upload to Project Sources: **No** — repository execution/recovery record.

Owner authorized controlled reconstruction on 11/10/2026 after the missing c9
candidate could not be recovered. This is not that candidate or its test proof.

## Identity and scope

- Product: HotelHub; repository `mugs-AI/hotel-hub`.
- Branch: `review/hh-reconstruction-20261011`.
- Product base: `6ac17dee7b503b96daf89015afdc9fb3995e1b68` (fresh native fetch).
- Preserved billing/security input: local `072f0c33647c679879afcbb789098447619c458d`;
  remote review reports `5d6861bb4c06cbe6de96e670cb938e651a18f1f8`.
- Parked receipt work: `653ca91a1270e3b801025bbf35957580b26301a0`.
- Older worktrees and their dirty changes are untouched.
- No public release, main merge, operational SQL, N3 writes or activation.

## Approved references

Use the 09/10 source-billing specification/plan, the existing settlement and
security-cash work, and the 11/10 OTA acceptance addendum. CN/commission/monthly
OTA settlement remain accountant-owned outside HH. Preserve RM300 source room /
RM40 guest extras, while retaining existing RM80 regression cases.

## Reconstruction rulings and pre-flight

- Ruling: create a new main-based review worktree rather than alter parked linked
  worktrees — explicit reconstruction scope and preservation take precedence —
  cost if wrong: additional isolated checkout, no loss of original work.
- Ruling: reuse completed billing/security source by additive local merge, not
  copy the older tree wholesale — current main has newer receipt protections —
  cost if wrong: integration regressions must be detected before release.
- Pre-flight: collection policy intersects existing receipt creation; bill-to
  paths need both contact-policy and settlement-lock failure handling.
- Pre-flight: sign-out/auth-transition purges must include both receipt policy
  and security-cash caches; neither branch replaces the other.
- Pre-flight: source policy feeds partition, which feeds leg-scoped storage and
  coordination; source-issued close cannot use the legacy single-leg close RPC.

## Fresh checks and progress

- Main baseline: `npm test` — 2,235 passed, 38 skipped, zero failed.
- Six merge conflicts identified; five manually combined, generated route tree
  regenerated from routes. This is not c9's six review findings.
- Billing/security integration: `npm test` — 2,574 passed, 38 skipped,
  zero failed; `tsc --noEmit` and `npm run build` passed.
- Protected-file comparison against product base: unchanged (`AGENTS.md`,
  package/dependency files, `src/start.ts`, integrations, hotel-store server).
- Preserved receipt safeguards: additive local cherry-picks `3a4ff99` and
  `a5698a0`; full suite 2,618 passed / 38 skipped / zero failed.
- New source policy prerequisite: immutable, explicitly configured payer facts;
  server actor identity, scope/revision/frozen checks, current customer evidence,
  and explicit DTO field allowlist. Initial test RED (module absent), then GREEN.
  No production adapter, persistence, source settings UI or dispatch is mounted.
- Source-billing Task 1 remains **incomplete**: do not call preparation a durable
  reservation confirmation. Walk-in migration, fenced policy/payer persistence,
  and accepted current N3 master readers remain required before downstream tasks.
- Candidate full suite: **2,629 passed / 38 skipped / zero failed** (171 passed
  test files, four skipped). Source-policy prerequisite contributes 11 tests.
- Candidate `tsc --noEmit` and local production build passed. Scoped lint:
  zero errors, one existing settings Fast Refresh export warning; no repository-
  wide lint-clean claim.
- Fresh isolated PGlite checks passed: settlement single-session transactional
  checks, deposit four-mode/role/fencing checks, security custody/history/return
  checks and seven security review regressions. No operational database involved.
- Independent whole-branch checkpoint review found three Important issues, zero
  Critical and no separately graded Minor issues. One RED→GREEN fix pass:
  - Candidate settlement replacements discarded all five earlier generation-1
    RPC fences. Actual sorted migrations + generation-2 requests reproduced five
    failures; all five legacy handlers now reject them with automation_unavailable.
    Existing reservation guards and generation-absent legacy support remain.
  - Settlement POST step/reconcile lacked provenance/content-type guards. Four
    API regressions were RED, now GREEN; Origin includes scheme, Fetch Metadata
    cannot claim same-site authority, and simple text/plain requests are denied.
  - Retained session data bypassed auth-error/role/cache cleanup. Error-aware
    tenant/user/role identity, central/sign-out cancellation and purge, and scoped
    result checks now apply. Four auth/late-response regressions RED→GREEN; actual
    sign-out hook additionally checked without a mounted settlement reader.
- Final verified tree after review fixes: **2,639 passed / 38 skipped / zero
  failed**, 173 test files passed and four skipped. TypeScript, production build,
  review-fix/core-file ESLint and diff whitespace checks passed. Protected files
  remain unchanged. Earlier settings-only Fast Refresh warning is retained.
- Final: fixed generation isolation — five executed SQL regressions RED→GREEN;
  legacy settlement SQL still passes and reservation guards are preserved.
- Final: fixed settlement HTTP origin/content boundary — four new API cases
  RED→GREEN (both mutation modes, multiple provenance inputs).
- Final: fixed settlement auth/cache lifecycle — four auth/purge/late-response
  regressions RED→GREEN; actual unmounted sign-out hook checked additionally.
  Entire suite after the single fix pass: 2,639 passed / 38 skipped / zero failed.
- No unresolved Critical/Important checkpoint review findings. No deferred Minor
  findings. This is not approval to install, activate, merge or publish.
- Final: Ruling: repair only the unreleased settlement candidate's replacement
  bodies — the historical automatic migration remains byte-identical to main —
  cost if wrong: any already-installed candidate requires a forward repair before
  activation; this turn applies no migration.
- Final: Ruling: retain this execution ledger/worktree as a recovery checkpoint
  while source-billing tasks remain incomplete — deleting it would undermine the
  approved recovery purpose — cost if wrong: unused local checkout remains.
- Final: Ruling: all review exclusions remain **NOT VERIFIED** and release-held:
  native concurrency; operational migration compatibility beyond captured schema;
  live N3 contracts/outcomes; deployed runtime flags; signed-in/mobile/printer
  acceptance; incomplete two-leg partition/recovery/printing/source close — no
  evidence or new live authority is implied by code reconstruction — cost if
  wrong: activation is delayed, rather than asserted from synthetic proof.

## Final checkpoint status

Source: reconstructed/review-fixed locally on the isolated branch. Product
main/Lovable were refreshed read-only and still report
`6ac17dee7b503b96daf89015afdc9fb3995e1b68`, Lovable ready/agentFinished=true.
Test: fresh counts and isolated SQL evidence above. Release: **not pushed,
merged, migrated, activated or published by this turn**. Acceptance: live/mobile/
printer/native-concurrency and unfinished source-billing work remain pending.
- Existing settlement/source/security historical test counts are not fresh proof
  of this reconstructed tree.

## Pending acceptance

Source policies/confirmation, frozen charge partition, leg-scoped persistence,
two-leg coordination, source-issued/guest-settled close, prints/readers and actual
runtime acceptance must each be established. Financial contract gates remain
closed unless their specific existing accepted evidence supports activation.

Native multi-session checks and signed-in/mobile/printer acceptance are separate
from unit/build results. No new live test transaction is authorized here.

## Next exact implementation boundary

Implement Task 1's additive schema and fixed scoped store, retaining old walk-in
and booking IDs. Mount only an accepted current N3 master reader; absence remains
setup-required. Save prepared payer facts under reservation revision/lock fencing
before implementing a durable partition or any two-leg coordinator. An arbitrary
customer-ID rewrite of the existing single-debtor snapshot is not an acceptable
shortcut (bill-to and customer-specific AR evidence must also be verified).

The reconstruction is a code-only checkpoint, not completion of the six-task
source-billing plan and not the missing c9 release candidate.

## Continuation approved 12/10/2026

Resume from clean `0c913912f930477edc463f84f6ddcf7cf70e26e3` on the same branch.
Fresh GitHub/Lovable still match `6ac17dee`; builder ready/finished. SELECT-only
Cloud inspection confirms automatic receipt migration `20261003120216` installed;
billing/security/source-payer candidate tables absent. Source/reservation/role/
settings identifier and timestamp types match the captured schema. No Cloud write.

Task 1 persistence prerequisites in progress: compound tenant/source/reservation
ownership, Owner source settings, fresh-master validation before durable saves,
server-stamped payer facts, reservation timestamp + payer/policy revision fencing,
and legacy Walk-in mapping copied once without reassigning existing stays.
Supabase CLI 2.120.0 is test tooling via npm exec, no application dependencies or
lockfile changed. Current official migration/RLS docs checked; changelog markdown
fetch unsupported, HTML index checked instead. Supabase search_docs plugin is
not connected; use official docs and the existing Lovable Cloud controller.

Pre-flight: existing policy preparation is not persistence; return SQL-stamped
saved facts, not its in-memory timestamp. Existing billing guard is a prerequisite
for the new source candidate. Policy changes affect future confirmations only;
changing a saved payer updates reservation revision before later billing freezes.
The production master registry stays closed and no UI writes are mounted until
the complete adapter/schema/booking lifecycle is accepted.

Owner clarification 12/10/2026: **no separate Supabase account exists or is
required. All operational HH database inspection/change goes through the current
Lovable Cloud controller**, project/ref above. Recorded prominently in
`docs/project-sources/MDB-01_HOTELHUB_ADOPTION.md` and the replacement Project
Source deliverable. Supabase CLI in this work generates local candidate SQL only;
it is not used to log in/link/push to an operational database. Preserve this rule
in future recovery/adoption/source generation. Do not ask Owner to create or
connect a standalone Supabase account.

Task 1 local migration generated by CLI:
`supabase/migrations/20261011225957_hh_source_billing.sql`. Fourteen executed
PGlite cases RED (schema/RPC absent), then GREEN after resolving an ambiguous
local SQL variable. Nine new policy-store tests RED (module absent), then GREEN;
existing eleven policy tests retained. New RPCs are service-only, active local
N3 user-role scoped, with empty search_path and no browser Supabase auth. Legacy
Walk-in mapping is copied once; settings/historical reservations are untouched.
Source/customer/master registry remains explicitly unavailable by default, so
neither policy update nor payer confirmation can persist unverified current N3
customer evidence. No source endpoint or settings UI is mounted yet.

## Source prerequisite continuation checkpoint — 12/10/2026

Recovered this exact existing isolated worktree and pre-existing dirty policy/store/
SQL work. Implemented immutable bill partition, local document-number reservation
and price-safe guest/accounting display prerequisites without runtime mounting.
Fresh full suite2673passed/38skipped; focused45passed; disposable SQL20passed;
TypeScript/scoped lint/build pass. Independent continuation review: no Critical/
Important defect established; one development-only RED-switch naming Minor deferred.
See `HH_SOURCE_BILLING_PREREQUISITES_CHECKPOINT_20261012.md` for all evidence,
recovery paths, decisions and deliberately incomplete plan units. Original worktrees
preserved. All operational/release/N3 lanes untouched. No full source-billing or
client-ready completion claim. Existing migration history20261003120216 rechecked
through Lovable SELECT only. Native concurrency remains NOT VERIFIED.
