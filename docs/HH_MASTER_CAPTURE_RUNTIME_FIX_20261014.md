# HotelHub master capture runtime repair — 14/10/2026

Upload to Project Sources: **Yes** — add as a dated recovery reference. Retain the earlier billing, payment, matching and setup sources as historical checkpoints.

Status: **source fixed, tested and independently reviewed; not uploaded, merged or published**. Billing posting, matching persistence and Complete Checkout remain incomplete and inactive.

## Diagnosis and evidence limits

The Owner's first exported batch contains20 unavailable entries (one customer/19 stocks), with no recorded HTTP status, response hash or sample. Its JSON is structurally valid; it cannot validate master records or their relationships. Batch2 was not supplied. Do not ask the Owner to repeat the original batch until the runtime repair is released.

A SELECT-only audit check through the existing HotelHub Lovable project found capture completion about57ms after the exported start time. That fits immediate request-construction failure rather than exhausting the30-second budget. No worker exception log was exposed, so the exact original thrown exception remains unobserved.

Source investigation found the capture uses `redirect: "error"`. Cloudflare workerd's Request constructor explicitly accepts only `follow`/`manual` and rejects `error` before dispatch:
https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B

HotelHub's existing journal reader already had the same compatibility correction, recorded in `docs/evidence/HH_N3_JOURNAL_RUNTIME_FIX_20261008.md`. The new capture had repeated that runtime incompatibility. The previous Node/mock tests did not model it and therefore did not establish live capture acceptance.

## Corrected behavior

- Use `redirect: "manual"` and reject every returned3xx. No redirect following, credential forwarding or automatic retry.
- Export finite failure categories, attempted/not-attempted and elapsed milliseconds. Distinguish transport failure, request timeout, skipped batch deadline, response-size limit, redirect refusal, HTTP error, absent body and unverifiable response. Raw error messages, credentials and upstream error bodies are never exported.
- Abort checks fence late fetch and body completions before modifying HTTP status, hash, sample or shared byte budget. A returned timeout report remains unchanged after a late response.
- Zero successful captures displays **No N3 responses captured**, with safe per-entry explanations and existing download access. Missing/unknown/malformed optional failure reasons show a fixed fallback.
- Preserve20-item/30-second/1MB limits, Owner-only access, current server-held identity, fixed GET endpoints, lossless parsing/sanitization, terminal401/session handling and `contractAccepted:false`.

No endpoint, dependency, package/lock, launch/authentication, role authority, backend schema, financial contract or activation gate was changed.

## Exact release package

Repository/destination: **public** `mugs-AI/hotel-hub`.
Narrow branch: `review/hh-master-runtime-fix-20261014`.
Workspace: `/workspace/scratch/cb26166d36cb/hotel-hub-master-runtime-fix`.
Fresh remote main/Lovable base: `a769a7cfbe666e4720c597528c3106e52c5fcdf9`, tree `b82af21c85d81ca946bce1c0955ae681a20f06e5`.
Reviewed product commit: `5beacd850c910766c0dadc846633f3cdda769023`, tree `c4fb14fabe26d9cf65b42550ff642bda96580e19`.
The subsequent documentation-only commit containing this packet is the final candidate; resolve its exact SHA before release.

Only four application/test files plus this packet:

1. `src/lib/n3-settlement-master-diagnostics.server.ts`
2. `src/components/BillingMasterCapturePanel.tsx`
3. `src/lib/__tests__/n3-settlement-master-runtime.test.ts`
4. `src/lib/__tests__/billing-master-capture-mounted.test.ts`
5. `docs/HH_MASTER_CAPTURE_RUNTIME_FIX_20261014.md`

The supplied JSON and audit rows remain private and are not included in the public payload. No unpublished billing/no-show/checkout source is included.

Target remains HotelHub Lovable project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`, workspace `JRQygHE7tZl2GgPN8a8N`, existing Lovable Cloud backend configured reference `fkakhdzelilnejyehwfk`, host `hotelrooms.lovable.app`. No separate Supabase account is needed.

## Verification and review

- Narrow full Vitest: **2,397 passed /22 skipped /0 failed** (159 files passed/3 skipped).
- Preserved broad billing full Vitest: **3,041 passed /22 skipped /0 failed** (215 files passed/3 skipped).
- Both full runs enabled existing DOM and PGlite lanes. Both typecheck and production build passed. Changed-file lint and whitespace checks passed; protected-file parity passed.
- Narrow full lint remains **170 errors/38 warnings**, all errors in the two unchanged legacy receipt-check scripts. Their byte equality to main was verified. Broad full lint was not rerun; its recorded307 legacy errors remain unresolved.
- Real loopback HTTP/native fetch tests reproduce the workerd Request-mode restriction and prove successful capture plus refusal of301/302/303/307/308 without following/retry. These are runtime-boundary simulations, **not actual workerd or live N3 tests**.
- Nine initial runtime assertions and the zero-capture UI assertion failed before implementation. New diagnostics cover failure redaction, skipped budgets, timeouts and report immutability. One independent reviewer found0Critical and1Important malformed optional reason crash/coercion; object/array regressions reproduced both, then a type guard fixed them in one pass. Final full suites passed afterward. No second review and no new deferred Minor.
- Existing helper loading-label and unrelated broader payment-refresh limitations remain recorded in earlier sources; they were not changed here.

## Broad source preservation and decisions

The same four reviewed files were copied into `review/hh-reconstruction-20261011` only after confirming its existing capture files exactly matched the release base. Existing untracked adoption/temp paths were preserved. Broad source commit is `6b0a2cb09be0b266a8e4244731d118e7cd15e182`, tree `61260bbfb10a298d0d161946161bd19fb4d86050`; its whole-suite result is above. Do not merge that broad branch as a ready production release.

Ruling: repair this current-master prerequisite under the approved billing plan without restarting design/plan approval. Cost if wrong: source evidence could be mistaken for live acceptance, so current Owner capture and all financial gates remain mandatory.

Review boundaries retained: original production exception, actual workerd/N3 behavior and broader pre-existing DTO validation were not proven by this review. An uncooperative fetch may remain pending after abort, but late continuations cannot change the returned report. Billing readiness was not judged or granted.

Permanent prevention lesson: exercise each new server reader against its hosting runtime's Request/redirect behavior, reuse already verified transport restrictions, and test negative branches with real local HTTP. Node/mock success alone cannot prove Lovable runtime compatibility. Keep specific safe failure diagnostics so an empty export is never treated as accepted master evidence.

## Independent release lanes and next action

Preparing/testing this correction is within the approved build scope. **Public source upload, main merge and publishing this new exact candidate need their scope-specific release approval**; the previous helper-only publication does not release these changed files.

After approval: reverify main/Lovable base, upload the exact narrow candidate, compare remote tree, merge without rewriting history, verify Lovable sync/build and publish only this capture repair. No migration, RPC, secret, runtime-setting or standalone Edge Function deployment is needed. Hold on substantive drift and preserve both sources.

Then the Owner reopens HH through N3 → Settings → N3 Financial Verification → Current billing master evidence → Use saved billing IDs → Capture/download each batch. Inspect recorded HTTP statuses, safe reasons and sanitized samples. Captured records still need contract review. Missing currency/UOM/tax/account relationships must come from current evidence; never infer them from the old CBE Purchase Invoice handover.

Do not recreate financial fixtures, post bills/receipts/matching, repeat prior completed journal proofs, request credentials or enable financial gates. Continue the already approved billing adapters, own-token staff payment, matching and safe whole-stay checkout only as their evidence prerequisites are met. Door access remains after accepted billing/checkout.

No shared push/merge, database write/migration, runtime setting, N3 call/transaction by the agent, Lovable AI Build message or publication occurred during this repair. Backend work was SELECT-only through Lovable.
