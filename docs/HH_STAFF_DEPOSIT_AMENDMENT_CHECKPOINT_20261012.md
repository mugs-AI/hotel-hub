# Staff deposit correction amendment — 12/10/2026

Upload to Project Sources: **No** — engineering checkpoint on the existing review branch. The Owner already uploaded and approved HH_DEPOSIT_WORKFLOW_AND_N3_PERMISSIONS_20261012.md; retain that active source.

## Scope and preserved baseline

Continues local ddbe1625e72d2314f69f159793715a67f07b9bcf / remote 32f8595f5000c1feb7144dbdd5d411eb8472986a, exact matching input tree 6a0d2d3a70d1911068b9ca8e866f5848da79282c. Local review/hh-reconstruction-20261011 corresponds to remote review/hh-source-prerequisites-20261012. Existing billing/accountant/checker work and the two original untracked items are preserved.

This approval implements the written staff-permission amendment in review source. It does not supersede earlier explicit no-publication/no-operational-write instructions. Main and Lovable were freshly read at 6ac17dee7b503b96daf89015afdc9fb3995e1b68. Lovable project d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76, workspace JRQygHE7tZl2GgPN8a8N, ready and agent finished. Existing backend is Lovable-managed. No separate Supabase account is needed or requested.

## Implemented source behavior

- Front Desk deposit creation uses the existing caller-held N3 token and stable create intent. Current HH authority is validated before dispatch and after authoritative readback; post-dispatch authority loss retains the same receipt UUID/number as unknown, never another Create.
- Approval ON: Front Desk proposes; Owner Approve invokes the existing bounded full-DTO same-OR Update plus independent receipt/journal proof and atomic effective projection. Owner approval/rejection/settings/reports and legacy manual execution remain Owner-only.
- Approval OFF: the signed-in requester (Owner or Front Desk) saves and applies in the reservation using their own N3 rights. Another staff member cannot dispatch or reconcile that request. N3 permission denial never reports success or triggers repeated financial POST.
- Automatic Check N3 result and explicit pre-dispatch Apply saved correction remain inside the reservation. Legacy manual requests keep their existing audit and separate Owner procedure; switches never upgrade or run them.
- Effective readers refresh through existing revision invalidation. A failed reader refresh hides failed money caches and emits refresh-required guidance without amounts or chime. The reservation does not claim refreshed totals until those readers have succeeded.
- An additive applied-event ledger is inserted only with generation-2 verified settlement, after the atomic revision bump. The read RPC exposes only the current caller's own events, bounded at 100 with exact bigint cursor pagination. NULL cursor baselines without historical events; failed/unknown/rejected requests create no event.
- One shared observer per QueryClient shows a bottom-right verified result and two-tone chime after reader refresh. Auth changes dismiss previous-session toasts and reset the cursor even if the new account's first poll fails. First load/reload never replays history. Mute preference is scoped by tenant/user/role; browser audio activation needs an interaction. Audio failure never hides visual results. No external messages.

## Review and regression fix pass

Independent read-only review found five Important issues, zero Critical issues. Each reproduced with a failing regression and then passed after correction:

1. Policy tightening during final fresh actor validation could dispatch. Current policy revision and durable attempt are rechecked after validation, immediately before the bounded Update.
2. Create lacked post-readback authority validation. Its projection fence now preserves unknown receipt identity on revocation; replay uses the saved intent and sends no second Create.
3. Sonner money notifications survived auth transitions. Scoped notifications are tracked/dismissed on tenant/user/role loss/change.
4. Success preceded reader-refresh completion. Refreshes now share one awaited promise per scope/revision; failed reader caches are cleared, no money/chime success is shown, and direct dialog copy promises only refreshing.
5. A failed intermediate account could retain the previous cursor. Identity transitions reset notification state independently of successful reads; A→failed B→A baselines history.

The review's Minor request for a specific deposit_authority_changed message was folded into the same failure-handling implementation. No deferred Minor findings.

## Verification and limitations

Fresh full suite, isolated Happy DOM and PGlite lanes enabled: **2,818 passed / 22 skipped**. TypeScript and production build pass. Changed-file ESLint has zero errors and ten existing Fast Refresh export warnings. Whitespace/protected-file checks pass; AGENTS.md, package/bun.lock, src/start.ts, integrations and hotel-store are unchanged. Evidence files preserve final commands/output and RED counterexamples.

Isolated PostgreSQL WASM verifies 19 SQL tests: existing receipt/proof fences plus staff own direct authorise/reserve/settle, forbidden other requester/Owner-only approval, event baseline/scope and one-event replay. Two native multi-session cases are prepared (Owner approval and staff direct dispatch); native CI remains pending: automatic approval review blocked the remote source save before any file was uploaded. WASM is not native concurrency proof.

Mounted notification tests use synthetic same-origin responses and external Happy DOM tooling, including two mounted observers, auth dismissal, failed refresh, account-switch baseline and failed session. They do not establish physical browser audio, real signed-in N3 or two-device live acceptance. Synthetic route/transport tests cover RM70→RM60 with approval and RM50→RM51 without approval, preserve the same synthetic parent document and send once. The two real requested ORs were not touched.

Candidate migration: **20261012075339_hh_staff_receipt_authority.sql**. It replaces only the v2 authority functions additively and adds the immutable scoped event ledger/read RPC. Applied 20261003120216 is unchanged. Candidate generation used a UTC timestamp fallback after the unavailable Supabase CLI (`npx --no-install` reported missing package); no app dependency/lockfile was changed. No SQL was applied remotely. Latest freshly observed live ledger remains 20261003120216; billing/source/accountant candidates remain unapplied too.

## Remaining live lanes — not authorised/executed here

1. Review the receipt-only release diff against current main: this existing branch also contains unrelated billing prerequisites, so do not merge the whole branch as an urgent deposit-only release.
2. Verify target Lovable runtime/schema/RPC/types and apply only the exact separately approved staff migration through Lovable-managed access. Avoid replaying earlier migrations. Git sync does not apply schema.
3. Confirm exact normal/scoped activation and accepted N3 update contract. Normal editing stays OFF. The historical RM70→RM85 scoped trial is not substituted for current RM70→RM60/RM50→RM51 cases.
4. Resolve/reject each existing legacy manual request explicitly, preserving its audit. Never automatically upgrade/run it after an approval switch changes.
5. Owner/staff perform specifically authorised same-OR acceptance entirely in HH using their own N3 roles: approval ON OR2610/003 RM70→RM60, OFF OR2610/001 RM50→RM51, independently confirm exact N3 detail/journal and all HH readers. Verify current before values first; do not assume historical amounts.
6. Complete signed-in Front Desk/Owner two-session notification/refresh, denial/revocation, browser sound/mute, mobile/folio/report acceptance; then the separately authorised public release.

This checkpoint is source implementation and synthetic/native-test preparation, not live deposit repair or client acceptance. No main merge, Lovable AI Build, operational DB writes, runtime activation, deployment/publication, N3 call/write or BEC work occurred. Runtime/build source-only does not mean deployed. Existing checkout and raw evidence remain preserved for cross-device recovery.

## Remote-save blocker and local recovery identity

Source candidate local commit: fcbfe8742def6e913a8430b7127641747e1f5539, tree 69741f37d993ea8ece373936f526a24142fc2dcf. All final code checks above apply to that source. This documentation-only follow-up does not change product code.

The first GitHub create_blob attempt for .github/workflows/staff-deposit-review.yml was rejected by automatic approval review. Stated reason: uploading repository source to an unverified GitHub destination without explicit authorization to disclose that payload. No file/blob/ref update succeeded, no workflow started, and no workaround/retry was attempted. Fresh read-only inspection had confirmed the expected repository/review branch and matching input tree; that did not supply the explicit upload authorization the review requested.

Remote review therefore remains 32f8595f5000c1feb7144dbdd5d411eb8472986a, not the new candidate. Main remains 6ac17dee7b503b96daf89015afdc9fb3995e1b68. Local tracked files are clean after each checkpoint commit. Original untracked adoption copy and supabase/.temp are preserved. No build/test process remains after final verification.

Requested next permission is narrowly bounded: upload this exact local checkpoint to mugs-AI/hotel-hub review/hh-source-prerequisites-20261012 with expected-head protection, then run its prepared disposable PostgreSQL 17.6 CI. This does not authorise main merge, operational migration/DB writes, runtime activation, public deployment/publication, N3 actions or BEC work. Receipt-only release extraction remains a separate lane because the preserved branch contains earlier broader billing source.
