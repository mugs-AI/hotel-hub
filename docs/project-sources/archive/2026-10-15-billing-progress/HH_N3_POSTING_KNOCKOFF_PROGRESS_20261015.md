# HotelHub — N3 posting and knock-off continuation

Date: 15/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: **Yes** — add as a recovery reference. Retain the prior
staff and transport checkpoints. This file records source progress, not a release.

## Priority and live result

Owner restated that posting to N3 and correct knock-off are the priority. Preserve
that order: confirm full folio → N3 bill and GL proof → apply only this booking's
receipts → receive/verify actual balance payment → prove exact matching. Safe room
release follows verified settlement. Access cards and BEC remain later.

The screenshot was read successfully. It shows the unchanged live Prepare Checkout
preview for BK260920001, not the unpublished billing branch. Main and Lovable source
remain e8341907a470d0d1e3a39a22413249becf73cd57. Lovable reports ready/agent finished.
No new posting/payment/knock-off enhancement is live in this continuation.

## Source implemented

Preserved branch review/hh-reconstruction-20261011; starting HEAD22d8074. New source
adds full-folio confirmation orchestration, fixed HTTP controller and server service
bindings for separate source/guest bill legs. Review reads never freeze/post.
Confirmation compares folio revision and full plan digest before freeze; the digest
also binds payer, date, amounts and mappings. Frozen plans and attempts are not
reposted by retrying confirmation. New legs pass through existing durable claims;
individual operations retain their exact leg/intent/revision. Session expiry stops
sibling dispatch. Partial success and uncertainty remain recoverable independently.

Public DTOs explicitly project allowed fields and deny foreign scopes, malformed
money, mismatched intents and single-leg checkout. Private plans, credentials and
proofs never enter responses. Front Desk uses its own server-resolved N3 session.

These source controllers/services are **not mounted in production**. No new live
routes/buttons are claimed. Production current-master/payer plan adapters, per-leg
client mounting, matching persistence and whole-stay close are still incomplete.
Closed bill/source/split/allocation contracts stay closed. Task3 and the whole
billing plan are not marked complete.

## One previously deferred question is now resolved

Fresh public N3 sales-v1.json downloaded15/10 has SHA256
`d9375f8fac7af01fe5f6fc8828ab948f433151bf1d48a610df10c00077404143`.
Its CustomerStatus explicitly defines ACTIVE0, INACTIVE1, PROSPECT2, SUSPENDED3.
Official N3 customer import guidance independently confirms those values:
https://support.qne.com.my/support/solutions/articles/81000416325-how-to-import-master-data-for-customers-and-suppliers-into-n3-ai-accounting-using-excel-csv-

Added a strict eligibility verifier: only numeric0 is active;1/2/3 deny eligibility;
unknown/string/missing values remain unavailable. This resolves status semantics,
not the complete runtime snapshot adapter or financial acceptance.

The freshly fetched public knock-off DTO/endpoint still exposes no version/ETag
or concurrency parameter. Documentation alone does not prove atomic behavior;
automatic matching remains gated. The approved explicit accountant match and
independent HH check remain available as the designed interim path once mounted.

## Current backend and verification

Read-only catalog inspection through the exact existing Lovable project on15/10
returned zero installed public hotelhub_settlement_* or hh_source_billing_* functions.
Source migrations were not installed. No separate Supabase account was used/requested.

Before independent review:3131tests passed,22skipped; typecheck, changed-file ESLint,
production build and whitespace checks passed. The existing payment navigation test
failed once in the initial full baseline, then passed independently. Investigation
found that it could click a still-disabled button before query notifications
finished; it now waits for readiness and proves the deferred POST exists before
asserting a pending close guard. No production payment behavior changed.

Full-repository lint was not rerun. Previously recorded legacy formatting debt is
unresolved; full lint is not passing. No native concurrency/live financial/signed-in
acceptance result is inferred from fixture tests.

One independent reviewer found0Critical/1Important/1Minor. The Important finding
was stale saved-plan confirmation: a changed digest/revision on another device
could be acknowledged as the old confirmation. Both cases were reproduced RED
and now deny before returning saved status. Matching replays remain read-only.
Final focused19passed; fullsuite**3133passed/22skipped/0failed**; tsc/scopedlint/
build/whitespace all pass. No second review was claimed.

Deferred minor: malformed/null Origin is denied with503 rather than403. No service
operation runs and no authorization bypass was found.

Ruling: keep unbuilt/live adapter, database, runtime, own-role and financial
acceptance outside the source claim. Cost if wrong: tested modules might be
mistaken for working N3 posting. Those gates remain closed. This is not a clean
main-based release candidate or a completed whole billing workflow.

Reviewed product commit: `4fa8cc5d8141484c11dca962d6f02341b921d936`.
Product tree: `004218b217807f483bb0486aeba6d817fe70e11b`.
A following documentation-only checkpoint records these identities; resolve HEAD
before resuming. Tracked tree is clean after checkpoint; pre-existing untracked
adoption and CLI temporary paths were preserved. No remote branch was created.

## Remaining evidence and next work

Do not repeat the successful38master captures or completed receipt/journal jobs.
The still-missing supplemental Owner capture is only these four referenced masters:

| Capture field | ID |
| --- | --- |
| Currency IDs | 88669 |
| Posting account IDs — customer control | d58cbfd6-bccb-4b8b-b0c6-1c795d5a5aa7 |
| Posting account IDs — income | ca0e043d-ecdb-4393-8980-18d152095b14 |
| Posting account IDs — tax | 7294e0c8-414f-4205-927e-7393e603a4c6 |

Use existing Owner Settings → N3 Financial Verification → Current billing master
evidence. Enter the three account IDs comma-separated; capture/download one JSON.
A progress Markdown is a recovery record, not that current N3 response packet.

Next engineering work: finish accepted current-master/snapshot and payer adapters,
mount confirmation/per-leg actions; finish exact bill/single/split receipt/knock-off
contracts and matching persistence. Then prepare one exact main-based code/backend/
runtime/Owner-operated financial acceptance packet. Inspect actual migration history
before any installation; never apply a dependency chain from guessed filenames.
No new financial proof transaction or production activation is authorized by this
source checkpoint. No public upload, PR/main merge, migration, runtime setting,
Lovable AI Build, tenant N3 call, financial write, deployment or publish occurred.
