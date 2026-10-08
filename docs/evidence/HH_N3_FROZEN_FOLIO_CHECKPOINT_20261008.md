# HotelHub frozen-folio continuation — 08/10/2026

Upload to Project Sources: **No**. Repository delivery evidence, not a replacement source.

Status: **review-only foundation; Task10 partial; not release-ready**.
Prior checkpoint: local87afcabc3cedfdfdd8adfb4751f24fb03217f45e /
remote426e29e74f7bf78d462a65ec5741f6f7f645ead9; identical
treeb5d3b14746e70cdb2606ce439a36d0c373d8583a.
Product main inspected734ac405c82e653a7098ce0ef22d51586382bd9d.
Resolve the review branch HEAD for this continuation's resulting commit/tree.

## Prepared, not activated

- Optional version1 `folioProjection` inside the immutable settlement snapshot.
- Captured existing prepared folio rows, room labels, dates, tax metadata,
  charge/tax/footer totals and safe display fields; no second price/tax calculator.
- Commercial rows bind exact snapshot IDs, quantities, unit prices and subtotals.
  Tax/service/levy groups bind admitted amounts. Rounding stays in the footer
  and requires its exact snapshot mapping; no fabricated detail row.
- Unknown fields, recorded-deposit claims and edit permissions are stripped.
  The statement remains preparation-only, not fresh N3 accounting evidence.
- Reader validates tenant/reservation, canonical snapshot digest and packet.
  It uses only `hotelhub_settlement_read`; no N3 call or mutation.
- Missing historical packets, contradictions, denied/failed/missing/stale RPCs
  remain unavailable. Only explicit null intent is absence; never reprice on errors.

The read adapter is deliberately **unmounted**. Applying it before the additive
schema is independently accepted would break current default-off printing, or
require an unsafe cache-error fallback. Current folio/client/print paths are
unchanged. Production snapshot/master adapter must provide the accepted packet;
all live reader wiring, caller auth, layout and prepared-deposit wording need
integration acceptance. These are not established by the unit tests.

## Verification and review

| Check | Actual result |
| --- | --- |
| Initial scoped baseline |48pass |
| Stub behavior RED |18fail/2already-conservative-pass |
| Snapshot packet RED |2fail, then GREEN |
| Tax relabel / unsafe error RED |2fail, then GREEN |
| Independent review |3Important/0Critical/0Minor; read-only gpt-6-astra |
| Review fix RED |3fail, then GREEN: hidden rounding, cancelling fabricated detail, footer-only rounding |
| Final scoped snapshot/projection |45pass |
| Full `npm test` |2179pass/20existingskip/0fail;135filespass/3skip |
| `tsc --noEmit` |exit0 |
| `npm run build` after fixes |exit0; no deployment |
| Changed-file ESLint |0errors/0warnings |
| Full lint |170identical baselineerrors/38warnings; no new issue |
| `git diff --check` / protected blobs |clean / unchanged |
| SQL/workflow/check files |unchanged87afcab; prior88PASS native evidence retained, not rerun |
| Browser/live print |not verified, not activated |

Logs remain in the preserved plan workspace. Review findings/rulings and
declined scopes are mirrored in `docs/HH_N3_BILLING_EXECUTION_20261008.md`.

## Remaining work and independent gates

Owner must designate the disposable non-production N3 tenant/current supported
session and exact synthetic IDs for the prepared proof jobs. Begin with the
read-only master/document diagnostics lane. Posting/allocation/concurrency jobs
require their own exact scoped approval; no sample amount or date is authority.
Owner operates those jobs; Codex prepares instructions and reviews sanitized
evidence. Never use the disputed BK260920001 / OR2610/001 receipt.

Then implement accepted production master/snapshot and complete monthly/matched
read adapters, supply/mount the frozen projection safely, and inspect desktop/
mobile signed-in behavior. Keep SQL application, runtime activation, code main
merge and publishing as independent approved lanes. No implicit correction,
refund/unmatch/void/replacement, access-card or BEC work belongs to this delta.

This continuation performed **no operational database or N3 query/write,
migration, main merge, deploy, publish or Lovable AI Build**. Only the isolated
review-branch checkpoint is eligible to be saved. Existing changes and plan
workspace are preserved. No new application dependency or protected-file change.
