# HotelHub N3 console evidence continuation — 08/10/2026

Upload to Project Sources: **No** — repository execution evidence.

Starting checkpoint: local`c26fb185e19f4eaa3f16c0363080d50ed9037608`,
remote`aa71d59615618d5bf94837c28d5a69640c11e2cc`, shared
tree`8bf2dd73a9a0eb474811d04f7d3cc96007c3d097`.
Review branch`review/hh-n3-billing-20261008`; worktree clean at recovery.
Fresh main and Lovable latest remain
`734ac405c82e653a7098ce0ef22d51586382bd9d`; Lovable ready/agentFinished.
Existing billing/frozen-folio implementation and other parked worktrees preserved.

## Corrected behavior

The Owner's uploaded GET bundle exposed console parser errors, not new failed
N3 postings. Matching now reads explicit `paymentAmount`/legacy applied or paid
aliases and never treats target document`amount` as an applied payment.
Conflicting or malformed explicit aliases return unavailable; zero stays zero.
The observed active leaf bank/cash shape is classified through`specialCode`
BAC/CAC and inverse`hasChildren`, while contradictory flags stay unavailable.
Safe numeric customer IDs survive normalization, and different known customers
are reported as a mismatch even when document UUIDs match.

Original export SHA256:
`7af5f30224bca23a2ecab7842c53711f9adad01cb7c07b7c1970189ebc521c95`.
Run at08/10/2026 18:13:53 Malaysia; test company9AC-0D9-2F1;
range26/09–27/09, filters empty. Private replay uses the original attachment
and performs no network requests. Synthetic shipped fixtures retain field names
and observed amounts but replace document/account/customer identities.

| Existing documents | Correct matching amount |
| --- | ---: |
| OR2609/001 → CS2609/001 | MYR60.01 |
| OR2609/002 → CS2609/001 | MYR150.00 |
| RF2609/001 → OR2609/001 | MYR40.00 |

The current bill detail reports114.02 outstanding, agreeing with
324.03−60.01−150.00. These are captured historical GET facts, not freshness-bound
production settlement proofs. No journal response was supplied. The refunded
receipt's RF row and outstanding40.00 require accepted vendor semantics;
two added strict-prover regression checks preserve rejection rather than
silently treating that outstanding field as spendable money.

## Scope and remaining work

Only the console parser/comparison rendering, focused synthetic tests, two
existing-prover safety tests and evidence records changed. No production snapshot/master adapter,
contract gate, coordinator, SQL, runtime account reader or print mounting changed.
Tasks1–8 and frozen-print foundation are preserved. Task9/10 live adapter/readers,
Task11 current GL/master/preservation/concurrency acceptance, browser inspection
and independent release lanes remain pending.

Next safe work requires current fixed-path account/master/detail+GL evidence
and vendor allocation concurrency semantics, followed by the production adapter
and remaining read/print/monthly integration. Do not repeat completed manual
receipt/refund transactions. The existing Owner-only financial console reads
detail/list data but does not capture the required journals or vendor atomic
concurrency mechanism; another identical console run cannot resolve those gaps.
Repository JSON never substitutes for authenticated runtime evidence.

Conditional publish approval remains recorded, but readiness is unmet. No main
merge, operational migration/write, N3 write, deployment, publish or Lovable AI
Build occurred in this continuation. The prepared settlement migration remains
unapplied according to the prior live schema checkpoint; this continuation made
no operational database call and does not relabel that older observation as fresh.

## Review and rulings

One independent read-only delta review found two Important issues: conflicting
customer aliases could diverge between raw/normalized paths, and the comparison
screen hid known mismatches. Both reproduced in failing tests and are fixed in
one pass. Scalar/nested customer identity now uses one resolver and retains
conflict state in normalized diagnostic DTOs. The receipt comparison renders
the actual evidence label; a mismatch also replaces its green summary badge.

Ruling: regrade arbitrary numeric GL flags from Minor to Important — a malformed
active flag must not establish account eligibility — cost if wrong: unsupported
numeric encodings remain unavailable. The local account parser now admits only
numeric0/1, retaining supported boolean/string forms. Its failing test passes.

Ruling: preserve strict rejection of the historical refunded-receipt shape —
captured matching links do not prove refund/remainder semantics or journal
conservation — cost if wrong: that shape remains unavailable until vendor-backed
proof and a separately reviewed adapter exist. No financial gate was changed.

Ruling: review only this new delta — the earlier full billing and frozen-folio
reviews are already completed — cost if wrong: unrelated earlier limitations
remain as documented release blockers, not newly reviewed acceptance.

Deferred minor: the GL table's old Special Type cell still displays only legacy
raw SpecialType aliases, so BAC/CAC rows can show a dash beside the corrected
bank/cash eligibility. The bundle contains normalizedSpecialType; defer this
presentation polish rather than mix it into the financial interpretation fix.

Reviewer declined: earlier billing/frozen/SQL/release lanes; live GL, preservation,
concurrency, refund semantics or write contracts; current N3/export provenance
and signed-in browser acceptance; executor test/build/lint claims; final ledger
accuracy; unrelated pre-existing shape detection. Ruling: retain each as outside
this narrow review; accepting any as verified would overstate current coverage.
Executor checks and evidence interpretation are recorded separately below.

## Final verification

- Full suite: **2208 passed,20 skipped,0 failed**;137files passed,3existing optional SQL suites skipped.
- TypeScript, production build and changed-five-file ESLint: exit0.
- Focused console/review tests:111passed. Private actual-export replay:1passed, no network.
- Full lint:170unchanged baseline errors,38warnings. Error sources remain the two
  untouched receipt SQL test scripts (51multisession,119PGlite).
- Diff check clean. Protected files, SQL/workflows, coordinator, production
  adapters and all financial contract gates unchanged from the starting checkpoint.
- Existing native SQL88PASS is prior acceptance, not a newly executed or applied migration.

All tests/build/lint sessions finished. No operational database or N3 request was
issued by Codex in this continuation. Signed-in desktop/mobile acceptance has
not been performed; the UI mismatch behavior has an actual server-rendered check.
The review-branch save is a checkpoint, not main integration or public release.
