# HotelHub read-only journal console release — 08/10/2026

Upload to Project Sources: **No** — repository release evidence.

## Approved boundary and target

Owner approved the next release on 08/10/2026 at20:02 Malaysia, following the
prepared read-only journal checkpoint. Existing conditional publish approval
also persists. This package releases only the console and its corrections;
whole billing remains NOT release-ready.

Product/repository: HH1.0 HotelHub / mugs-AI/hotel-hub.
Lovable project: d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76.
Workspace: JRQygHE7tZl2GgPN8a8N.
Hosting: hotelrooms.lovable.app, existing public audience preserved.
Backend: existing Lovable Cloud, configured fkakhdzelilnejyehwfk;
operational shared data, no separate staging backend established.
Runtime: existing TanStack Start/Nitro/Cloudflare server routes.
No dependency, environment variable, secret, schema, SQL, Edge Function,
session authority, tenant/RBAC, integration or protected-file change.

Starting main/Lovable:734ac405c82e653a7098ce0ef22d51586382bd9d,
tree77e39c50af8b9a17b93c36e1ec64c2fca08d4de4; ready/agentFinished.
Source billing candidate: localf32c5e0f90f5192cdf51fdd73c9b37ca4c34bc94,
remote9ff614502106fb778a1c8363e8a98d714055aec5,
tree9b164b69d613259033142f77632844542dd3b88c.
Release branch: review/hh-n3-journal-release-20261008, forked from exact main.

## Reused files and checks

All eleven shipping/test files were copied byte-for-byte from the reviewed
billing tree, not reimplemented. Existing billing worktrees remain preserved.
Five runtime files: n3-financial.server, n3-financial-journals.server,
n3-lossless-json.server, API financial-verification, and Owner settings console.
Six tests: financial-console-live-shape, financial-console-render,
financial-journal-capture, financial-journal-verification,
financial-journal-render, and run-5d0-financial-verification.

The release includes prior paymentAmount/customer/GL-classification console
corrections as well as optional GET-only journal capture. Capture defaults off;
accepted discovered UUIDs only; fixed three GLPosting routes; cap12; concurrency3;
phase40s; read10s; body1MB; no retries or redirects. All observed page/detail/
journal401 failures discard the bundle and invalidate the session. Int64 parsing
is lossless. Journal unknown/free text, names, credentials and tenant identity
are redacted. Partial captures never claim posting correctness.

The historical GL Special Type display-cell polish remains deferred.
Previously prepared billing SQL/writers/coordinator/new checkout routes,
settlement/proof gates, frozen print and monthly adapters are excluded.

Fresh base suite:1937passed20skipped0failed.
Fresh candidate suite:2004passed20skipped0failed;126filespass3existingskip.
TypeScript, production build and changed-eleven-file lint exit0.
Protected/schema/integration/CI/dependency diff:none; exact file matches11/11.
No main CI workflow exists at the inspected base. No migration or function
deployment is triggered by the new files. The new server diagnostic is deployed
through the existing application runtime.

## Rulings and remaining acceptance

Ruling: use a separate main-based release worktree — changing the unfinished
billing checkout would risk mixing unaccepted financial paths — cost if wrong:
one extra isolated candidate/checkpoint, with all original work preserved.
Ruling: reuse the exact reviewed implementation and its prior regression tests —
release isolation changes the base, not product behavior — cost if wrong:
integration defects must be caught by this base's fresh full checks and the
release-boundary review; no earlier billing task is repeated.
Ruling: existing approval selects merge/sync/publish for this bounded console —
the Owner approved the concrete proposed next step — cost if wrong: the public
console receives diagnostic changes, but no financial gate or schema opens.

Actual tenant journals, browser/mobile signed-in operation, journal balancing,
refund/spendable semantics, before/after preservation, vendor atomic allocation
concurrency and whole-billing acceptance remain unverified. The Owner uses the
existing test company, not recreated transactions. Live use creates normal
HotelHub audit/settings records; GET-only refers to N3 operations.

Independent release-boundary review and merge/sync/publish receipts are pending
at this candidate document's creation. No Lovable AI Build, operational DB call,
migration or N3 call/write has occurred while preparing it. New tests mock
session/settings/audit/network. Deployment and authenticated UAT must be
reported separately; do not infer live acceptance from a successful local build.

## Owner GET evidence steps after verified release

1. Open HotelHub through N3 Marketplace → My Apps under existing company
   9AC-0D9-2F1 — MUGS AI LAB TEST SDN. BHD., using the Owner account.
2. Open Settings → N3 Financial Verification.
3. Set Date From26/09/2026 and Date To27/09/2026; leave other filters empty.
4. Tick Include GL journals, then choose Get Result once.
5. Under GL journal capture, note Responses captured/Partial capture/Unavailable;
   choose Show sanitized journal evidence to expand the response samples.
6. Choose Download JSON and attach that sanitized export for evidence review.

If the session expires, reopen through N3 My Apps. Do not recreate receipt,
cash-sale or refund documents, approve unrelated corrections, or enable writes.
A captured/partial journal response does not authorize billing activation.

## Release review receipt

Fresh independent release-boundary reviewer examined base734ac405..c3f4e98:
0Critical,0Important,1Minor (the documentation button label). Verdict approves
this bounded merge/public diagnostic release subject to fresh base/sync/publish
receipts. The handover label was corrected above as documentation only; all11
reviewed runtime/test files remain byte-identical, with no new implementation.
Full repository lint:170unchanged baseline errors37warnings; changed-file lint
is clean. Those errors remain in the two unchanged receipt SQL check scripts.

Ruling: correct the Owner guide's button/expand labels during handover — the
Owner must be able to find the existing controls — cost if wrong: documentation
changes only, with no new UI or financial behavior. This is not a second code
fix pass or repeat review. No remaining minor release finding.

Rulings on every declined-to-judge item: executor owns fresh tests/types/build/
lint evidence; fresh remote/main/Lovable and deployment receipts are required
before release claims; signed-in mobile/runtime/environment/actual journal
shapes require Owner UAT; journal balance/refund/preservation/concurrency remain
unaccepted financial contracts; prior algorithm reviews retain their documented
fix/test evidence, with this review accepting integration only; whole billing
remains NOT release-ready/default-off. Cost if wrongly treating any of these as
verified: false runtime, accounting or release acceptance. None opens a gate.
