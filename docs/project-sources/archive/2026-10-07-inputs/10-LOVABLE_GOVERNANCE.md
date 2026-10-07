# LOVABLE_GOVERNANCE

## HotelHub HH1.0 Build, Audit and Release Control

**Pack version:** 17/09/2026  
**Status:** Active working method

## 1. Authority

Lovable is an implementation/deployment tool. It is not the acceptance authority.

A Lovable statement, screenshot, commit title, “website is up to date,” security badge or test count remains a claim until the controller verifies exact repository/deployment state and required live behavior.

## 2. Permanent targeting safety lock

This lock applies before every HotelHub Lovable write, correction, migration or publication.

| Identifier | Required value |
|---|---|
| ChatGPT Project | `HH1.0` |
| Lovable Project | `Hotel Hub` |
| Lovable Project ID | `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76` |
| GitHub repository | `mugs-AI/hotel-hub` |
| Canonical branch | `main` unless a separately named candidate branch is approved |

Before writing:

1. verify every identifier above;
2. inspect canonical `main` and recent commits;
3. verify current `main` equals the approved input SHA;
4. verify Lovable is tracking/loading the intended branch/SHA;
5. if any identifier/SHA differs, **stop without sending**.

Display name alone is not targeting evidence. Never redirect a HotelHub prompt to ServiceHub, ProjectHub, BEC, Van Sales or another similarly named project.

## 3. Before every implementation prompt

Inspect:

- current `main`, candidate branches and drift;
- latest accepted/deployed SHA;
- exact input-to-current diff;
- migrations and Cloud-applied ledger;
- generated database types;
- routes and mounted UI;
- server/API handlers and their consumers;
- role and tenant filters;
- protected authentication/dependency/environment files;
- tests, skips and package scripts;
- active Project Sources and README;
- live/deployment evidence.

If repository state differs from the approved input, stop and re-scope.

## 4. Scope authorization gate

Propose exactly one bounded action with:

- **Included:** complete vertical/change.
- **Excluded:** related work that cannot enter.
- **Frozen:** accepted foundations that must not change.
- **Acceptance:** engineering, API, permission, tenant, mobile and live checks.

Wait for Product Owner authorization before mutation.

A bare “authorise” may control only the single immediately preceding unambiguous gate. For a public GitHub push, merge to `main`, Lovable publish, database migration or N3 write, restate the exact target/scope before acting whenever platform policy or ambiguity requires it.

Never treat authorization for build as authorization to push, merge, publish, migrate or post to N3.

## 5. Prompt requirements

Every implementation prompt must contain:

- exact project/repository/branch/input SHA;
- stop-on-drift instruction;
- business goal and proven defect;
- complete bounded vertical;
- explicit exclusions/frozen paths;
- schema/migration/generated-type requirement or explicit N/A;
- server/API/UI/route/mount/navigation requirements;
- server-derived tenant/actor/mapping;
- loading/empty/error/locked/success behavior;
- DD/MM/YYYY and mobile behavior;
- tests and direct-negative checks;
- exact engineering commands;
- live acceptance matrix;
- completion-report format;
- `do not publish` unless publication is separately authorized.

Do not send competing prompt versions.

## 6. Full vertical rule

A feature is incomplete if any required layer is missing:

```text
decision
→ migration/schema
→ generated types
→ domain/server
→ API
→ browser payload
→ mounted UI/navigation
→ permissions/tenant isolation
→ user feedback/cache refresh
→ tests/build
→ exact-SHA deployment
→ live acceptance
```

Reject these patterns:

- backend complete, UI later;
- component exists but is not mounted;
- UI hides action but API allows it;
- selector changes visually but save request never occurs;
- API saves but readiness continues using stale cache;
- build passes but workflow was never used live;
- migration exists locally but is not Cloud-applied;
- Cloud migration exists but generated types are stale;
- “next turn will finish it.”

## 7. Status and defect vocabulary

Requirement status:

`Required / Implemented / Verified / Accepted / Partial / Failed / Unknown / Deferred / Obsolete`

Defects:

- **P0:** cross-tenant/security/secret leak, duplicate money, destructive integrity or production emergency.
- **P1:** essential workflow incomplete/unsafe, authorization gap, unmounted vertical, missing recovery or failed acceptance gate.
- **P2:** non-blocking UX, documentation, maintainability, traceability or performance debt.

Formal result:

`ACCEPTED / ACCEPTED WITH P2 / PARTIALLY ACCEPTED / REJECTED`

## 8. Post-build audit

1. Identify exact input and resulting SHA.
2. Inspect every changed file and confirm no hidden drift.
3. Verify migration safety, applied ledger and generated-type parity.
4. Confirm UI import, mount, navigation, API call and response/cache handling.
5. Confirm server role, tenant and immutable-ID enforcement.
6. Inspect tokens, secrets, guest PII and audit payloads.
7. Run or verify formatting, lint, TypeScript, tests, production build and `git diff --check`.
8. List skipped tests separately.
9. Perform direct API negative tests where relevant.
10. Execute affected Owner/Front Desk/Housekeeper and tenant/mobile/retry/live scenarios.
11. Classify defects and result the candidate.
12. Update evidence sources only after result.

No dependent work proceeds while a P0/P1 remains.

## 9. Engineering gate

Use the scripts supported by the actual repository. Last known interface:

```bash
bun install --frozen-lockfile
bun run lint
bunx tsc --noEmit
bun run test
bun run build
git diff --check
```

Do not claim a nonexistent package script. A new lint warning, skipped test or dependency/lockfile change must be explained.

## 10. Protected security/privacy gate

Every affected build must preserve/prove:

- N3-only identity;
- raw N3 token absent from URL after clean redirect, browser storage, HTML, logs and client payloads;
- secure HttpOnly HotelHub session;
- server-resolved active actor, current Owner and tenant;
- only approved HotelHub roles;
- non-owner allowlist/role assignment;
- no browser Supabase Auth;
- server-only service credentials;
- tenant filter plus record ID on every access;
- no guest identity number in query state/log/export/broad DTO;
- safe audit detail;
- 401/403/malformed upstream response fails closed.

## 11. Financial mutation gate

Before any new N3 POST:

- prove endpoint/method/DTO/document type;
- derive authority server-side;
- persist and claim stable local intent;
- enforce tenant-scoped uniqueness;
- classify deterministic failure versus unknown side effect;
- never blind-retry unknown;
- provide GET-only reconciliation;
- store immutable ID and display document number;
- verify amount/currency/customer/tax/allocation/outstanding;
- test duplicate click, concurrency, timeout and local-save failure;
- keep final checkout blocked until N3 truth is sufficient.

## 12. Candidate push and merge

Push only reviewed files to a named candidate branch. Before merge:

- remote candidate tree equals tested local tree;
- candidate is ahead-only from expected `main`;
- `main` has not moved;
- exact file list matches approval;
- merge is non-force fast-forward unless a separately reviewed reason exists.

After merge verify candidate and `main` are identical. Merge authorization does not authorize publication.

## 13. Lovable publication

Before publish:

- Lovable project/repository/branch/SHA match the accepted release;
- Lovable has synchronized current `main`, not a stale internal branch;
- no P0/P1;
- Product Owner explicitly authorized publication.

After publish:

- record deployment ID/environment/time;
- verify live host and bundle/source markers;
- perform cache-bypassed smoke test;
- perform N3-authenticated workflow UAT where required;
- distinguish application time from Chrome/native print preview time;
- never call a manual Publish click complete until independently verified.

Cloudflare/CAPTCHA may require the Product Owner’s normal browser. It does not change the exact-SHA control requirement.

Latest accepted release evidence: GitHub `main` and Lovable loaded SHA `75ceac11089936778b672c438d3a103b4715609a`; production deployment `dd4d2ce8-9bca-475a-95d1-181fe9140a2e`; HTTP 200 with the new deployment marker; anonymous session deny-by-default; protected financial-settings HTTP 401.

## 14. Database migration gate

- Migration requires separate explicit authorization.
- Inspect exact SQL, tenant/RLS/security impact and rollback/recovery posture.
- Never edit/delete already-applied migration history.
- Apply once to the correct HotelHub database.
- Verify Cloud ledger, schema and generated types.
- Data backfills/purges require separate evidence and authority.

## 15. Completion report

Every completed run reports:

- exact input/resulting SHA;
- changed files and reason;
- migrations/generated types;
- mounted routes/UI/API;
- role/tenant/privacy controls;
- tests/commands/skips;
- live tests performed/not performed;
- known limitations;
- explicit statement of push/merge/publish/database/N3 actions not performed.

## 16. One-action rule

End every controller result with exactly one clear next action. Do not make the Product Owner answer a long interview one question at a time; collect necessary decisions in one consolidated checklist.

## 17. Current single next action

No Lovable write is authorized by this documentation closeout. The only proposed next scope is separately authorized `HH-GOLIVE-01D — N3 Checkout Contract Proof (read-only only)`; HH-BEC remains unauthorized.
