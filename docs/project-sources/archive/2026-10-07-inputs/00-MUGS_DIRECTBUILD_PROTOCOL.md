# MUGS DirectBuild Protocol (MDB-01)

**Version:** 1.1 — 03/10/2026 (Malaysia)  
**Upload to Project Sources:** Yes — replace the previous common protocol in each applicable project. Keep the matching product adoption file and all product requirements.  
**Status:** Reusable Project Source and delivery rule  
**Owner:** MUGS PERFECT SOFTWARE SDN. BHD.  
**Scope:** N3 extension products initially built or hosted in Lovable and subsequently developed through a linked GitHub repository  
**Companions:** One product-specific `MDB-01_<PRODUCT>_ADOPTION.md` for each existing product; attach both files to the corresponding ChatGPT Project Sources.

## 1. What this rule does

Use the owner's established path: Project Sources → N3 Development Instruction → N3 Starter Prompt → initial Lovable project/build → backend choice and GitHub connection → controlled direct coding for later work. DirectBuild means editing and testing the real repository with ChatGPT/Codex or another developer, normally on a review branch. It does not mean abandoning Lovable hosting, its backend, its visual editor, or the connected N3 application.

The initial Lovable build is the default MUGS onboarding path, not a technical requirement of GitHub or Supabase. Decide and record the backend at creation: Lovable Cloud's built-in Supabase-based backend **or** a separately owned Supabase project. Never assume that switching between them is automatic. Record the exact Lovable project, workspace, GitHub repository, synced branch, backend kind and backend project reference before the first direct change. Do not record a secret value in Project Sources.

This document governs **how** a product is built. Product requirements, N3 contracts, permissions, tenant isolation, commercial rules and accepted work packages stay in their own Project Sources. A reusable workflow never silently supersedes a stricter product rule. When an older source requires Lovable for every build, document the conflict and explicitly amend that governance at a safe checkpoint before adopting DirectBuild for that product.

## 2. Four independent release lanes

| Lane | Authoritative state | What GitHub/Lovable code sync does | Separate proof before claiming live |
| --- | --- | --- | --- |
| Application code | Reviewed Git commit and Lovable's synced branch | Commits on the active branch appear in Lovable after sync | Exact commit/tree, sync status, build and actual deployed version |
| Database schema, RLS, RPC and data | The **actual** backend database and migration history | Syncs migration **files**, not the database change | Target project identity, approved migration, applied version, schema/RLS/RPC inspection, data compatibility |
| Edge/server functions and secrets | Deployed function version and server-side secret store | Syncs source files, not function deployment or secret values | Target project identity, deployed version, secret names/presence without exposing values, authenticated behavior |
| Public release | Lovable publish/deployment or other hosting pipeline | A Git merge may update the editor/preview; it is not proof of public release | Deployment ID/commit, domain, smoke checks and owner-approved release |

**Therefore:** merging the reviewed branch into Lovable's synced `main` is important for returning approved **code** to Lovable. It does **not** by itself “calibrate Supabase.” Calibration means separately reconciling repository migrations and generated types with the actual backend schema, migration history, RLS, RPCs and deployed functions. A configured external Supabase CI/branching pipeline could deploy on merge; inspect its real configuration and logs first. Never assume that such a pipeline exists.

## 3. Authority and checkpoints

1. Confirm product, workspace, Lovable project ID, repository, synced branch, backend type/reference, environment (sandbox/staging/production), N3 tenant and intended work package. Product ID and backend target cannot come from an untrusted browser field.
2. Read the current Project Sources, recent owner decisions, repository `AGENTS.md`/governance, existing migrations/functions and current deployed evidence. Resolve conflicting or stale instructions; do not rely on an old SHA as current.
3. Record `INPUT_SHA` from remote, Lovable's displayed synced commit, accepted baseline, working-tree cleanliness, and any pre-existing drift. A current head is not automatically an accepted baseline.
4. Define bounded included scope, excluded scope, frozen behavior, checks and side effects. Separate authorization for a code change from migration, N3 write, merge and publish unless the owner already granted that exact scope.
5. Work on an isolated review branch from verified `INPUT_SHA`. Do not force-push, rebase or squash history already synced to Lovable. Do not start concurrent Lovable AI edits of the same branch while direct code work is active.
6. Verify changed files, dependency/lockfile changes, generated types, secrets, routes, tenant and role guards, mobile behavior and relevant tests. A passing build alone does not establish live correctness.
7. Save a candidate SHA and diff. Review/approve the exact candidate, then fast-forward or reviewed-merge to the correct synced branch after a fresh base and Lovable sync check. Stop on divergent histories or new content drift. Platform-generated no-content commits may be assessed by tree comparison; real changed content needs review.
8. Confirm the remote resulting SHA/tree and Lovable Git sync status. A Lovable read-only project inspection is allowed when needed; distinguish it from a Lovable AI Build message and report any credit-consuming build separately.
9. Reconcile backend and publish lanes independently. Do not describe a feature as live until the necessary backend and public release checks pass.

## 4. Backend selection and identity record

Maintain a **non-secret** product deployment record with these fields:

| Field | Required rule |
| --- | --- |
| Product and permanent code | Record exact trusted product identity where the product uses BEC; no browser-selected identity. |
| Lovable workspace/project ID | Verify before every Lovable write and backend operation. |
| Git repository/default/synced branch | Verify by current remote and Lovable Project settings → Git. |
| Backend kind | `Lovable Cloud`, `own Supabase`, or `none/other`, based on observation. Do not infer from a `supabase/` directory alone. |
| Backend project reference | Store only the non-secret identifier; compare environment URLs without exposing credentials. |
| Environments | Name sandbox, staging and production separately; a Git branch alone is **not** a separate DB. |
| Deployment/CI mechanisms | State whether migrations and functions are manual, Lovable-managed or CI-managed, with actual evidence. |
| N3 connection | Identify sandbox versus production and permitted operations. Keep tokens and tenant-sensitive material out of documents and output. |

If a Lovable Remix points to the source product's Auth, database, Storage, functions or secrets, stop before first login or write. Give the Remix its own operational data and commercial identity. If the backend identity is unknown, pause backend work and mark it `NOT VERIFIED`; continue only with independent read-only or code-only work that cannot cause side effects.

## 5. Code-only route

For a change that genuinely needs no schema, function, secret or N3 contract change:

- Compare actual data shape and deployed API/RPC behavior with the code assumptions. Do not invent database columns to make TypeScript pass.
- Implement and test in a review branch. Use test fixtures or an isolated backend for writes; do not assume a local web server uses a local database.
- Inspect the entire diff for hidden SQL, generated types, function changes, new env variables, dependencies and direct network calls. If any appear, reclassify the work into the relevant lane.
- After reviewed merge, verify Lovable's active branch is in sync and inspect its preview. Publish only when in scope; then inspect the live site and logs.

## 6. Database/schema route

Use this route for tables, columns, indexes, RLS policies, RPCs, grants, triggers, seed/data changes, and migrations.

**Before:** identify the exact target backend and environment; inspect applied migration history, actual schema, generated types, permissions, existing rows and dependencies. Inspect any external CI/Supabase branching that might automatically deploy on merge. Back up or record a recovery point appropriate to the change. Plan an additive, forward-safe, tenant-safe migration; never rewrite applied history. Put both migration and compatible application code in the candidate; avoid exposing UI paths that require unapplied schema.

**Apply:** obtain the scope-specific authorization required by the product. For Lovable Cloud, use the project's approved backend operation/SQL mechanism; for an owned Supabase project, use its approved migration mechanism. A merged SQL file alone is not applied. Verify the backend project reference immediately before the write. Do not run the same migration through two controllers. If a deployment pipeline automatically applies it, let that pipeline be the sole executor and inspect its result.

**After:** compare remote applied migration versions and actual schema/RLS/grants/RPCs with repository SQL; regenerate or verify types; exercise authorized and denied tenant/role cases; verify old data and rollback/forward recovery behavior. If code and schema cannot be changed atomically, plan compatibility and sequence explicitly. Mark state separately as `CODE MERGED`, `DB APPLIED`, `BACKEND VERIFIED`, `PUBLISHED`, `LIVE VERIFIED`.

**Failure:** stop writes; do not blindly rerun or use migration-history repair as a shortcut. Record partial effects and affected environment, preserve existing data, and design a forward correction or controlled restoration. Reverting Git does not undo an applied migration.

## 7. Function and secret route

Function source committed to `supabase/functions/` or server routes is not proof the deployed runtime changed. Check whether this app is a legacy client/Edge Function design or a newer server-rendered architecture. Identify exact runtime, deployment mechanism, target project and secret source. Never place service-role credentials in browser-exposed `VITE_` variables, Git, Project Sources, screenshots or logs. Verify local/prod secret **presence** and authorization, not values.

Deploy changed functions using the approved product backend mechanism only after target validation. Check deployment version/logs and run authenticated role/tenant and failure-path tests against the intended environment. A local pass may not prove managed Lovable connectors work outside its preview. Do not treat code merge, function deploy and live publish as the same event.

## 8. N3 and financial side-effect route

Treat every N3 write as a separate side effect. Verify the server-authoritative N3 user, stable tenant, immutable IDs, exact endpoint/payload and sandbox versus production. Use idempotency or a durable claim where available; classify unknown responses as **unknown**, never automatically retry a financial POST as if it failed. Record external transaction IDs and read back. Never let a local test pointed at a production backend or N3 tenant create transactions inadvertently. A code-change authorization alone does not authorize an N3 transaction.

## 9. Security, data and test checks

- Tenant isolation and server-side role/identity remain authoritative. Test a permitted and denied actor, an alien tenant, and stale/revoked sessions for changed paths.
- Validate RLS **and** server-side authorization. Do not place privileged service keys in browser code. Redact N3 tokens, backend secrets, customer data and sensitive tenant identifiers in reports.
- Preserve existing attachments/storage provider behavior. Do not assume Lovable's built-in storage replaces an explicitly chosen Google Drive or N3-only data model.
- Run the product's actual package manager/lockfile and relevant typecheck, lint, tests and build. Explain an existing failing baseline instead of calling the whole suite green. Use meaningful tests; owner can do final manual UAT.
- Inspect preview/live behavior at desktop and mobile sizes where relevant. Preview success does not establish production publish.
- Record what **did not** occur: no migration, function deploy, N3 write, merge or publish unless evidence shows it happened.

## 10. Drift and rollback decision table

| Condition | Response |
| --- | --- |
| Lovable and GitHub on different or diverged commits | Pause merge/build. Compare commits and trees; resolve the authoritative base without overwriting either side. |
| Another Lovable run or developer changed `main` | Refresh base, inspect diff, retest/review candidate; do not assume prior merge authorization covers a different target. |
| Package/lockfile/types changed unexpectedly | Check for platform drift; restore only if unrelated and prove the candidate tree still matches tested content. |
| DB migration applied but application merge fails | Keep compatible old code or use a planned forward fix; do not assume Git revert reverses schema. |
| Function source merged but runtime old | Do not publish dependent UI; deploy/verify function through approved lane. |
| Local test reaches live DB/N3 | Stop test writes, establish impact from logs/IDs, avoid repeat side effects. |
| Sync succeeded but public app unchanged | Check deployment status/domain and publish gate, not merely Git SHA. |

## 11. Evidence report for every work package

Report: product/environment; approved scope; starting and candidate/main SHAs; changed-file list and tree/diff summary; test commands/results; Lovable synced branch/status; backend kind/reference; migration history delta and applied state; deployed function versions; secret presence check; N3 operations and readback; preview/live test; publish ID; unresolved risks. Use `NOT VERIFIED` rather than inferring success from a builder message. For read-only inspections say so explicitly.

## 12. Existing-product adoption and future-project bundle

Existing products: attach this common source and the matching product adoption file to the ChatGPT Project. Update that project's short Instructions to say: **“Read `00-MUGS_DIRECTBUILD_PROTOCOL.md` and `MDB-01_<PRODUCT>_ADOPTION.md` before build planning. Respect stricter product gates and verify current repository/backend identity. Do not infer database deployment from Git sync.”** Inspect and reconcile old builder-only rules first. Merely generating these files does not update a ChatGPT Project, Lovable Knowledge, repository, database or deployment.

| Current product | Required companion | Observed repository |
| --- | --- | --- |
| HH1.0 HotelHub | `MDB-01_HOTELHUB_ADOPTION.md` | `mugs-AI/hotel-hub` |
| SH2.2 ServiceHub | `MDB-01_SERVICEHUB_ADOPTION.md` | `mugs-AI/ServiceHub2` |
| PMS1.0 ProjectHub | `MDB-01_PROJECTHUB_ADOPTION.md` | `mugs-AI/pms` |
| Custom Bill Entry | `MDB-01_CUSTOM_BILL_ENTRY_ADOPTION.md` | `mugs-AI/n3-custom-bill-entry` |
| BEC1.0 | `MDB-01_BEC_ADOPTION.md` | `mugs-AI/bec1.0` |
| SalesPilot | `MDB-01_SALESPILOT_ADOPTION.md` | `mugs-AI/VanSales` |

For the six existing ChatGPT Projects, use this short Project Instructions addition with the exact corresponding companion filename substituted:

> Use the attached MUGS DirectBuild Protocol (MDB-01) and this product's MDB-01 adoption file for development delivery. Start new N3 extensions with Project Sources, N3 Development Instruction, N3 Starter Prompt and initial Lovable build as the default onboarding route. Then permit bounded direct repository development on a reviewed branch after current product governance is reconciled. Check Git/Lovable sync, actual backend migration/function state and publish state independently. Existing product security, tenant, N3 and approval gates remain in force.

For **each future new project**, include in the generated Project Sources: this versioned common protocol, a new product adoption file with actual IDs and N3/backend contracts, and a `PROJECT_START_HERE` reference to both. The ChatGPT Project Instructions must point to them. If another conversation cannot see these files, attach the current copies; do not claim a global ChatGPT memory or automatic installation. Refresh from current official platform behavior and the product repository before execution.

Do not create a Lovable workspace skill merely by naming this protocol. A Lovable workspace skill is a separate installation with its own scope and owner review.

Direct coding avoids Lovable AI Build messages for that coding step. It can still consume development time, Git hosting, Lovable hosting/backend runtime, connector/API and external service usage. A read-only Lovable project lookup is not evidence of an AI Build message. Confirm actual usage from platform records rather than a generic activity label.

## 13. Source references and interpretation

Lovable Git sync and Cloud documentation rechecked 03/10/2026; other references below retained from the 29/09/2026 review:

- Lovable Git sync: https://docs.lovable.dev/integrations/git-sync-overview — active branch, divergence, local backend access, and explicit non-deployment of Cloud migrations/functions from synced commits.
- Lovable GitHub integration: https://docs.lovable.dev/integrations/github — two-way code sync and branch controls.
- Lovable Supabase integration: https://docs.lovable.dev/integrations/supabase — owned Supabase versus Lovable Cloud, migration approval and generated types.
- Supabase migrations: https://supabase.com/docs/guides/deployment/database-migrations — migration history and explicit/CI deployment paths.
- Supabase function deployment: https://supabase.com/docs/guides/functions/deploy — function deployment is a separate operation.

These documents describe platform behavior; actual project configuration and owner-approved product governance determine the permitted operation. Recheck them if the platform changes.

## 14. Required alignment checkpoint and switching builders

This section makes the existing independent-lane rules explicit for every product. It does not grant new implementation, migration, deployment or financial-write authority. Current owner authorization persists: complete necessary work already authorized without requesting the same permission again.

### 14.1 Before the next package or a builder handover

Inspect the actual state, not only earlier reports. For the most recent package, record each applicable row as ALIGNED, PENDING, UNKNOWN or NOT APPLICABLE, with evidence:

| Check | Required comparison |
| --- | --- |
| Target | Exact Lovable project/workspace, connected repository, active synced branch, backend kind/reference and environment |
| Code | Candidate branch/SHA, remote synced-branch SHA and Lovable sync status; distinguish prepared, pushed, merged and synced |
| Schema | Repository migration files versus remote migration history and actual columns/tables, constraints, RLS, grants and RPCs |
| Types | Generated database types versus the actual backend schema; type edits cannot create a database column |
| Functions | Committed function source versus deployed runtime version and required secret presence |
| Release | Preview version versus published version/domain and actual smoke-test evidence |

UNKNOWN is missing evidence, not a failure or permission to write. Continue independent authorized work when safe; hold only work that depends on the unresolved state. If a check is inaccessible, state the exact missing capability and smallest next action.

### 14.2 Adding a column or table through DirectBuild

1. Verify backend target, applied history and access route. A review branch may still call the production database.
2. Prepare a reviewed forward migration, compatible application code, permissions and meaningful checks. Preserve existing data and tenant isolation.
3. Apply through one approved backend executor within existing authority. Git sync alone does not apply it. For Lovable Cloud, use its supported SQL editor or a specifically authorized bounded Lovable backend request; never assume a separate Supabase dashboard login or privileged database connection exists.
4. Verify actual schema and permission behavior, and record how the execution is represented in migration history. Manual SQL execution must not be assumed to register a migration version automatically. Reconcile any missing history using the supported procedure after inspection; never rerun the SQL blindly or fabricate an applied record.
5. Regenerate/reconcile types against the actual schema; deploy affected functions separately and verify them. Release dependent UI only after its backend requirements exist.
6. Save evidence, complete the authorized merge/sync/release steps, and clearly report any remaining lane.

If backend execution access is unavailable, finish the reviewable migration and report DB PENDING. Do not substitute a frontend column, fabricated types or an unrestricted client key. Do not silently send a credit-consuming Lovable AI Build request as a fallback. Where the owner has prohibited such requests, offer the SQL-editor route or report the access blocker.

### 14.3 Return from DirectBuild to Lovable development

Before an owner starts a new Lovable AI request:

- Finish or pause the active DirectBuild package and preserve its candidate/working changes. No overlapping builders on the same work.
- Ensure approved code reached the actual Lovable synced branch and inspect the in-sync state. A review-branch push alone is insufficient.
- Resolve relevant schema/type/function mismatch before requesting a dependent feature. Inspect changes generated when Lovable opens the project; platform-generated types/connection files are real diffs that need review, not automatic permission to delete them.
- Give Lovable the repository handover and permanent product constraints. ChatGPT Project Sources do not automatically become Lovable Project Knowledge, and external commits need not create Lovable chat messages.
- Lovable can edit externally written code. Keep required behavior in its Project Knowledge and meaningful repository tests. Read the resulting diff, backend effects and sync state before accepting its work.
- If reverting code, preserve compatibility with the actual database. A code revert cannot roll back financial transactions or database migrations.

Suggested owner handover to Lovable, with placeholders replaced by verified evidence:

```text
This project was enhanced outside Lovable through DirectBuild.
Read the repository handover at [actual path]. Start from synced commit
[actual SHA] on [actual branch]. Preserve the existing backend identity,
tenant/role controls, N3 financial safeguards and accepted behavior.
Applied migrations: [verified versions or explicitly pending].
Deployed functions: [verified versions or explicitly pending].
Inspect actual schema before proposing database changes. Do not recreate
already-applied tables/columns, replace the backend or rewrite applied SQL.
Now perform only: [owner's bounded requested change].
```

### 14.4 Evidence and records shared across devices

Keep non-secret package handovers and release evidence in the product repository when documentation writes are authorized, not only in a transient conversation workspace. Include date/time, target IDs, starting/candidate/resulting SHAs, migration/function states, checks, authorization, unresolved work and next task. Never copy another product's checkpoint as this product's truth.

For each supplied Markdown file, state Upload to Project Sources: Yes or No. Stable protocol/requirements/adoption updates are Yes; temporary implementation plans and repository evidence are normally No unless explicitly promoted. Replacing a Project Source does not update GitHub, Lovable Knowledge, the database or the published app.

### 14.5 Installing v1.1 in existing projects

Replace the old 00-MUGS_DIRECTBUILD_PROTOCOL.md source with this file in HotelHub, ServiceHub, ProjectHub, Custom Bill Entry, BEC and SalesPilot. Retain each project's existing matching MDB-01 adoption file. That adoption's observed IDs and checkpoints are historical until checked; no project identities or current SHAs are verified by this shared update.

Add to each project's Instructions:

> Follow 00-MUGS_DIRECTBUILD_PROTOCOL.md v1.1 and this product's MDB-01 adoption file. Use DirectBuild within current owner authorization. Verify code sync, actual schema/migration history, generated types, deployed functions and public release independently. Before switching builders, record a verified alignment checkpoint and repository handover. Do not silently use Lovable AI Build as a fallback. Preserve product requirements and existing release, database and N3 financial gates.

Future new projects must include this protocol and a product-specific adoption file that records its own verified targets, access routes and constraints. Unknown targets remain Unknown; do not borrow another product's backend.

## 15. v1.1 change record

03/10/2026: Retained v1.0 product and safety controls; added required alignment status, explicit Lovable Cloud access handling, manual-SQL history reconciliation, builder handover, platform-generated drift review, repository continuity and all-project installation instructions. This file generation performs no product code, database, function, N3, merge or publishing operation.

Additional official reference: https://docs.lovable.dev/features/cloud — Lovable-managed backend, Cloud database and SQL-editor access.
