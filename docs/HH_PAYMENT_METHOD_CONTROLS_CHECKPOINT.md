# HH payment method controls — build checkpoint

Date: 01/10/2026 (Malaysia). Status: **DB APPLIED AND VERIFIED — PUBLIC SOURCE UPLOAD AND RELEASE AUTHORIZED — RELEASE IN PROGRESS**.

## Latest release authorization — 01/10/2026

Owner explicitly approved uploading the reviewed correction to the existing public `mugs-AI/hotel-hub` repository and publishing HotelHub after the source-disclosure review block. No new feature or N3 write was authorized. The migration is already applied and must not be reapplied. Product code remains exactly the reviewed `d7c437f` candidate; subsequent local commits change only this checkpoint.

## Target and continuity

- HH1.0 / Hotel Hub, Lovable project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`.
- Repository `mugs-AI/hotel-hub`; public domain `https://hotelrooms.lovable.app/`.
- Remote main inspected at completion: `9f95f8779b60fd1eb809e777d43548bbf03226e0`, tree `777a754e162378074e5a7f9e93b777bb5450a605`.
- Candidate branch: `agent/hh-payment-method-controls` in the existing isolated public-release worktree.
- Local equivalent base: `89585ed9e3f7360a67055780fea83f58fb42997c`. Its tree exactly equals remote main's tree; the SHAs differ because the previous release used connector-created commits. Do not merge unrelated recovery history. A future release must use the freshly verified remote main as its parent and reproduce the reviewed candidate changes.

## Approved build and resulting behavior

Settings previously used the strict receipt-posting defaults parser to load the account list. A response with a valid currency ID but no default account or currency code therefore blocked the read-only list. This is a proven code path; the exact field or transport failure in the owner's sandbox has not been observed.

Settings now requires a declared-success N3 defaults response with a valid currency ID and no contradictory supplied currency details. It does not require posting defaults simply to list active, leaf, currency-matched bank/cash accounts. Errors distinguish unavailable/rejected defaults, missing/invalid/conflicting currency, permissions and session expiry. No currency or account defaults are invented.

Each method has a **Show** checkbox and **Save method** button alongside its local display name. All existing methods start shown. Settings retains hidden methods for re-enabling; the deposit picker filters them. The server rejects a hidden selection before a new preview or deposit claim/N3 call. Existing idempotent results, historical snapshots and reconciliation remain intact. The strict receipt defaults, detail/journal proof, write feature gates and split-payment gate remain unchanged.

Preference writes are scoped to the trusted session tenant and verified immutable N3 account UUID. A single database UPDATE patches only the edited account, preserving other methods and concurrent changes. Names and visibility use canonical UUID reads; editing/clearing a name removes only that account's legacy casing variants. Browser roles cannot execute the new RPC.

## Prepared database change

File: `supabase/migrations/20260930135429_hh_payment_account_visibility.sql` (created with the Supabase CLI).

- Add `hotel_settings.payment_account_visibility` JSONB NOT NULL, default `{}`, with an object-shape constraint.
- Add `hotelhub_set_payment_account_preferences(uuid, uuid, text, boolean)`, SECURITY INVOKER, empty search path, explicit execute permission only for `service_role` (PUBLIC/anon/authenticated revoked).
- Preserve aliases on Show-only edits; preserve visibility on name-only edits. No N3, reservation or deposit data mutation.
- Expected type contract is prepared in `src/integrations/supabase/types.ts`; verify/regenerate against the actual backend after application.

Read-only Cloud metadata confirmed: tenant ID is UUID; `hotel_settings` has RLS enabled and no browser policies; only the older alias field currently exists. Applied ledger contains `20260927120000` (`hh_payment_accounts_and_lines`). New version `20260930135429`, visibility column and new RPC are absent. The configured Supabase ref is configuration evidence only; no direct CLI connection to a remote database was made.

## Verification

- Four focused suites: **101 passed** (Settings API/currency errors, preferences store, rendered checkbox/wiring/filtering, deposit safety).
- Full suite: **1,539 passed, 20 skipped**, 96 files passed / 3 skipped.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed. Generated route formatting drift restored.
- Changed-file ESLint: **0 errors, 8 existing Fast Refresh warnings**. Whole-repository lint retains **15 pre-existing formatting errors and 28 warnings** on unrelated paths; it is not a clean full lint run.
- `git diff --check`: passed.
- Independent review found and reverified the casing correction; no remaining blockers.
- The actual prepared SQL executed successfully in an isolated local PGlite PostgreSQL fixture: default Show behavior, per-account preservation, canonical IDs, clearing legacy aliases, tenant isolation, invalid input rejection, invoker security and denied anon/authenticated execution. This does not prove the remote backend is migrated or healthy.

During the original build, no remote database writes, N3 operations, push, merge, Lovable AI request, publish or deployment occurred. The later authorized migration application is recorded below. No live sandbox fix is claimed.

## Authorized release checkpoint — 30/09/2026

Owner approved applying this migration and publishing the reviewed payment-method correction. Existing accepted live base remains `9f95f8779b60fd1eb809e777d43548bbf03226e0`; it is not acceptance of this new candidate. Reviewed code candidate is `d7c437f79343ab2b0b8c277a0306af778f9c767a`, tree `a0452d1556466e33ac4c2a5c680a1531277c3bee`. GitHub main and Lovable source were freshly checked at `9f95f877`; no code or dependency drift was found.

Fresh gates: 1,539 tests passed / 20 existing skips; TypeScript and production build passed; changed-file lint has 0 errors / 8 Fast Refresh warnings; formatting and diff checks passed. Generated route ordering was restored to the candidate version after build. Existing whole-project lint exceptions recorded above remain.

### Database applied and verified

Target: existing Hotel Hub Lovable Cloud project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`, workspace `JRQygHE7tZl2GgPN8a8N`. Database enabled, Supabase stack; all actions used that exact project through its Cloud database controller. No external Supabase account was connected.

Applied `20260930135429_hh_payment_account_visibility.sql` once, with its migration ledger entry, in one transaction guarded against pre-existing column/function/ledger and settings drift. SQL source MD5: `957e6603eae7f9dcad6482bc696a6a1f`; remote ledger matches. Schema-cache reload notification issued.

Confirmed JSONB NOT NULL default `{}`, object constraint, empty function search path, SECURITY INVOKER, service_role execute allowed, anon/authenticated execute denied. RLS remains enabled with zero browser policies. All 10 existing settings rows have default visibility; old settings fingerprint is unchanged (`70f64ad89601c2b12764f3764593aa83`). Execution checks in a rolled-back transaction confirmed invalid-input rejection, unmatched tenant returns zero rows under service_role, and actual anon/authenticated execution denial. No existing settings row was altered by those checks.

Recovery: old application is compatible with this additive schema. Keep the column, function and ledger; do not drop data or blindly rerun the migration.

### Release blocked before source upload

Automatic approval review rejected `github_create_tree` because it uploads reviewed source code to a repository considered unverified/public, and required explicit source-disclosure approval. A read-only identity check then confirmed repository ID `1305313263`, owner `mugs-AI`, canonical name `mugs-AI/hotel-hub`, public visibility, and current connection admin/push permissions. The repository is the existing HotelHub target, but it is public.

No source upload, branch update, merge, Lovable AI build, publish or deploy was performed. Do not bypass the rejection through another tool or indirect route. Obtain explicit approval to upload this reviewed correction to the public repository before resuming the release. No N3 operation occurred. Authenticated sandbox Settings and Show/Hide live acceptance remain pending.

Next bounded action, after that approval: freshly verify main/Lovable, create the exact reviewed candidate tree on remote parent `9f95f877`, verify tree equality, fast-forward main, verify Lovable sync/preview, publish existing `hotelrooms.lovable.app`, and record deployment plus UI acceptance. No migration reapplication and no N3 financial write.

## Original build release sequence (historical)

The Project Owner's latest `approve` covered the bounded build only. `08-10-LOVABLE_GOVERNANCE.md` section 4 says: “Never treat authorization for build as authorization to push, merge, publish, migrate or post to N3.” `13-00-MUGS_DIRECTBUILD_PROTOCOL.md` section 6 requires scope-specific database authorization. Obtain approval for this exact migration and the reviewed Hotel Hub public release before acting.

After that approval:

1. Freshly verify repository/main, Lovable sync, exact Cloud backend target, migration ledger, schema and grants; stop on real drift. Record a recovery point.
2. Apply the additive migration and ledger version through one approved controller/transaction; verify column/default/constraint/RPC/grants and refresh the API schema cache if needed. Old code remains compatible with the additive schema. Do not ship the new settings SELECT before the column exists.
3. Release only the reviewed candidate changes onto the exact remote main parent; verify candidate tree/content and Lovable sync, then publish to `https://hotelrooms.lovable.app/`. Record release commit and deployment ID separately from the DB version.
4. Check the public app and supported tenant UI. Owner verifies sandbox Settings: methods load or show a specific diagnostic; uncheck Show and Save method, reload and confirm it stays hidden; re-enable and confirm it returns. Check narrow-screen layout. Do not ask for N3 credentials or repeat completed financial UI tests. Any new N3 financial operation needs its own authorized owner-run test.

Recovery: reverting the application release leaves this additive column/function and saved preferences in place; do not drop preference data as an automatic rollback. Diagnose a failed migration without blind rerun or ledger repair.

This checkpoint is specific to HH1.0. It is not a generic source for other projects.
