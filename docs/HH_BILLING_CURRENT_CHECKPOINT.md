# Current continuation — 16/10/2026, Malaysia · Revision10

Upload to Project Sources: No additional upload requested. This top section supersedes older progress-state statements below.

Knock Off / Settlement is implemented in the clean main-based release candidate, draft [PR16](https://github.com/mugs-AI/hotel-hub/pull/16). Live main/Lovable remain e8341907; the app still shows preparation-only checkout. Associated application migrations remain unapplied, and N3 financial operation gates remain closed. Nothing has been represented as a successful N3 post or public release.

Final source checks: **3,481 passed /22 skipped /0 failed**, TypeScript, changed-file lint and production build pass. Seventeen mounted settlement cases pass.

New source36a57d5 connects existing guest-leg Match Deposit, exact-balance Receive Payment and saved-receipt matching/recovery. Independent review found two Important recovery issues, reproduced and fixed once; final verification/identities are in the execution ledger and release packet. Source legs cannot receive guest payments. Unknown outcomes never invite recollection.

Native PostgreSQL17.6 combined11-migration/freeze/20-session claim race PASSED in GitHub run38828072125. This supersedes earlier native-not-run statements for this narrow claim lane only. Application installation and N3-side allocation concurrency are still unverified. See docs/evidence/HH_CASHMEMO_NATIVE_CI_20261016.md.

Latest direct Owner instruction authorizes settlement implementation and associated posting DB/API logic; publication authority is already recorded. Preserve exact release sequencing and the separately unapproved cleanup of the marked private test schema. The current external blockers are a designated synthetic proof booking, Owner N3 session/proof and supported vendor GL/refund/stale-matching semantics. The cloud browser currently displays Sign in from N3. No separate Supabase login is needed. Do not repeat completed master/journal captures or prior N3 UI exercises.

Active checkout: `/workspace/scratch/cb26166d36cb/hotel-hub-cashmemo-release`, branch `review/hh-cashmemo-release-20261015`. Keep the original reconstruction checkout preserved; resume this candidate rather than repeat it.

---

# HotelHub — current billing checkpoint

Version: 15/10/2026, Asia/Kuala_Lumpur. Revision 9: mounted per-leg billing and frozen recovery; exact release/database scope and approval-review stop. Owner reports the three-file pack uploaded and approves continued source work; no Project Sources cleanup is claimed.
Upload to Project Sources: **Yes**, as part of the THREE-file pack below. This supersedes the earlier one-file removal proposal. Keep one active copy of this stable filename.

## Latest CashMemo continuation — 15/10/2026

Owner approval at22:56 MYT authorizes continued work through CashSalesMemo posting and publication when complete. Publication permission is recorded; routine re-approval is unnecessary. The exact database/financial proof controls remain separate. **No additional Project Sources upload is requested.**

- Source `76aecf4` mounts the existing authoritative plan/store/coordinator through fixed scoped read/confirm/step/reconcile routes and a final-bill card in Reservation and Prepare Checkout. Review GET never freezes or posts. Stable request keys, pending/scope fences, fresh review after change, separate source/guest status and exact HH/N3 identity display are implemented. Source collection and whole-stay room release are not granted by billing.
- Frozen recovery uses immutable canonical preparation plus exact frozen plan membership/source versions and original bill date. Fresh current own-caller master/receipt evidence and before/after local fences must agree; it does not reprice today's whole stay or compare a sibling leg against the whole folio. Master401 becomes the coordinator's session-expired stop signal.
- Independent review:0Critical/1Important/1Minor;49focused independently passed. Both user-facing findings are fixed in one RED→GREEN pass at`ff1bcb6`: initial preparation blockers always offer explicit reload, and source actions directly refresh matching folio/checkout/report/payer/allocation readers without a legacy subscriber; foreign booking/tenant caches remain untouched. Reader finding regraded Important due stale frozen editor affordances/status. No second review; prior deferred minors remain.
- Latest source verification: **3,471 passed /22 skipped /0 failed**, types and SSR build pass. Full repository lint is now **0 errors/39 existing warnings** after formatting-only cleanup of the four legacy check/evidence scripts. Combined11 additive migrations pass disposable rehearsal with PostgreSQL body checking enabled and existing receipt generations retained.
- A clean candidate is based on actual main`e8341907`, branch`review/hh-cashmemo-release-20261015`, preserving both released main handovers and all protected code/dependencies. Original broad branch and pre-existing untracked files remain. GitHub native CI uses disposable PostgreSQL17.6 and a20-session source-leg claim race; record its completed result separately, never substitute PGlite for concurrency proof.
- **Automatic approval-review stop:** the marked private schema`hh_cashmemo_probe_20261015` was partially populated during native rehearsal, then further SQL was rejected under retained source-only authority. Guarded cleanup was separately rejected because its two bootstrap marker tables are nonempty and deletion lacks explicit authorization. It remains63tables/125routines with only those2marker rows, no tenant/guest/booking/receipt rows; anonymous/authenticated access is revoked. Application billing routines remain0 and actual migration history40; no application migration or N3 financial write occurred. Do not retry or bypass either rejection.
- The exact cleanup and11 additive application migrations, hashes, controller, sequencing and Owner proof requirements are listed in **[HH_CASHMEMO_RELEASE_PACKET_20261015.md](HH_CASHMEMO_RELEASE_PACKET_20261015.md)**. Explicit database authorization is required by automatic review. No separate Supabase account is needed.
- No existing stay was selected as a financial test: five checked-in stays and zero prepared folios were observed. Owner must designate a synthetic booking/leg and operate the bounded own-session proof required by the adoption. Prior N3 UI/accounting/master exercises are not repeated, and CBE read-only PI evidence is not CashSales API acceptance. All financial contract gates remain closed pending exact evidence.

CashSalesMemo posting and publication are **not complete**. Continue from the draft candidate after the database scope and exact Owner proof target are settled; finish actual installation/runtime/N3/live acceptance before claiming release. The wider payment/matching/print/accountant/whole-stay-close plan remains unfinished.

## Latest authoritative per-leg preparation — 15/10/2026

This section supersedes older claims that the production plan preparer is absent. Routine evidence stays in Git/chat; **no additional Project Sources upload is requested**.

- Source checkpoint `750d92def4d293c4dfe07594733c1abd3282485e`, product tree `2b756ab040111e4ace6bbd5e385c4d78567bdff9`, on the existing isolated branch. Resolve the final documentation recovery HEAD with Git. Existing partitioning, saved payer and charge-allocation implementation are reused.
- `prepareLiveSourceBill` supplies a server-owned preparation port for the existing source-confirmation service. It takes only the current caller context. One canonical charge/allocation snapshot supplies saved payer, exact membership, money and receipts. Every line is then verified against its assigned customer's own current customer/AR account and stock/UOM/revenue/tax graph. Source and guest account evidence are separate. Source lines never inherit the guest debtor mapping merely by changing the header.
- Source bill-to uses the observed current customer contact fields, projected to bounded name/address/phone/email. Missing or unsupported contact shapes fail closed. Existing guest bill-to remains from the prepared booking. Whole-folio projections and private caller credentials are excluded from the partitioned plan.
- Stable leg IDs derive from a domain-separated digest of tenant, reservation, folio, saved payer revision, allocation basis and leg kind. Repeated unchanged reviews preserve IDs and plan digest. Current payer/allocation/frozen state is checked again after master reads; caller switches, stale choices, unassigned derived charges and failed own-session verification deny preparation. Candidate SQL freeze still independently checks raw source versions and exact membership under its locks.
- This is a **read-only preparation checkpoint**, not a mounted live checkout flow. Existing confirmation review accepts the prepared plan while closed contract gates keep `canConfirm:false`; opening/reviewing it does not freeze or issue documents. A complete production frozen-leg adapter is still needed before mounting confirmation/payment/recovery routes and cards. Saved leg snapshots intentionally omit sibling/whole-folio projections and must not be naively passed to the whole-folio loader.
- Final verification: **3,443 passed / 22 skipped / 0 failed**, 239 files passed / 3 skipped. TypeScript, six-file scoped lint (zero errors/warnings), whitespace and SSR production build (exit0,27.96s) passed. Ten factory cases cover saved overrides, stable identities, stale/unassigned allocation, line-fact integrity, changed payer/caller, failed proof and denied role. Nine contact cases cover bounded/nullable observed fields and unsupported shapes. Two integration cases compose real allocation, bounded own-token GET transport/master graph and confirmation review: distinct source/guest AR succeeds, incorrect source account type denies, no financial POST/freeze occurs, and confirmation remains gated.
- Independent review `5aebdcd..750d92d`: **0 Critical / 0 Important / 1 Minor**. Reviewer independently ran all 63 focused cases. No fix pass or second review was needed. **Deferred Minor:** tests cover payer-revision changes during verification but do not separately mutate only allocation or freeze state during that await. Both guards are present and were checked by inspection; no runtime defect was found. Prior deferred minors remain.
- Review declines remain explicit: live/deployed N3 and financial-contract acceptance, installed SQL/native concurrency, production end-to-end loading, frozen-leg recovery/mounting, payment/matching/accountant/print/report and whole-stay close/no-show are not established by this preparer. Booking navigation, another staff member resuming dispatch, partial posting recovery, midnight close and shared-customer receipt conservation still need their designated integration/acceptance work. Treating this source checkpoint as complete live checkout would bypass those pending gates.
- Fresh read-only observations: GitHub main and Lovable latest commit remain `e8341907a470d0d1e3a39a22413249becf73cd57`; Lovable is ready/agent finished; installed source/settlement/canonical billing routine count remains **zero**. No migrations or protected files/dependencies changed. No operational SQL, N3 financial write, shared push/merge, AI Build, deployment/publication or activation occurred. Existing master captures remain complete.

Next remaining engineering: frozen-leg recovery from immutable canonical history with fresh current caller proof; then production source services/routes/cards and affected readers. Payment/matching/whole-stay close, native concurrency, actual installation and signed-in/live N3 acceptance remain pending. Complete Checkout and the broad billing plan are unfinished.

## Latest charge allocation continuation — 15/10/2026

This section supersedes older charge-attribution progress claims below. Routine evidence stays in Git/chat; **no additional Project Sources upload is requested**.

- Source `914cca726159265a7bf4ca1bee0c4ddbe36aba74` plus reviewed fix `9d3c2e4290c89105268722f4b3846579f599218a`; final product tree `99b0eaa35cfa1890e14446474474a71588301c2f`. Same isolated `review/hh-reconstruction-20261011` branch. Resolve the final documentation recovery HEAD with Git. Existing payer, canonical prepared snapshot and bill partition logic are reused.
- Reservation now has **Bill charge allocation**. Review loads explicitly; opening the reservation does not start this review or save allocation. Owner assigns every active canonical charge to one bill before billing freezes; Front Desk reads only. Guest collection defaults all charges to guest. Source collection defaults room charges to source and extras to guest; derived source charges require an explicit choice. Tax stays with the charge. No browser amount/customer/account authority or financial writer was added.
- The fixed same-origin read/save route and allowlisted browser DTO/cache are scoped to the current tenant/user/role and reservation. Owner saving asserts the reviewed basis digest and allocation revision; the server rereads saved payer and the existing current prepared snapshot. Background basis changes require explicit refreshed review; late saves cannot replace a different booking/session view. Auth transitions purge the new allocation prefix even with the card closed.
- The existing live prepared adapter now accepts the trusted saved payer's guest customer as its initial customer; browser inputs cannot set it, and an existing frozen snapshot retains its own customer. Allocation requires the real prepared folio/current mappings and own-session receipt proof. It stays unavailable rather than inventing amounts or tax rows when those prerequisites fail.
- CLI-generated additive candidate `20261015134554_hh_source_charge_attribution.sql` stores the exact payer revision, canonical scoped charge descriptors/property date and raw source fingerprints with complete unique assignments and immutable audit. Save validates current reservation/folio/payer, source versions, property day and exact active raw/deterministic derived line membership under reservation guard. Audit failure rolls back the save. Reads and allocation saving never persist billing preparation or dispatch N3 documents.
- Source freeze independently enforces the saved allocation or established default assignment. Changed payer/charges/date require new review. Exact existing frozen-plan replay retains its original semantics. Renamed original freeze routines and internal validators are revoked from service/browser access. The legacy freeze route rejects saved-payer stays, so it cannot silently ignore source/guest splits; no-payer legacy behavior remains. **Source-payer checkout still awaits the unfinished per-leg production mount and separately approved code/backend release.**
- Independent whole-checkpoint review `4a4b48b..914cca7`: **0 Critical / 1 Important / 1 Minor**; reviewer independently reran all 29 then-current focused cases. Important stale frozen responsibility display was reproduced in two real HTTP/PGlite cases: save allocation, change payer/customer or charge, then close/cancel without a validating source plan. Both returned200 before the fix and409 after. Frozen reads now require the matching saved payer revision and validated immutable source bill plan; they reconstruct the historical basis and membership from saved leg facts. A positive actual frozen-plan regression makes the current-snapshot dependency throw and still reads successfully, proving no historical repricing/current N3 read. No second review.
- **Deferred Minor:** legitimate default/guest freeze with no separately saved Owner allocation remains unavailable in this allocation card after freeze. Financial enforcement is intact; a future frozen-plan/default reader can improve visibility. The earlier TypeScript SST early-feedback minor remains deferred; SQL still rejects class-rounding disagreement before persistence/freeze.
- Final full suite: **3,422 passed / 22 skipped / 0 failed**, 238 files passed / 3 skipped. Feature coverage: eight service cases, nineteen real HTTP-to-disposable-PostgreSQL cases, five mounted cases. TypeScript, changed-file lint (zero errors, one existing FastRefresh warning), whitespace and full SSR production build (exit0,7.37s) passed. Initial full run exposed one existing mounted policy-notification timing failure; isolated run passed, then the test was corrected to await observed React Query policy version before asserting confirmation invalidation. Product behavior was unchanged by that test correction. Native concurrent-session proof remains unverified.
- Fresh GitHub main remains `e8341907a470d0d1e3a39a22413249becf73cd57`; Lovable is ready/agent finished; SELECT-only installed billing routine count remains zero. No operational SQL application, N3 financial write, shared push/merge, Lovable AI Build, deployment/publication or activation. Protected files/dependencies are unchanged. Existing master captures remain complete.

Next remaining engineering: the authoritative per-leg debtor/control-account factory, per-leg bill confirmation/posting/payment/recovery routes and cards, and affected balances/readers/prints. Signed/rounding/partial credited-tourism contracts, native concurrency, installed grants/backend, exact N3 financial proof and signed-in whole-stay checkout acceptance remain separately pending. Broad Task2/Task3 and Complete Checkout are not complete. Preserve the unfinished plan workspace and original approvals.

## Latest initial booking payer continuation — 15/10/2026

This section supersedes older initial-new-booking-default progress claims below. Routine evidence stays in the repository; **no additional Project Sources upload is requested**.

- Source `905fe032bd221745e5ea127f7a0a29a69143a9d0` plus reviewed fix `9313756cc8a18ba9b8c0062583b08696ada41f29`, final product tree `b80d0405b6e5b29913fafbec311cd25aa7caa80d`, on the same isolated `review/hh-reconstruction-20261011` branch. Resolve the final documentation recovery HEAD with Git. Existing source policies, customer adapters, reservation creation and payer confirmation/audit are reused.
- New Reservation reads the selected source configuration with an own-session, tenant/user/role-scoped GET. The configured room collection mode supplies the default; staff must explicitly confirm the arrangement before creation and may choose another allowed mode at entry. Source, policy or identity changes invalidate confirmation. Payer confirmation is not restored from drafts. Existing-stay changes remain Owner-only.
- CLI-generated candidate `20261015132243_hh_initial_reservation_payer.sql` adds a service-only entry read and atomic create wrapper. Source and policy locks bind the selected source, reviewed policy version and allowed mode. The wrapper calls existing reservation creation, then existing payer confirmation/audit in the same transaction. Failure rolls back reservation, rooms, guests, reference counter and payer/audit together. Source settings never rewrite saved snapshots. GET never saves a payer or dispatches financial work.
- The candidate revokes direct service execution of the former create RPC, preventing a caller from omitting initial payer selection after installation. Before this candidate is installed, only an exact missing-entry-routine result preserves existing legacy booking. Other failures block with setup guidance; a selected payer never falls back to legacy creation. **Install code and backend together in a separately approved release.** Stale pre-installation drafts receive `initial_payer_required` and reload, rather than creating an unreviewed booking.
- Entry configuration is not current N3 customer or accounting evidence. No empty-booking Front Desk N3 master access was added. Current customer/account checks and all financial contract gates still apply before dispatch; stale configuration can be saved at entry but must block later financial preparation until repaired by Owner.
- Independent whole-checkpoint review `6d54310..905fe03`: **0 Critical / 1 Important / 0 Minor**. One fix pass reproduced pending draft/payer editing in a real mounted wizard with a deferred POST, then disabled the submitted form/steps/discard/payer controls and Cancel action until resolution. Success opens the original saved booking and clears only its draft; rejected creation unlocks the original draft and retains guest identity. No second review. Prior deferred minors remain.
- Final verification: **3,390 passed / 22 skipped / 0 failed**, 235 files passed / 3 skipped. TypeScript, changed-file lint (zero issues), full SSR production build (exit0,13.94s) and whitespace checks passed. New evidence includes nine disposable SQL cases, eight scoped configuration reader cases, five mounted payer lifecycle cases, two deferred mounted wizard cases, and the existing create HTTP suite with five added cases. The final type-only fixture correction keeps raw identity exclusively in the memory vault and persisted draft identity empty; focused wizard tests passed again. Native concurrency and installed/backend/live N3 acceptance are not implied.
- Fresh main remains `e8341907a470d0d1e3a39a22413249becf73cd57`; Lovable is ready/agent finished. SELECT-only inspection confirms only the original nine-argument create RPC and no source billing routines installed. No operational SQL application, N3 financial write, shared push/merge, Lovable AI Build, deploy/publish or activation occurred. Protected files and dependencies remain unchanged. Existing master captures stay complete.

Next remaining engineering: Owner pre-freeze charge attribution, authoritative per-leg debtor/account plan, then per-leg confirmation/payment/recovery routes/cards and affected readers. Broad Task2/Task3 and Complete Checkout remain unfinished. Native concurrency, installed privileges, live contracts, shared-customer receipt ownership, partial recovery and whole-stay close/no-show acceptance retain separate proof gates.

## Latest policy/payer continuation — 15/10/2026

This section supersedes the older **current implementation-state** claims below. Routine evidence stays in this repository and chat; no extra Project Sources upload is requested.

- Source mount `fd729df51fa489b27a584d31a01d0fb3f4fdecbd` plus review fix `ed58d6354e9cabeddd726417c656f462b60b2de2` (final product tree `8b10b8e5924f0d03e0fa810cc97debc0e1ec1b81`) on the existing isolated branch. Resolve the documentation recovery HEAD with Git. The existing current-customer adapter was already connected and reused.
- Settings → Booking Sources now has a source billing-policy editor using the existing own-session N3 customer picker. Reservation has a saved payer/collection card. Owner configures policy and changes existing-stay payers; Front Desk reads them. The Owner settings read separates saved configuration from verification so an inactive customer can be replaced; this read never grants financial authority. Scoped, same-origin GET/POST routes use the existing fenced store. Opening either page never persists a payer or posts money.
- Browser DTOs exclude credentials/private proofs; query and mutation caches follow tenant/user/role and booking/source identity. Auth transitions remove policy/payer data even when these screens are closed. Late saves cannot replace a different booking/session view. Frozen stays and stale revisions deny changes. Both the browser-reviewed policy/source/timestamp and the existing transaction-owned SQL version/timestamp checks must agree. Background changes require an explicit refreshed review.
- Owner Settings may read the selected current customer without fabricating a reservation UUID. This empty-booking exception is limited to the fixed customer GET; other master reads and all financial writes retain the original booking fence.
- Four disposable HTTP → real store → PostgreSQL cases verify explicit audited saving, zero payer creation on GET, stale rejection, saved payer preservation after policy changes, Front Desk read-only behavior and closed-stay refusal. Current N3 customer GET identity/provenance tests remain separate; no live N3 transaction is implied.
- Final source suite after the review fix pass: **3,361 passed / 22 skipped / 0 failed**, 231 files passed / 3 skipped. TypeScript, changed-file lint (two existing FastRefresh warnings), full SSR production build and whitespace checks passed. Independent review of `c1affce..fd729df` returned 0 Critical / 6 Important / 0 new Minor. All six Important findings were reproduced and fixed in one pass: picker pagination/Enter never submit; payer saves assert the Owner-reviewed source ID, policy version and reservation timestamp; saved/prospective room and extras accounts are separate; an obsolete saved mode requires explicit choice; DTO/input limits preserve the established 160/600 text contract; Owner can read and repair saved configuration with separate verification blockers while saves and payer preparation still require current valid customers. Focused final checks: 59 passes, including seven HTTP-to-disposable-SQL cases and exact stale-policy/source/booking rejection with no payer/audit insert. No second review is claimed; prior deferred minors remain.
- Fresh main remains `e8341907`; Lovable is ready/agent finished; SELECT-only installed billing routine count remains zero. No new SQL, packages, protected files, shared push/merge, AI Build, operational backend or N3 financial writes, deployment/publication or activation.

Remaining Task2/3 work includes initial new-booking default payer snapshots, pre-freeze charge attribution and the authoritative per-leg production plan/services/routes/cards. The manual existing-stay payer controls above do not complete that integration. Earlier signed/rounding/credited-tourism and N3 contract gates, native concurrency, installed backend and signed-in whole-stay acceptance remain pending. Existing master captures are complete; no repeat capture is requested.

## Latest implementation supplement — 15/10/2026

This supplement supersedes older **progress-state** claims below; it does not replace the approved three-file arrangement, original history archive or 140-case QA matrix. Routine implementation evidence stays in Git/chat; no additional Project Sources upload is requested for this checkpoint.

- Branch `review/hh-reconstruction-20261011`; canonical preparation product `2c79755f2cdc30472c72ea43e0abfd04a5ae0db2` plus reviewed rounding fix `2ae2c67e39acb48ccf512e239085605444ca83f4` (final product tree `fdf1791cec1d95c6168c1fded768251b4feade78`), following production snapshot bridge `d6aeab45a107516e606260b37716c4f744f14c65`. Resolve the final recovery HEAD with Git; full review/fix evidence is recorded in the execution ledger.
- Fresh GitHub main remains `e8341907a470d0d1e3a39a22413249becf73cd57`. Lovable project is ready/agent finished. Fresh SELECT-only backend inspection still returns **zero** settlement/source/canonical billing routines. No fresh signed-in/public acceptance is claimed; the broad billing source is unpublished and candidate migrations are unapplied.
- The production snapshot adapter reads bounded tenant/booking-scoped local facts, corrected/voided effective receipts, source fingerprints before/after, current customer/currency/stock/UOM/tax/account graphs and own-session receipt detail/GL proof. Customer master code is kept separate from the receivables control GL code.
- Canonical preparation now projects calculated SST and supported positive service-charge/tourism/local-levy rows separately from operational folio history. Each charge embeds its own SST once. Captured stock/UOM stay intact; the canonical tax code comes from the current financial configuration governing the calculation. Missing/ambiguous mappings, incompatible tax rounding, signed charges and nonzero rounding stop before dispatch.
- New additive migration `20261015064523_hh_canonical_billing_preparation.sql` creates immutable, scoped preparation records and saves them **inside** explicit legacy/source freeze transactions. GET/print never save them. SQL independently checks exact raw membership, source versions, bounded numeric cents, per-line/class tax agreement, derived identities/configured amounts/mappings, own operator and receipt ownership. Failed freezes roll back preparation and audit together. Source membership accepts derived canonical IDs without fabricating operational folio rows. Internal preparation helpers have no browser/service direct execute grant; the authorized freeze functions call them as security definers.
- Frozen recovery preserves the validated original projection, bill date and digest across property midnight. Current source versions, financial settings and N3 mapping/receipt proof must still agree; changing raw facts or caller identity blocks recovery.
- Final full source validation after the review fix: **3,312 passed / 22 skipped / 0 failed**, 228 test files passed / 3 skipped. TypeScript, eight changed-file lint checks, production build and whitespace checks passed. The new disposable SQL lane has 27 cases, including real folio calculator → preparation → snapshot → freeze, derived source membership, rollback, privileges, malformed amounts, duplicates and stale facts. Legacy whole-repository lint debt remains. Independent review of `a6862b0..2c79755` returned 0 Critical, 1 Important and 1 Minor. The Important configured-rounding omission was reproduced through both freeze entrypoints and fixed in one RED→GREEN pass; no second review is claimed. SQL now rejects nonzero configured document-rounding adjustments before preparation/audit persistence, while allowing already-rounded totals. One minor remains: offsetting class rounding errors can pass the TypeScript aggregate-SST check, then fail safely at SQL class validation before any preparation persists.
- Native independent-session PostgreSQL testing remains **unverified**. This runtime refused non-root ownership/group changes while initializing the isolated test server. No server started and no bypass/escalation was used. PGlite evidence is not native concurrency acceptance.

### Remaining production work and proof

The previous unconditional `settlement_prepared_posting_rows_required` block is replaced on the live adapter by canonical preparation for its supported charge shapes. This does **not** finish all billing: signed discounts/adjustments, rounding, partial platform-credited tourism-tax line treatment and N3 liability-posting contracts still require explicit implementation/proof. Room UOM ambiguity and absent dedicated mappings remain visible failures.

Complete saved payer lifecycle and pre-freeze attribution, each leg's own debtor/control-account graph, per-leg confirmation/payment/recovery mounting and affected readers. Then prepare one consolidated code/additive-backend/runtime release candidate, comparing actual Lovable migration history/schema/grants/types before application. Actual installation/publication, designated Owner-operated N3 bill/receipt/knock-off proof, native concurrency and signed-in whole-stay acceptance retain their separate gates. Complete Checkout remains unfinished.

No N3 financial transaction, operational DB change, Lovable AI Build, shared push, merge, deployment, publication or activation occurred. Existing master captures remain complete; no repeat capture or extra MD upload is requested.

## QA recommendation: 14 files become 3, with all original text preserved

The 12 older notes are useful historical evidence; they are not useless or safe to discard without an accessible complete copy. The previous short checkpoint preserved current state but did not reproduce every technical/release detail. Its local-only archive was not sufficient as the Owner's sole future reference. That is why the earlier “upload one, remove twelve” recommendation is replaced by this three-file proposal.

| Active billing source | Purpose | Owner action after reviewing the pack |
|---|---|---|
| **HH_BILLING_CURRENT_CHECKPOINT.md** | Current approved workflow, completed evidence, unfinished work and latest known lane state | Upload this revised version; keep one active copy |
| **HH_BILLING_HISTORY_ARCHIVE.md** | Full verbatim originals of ALL 14 reviewed files, including the 12 older notes and the two earlier proposals | Upload and keep as historical reference |
| **HH_SEQUENTIAL_N3_CHECKOUT_QA_20261015.md** | 120 workflow cases plus 20 document/evidence/recovery cases, priorities and explicit acceptance status | Upload this revised version; keep separately |

**Do not remove anything until all THREE files are uploaded.** After the complete pack is uploaded, remove only the 12 named older progress/release notes below. If either newer file was already uploaded, replace its older same-name version rather than keeping two active versions. Keep every other existing source, including protocol/adoption, permanent decisions/financial master/roadmap/integration/impact/BEC sources and the independent reservation-controls checkpoint.

The Owner reports that the earlier instructions are on hold and no upload/removal has been done. These are proposed replacement documents; neither ChatGPT Project Sources nor Project Instructions/Lovable Knowledge have been changed by preparing them. Do not assume an attachment inventory proves installation.

All 14 reviewed inputs are preserved exactly inside the downloadable history archive. The repository also retains the 12 individually archived originals and Git history. No original source file or previous app implementation is deleted. The archive is text only, not the private raw JSON exports, code, SQL files or test logs referred to by those notes. Do not claim those external artifacts are backed up by this document pack.

### Superseded active progress/release documents

| Old filename | Replacement |
|---|---|
| HH_BILLING_PROGRESS_20261014.md | Current checkpoint + complete history archive; QA kept separately |
| HH_CHECKOUT_PAYMENT_PROGRESS_20261014.md | Current checkpoint + complete history archive; QA kept separately |
| HH_CHECKOUT_MATCHING_PROGRESS_20261014.md | Current checkpoint + complete history archive; QA kept separately |
| HH_CONFIGURED_MASTER_CAPTURE_RELEASE_20261014.md | Current checkpoint + complete history archive; QA kept separately |
| HH_BILLING_MASTER_SETUP_PROGRESS_20261014.md | Current checkpoint + complete history archive; QA kept separately |
| HH_MASTER_CAPTURE_RUNTIME_FIX_20261014.md | Current checkpoint + complete history archive; QA kept separately |
| HH_MASTER_ACCOUNTING_GRAPH_CAPTURE_RELEASE_20261014.md | Current checkpoint + complete history archive; QA kept separately |
| HH_MASTER_EVIDENCE_REVIEW_AND_ADAPTER_PROGRESS_20261014.md | Current checkpoint + complete history archive; QA kept separately |
| HH_BILLING_TRANSPORT_PROGRESS_20261014.md | Current checkpoint + complete history archive; QA kept separately |
| HH_STAFF_CHECKOUT_AUTHORITY_PROGRESS_20261014.md | Current checkpoint + complete history archive; QA kept separately |
| HH_N3_POSTING_KNOCKOFF_PROGRESS_20261015.md | Current checkpoint + complete history archive; QA kept separately |
| HH_CURRENT_MASTER_ADAPTER_PROGRESS_20261015.md | Current checkpoint + complete history archive; QA kept separately |

This consolidates progress state and recovery direction; it does not cancel existing approvals, override permanent requirements, prove deployment, or grant new release/N3 authority. Earlier statements in these files such as “capture missing”, “customer activity unresolved” and “helper not published” are dated history, superseded by the explicit later state below.

## Read first and permanent operating constraints

Read `00-MUGS_DIRECTBUILD_PROTOCOL.md` v1.1 and `MDB-01_HOTELHUB_ADOPTION.md`, then Start Here, the source index, permanent product/financial decisions and change-impact map. Use this checkpoint for the latest billing progress rather than treating older baseline dates as current evidence.

HotelHub repository is `mugs-AI/hotel-hub`. Preserve the existing Lovable hosting and Lovable-managed backend. **The Owner has no separate Supabase account and must not be asked to create or use one.** Database inspection/application must use the verified HotelHub Lovable-managed route. Do not send Lovable AI Build messages or silently use build credits. A review branch is not a separate database.

Preserve N3-only launch, encrypted server-held credentials, server-resolved tenant/actor/current role, own-user N3 rights, allowlist, immutable booking/document IDs, durable intents/claims and GET-only recovery for unknown writes. No credentials/raw tenant exports in repository or chat. Existing BEC/access-card and financial safety rules remain in force.

## Latest recovery identity and verification

| Item | Recorded state and evidence boundary |
|---|---|
| Development branch | `review/hh-reconstruction-20261011` |
| Latest verified product source | `a33a8b784582a0f16031690a272f6fb8e78a09a7` |
| Product tree | `91063c05eb82ef693174dbd25ecddb5e8bc63869` |
| Recovery HEAD before this consolidation | `a2de0af41175310c4f876e56b70109390a5e10fe` — freshly read for this documentation task |
| Full source test result | **3,219 passed / 22 skipped / 0 failed**, 223 files passed / 3 skipped, from the preceding verified implementation run; not rerun for documentation cleanup |
| Focused sequence/mounted/coordinator checks | **87 passed** in that implementation run |
| Other checks | TypeScript, changed-file ESLint, production build and whitespace checks passed; existing FastRefresh warning and full-repository lint debt remain |
| Last inspected Lovable source | `e8341907a470d0d1e3a39a22413249becf73cd57`, project ready/agent finished — from the preceding implementation inspection, not a fresh deployment audit here |
| Last inspected settlement backend | Lovable-managed database enabled; SELECT catalog count for `hotelhub_settlement_*`/`hh_source_billing_*` functions was **0**; candidate SQL was not installed |
| Live billing/payment/matching/checkout | **Incomplete and not financially accepted.** The broad billing source is unpublished. A successful build is not live N3 proof. |

A documentation commit follows this file. Re-read actual branch/HEAD, dirty files, remote main, Lovable source and observable tasks before resuming implementation; preserve recovered work. Do not restart completed foundations. The pre-existing local adoption/temp paths were retained, never staged as product changes. Fresh pre-audit documentation HEAD was `057f95349087ce8dac63147360e5b48183f3fedd`; no product tests were rerun for this document audit.

## Evidence completed — do not ask the Owner to repeat it

- Owner supplied 38 successful master observations (customer, 32 stocks, 3 standalone UOMs, tax and an account) and a supplemental capture of local MYR plus the three linked control/income/tax accounts. All requested **42 observations** were reviewed. Requested current-master capture is complete.
- Current graph adapter validates exact IDs, activity, stock/UOM relationship, customer control, each stock's own revenue account, tax liability, currencies/rates and conflicting scalar/nested facts. All 32 supplied stock graphs passed synthetic replay. Reused nested UOM observations are not additional independent live captures.
- Official customer status semantics were resolved: numeric **0 = Active**. Unknown/string/missing values remain unavailable. Do not resurrect the old customer-status blocker.
- MYR local currency and the requested independent account relationships are accepted at the observed-shape level. This does not establish live financial Create, matching or committed-GL semantics.
- Preserve completed Owner N3 Cloud UI deposit/partial allocation/split bank/refund/journal examples and previous same-OR correction proof. They are business/accounting evidence, not proof that HH issued those API writes. Do not repeat those UI exercises or ask for an API Create response for an N3 UI-created document.
- CBE/RAA handover concerns Purchase Invoice editing. It is a reference for retained IDs/full-DTO updates, not acceptance of HotelHub CashMemo/AR/knock-off.

## Released diagnostic helpers versus unfinished billing

The conversation's release evidence records these limited helper releases:

| Published helper | Recorded merge |
|---|---|
| Initial read-only billing master capture | PR12 / `6e92a5a` |
| Use saved billing IDs, bounded batches | PR13 / `a769a7c` |
| Runtime-compatible manual redirects and safe failure diagnostics | PR14 / `3f467c3` |
| Capture retains required non-personal accounting graph fields | PR15 / `e8341907` |

These release observations are retained provenance, not fresh public signed-in acceptance performed during consolidation. Earlier release-packet “not published” headings describe their preparation date. They do not mean the later helper releases failed. None of these narrow releases installs or activates broad checkout posting/matching.

## Implemented and tested in unpublished source

1. **Current-master/transport foundations:** fixed bounded own-token GET paths, manual redirects compatible with the runtime, cancellation/timeout and late-response protection, accounting graph verification, copied caller facts and identity-bound provenance.
2. **Folio confirmation and separate debtors:** current digest/revision checks, frozen intents, guest/source bill legs, per-leg dispatch/recovery and public DTO boundaries. The production local-folio/deposit/payer loaders and full route/UI mounting remain incomplete.
3. **Staff authority:** ordinary Owner/Front Desk posting/payment/recovery uses each user's own N3 session across server boundaries and SQL candidates. Owner setup/payer overrides/approvals/reports remain separate. Candidate SQL is not live permission.
4. **Actual payment entry:** exact positive cents, selected eligible N3 bank/cash account, up to 10 distinct account lines, exact outstanding total, booking/session drafts and explicit confirmation. Split entry exists in source; the split writer is separately gated and not accepted.
5. **Matching verification:** saved bill/owned receipts, detail/GL, exact allocations, receipt/bill conservation, two consistent observations and foreign-booking refusal. Durable external-match persistence and full settlement reachability still require completion.
6. **Sequential checkout UI:** explicit Post to N3 → Match Deposit → Receive Payment, server order guard, no-deposit skip, and controlled receipt-then-match continuation. A saved receipt is never recollected after an interrupted matching operation.
7. **Manual no-show:** explicit confirmation/reason, revision/date/occupancy/tenant/role fences, reserved-room release candidate and action-bound accounting review. Candidate no-show migration is unapplied; native races, installed acceptance and accountant report integration remain pending. No occupied-room release or deposit deletion is authorised.

Source tests and replay do not certify installed schema, native simultaneous sessions, deployed runtime, N3 permission responses, posting, matching, room release, mobile UI or financial acceptance.

## Approved sequential workflow — 15/10/2026

**Prepare Checkout is the action surface.**

1. **Confirm Folio & Post to N3:** post the exact verified guest/source leg(s), retain N3 UUID/code, verify bill detail and committed GL. Reads/print/refresh do not post.
2. **Match Deposit:** apply only this booking's eligible existing N3 OR(s) to the correct debtor/bill. Keep Receive Payment disabled until matching is verified. No linked deposit skips this step. Already posted deposits are never created again.
3. **Receive Payment:** enter actual cash/bank amounts equal to fresh positive guest outstanding; save and independently verify the new OR, then match it to the bill. A normal explicit click may make two sequential bounded HH requests; each retains its own server authorization, API gate and durable claim.

Example: RM1,000 bill − RM50 matched existing deposit = RM950 to receive; verified RM950 receipt/matching gives zero outstanding. A fully settling deposit needs no balance OR. Surplus/refund/unsupported external matches require review, not silent collection, refund or write-off.

The continuation checks the copied original tenant, booking, user session, intent, bill, currency, amounts, preserved prior receipts, new receipt and returned revision. Unknown/contradictory results stop continuation. A tab/user/tenant switch stops further matching. No page load, polling or Refresh automatically creates or applies money. Matching failure after a verified receipt shows saved-payment recovery; an unverified outcome is not labelled confirmed money. Never blindly retry.

**Complete Checkout remains separate** and requires proven guest settlement, supported source-credit handling and fenced all-room release/Dirty/DND handoff. Posting a bill does not release rooms. Keep source and guest debtors/AR mapping separate; OTA gross sales/commission/CN handling remains the accountant's work in N3.

## Precise outstanding API and production work

The public API documents `POST /api/ARReceipts/UpdateCustomerKnockoff` and `ARReceiptDto.knockoff[]`. Missing explicit version fields do not prove that QNE lacks concurrency protection. Resolve the supported behaviour, rather than repeatedly rereading an unchanged schema or treating an HH lock as an N3 lock.

Remaining proof must establish exact CashMemo-to-INV identity; current committed document/GL interpretation; existing allocation preservation/replace-versus-append/repetition; supported stale/conflict behaviour when another N3 user changes matching; refund/spendable-remainder semantics where relevant; and single/split new receipt creation/readback/matching. The new receipt's possible Create-with-knockoff path needs its own acceptance. Questions are prepared, not sent to QNE. No outreach or new financial transaction is authorised by this file.

Next work, in order:

1. Finish actual production prepared-folio/deposit facts, saved payer lifecycle and each leg's own customer accounting graph.
2. Mount per-leg confirmation/posting/payment/recovery and persist independently verified matching; integrate affected folio/print/Reservation/Departures/finance readers without duplicate deposit editing.
3. Prepare one main-based code plus additive backend/runtime release packet. Compare real migration history/schema/grants/types first; never blindly replay candidate SQL or assume merge deploys it.
4. Obtain any genuinely missing exact installation/release/proof authority; conduct the designated Owner-operated N3 API posting/receipt/matching proof and signed-in acceptance. Keep automatic matching closed until supported N3-side stale/conflict/preservation behaviour is accepted.
5. Finish safe whole-stay checkout/accountant cases and client UAT. Access-card hardware integration follows accepted financial checkout; BEC one-package/default 30-room lots follows the existing roadmap.

Do not present this sequence as four more chat replies or a guaranteed completion date. Source build approval persists; new financial operations and unrelated releases retain their separate boundaries.

## QA and known limitations

Keep `HH_SEQUENTIAL_N3_CHECKOUT_QA_20261015.md`: the original 120 workflow cases remain with unchanged IDs; 20 document/evidence/recovery cases were added. The workflow cases cover roles/tenant, folio/mapping, posting, deposits, matching, balances, payment accounts/split, receipt matching, recovery, identity/concurrency, source legs and checkout/readers. **140 named cases does not mean 140 passes.** All full-workflow acceptance remains NOT CERTIFIED until its required lanes have per-case evidence.

Latest sequence review: 0 Critical, 2 Important fixed in one RED→GREEN pass, 1 Minor deferred. Fixes preserve earlier receipts and reject contradictory saved/final matching responses. Full final source suite: 3,219 passed / 22 skipped. No second review is claimed.

Carry prior deferred items forward rather than silently clearing them:

- Generic third-step guidance when a verified saved balance receipt has a closed allocation gate. The receipt remains listed and collection disabled; wording is not signed-in accepted.
- Earlier cached payment form may remain actionable during automatic background refresh; fresh server account/balance validation remains authoritative. Explicit Refresh is serialized.
- Malformed/null Origin on the separate source-billing controller is denied with 503 rather than 403; no operation is authorised.
- Shared saved-ID loading/capture busy label was deferred in the narrow helper source. Do not assert a later fix without evidence.
- Legacy full-repository lint errors remain; changed-file lint passing is not full lint passing.

No operational DB change, N3 write, AI Build, merge, activation or publication is performed by this consolidation. It changes documentation only.

## Future source maintenance

Routine implementation updates should remain in the repository execution ledger and chat. Do not ask the Owner to upload another MD after every small build. At a meaningful milestone or material requirement change, update the appropriate permanent source or replace **this same stable checkpoint file**. Keep the QA matrix separately and retain the full history archive. Routine checkpoints belong in the repository; refresh this same current checkpoint only at meaningful milestones. Do not require another source upload after every small build.

Keep one active source per logical document. An obsolete requirement is replaced deliberately, never erased merely because a newer test count exists. This consolidation updates neither saved ChatGPT Project Instructions nor Lovable Knowledge automatically.

## Exact archive and provenance

The 12 original supplied files remain preserved byte-for-byte at `docs/project-sources/archive/2026-10-15-billing-progress/` in the review branch. This repository directory is historical; do not upload its 12 separate files again. Upload the single `HH_BILLING_HISTORY_ARCHIVE.md` instead; it also preserves the two pre-audit proposal files. It is a local documentation checkpoint until its own remote push is separately authorised; do not claim it is already on GitHub.

| Archived filename | SHA-256 of supplied bytes |
|---|---|
| HH_BILLING_PROGRESS_20261014.md | `50422d3ece896a9b6198085ea43298b10f04f84df107cb8ceb77c4cf53f4633b` |
| HH_CHECKOUT_PAYMENT_PROGRESS_20261014.md | `cde1504a6bab48fe161e67693d33aa5c750fe7074927cd14aa938f1a290a79f4` |
| HH_CHECKOUT_MATCHING_PROGRESS_20261014.md | `cb924d47cbfe6abb8b76a9130a33e773b7012091f78cdbfecfe8037f3f778b62` |
| HH_CONFIGURED_MASTER_CAPTURE_RELEASE_20261014.md | `9e89a2725e3ba9f0bead03ccfe538fe88725055a5fa80284ca077062b57fee33` |
| HH_BILLING_MASTER_SETUP_PROGRESS_20261014.md | `e51a592fce7529245695d5609ca6413c48466878a76c8f267e65ffcfa6f534b0` |
| HH_MASTER_CAPTURE_RUNTIME_FIX_20261014.md | `fd816ef2b5348ad5d7bafe03bce4f84f125b009c4616c3f318474b82a0e30391` |
| HH_MASTER_ACCOUNTING_GRAPH_CAPTURE_RELEASE_20261014.md | `f1c411a9cc58e2a45bd7000b9bf93d710e9f16a704f1237d15879fc47c1f7632` |
| HH_MASTER_EVIDENCE_REVIEW_AND_ADAPTER_PROGRESS_20261014.md | `dbf9495cb63b33e3ab3b15031b6e5a6397e2c7869904aa7efa8b25876a5afb36` |
| HH_BILLING_TRANSPORT_PROGRESS_20261014.md | `c4f80c703126705ad4cbcdc1f888fe249438d5ac0a48da13d1acaa668fecf377` |
| HH_STAFF_CHECKOUT_AUTHORITY_PROGRESS_20261014.md | `741caa9ad5704bb25de2821d1c06a8bcc1514f4193a12f6f298f7c2948553e9b` |
| HH_N3_POSTING_KNOCKOFF_PROGRESS_20261015.md | `a4918ab0a8aa6fba2394bb8a572174fad72b322a29fe6590827d5218e10e6b37` |
| HH_CURRENT_MASTER_ADAPTER_PROGRESS_20261015.md | `6f5bf79ac3eba45293044dfe55ee5e9cce6e5a0d26e95cbe062106d18a0b8c5a` |

## Findings from rereading all 14 documents

| Input | Unique value retained | QA disposition |
|---|---|---|
| HH_BILLING_PROGRESS_20261014.md | No-show action-bound review, unapplied migration, early broad/narrow source boundaries | Preserve original in history; current no-show acceptance remains pending |
| HH_CHECKOUT_PAYMENT_PROGRESS_20261014.md | Exact-cents/single-versus-split input, drafts, account selection, payment-refresh limitation | Preserve in history; current payment rules and limitation retained |
| HH_CHECKOUT_MATCHING_PROGRESS_20261014.md | Two-observation owned-matching proof, canClose:false, missing persistence/reachability | Preserve in history; never promote read-only matching observation to final close |
| HH_CONFIGURED_MASTER_CAPTURE_RELEASE_20261014.md | Exact helper payload/tree/files/lane approval; originally marked Upload:NO | Historical release packet, not a competing current requirement |
| HH_BILLING_MASTER_SETUP_PROGRESS_20261014.md | Exact-count/truncation guards, 200-row helper caps, saved-ID loading behaviour | Preserve exact limits; distinguish helper read cap from BEC entitlement |
| HH_MASTER_CAPTURE_RUNTIME_FIX_20261014.md | workerd redirect failure, 57 ms observation limit, safe failure classes, 20/30s/1MB limits | Preserve complete diagnosis; simulations are not live vendor proof |
| HH_MASTER_ACCOUNTING_GRAPH_CAPTURE_RELEASE_20261014.md | Exact three-file capture-only payload and privacy exclusions; Upload:NO | Preserve release provenance; do not re-run its old approval/release instruction |
| HH_MASTER_EVIDENCE_REVIEW_AND_ADAPTER_PROGRESS_20261014.md | 38 observations, redaction gap, three standalone versus nested UOMs, raw-hash limitation | Preserve history; later 42-record/status resolution supersedes old blockers |
| HH_BILLING_TRANSPORT_PROGRESS_20261014.md | Five financial readers/writers, redirects/late completion/caller provenance | Preserve runtime lesson and narrow acceptance boundaries |
| HH_STAFF_CHECKOUT_AUTHORITY_PROGRESS_20261014.md | Own-token authority, 11 SQL bodies, exact pending migration and dependencies, native/live exclusions | Preserve exact candidate evidence; candidate SQL is not an installed backend |
| HH_N3_POSTING_KNOCKOFF_PROGRESS_20261015.md | Stale-confirmation refusal, customer status enum, Origin limitation | Status semantics resolved; keep Origin limitation and unmounted-flow distinction |
| HH_CURRENT_MASTER_ADAPTER_PROGRESS_20261015.md | Supplemental 4 records, 30s/2MB/128-read graph, source-policy identity fence | Requested captures complete; per-leg production adapters remain unfinished |
| Earlier HH_BILLING_CURRENT_CHECKPOINT.md | Current-state summary, release chronology, named retirement list | Revise: summary alone is not full historical preservation; use three-file pack |
| Earlier HH_SEQUENTIAL_N3_CHECKOUT_QA_20261015.md | 120 cases and honest source-versus-live separation | Revise: remove conflicting retention instruction; add priorities, acceptance status, traceability and missing boundary variants |

Document/recovery edge cases M01–M20 are listed in the active QA file. They include partial uploads, accidental deletion, archive corruption/omission, stale historical instructions, same-name duplicates, lost detailed evidence, local-only recovery, unknown external artifact availability, assumed source installation, and false test/deployment claims.

The exact original-byte round-trip for all 14 inputs, preservation of all 120 A–L case IDs, uniqueness of 140 total IDs and documentation-only change scope are checked for this proposal. Actual Owner upload/removal remains PENDING. No N3, DB, runtime, app-source or public-release change is part of this audit.
