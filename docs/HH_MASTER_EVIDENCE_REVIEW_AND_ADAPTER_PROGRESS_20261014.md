# HotelHub current-master review and adapter progress — 14/10/2026

Upload to Project Sources: **Yes** — add as a dated recovery reference; retain previous billing/payment/matching/runtime sources. Not a claim of completed or live billing.

## Fresh Owner evidence

Only the two newly supplied batches are current: batch1of2(1) and batch2of2. The older failed batch is excluded. Both exports are captured:20+18=38 entries, each GET/HTTP200 with64-character response hash, non-null sample and no truncation. Requested ID equals returned data.id in every entry; no cross-batch duplicate master identity. Captured at20:28:07 and20:28:18 Malaysia. These are Owner-supplied signed-in live results, not synthetic test results. Export hashes cannot be independently recomputed from the sanitized samples because raw upstream bodies are intentionally unavailable.

Counts:1customer,32stock,3standaloneUOM,1tax,1account. All32stock and32nestedUOM active=true; all conversion rates1, all nested stock ownership consistent, all3 standalone UOMs match stock members. Tax rate0.08 is8%; active/output flags true. Account type EXP is observed, not a universal revenue mapping.

The published runtime fix has passed this specific successful capture acceptance. This does not prove inactive/error cases, financial POSTs or checkout. No agent N3 request occurred.

## Remaining accounting evidence

No standalone currency detail was captured. Customer exposes currency ID88669/MYR, but the exported numeric status and control-account graph are redacted. Stock accountPresetId/accountPreset.cashSalesAccount, tax postingAccountId/postingAccount and currency local/default rates were also unnecessarily redacted. These fields are non-personal accounting relationships, needed before accepted current-master validation. No customer-status activity enum or exchange-rate semantics are inferred.

Customer status, currency semantics, stock revenue/tax posting-account roles and independent account relationships remain to be accepted. Existing CashSales/AR linkage, actual single/split OR, staff permissions, matching concurrency, source policy/plan integration, whole-stay close and backend/public acceptance remain separate unfinished plan items. Door access follows accepted billing/checkout.

## Preserved source

Branch review/hh-reconstruction-20261011; starting3389a5a902f88b5c4d1e8dc057896e83a16e559e.
Reviewed product source788ad1ef920637b9487f9796cf67ef8b039eaf8d; treeecd381f8f601bce10e22f91db32a456f73d107c3.

Four changed/new application/test files only:
- settlement-master-adapter.server.ts and its tests: pure observed-shape projections for customer/stock/UOM/tax/account, exact requested identity, paired account/currency/preset relationships, inactive/missing refusal, unit membership and fractional tax rates. Currency remains unavailable. Every projection has postingAuthority:false. No I/O or live snapshot mounting; this is NOT the completed production SnapshotDeps adapter.
- n3-settlement-master-diagnostics.server.ts and its tests: retain control-account, stock account-preset/cash-sales-account, tax posting-account, bounded numeric root status, currency local/default rates, UOM base flag and bounded tax-code punctuation. Unknown/private paths, contacts, bank details and credentials remain redacted. Existing bounds/identity/redirect/timeout/session behavior preserved.

Untracked adoption/temp paths were preserved. No package/lock/start/integrations/store drift. Original approved billing spec/plan remain accepted; no duplicate design approval needed.

## Verification and one review

Baseline full suite3041passed22skipped. TDD initially reproduced9 projection gaps and1 capture graph failure. One numeric-Infinity test was corrected because JSON serialization turns Infinity into null; no production check was weakened. Final targeted41tests passed.

One independent reviewer found0Critical/1Important: missing paired stock preset scalar/account currency graph could be projected as confirmed. Two new regressions failed before the fix; both mandatory comparisons were added. The complete-fixture preset field insertion initially missed its formatted target, causing3 tests to fail; corrected the synthetic fixture without weakening assertions. No second review; no new deferred Minor.

Final broad suite3066passed22skipped0failed; TypeScript/changed-file lint/build/whitespace checks pass. Isolated capture-only candidate2401passed22skipped0failed with types/changed-file lint/build/whitespace checks pass. Existing full-lint debt307broad/170narrow unchanged; not rerun or called green. Full suites used explicit local DOM/PGlite modules, not production fixtures.

Ruling: accept38 exports as successful observations, not posting authority; advance strict projections and accounting graph capture under approved Task2/7. Cost if mistaken: API success could be confused with financial readiness, so financial gates and the live snapshot adapter remain closed. Task2 is incomplete.

## Exact next release boundary

Public release candidate is isolated at /workspace/scratch/cb26166d36cb/hotel-hub-master-graph-release, review/hh-master-graph-capture-20261014, from fresh remote main/Lovable3f467c394295d23cf5a7fe391ed22e75e2f461c4. This exact signed public main commit was reconstructed locally from its API payload/signature and verified by its hash; no remote ref changed. Original candidate8032fff source tree equals this main tree, but current main was used as the actual parent.

Narrow product30a827535a68b4d17255a406744dd7adb4d0a878/treebffa3017468b0d7652383961457d2fe9162f46df, followed only by its release-packet commit. Only capture service, its existing tests and packet are included. The pure projection adapter, raw Owner files, no-show/billing SQL and unfinished financial source are excluded. Scope-specific public code/packet upload, merge and publication approval is still required for this NEW candidate;8032fff approval does not release changed source.

After release Owner performs another read-only master capture including currency ID88669 plus saved customer/stock/tax/account mappings. Missing related accounts can be identified from newly retained graphs without guessing; follow the fixed20-record batches. Retain current38 responses as evidence of successful transport and identity/UOM shape. Review full remaining eligibility relationships before mounting/activating billing; no financial proof transactions are included in capture approval.

No push/merge, operational database/secret/runtime change, Lovable AI Build message, N3 call/financial transaction, financial activation or publication occurred in this slice. Current live code remains3f467c3.
