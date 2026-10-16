# N3 GUID compatibility checkpoint — 08/10/2026

Upload to Project Sources: No.

## Evidence and bounded correction

Resumed the existing billing review worktree at local
`553b164d65622cb2a2a397ae851cbf6c5c6234f2`, remote
`8cf25dc7d5bf26269d7a2093727f73fe2a7a3718`, shared tree
`ce244356eb6bf1969921db18182ab96f2c15eab0`. Completed Tasks1–8,
earlier corrections and the separately published journal diagnostic were preserved.

The already supplied Owner export `20261008T133334-1le2bt`, SHA256
`e359b6b25f6a89d877dd1540ed4ac3c7f3206364e5540d6c768d11a1301c9db5`,
contains receipt GUIDs whose fourth groups start with0/f. Billing's N3 transport
and evidence parser already accept these identifiers, but snapshot, dispatch,
recovery and HTTP account-selection boundaries required RFC UUID version/variant
bits. They could reject an otherwise supported external identity before proof.

A shared nonzero hexadecimal 8-4-4-4-12 GUID predicate now applies only to external
N3 receipt/bill/account identifiers at those boundaries. Zero/malformed values
remain rejected. Local tenant/reservation/intent/attempt/client-request/folio/line/
deposit identity validation is unchanged. Snapshot admission also refuses the
same receipt GUID supplied in two letter cases. It preserves supplied receipt
facts and digest binding; it does not silently normalize or reprice snapshots.

An acknowledgment still saves only an unknown outcome and optional locator.
Bound, fresh document/detail/journal proof remains mandatory. Uncertain outcomes
recover through the saved ID or one exact-reference identity, without repeating
a financial POST. The production contract gate remains unavailable/default-off.
No uploaded JSON becomes runtime authority.

## Verification

- Ten assertions failed before the correction for the expected GUID rejection
  and case-duplicate admission;89 existing/control assertions passed.
- The four focused files passed99 assertions after correction.
- Fresh full suite:2,280passed/20existing skips/0failed;141files pass/3skip.
- TypeScript and production build exit0; all10changed code/test files pass scoped
  lint with0errors/0warnings. Existing npm/Vite configuration warnings remain.
- Full lint was not repeated; its previously recorded170baseline errors and
  38warnings are not claimed fixed.
- SQL/workflows, protected files, dependencies and existing operation gates are
  unchanged. No repeat PostgreSQL acceptance run is needed for this code delta.

One fresh read-only delta review:0Critical/0Important/0Minor. The reviewer did
not run tests/builds; the executor owns the verification results above. Prior
whole-branch reviews were not repeated.

Declined-to-judge rulings: (1) executor checks are fresh local evidence, not
independently executed review checks; (2) private-export authenticity/completeness
is not claimed independently verified by the reviewer; (3) live vendor posting,
INV/refund/allocation/concurrency contracts remain unaccepted; (4) actual database
application/grants/RLS/cache/live-failure acceptance is unchanged and unperformed;
(5) production adapters, lookup completeness and current provenance remain
unfinished; (6) reader/browser/mobile/historical recovery integration remains
unfinished; (7) prior algorithms and normalization beyond this delta were not
re-reviewed; (8) remote parity must be verified separately and no operational
release or plan completion follows from review. These boundaries stand. Cost if
incorrectly promoted: false financial, runtime or release readiness; no gate is
opened on this basis.

Ruling: isolate N3 GUID shape checks from local HH UUID guards — actual external
IDs do not promise RFC bits — cost if wrong: an unsupported external ID can reach
the existing proof readers, but cannot bypass ownership/accounting checks.
Ruling: compare receipt identity case-insensitively only for duplicate detection,
while retaining exact snapshot/evidence binding — GUID letter case cannot create
a second receipt — cost if wrong: a corrupt duplicate candidate blocks settlement
rather than being counted twice.

## Remaining work and release boundary

Tasks9/10/11 remain partial. Accepted current master/snapshot adapters, frozen
print mounting, complete monthly/matched-deposit readers and browser integration
remain unfinished. Vendor acceptance is still required for persisted OR/CS
journals, refund/spendable remainder semantics and atomic stale-allocation
rejection. The detailed questions are in
`HH_N3_JOURNAL_ACCEPTANCE_20261008.md`; no identical diagnostic export or recreated
transaction is needed. Synthetic GUID tests do not accept those contracts.

This continuation is saved only to `review/hh-n3-billing-20261008`. No main merge,
public publish/deployment, database operation/migration, secret change, N3 request
or financial write is part of it. Main remains
`974cb476e95d2b99c4b3236969d06719130209b5`. All existing worktrees and changes are
preserved. Resume pending adapters only from accepted current contracts; do not
repeat Tasks1–8 or enable a financial gate from this checkpoint.
