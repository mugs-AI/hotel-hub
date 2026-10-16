# HotelHub — supplemental masters and current-accounting adapter

Date: 15/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: **Yes** — add this recovery reference; retain prior
posting, staff-authority and transport checkpoints. This records source work,
not a released or financially accepted checkout workflow.

## Requested supplemental capture is complete

The Owner's new capture contains the one requested currency and three linked
accounts. All four are attempted, captured HTTP 200, hashed, untruncated, with
exact requested/returned IDs and no failure reason. Capture time is
15/10/2026 07:49:23 Malaysia. The filename uses the UTC date14/10.

Local MYR is explicit, with sales/purchase default rates1. The customer control,
stock income and output-tax account types are respectively BCA, INC and BCL;
all three accounts are active and share the exact captured currency. Paired
account-type IDs agree. Independent supplemental detail agrees with34 nested
account links in the previously supplied customer/32stock/tax observations.
No need to repeat the requested four-record capture or38 successful records.
The exports contain observations, not financial posting/knock-off approval.

All42 supplied samples pass the observed-shape parser in a private replay.
All32 stock graphs pass the new current-graph logic against these supplied
currency/accounts in a synthetic GET replay. Missing standalone UOM observations
were replayed from each supplied nested UOM, not retrieved from N3 or newly
captured by the Owner. This is adapter-shape validation, not signed-in runtime
acceptance. Raw exports, tenant master IDs and personal data are excluded from
repository source and this public-compatible handover.

## Implemented in this continuation

- Reviewed local-MYR currency projection, with exact ID/local/rates checks and
  explicit refusal of unsupported foreign/missing rates.
- Six fixed master GET paths on the existing bounded lossless billing transport.
  Reads use the caller's own N3 token, manual redirects and private provenance
  bound to tenant/reservation/user/token/kind/ID. Exported/fabricated/copied
  objects cannot become current transport evidence.
- Per-operation accounting graph: current active customer, currency, stock/UOM,
  independently read customer control, per-stock income and tax posting account.
  Verify exact IDs, active status, account types/codes/currencies and paired
  account-type/currency identities. Never use an EXP account universally.
- Compare tax/line cents against the current mapped rate; a mismatch is refused,
  never a silent folio reprice. Current mapping evidence replaces old untrusted
  mapping fields and carries response fingerprints, without tokens/raw replies.
- Thirty-second operation deadline, shared2MB/128distinct-read budget, request-local
  cache only; expired/changed-caller evidence and401/403 stop further graph reads.
  Independent receipt checking cannot turn expired master evidence into a snapshot.
- SnapshotDeps composition with explicit separately scoped local-folio facts and
  receipt-proof ports. Caller facts are copied, never mutated; another booking
  is refused before N3 reads. Receipt ownership/GL verification remains separate.
- Source-policy production customer reader now verifies current activity using
  the actual caller's N3 session before policy persistence. Generic/test store
  defaults remain closed. Owner policy authority is unchanged.

No new UI, schema, financial contract, environment switch or dependency is added.
The concrete production local-folio facts loader and whole checkout routes/UI
still need completion; this composition does not fabricate those ports.

## Fresh verification and review

Starting source HEAD: e35acdd4c722352525d0c765ee647d25138a1eed on existing
review/hh-reconstruction-20261011. Pre-existing untracked adoption/temp paths
were preserved. No previous completed implementation was restarted.

Baseline3133passed22skipped. The first runner invocation had four import-suite
errors from an obsolete external PGlite module path; correcting to the existing
module restored baseline without product changes. Current full-suite verification:
3177passed,22skipped,0failed;222test files passed,3skipped. DOM and disposable
PostgreSQL WASM lanes were enabled explicitly. Types, eight changed/new source/test
ESLint, production build and whitespace checks pass. Existing full-repository
lint debt307errors is not fixed or called green. No native simultaneous-session,
installed-schema or signed-in N3 acceptance is implied by these fixture tests.

TDD observed failures before implementation: currency acceptance; fixed master
reader/graph/snapshot; production source-policy binding; contradictory currency
and type copies; master expiry during slow receipt proof. Targeted suites passed
after repairs. One independent reviewer found0Critical/2Important/0Minor. Both Important findings
were reproduced RED and fixed in one pass: nested account currency/type/rates
must agree with standalone details, and a source-policy operation pins/checks its
original caller before/after each RPC/master read and before returning. Five
regressions reproduce these findings; all74 focused master/policy assertions pass.
No second review or new deferred minor is claimed.

A subsequent full run found one existing mounted Front Desk payment failure:
`Front Desk can enter and submit actual payment through checkout permission`.
It passed alone. Investigation reproduced it deterministically by delaying account
choices120ms: the test driver attempted to select an option before it existed,
which produced an empty native value. The helper now waits for an enabled field
and the requested option before entry. The delayed regression is RED→GREEN;
all12 mounted-payment assertions pass. No production payment behavior changed.
The final full suite recorded above includes this repair.

Rulings and costs: reuse the already bounded billing transport rather than create
a parallel fetch implementation; master-specific tests protect that coupling.
Retain receipt ownership, source-leg AR remapping, deployed/native/financial and
whole-plan acceptance as external unfinished boundaries; treating this checkpoint
as working live settlement would be incorrect.

## Actual backend/release lanes and next work

Fresh Lovable inspection confirms the exact existing HotelHub project/workspace,
source e8341907a470d0d1e3a39a22413249becf73cd57, ready/agentFinished. Backend is
enabled Supabase stack, managed through Lovable. SELECT-only catalog inspection
again finds zero public hotelhub_settlement_* or hh_source_billing_* functions.
Repository SQL candidates are not installed; no separate Supabase account is
needed or requested.

Next engineering work, without another repeat of these captures:

1. Complete the actual scoped prepared-folio facts/deposit loader and payer
   lifecycle; check changed sources before/after reads and preserve all derived
   charges, tax, print and receipt ownership. Each bill leg must obtain its own
   customer's AR mapping; never clone guest AR evidence onto another customer.
2. Mount per-leg confirmation/posting/payment/recovery and persist verified
   external matching. Whole-stay close remains later than exact settlement.
3. Assemble one main-based code + additive backend/runtime release packet with
   current history/schema/type/grant comparisons and gates closed until proof.
4. Obtain separate exact installation/publication authority and an Owner-operated
   designated N3 bill/receipt/GL/knock-off proof. Automatic matching remains closed
   without its N3-side stale/concurrent update contract. Do not repeat existing
   receipt/journal jobs or issue transactions from generic continuation approval.

This source continuation performs no N3 tenant call, financial transaction,
operational migration/data change, shared push, PR/main merge, runtime activation,
deployment, publication or Lovable AI Build. Posting/payment/matching/Complete
Checkout are not live or financially accepted. Access cards/BEC remain later.

## Verified product checkpoint

Product commit: `2c7a94e93793029f96da59d6aba8f44b5e621b89`.
Product tree: `a29189f87bd03986cbe64b5b42b149209b05a6ae`.
Eight source/test files only. A subsequent documentation-only commit records
this handover and execution ledger; resolve HEAD before resuming. Tracked tree
is clean after that checkpoint, apart from the pre-existing untracked adoption
and Supabase CLI temp paths. Neither path was staged or removed.

Final verification:3177passed/22skipped/0failed; TypeScript, eight-file ESLint,
build and diff check exit0. Two private replay checks pass. Protected files,
packages/locks, SQL and deployment configuration are unchanged. No result here
is a live billing/knock-off acceptance, whole Task2 completion or a main-based
release candidate. Keep the unfinished worktree/plan for direct continuation.
