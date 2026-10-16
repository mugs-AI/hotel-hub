# HotelHub accountant foundation checkpoint — 12/10/2026

Upload to Project Sources: **No** — engineering recovery record in the existing review repository.
Status: reviewed, tested **source candidate**; accountant plan and source-billing integration remain partial. This is not a deployed feature or client acceptance.

## Recovery and authority

Continue from preserved local c9eb3f1 and remote05e9951296f31083572546330f9eced940091af3, exact tree71c7cb43e1c1df69e805de8f1a835526b16d9e88. Existing isolated local branch review/hh-reconstruction-20261011 and approved remote review/hh-source-prerequisites-20261012. No restart/replacement of existing billing/deposit/security work.

Fresh preserved-source verification reproduced2695passed/38skipped, exit0. The original c10 final raw outputs were unavailable; this is a new verification prompted by that evidence gap, not a claim they were recovered.

Existing Lovable project d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76, workspace JRQygHE7tZl2GgPN8a8N; latest source/main6ac17dee7b503b96daf89015afdc9fb3995e1b68, ready and agent finished. Public deployed asset identity and signed-in acceptance not refreshed in this continuation.

Backend remains Lovable-managed. The Owner has no separate Supabase account and must never be asked to create/use one. SELECT-only inspection through that project reports PostgreSQL17.6/UTF8 and latest applied migration20261003120216. New CLI-generated candidate supabase/migrations/20261012032508_hh_accountant_handover.sql was created locally, not applied. It depends on the unapplied billing ledger. No operational schema/type/runtime parity is claimed.

## Source prepared

- External matching prover consumes privately bound saved intents and authenticated bill/receipt evidence. Exact booking/tenant/customer/document/amount/journal ownership is preserved. It emits external_n3_matching provenance, no fictitious HH allocation dispatch, no spendable-credit authority and no checkout permission.
- Unknown/null refunds and unsupported overlapping RF rows remain held by existing strict evidence rules. Source-debtor/refund-specific contracts are not invented or activated.
- Owner service-only durable cases, append-only events, version/request fences, current role revalidation, compound booking/intent ownership, RLS and explicit public-role revokes.
- Open-as-at recorded history carries unresolved cases across months. Review is acknowledgment; changed financial observations can reopen a case. Pre-capture history and incomplete pages cannot produce a complete statement.
- Explicit statement capture stores immutable bytes and SHA256. A reprint reads the saved snapshot; report GET creates no observation/event.
- Resolution accepts an opaque proof converter, exact scope/current intent revision and fresh evidence. Identical committed resolution can be replayed by a scoped read after proof expiry or process restart; no new resolution can be authorized by a body digest alone.

No checker/report UI or revised whole-stay close is mounted in this delta. Existing canClose=false and all unaccepted financial gates remain held. Normal receipt editing remains OFF as governing direction; no runtime flag activation occurred.

## Independent review and one fix pass

One fresh read-only reviewer examined c9eb3f1..8167d6b. Three Important findings and two initially Minor findings were corrected in one covering RED→GREEN pass; no second independent re-review is claimed.

1. Completed resolution replay now performs exact GET-only saved-event lookup before checking authority for any new mutation.
2. Stable financial observationDigest excludes checkedAt and local intent revision; time alone cannot reopen unchanged facts.
3. Proof checkedAt preserves the oldest authenticated component read, preventing mint time from extending a lock-wait freshness window.
4. Completed Malaysia days use exclusive next-midnight boundaries, retaining events in their final microseconds.
5. Durable references obtain known receipt numbers from exact scoped progress evidence.

Ruling: the two report-edge findings were graded Important because a complete immutable statement could permanently omit a case or known required document reference. Cost if wrong: bounded extra report regressions; no new financial operation. No deferred review finding remains in this delta.

## Fresh checks after fixes

| Check                                  | Result                                                              |
| -------------------------------------- | ------------------------------------------------------------------- |
| Full Vitest                            | 2731passed,38skipped,zero failed;182files passed,four skipped;exit0 |
| New focused evidence/case suites       | 36passed;exit0                                                      |
| Disposable embedded PostgreSQL         | 13checks passed;exit0                                               |
| TypeScript                             | npx tsc --noEmit;exit0                                              |
| Changed TypeScript ESLint              | exit0                                                               |
| Production build                       | npm run build;exit0;final Nitro outputs confirmed                   |
| Native script syntax / diff whitespace | pass                                                                |
| Protected files versus main6ac17dee    | AGENTS, package/lock, start, integrations and hotel-store unchanged |
| Native17.6 single/multi-session        | NOT VERIFIED locally; prepared runner requires actual CI result     |
| Mounted/mobile/print/live N3           | NOT VERIFIED in this source preparation                             |

Raw check extracts and command exit results are retained in docs/evidence/HH_ACCOUNTANT_CHECK_OUTPUTS_20261012.txt. Full local outputs and progress/rulings remain in the ignored accountant plan workspace.

## Native environment and remaining work

Native local PostgreSQL17.6 tooling could not start: required ICU60 library missing, managed UID/group switching denied. No native test DB/process was created. A dedicated workflow is prepared for a disposable postgres17.6 service on the approved review branch, with guarded localhost/synthetic database and read-only repository permission. Its six independent-backend scenarios are not counted as passed until actual job output is read.

The new migration must not be applied as a workaround. There was no Lovable AI Build/settings change, main merge, public publish, backend apply, N3 request/write, receipt fixture repetition, commercial/BEC work or sharing to recipients.

Remaining approved tasks: bounded saved-document checker/401/deadline handling; accountant close and source-issued/guest-settled atomic all-room Dirty handoff; mounted Owner report/export and all-reader refresh; source Settings/booking/master lifecycle and editable attribution; accepted real document/reference/master contracts; native schema/type/runtime and signed-in mobile/print/UAT. Preserve20/10 training and01/11 launch as targets, not certified readiness.

This source candidate cannot resolve the original OR2610/001 exception or activate ordinary receipt editing. OR2610/002 proof is not repeated; BK260924001/OR2610/003 remains its separate dormant ordinary-workflow fixture.

Candidate SHA is the commit containing this checkpoint; resolve actual local and remote refs/tree at handover. Review push, main merge, operational migration/runtime, N3 acceptance/activation and public release remain separate lanes. No fresh approval is needed to continue the already approved remaining code scope.

## Native verification addendum — 12/10/2026, Malaysia

The review-branch source upload completed at43bd2b3a6283a88c68c5b6f8635d3b6f51efcc97, exact tree2831a37c5506ba881377eff37a9d0ed729d44608, matching localf23beae. GitHub run38202969784/job114660187231 passed13native17.6 single-session and6independent-backend scenarios; actual logs were read. See [native evidence](evidence/HH_ACCOUNTANT_NATIVE_SQL_EVIDENCE_20261012.md). This supersedes the prepared-runner/native-pending statements above for this scoped delta. Later documentation-only checkpoints preserve the tested product source. No operational Lovable migration, N3 operation, main merge or publication occurred. Task2/checker, Task4/close, Task5/report and the broader source-billing integrations remain pending; do not call the entire plan complete.
