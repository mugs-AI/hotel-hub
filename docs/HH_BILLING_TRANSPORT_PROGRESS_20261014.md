# HotelHub billing transport and master-evidence checkpoint

Date: 14/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: **Yes** — add as a dated recovery reference; retain the
earlier billing/master/payment/matching checkpoints. This is not a release or a
claim that billing or Complete Checkout is finished.

## Preserved source and current live state

Branch: `review/hh-reconstruction-20261011`.
Starting checkpoint: `9aa224d6a6ac7f8fba5a89d9e8cf4f6e522f01e2`.
Reviewed/tested product commit: `362693d011670a7db5f58d3edbfff284b250f385`.
Product tree: `d1ef407b9ff30276208c188c3e11f4625f26c623`.
The following documentation-only commit saves this handover; resolve its HEAD
before resuming. Do not replay the implemented transport repair.

Fresh GitHub main and Lovable source both remain at
`e8341907a470d0d1e3a39a22413249becf73cd57`, exact published capture-only tree
`c44ad15bb907722407ade60a2b091d897a98ecd2`. This broad source is not a reviewed
main-based production candidate. Existing untracked adoption/temp paths remain
preserved. No protected launch/store/integration/package/lock files changed.

## Latest Owner-supplied master evidence

The latest two batch exports contain 20+18=38 successfully captured records:
1 customer, 32 stocks (29 room stocks/3 other items), 3 standalone UOMs, 1 tax and
1 account. Every entry is GET/HTTP200, matches its requested immutable ID and has
no truncation; no duplicate master identities occur. All stock/nested UOM active
flags are true, UOM rates are 1, standalone unit copies agree, scalar/nested
control/preset/tax-account identities match, and observed currency graphs agree.
All 38 samples pass the existing pure observed-shape parser with
`postingAuthority:false`. No supplied raw exports were added to the repository.

These supplied sanitized results confirm the capture correction's observed
behavior. Their raw response hashes cannot be independently recomputed from the
sanitized samples. They do not prove current posting eligibility or a financial
transaction. Standalone currency detail and three independently captured related
accounts remain requested but absent. Customer numeric status semantics remain
unaccepted. The expense-type standalone account is not universal income or a
cash/card collection account; its configured role still needs validation.

## Transport repair implemented

The unfinished billing transport repeated the workerd-incompatible
`redirect: "error"` option. Master capture already has a separately released
manual-redirect correction. Real loopback HTTP with a Request-mode shim reproduced
the billing failure; no live N3 call was made.

Only two application/test files changed:
- `src/lib/n3-billing.server.ts`
- `src/lib/__tests__/n3-billing-runtime.test.ts`

The five fixed GET readers and gated bill/receipt/allocation POST paths now use
manual redirects. All 300-399 responses return status plus null body without
following, parsing or creating provenance. Existing coordinator acknowledgment
keeps redirects and transport failures unknown with durable one-dispatch fencing.
No retry or financial-success inference was introduced.

Caller cancellation promptly settles an uncooperative request. Late fetch/body
continuations cannot consume shared verification bytes or mint provenance after
timeout. A snapshot of the actual dispatch actor binds the outgoing token and
the returned server-held provenance; caller mutation cannot rebind identity.
Active 401 responses retain terminal classification before body cleanup. Already
cancelled/expired responses remain fenced. Cleanup does not change returned facts.

Owner-only financial write authority, current unavailable contract gates,
unavailable live master snapshot, split/matching acceptance and all existing DTOs
remain unchanged. This change does not implement the requested Front Desk billing
authority or activate financial writes.

## Fresh verification and independent review

- Baseline full suite: 3,066 passed / 22 skipped / 0 failed.
- All 22 new runtime/recovery tests failed before implementation, then passed.
- Focused new/existing billing tests: 41 passed / 0 failed.
- Final full suite: **3,088 passed / 22 skipped / 0 failed**.
- TypeScript, changed-file lint, production build and whitespace checks passed.
- Explicit existing local DOM/PGlite lanes were used. Loopback writes are synthetic
  test HTTP only; no operational database/N3 fixtures were written.
- Recorded 307 legacy full-lint formatting errors remain; full lint was not rerun
  or described as green.
- One independent final reviewer found no Critical, Important or Minor findings;
  no second review or speculative fix pass was needed.

## Rulings and acceptance boundaries

Ruling: advance this independent Task3/4 transport prerequisite while Task2 master
acceptance is incomplete. Cost if mistaken: source transport success could be
confused with live accounting readiness. All financial activation/release gates
therefore remain closed; the broader billing plan is not marked complete.

The reviewer deliberately did not certify: (1) deployed workerd execution,
(2) live N3/network/credentials/permissions, (3) master/currency/status contracts
or live snapshot mounting, (4) financial creation/GL/INV/split/concurrency contracts,
(5) staff authority across HTTP/store/SQL/N3, (6) installed DB/grants/concurrency or
real recovery, (7) receipt ownership/conservation/source legs/matching/refunds and
accountant cases beyond preserved transport boundaries, (8) UI/prints/reports/
checkout/room-release/no-show acceptance, (9) whole-plan/merge/publication/activation,
(10) independently rerunning the reported checks, or (11) unrelated unchanged
adoption/temp/repository behavior. Parent verification supplies the reported test,
type/lint/build results and preserves unrelated paths; all actual live/workflow
items remain pending. Cost if those boundaries were treated as accepted: an
unproven financial or room-release operation could be enabled prematurely.

## Next permitted work

Continue approved master/payer adapter, staff authority, bill/receipt contracts,
matching and whole-stay checkout work from this preserved source. Obtain the
previously requested small supplemental master capture and authoritative customer
status semantics before mounting an accepted posting snapshot. Do not repeat
successful room-stock batches or earlier journal proof jobs unnecessarily.

No shared push/PR/main merge, migration, backend/secret/runtime-setting change,
N3 call/financial transaction, Lovable AI Build message or publication occurred
in this slice. Backend access remains through the existing Lovable-managed
project; no separate Supabase account is required.
