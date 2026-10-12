# HH deposit-only release — 12 October 2026

Status: locally prepared and reviewed; NOT uploaded, merged, migrated, activated or published. No N3 writes or live request decisions were performed.

## Exact source candidate

Repository: mugs-AI/hotel-hub. Local branch: review/hh-deposit-release-20261012.
Base: 6ac17dee7b503b96daf89015afdc9fb3995e1b68 (observed live main/Lovable source).
Code commit: 8b7f46902030655ff865967c3eb8c5b9281fbf81.
This isolated candidate contains receipt/staff authority, shared notices, reservation recovery and completion fixes only. Unfinished billing, security cash, accountant and settlement modules are excluded. Existing disabled historical scoped-UAT guards are preserved, never activated for these cases.

## Reported cases and read-only diagnosis

| Receipt | Current recorded amount | Requested amount | Saved request state | N3 update attempts |
|---|---:|---:|---|---:|
| OR2610/001 | RM50 | RM51 | approved_awaiting_n3, generation 1 | 0 |
| OR2610/003 | RM70 | RM66 | needs_review, generation 1 | 0 |
| OR2610/004 / BK260925001 | RM33 | RM30 | pending, generation 1 | 0 |

Live deposit approval setting is OFF. These are old manual requests. OR001's active request blocks another Edit. OR003 and OR004 did not execute an automatic N3 Update. Approval OFF alone does not install/activate the new updater.

## Candidate behavior

Authorized Owner / Front Desk with approval OFF submits a normal correction through their own current N3 authority; exact receipt Update and read-back must succeed before HH projects the amount. Readers refresh before the dialog closes. Front Desk cannot approve Owner-only requests. Approval ON preserves Owner approval.

If automation is unavailable, a new correction returns an explicit unavailable result and creates no new manual Dashboard task. No false N3 success or automatic legacy conversion.

Owner can check an old saved request in its reservation. OR001 first needs its existing read-only result check; if unchanged it becomes reviewable. Owner can then explicitly confirm closing the old HH request without changing N3 money. OR003/OR004 offer explicit local close confirmation. Request history remains. A fresh edit becomes possible after the old request is closed. This release does not itself close any live request.

Read-back mismatch, unknown outcomes, session/role/tenant changes, failed balance refresh and N3 permission denial remain fail closed. The observed same-dialog/polling refresh concurrency edge may conservatively keep the dialog open with a refresh warning; it cannot announce stale totals as success.

## Verification

Full isolated suite: 2,318 passed, 22 skipped, with external HappyDOM and PGlite (no package changes). TypeScript passes. Production build passes. Changed-file lint: zero errors, ten existing Fast Refresh warnings. git diff --check passes. Independent review found no remaining Important/Critical issue after fixing pre-commit stale reads. Real active QueryObserver regression verifies old70 reads cannot satisfy post-commit66 completion.

Staff migration is byte-for-byte identical to the previously reviewed migration with native PostgreSQL 17.6 proof (21 passed). This is not evidence of live migration or live N3 acceptance. No deployment/browser end-to-end success is claimed.

## Exact gated release sequence for approval

1. Upload this candidate and this release packet to a review branch; verify remote tree/hash, unchanged main base and deposit-only diff. Never upload the broad reconstruction branch.
2. Verify Lovable-managed runtime configuration through a supported configuration surface. Available Lovable connector tools currently expose no environment/secret setter. If configuration cannot be safely read/set, STOP before production publication and report the exact access blocker. A read-only Lovable browser inspection may be needed; never inspect or reveal credentials.
3. Apply only supabase/migrations/20261012075339_hh_staff_receipt_authority.sql to the existing Lovable-managed backend after prerequisite/migration checks. No separate Supabase account and no operational receipt/request UPDATEs.
4. Configure the normal runtime lane: HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT=true; HOTELHUB_RECEIPT_EXECUTION_BUDGET_MS=30000; HOTELHUB_N3_DEPOSIT_WRITES_ENABLED=true; both HOTELHUB_N3_DEPOSIT_WRITE_TENANT_ALLOWLIST and HOTELHUB_RECEIPT_EDIT_TENANT_ALLOWLIST include only verified approved tenant ca75ed66-69ac-40d9-92f1-f6b3a8780fdd. Keep HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED=false; never use historical70→85 permits for66/30. Re-check gates and server capability before publication. Values are release requirements, not claims that current secrets were inspected.
5. Merge only this reviewed deposit candidate and publish only its verified Lovable deployment. Stop if main/base, hash, migrations or runtime gates differ. Retain pre-release source/runtime checkpoints for rollback.
6. Owner performs explicit legacy recovery and real in-HH acceptance: OR00370→66, OR00433→30, then desired OR001 correction. Verify N3 exact amount, HH refreshed amount, close behavior and folio continuation. No agent performs these financial actions on their behalf.

Approval covers the exact source upload, stated schema migration, normal runtime activation, merge and publication. It does not authorize agent-created financial writes, clearing live requests, unrelated features or expanding tenant allowlists. Publication remains blocked until the runtime configuration path is verified.

Project Sources upload: NO — engineering release packet. The already approved deposit workflow source remains authoritative.
