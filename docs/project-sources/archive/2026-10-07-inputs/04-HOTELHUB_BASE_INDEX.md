# HOTELHUB_BASE_INDEX

## HH1.0 Active Source Map

**Pack version:** 23/09/2026, Asia/Kuala_Lumpur  
**Repository / branch:** `mugs-AI/hotel-hub` / `main`  
**Verified GitHub main SHA:** `4d46404e949499840f481a9379a673ec1e03661d`  
**Production:** `https://hotelrooms.lovable.app`  
**Observed deployment ID:** `c8714cc4-d944-47c5-b98c-ae4a91993687`  
**Exact production server SHA:** unknown  
**Status:** HH-GOLIVE-01G audit completed; full go-live remains blocked and HH-GOLIVE-01H awaits approval.

**27/09/2026 local source checkpoint:** Local commit `b32a519` contains the rebuilt N3 bank/cash account selector, Owner display labels, immutable payment-line snapshots, matching migration `20260927120000_hh_payment_accounts_and_lines.sql`, and a separate split-posting gate. Local build and TypeScript passed; 116 focused financial tests passed and changed-file lint has no errors. GitHub `main` now points to `495b90d900a44bc9b5297d24ca07529b45aff23e` (three equivalent fast-forward commits created through the GitHub integration). Its final tree `719e5932b501bda74d88a6937806e3726b27922d` exactly matches the tested local `b32a519` tree. The commit IDs differ because the connected integration created new GitHub commits. No migration, deployment or HotelHub N3 Create occurred. N3 Cloud UI evidence for split receipt and balanced journals remains distinct from HotelHub API proof. Keep split posting disabled pending tenant Create/read-back and GL verification. The 23/09 repository/deployment pointers below remain historical audit snapshots.

## 1. Purpose

This file tells every HH1.0 conversation which source controls each decision. The numeric filename prefix controls upload/display order. The contents, current evidence and authority rules control meaning.

It prevents:

- stale unnumbered files from competing with refreshed sources;
- other-project rules from leaking into HotelHub;
- a candidate, GitHub `main`, Lovable source and production deployment from being confused;
- a screenshot or Lovable completion claim from being treated as proof;
- planned finance, BEC, promotion or hardware behavior from being described as implemented;
- the wrong Lovable project/repository from receiving a HotelHub write.

## 2. Active source pack

| File | Primary purpose |
|---|---|
| `01-SOURCE_REFRESH_SUMMARY.md` | Pack identity, latest accepted bounded result and replacement rule |
| `02-HOTELHUB_COMPLETION_PLAN.md` | Remaining milestones, dependencies and Definition of Done |
| `03-HOTELHUB_N3_FINANCIAL_POSTING_KNOCKOFF_MASTER_RECORD.md` | Financial truth, write safeguards and unknown contracts |
| `04-HOTELHUB_BASE_INDEX.md` | Authority, reading order and current control pointers |
| `05-VERIFIED_BASELINE_CURRENT.md` | Exact current evidence and defect ledger |
| `06-HH1.0_PROJECT_SOURCE_REFRESH_REPORT.md` | What was reconciled and why |
| `07-HOTELHUB_INTEGRATION_REGISTRY.md` | N3, database, BEC, printing and hardware boundaries |
| `08-HOTELHUB_PRODUCT_DECISIONS.md` | Approved business and UX decisions |
| `09-PROJECT_START_HERE.md` | Compact controller handover and current next action |
| `10-LOVABLE_GOVERNANCE.md` | Build, audit, merge, publish and release controls |
| `11-CROSS_PROJECT_LESSONS_AND_BUG_PREVENTION.md` | Reusable lessons and known bug-prevention checklist |

## 3. Mandatory reading order

### New HotelHub chat or general continuation

Read `09`, `04`, `05`, `08`, `02`, `10`, then the relevant specialist file.

### N3 financial work

Read `09`, `04`, `05`, `08`, `03`, `07`, `10`, `11`, then inspect current GitHub and official/sanitized N3 contract evidence.

### Authentication, ownership or role work

Read `09`, `04`, `05`, `08`, `07`, `10`, `11`. Preserve the server-side N3 identity/session architecture and fail-closed role resolution.

### Release or Lovable work

Read `09`, `05`, `04`, `10`, `11`, then independently verify exact project ID, repository, branch, main SHA, Lovable source and deployment identity.

### BEC work

Read `09`, `04`, `05`, `08`, `07`, `10`. HotelHub–BEC remains frozen. Do not create a BEC connector, credential, table, migration, licensing enforcement or trial control without a separately approved integration contract and build.

### Room-door card work

Read `09`, `04`, `05`, `08`, `07`, `10`, `11`. Stop at discovery until exact vendor, lock/writer models, card technology, SDK/protocol, OS, licensing and physical test-kit proof exist.

## 4. Authority model

### Business intent

1. Latest explicit Product Owner decision/correction.
2. Current numbered HotelHub Product Sources.
3. Official N3 constraints and approved integration contracts.
4. Historical chats, old prompts and screenshots.

### Implementation proof

1. Reproducible live evidence tied to exact source, deployment, tenant, role and fixture.
2. Current GitHub code, migrations, generated types, tests and configuration.
3. Official N3 documentation or sanitized live contract evidence.
4. Current evidence ledger.
5. Lovable reports/screenshots as supporting, not sole, evidence.

If product intent and implementation differ, report a gap/defect. Do not silently rewrite either side.

## 5. Current control pointers

| Pointer | Current verified value |
|---|---|
| GitHub repository | `mugs-AI/hotel-hub` |
| Canonical branch | `main` |
| GitHub `main` SHA | `4d46404e949499840f481a9379a673ec1e03661d` |
| Lovable project ID | `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76` |
| Observed production deployment ID | `c8714cc4-d944-47c5-b98c-ae4a91993687` |
| Exact production server SHA | Unknown; not exposed by deployment |
| Production URL | `https://hotelrooms.lovable.app` |
| Latest checkpoint | HH-GOLIVE-01G current-main/live-parity audit completed |
| Client live parity | Partial pass: identifiable 01E/01F client markers deployed |
| Full server parity | Not proven |
| Full go-live | Blocked |
| BEC | Frozen; no HotelHub implementation present |
| Door-card writer | Discovery only |

These are evidence pointers, not permission to assume the repository or deployment cannot move. Re-check before every write or release.

## 6. Current blocker pointers

- exact Lovable deployed server tree is not linked to GitHub `4d46404…`;
- current authenticated role/tenant matrix is not fully evidenced;
- successful post-correction live Early Check-in and StockMaster-detail room import remain unproven;
- approved-tenant deposit evidence is incomplete;
- CashMemo/allocation/balance/refund/final-checkout vertical is incomplete;
- maintenance/out-of-service is incomplete;
- current-SHA test/build/deployment evidence is not sealed;
- promotion/rate-plan contract is not yet approved;
- monitoring, backup/recovery, reports and support acceptance are incomplete.

The detailed IDs and severity live in `05-VERIFIED_BASELINE_CURRENT.md`.

## 7. Document maintenance

- Keep the numeric prefixes and filenames stable.
- Keep exactly one active copy of every source.
- Update `05` first after an audited checkpoint.
- Then update `09`, `04`, `01` and affected specialist files when the approved refresh scope includes them.
- Update `08` only after a real Product Owner decision.
- Update `10` only when the working/release method changes.
- Historical evidence may be archived, but must not remain as a competing active source.
- Do not add a second completion plan or financial master.

## 8. Current single next action

Next: use the published `495b90d` tree for release preparation; complete authorized selected single and split receipt Create/read-back and balanced journal proof in the owner-designated N3 sandbox. Keep split posting disabled until that proof, then release matching code and migration together through the separate release process. Prior Cloud UI matching and refund tests need no repetition.
