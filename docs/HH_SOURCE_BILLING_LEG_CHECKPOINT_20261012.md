# HotelHub source/guest bill ownership checkpoint — 12/10/2026

Upload to Project Sources: **No** — engineering checkpoint in the review repository.
This records continued approved build work. It is not a deployed release or a
completed source-billing implementation plan.

## Current state

Repository: `mugs-AI/hotel-hub`. Local isolated branch:
`review/hh-reconstruction-20261011`. Input checkpoint `2e908dd` corresponds exactly
by tree to remote review checkpoint `8620f6e` on
`review/hh-source-prerequisites-20261012`. Implementation commit: `254d75a`.

Fresh read-only checks show main and Lovable latest commit
`6ac17dee7b503b96daf89015afdc9fb3995e1b68`, with Lovable ready and its agent finished.
This is repository/Lovable connection evidence; no fresh deployed asset identity
or signed-in live acceptance is claimed here.

Lovable project: `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`.
Its existing cloud database is enabled. Authorised Lovable SELECT inspection
still shows latest installed migration `20261003120216` (`hh_automatic_receipt_controls`).
HotelHub's backend is managed through this Lovable project. The Owner has no
separate Supabase account and must never be asked to create or use one.

Both changed files remain **unapplied candidates**:

- `supabase/migrations/20261008080000_hh_billing_settlement.sql`
- `supabase/migrations/20261011225957_hh_source_billing.sql`

No applied migration was edited. No operational database apply, N3 financial
operation, activation, main merge, publication or Lovable AI Build occurred.
Normal receipt editing remains OFF as the governing release instruction; no
runtime flag inspection or activation is implied.

## Implemented preparation

- One immutable payer/plan, one membership row per original charge, and distinct
  source/guest intent rows under the existing reservation lock.
- Stable leg UUID is also its intent and numbering operation UUID. Each bill
  keeps its own HH number, existing reference shape and frozen customer facts.
- Both intents and both bill numbers are saved in one transaction. Failure on
  the second number rolls back the entire freeze. Same-request replay returns
  the same plan and numbers; conflicting requests stay held.
- Legacy single-intent reads retain their old shape. A source-plan stay requires
  an explicit leg read, including when it has only one populated leg.
- Claim/outcome/prove compare exact leg, intent, plan, reservation and tenant.
  They preserve the existing opaque dispatch/proof authority. A source bill
  cannot create or allocate a guest receipt through either wrapper or core claim.
- Membership, folio mutation and payer changes stay fenced after freeze.
  Another booking's receipt is rejected even when both use the same walk-in debtor.
- Coordinator performs one selected leg action and preserves successful sibling
  facts. Unknown outcomes recover through GET proof; there is no combined repost.
  Action errors survive refresh. An observed401 ends the session and stops later
  sibling reads. Background status performs no SQL proof save or financial POST.
- HH and actual N3 codes remain separate. Guest RM40 receipt behavior was exercised
  with mocked accepted contracts and exact bill/detail/journal evidence.
- All individual source/guest close and abandon actions are denied. Whole-stay
  close remains unavailable (`canClose=false`) pending its accountant-case policy.

## Fresh verification

| Check | Result |
|---|---|
| Default full Vitest suite | 2,695 passed; 38 skipped; zero failed |
| New source store/coordinator suites | 22 passed |
| Disposable source-plan/leg SQL | 15 passed |
| Disposable source policy/local number SQL | 20 passed |
| Legacy settlement SQL | PASS, including all-room rollback, Dirty/DNDoff, replay and browser permission denial |
| TypeScript | `npx tsc --noEmit`, exit0 |
| Changed-file ESLint | exit0 |
| Production build | exit0; final Nitro generation confirmed |
| Protected-file byte comparison against main6ac17dee | unchanged |
| Independent review | One reviewer; no Critical findings; reversal and aggregate-revision findings reproduced RED then fixed GREEN; full suite/type/lint/build repeated after fixes |

New store/coordinator modules and SQL paths were observed RED before implementation.
Stay revision and selected action-error regressions were also reproduced RED then
fixed GREEN. The guest receipt fixture initially assigned an outcome to the wrong
attempt; it was corrected to the exact attempt ID without relaxing evidence checks.

PGlite tests are disposable single-session PostgreSQL checks. They do **not** prove
native multi-session concurrency. Native PostgreSQL/psql/Docker/Podman are unavailable
in this environment; no operational Lovable database was used as a test substitute.

Review found a valid historical charge/reversal pair was counted as active
membership. SQL now validates all reversal pairs, records only active lines,
and still fences every underlying row through sourceVersions. A valid pair passes;
a same-value pair with a wrong stock mapping is rejected. The reviewer also found
reconciliation returned its pre-save aggregate revision. It now reads the current
persisted stay after saving proofs and holds any concurrently changed leg revision.
The final covering tests and whole suite passed after these fixes. No second
reviewer pass or independent confirmation of the fixes is claimed.

## Work still required

| Approved task | Status after this checkpoint |
|---|---|
|1 — source settings/booking confirmation | Policy/store prepared; current-master reader and mounted settings/booking lifecycle pending |
|2 — attribution/partition | Pure partition and durable frozen membership prepared; editable pre-freeze attribution APIs/UI pending |
|3 — leg ownership/numbering | Durable candidate implemented; native concurrency and accepted real reference/number semantics pending |
|4 — two-leg coordination | Fixed scoped coordinator prepared; HTTP/runtime integration and source-debtor contract acceptance pending |
|5 — source-issued/guest-settled close | Accountant cases and atomic whole-stay close pending; cannot close in this candidate |
|6 — privacy/print/readers | Pure audience projection prepared; mounted component, CSV/readers, browser print and legal-document acceptance pending |

The default N3 master/financial contracts remain closed. Existing Post-to-AR Cash
Sale syntax does not establish source debtor credit semantics. The new separate
source contract also defaults closed. Sales Invoice transport is not invented from
a custom guest title. New numbering is local identity; no claim that N3 accepts an
HH-assigned number. Owner-operated bounded N3 acceptance remains a separate lane.

## Decisions carried forward

1. Extend only the observed unapplied candidates; installation order and exact
   deployed schema still require release acceptance.
2. Reuse stable leg UUID as intent/operation UUID and keep the existing HH-B-UUID
   reference shape. New debtor/reference behavior still requires accepted evidence.
3. Preserve server-side persisted facts separately from the allowlisted browser
   view, so credential/snapshot serialization is never a convenience shortcut.
4. Prepare existing Post-to-AR Cash Sale orchestration behind a separate closed
   source-debtor contract; retain Sales Invoice as unaccepted rather than guessing.

These decisions preserve the approved scope. They do not remove the 20/10 UAT/
training and01/11 client-use targets or assert that the remaining work is complete.
The ignored execution ledger remains available for recovery while the plan is partial.
