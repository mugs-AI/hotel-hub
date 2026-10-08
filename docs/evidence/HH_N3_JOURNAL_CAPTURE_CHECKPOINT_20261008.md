# HotelHub optional journal capture checkpoint — 08/10/2026

Upload to Project Sources: **No** — repository execution evidence.

Resumed the existing worktree and review branch without repeating Task7/8 or
prior billing, frozen-folio or console work. Starting local HEAD
`5e71c200c97f0df60ba3d20ab99ba0a6a3e2a46d`, remote review
`8cfc69b79ca287f2a1228ace6e2b86b9171a1b25`, shared tree
`7b6b21fe849b9110cafde2215c725b35a70502df`.
Fresh main/Lovable remain `734ac405c82e653a7098ce0ef22d51586382bd9d`,
ready and agentFinished. Review branch: `review/hh-n3-billing-20261008`.

## Implemented diagnostic

The existing Owner console has an optional **Include GL journals** checkbox,
off by default. It captures responses from fixed GET GLPosting routes for
accepted receipt, cash-sale and customer-refund detail UUIDs discovered by the
server. Browser-supplied credentials, tenant, document IDs, endpoint and method
are not used. It adds no N3 write or financial activation.

| Bound | Value |
| --- | --- |
| Documents | 12 total, deduplicated by resource and UUID |
| Concurrent reads | 3 |
| Capture phase | 40 seconds |
| Individual read | 10 seconds or remaining phase budget |
| Response body | 1 MB streamed byte limit |
| Retry / redirect | None / rejected |

Bundle schema is `5d0.4`. Coverage is explicitly partial when source details
are missing, a sample is shortened, or the cap is exceeded. Capturing responses
does not establish posting correctness or complete settlement proof.
The UI clears the last result before starting another request and supports older
bundles without journalCapture. Evidence stays collapsed until requested.

The shared lossless parser was moved from the existing strict billing transport:
oversized integers remain exact strings; duplicate keys, rounded oversized
exponents and trailing JSON data are rejected. Existing billing gates stay closed.

Journal samples remove credential/internal keys and tenant IDs even through
arrays. Unknown/free text and names are redacted. Restricted financial
IDs/codes/dates and numeric amounts remain. Metadata cannot export arbitrary
error-code text or the session token. This deliberately sacrifices descriptive
text until an explicit journal field contract is accepted.

Any observed list-page, detail or journal HTTP401 reaches session invalidation
and returns no financial bundle. No additional journal reads start after a source
401, and journal scheduling stops after an observed journal401.

## Review and verification

One independent read-only delta review found three Important issues and no
Critical/Minor issues. One regression fix pass addressed page401 aggregation,
envelope-code token disclosure, and tenant-array/free-text privacy. All three
failures reproduced before correction; 143 focused tests then passed. No re-review.

Final full suite: **2248 passed,20 skipped,0 failed**;140 files passed,3 existing
optional SQL suites skipped. TypeScript, production build and changed-ten-file
ESLint exit0. Full lint remains **170 baseline errors,38 warnings** in unchanged
receipt SQL checks. Diff check is clean. Protected files, dependencies, SQL,
coordinator, provers, production adapters and integration files are preserved;
only the exact parser extraction affects strict billing transport.

Review did not establish actual tenant journal shapes or vendor semantics,
browser/mobile operation, deployment or whole-billing readiness. Timing/build/
test evidence belongs to the executor. Pre-existing transport beyond the direct
new reuse and audit/session infrastructure failure behavior were not reviewed.
Each remains unaccepted, never silently counted as proof. Detailed rulings and
their costs are in the execution ledger.

## Release and next work

**This is a review checkpoint, not a published feature.** No operational DB call,
N3 call/write, migration, main merge, deployment, publish or Lovable AI Build
occurred. New tests mock network, session/settings and audit dependencies.
The Owner console, when later used live, can create its normal HotelHub
settings/audit records; GET-only describes its N3 operations.

Prior conditional publish authorization remains recorded. The whole billing
branch is not release-ready. Next safe release step is a main-based candidate
containing these exact reviewed read-only console files and relevant tests,
excluding billing SQL/writers/coordinator and new checkout paths. Verify that
candidate, sync and publish independently before telling the Owner the checkbox
is live.

After that diagnostic release, use existing company **9AC-0D9-2F1 —
MUGS AI LAB TEST SDN. BHD.**, date range **26/09/2026–27/09/2026**, enable
Include GL journals, choose Get Result, and export its sanitized JSON.
Review those GET responses against the already existing documents; do not
recreate receipt, cash-sale or refund transactions.

Current GL/master, exact ownership, before/after preservation, refunded-receipt
semantics and the vendor's atomic allocation concurrency mechanism are still
unaccepted. Journals alone cannot unlock allocation gates. Tasks9/10 production
adapters, frozen print/monthly/matched-deposit integration and live browser
acceptance remain incomplete. Task7/8 and prior native SQL acceptance are preserved.
