# HH1.0 SOURCE REFRESH SUMMARY

**Pack version:** 17/09/2026, Asia/Kuala_Lumpur  
**Evidence cut-off:** 17/09/2026  
**Repository / branch:** `mugs-AI/hotel-hub` / `main`  
**Last verified GitHub and deployed SHA:** `75ceac11089936778b672c438d3a103b4715609a`  
**Lovable project ID:** `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`  
**Production:** `https://hotelrooms.lovable.app`  
**Last verified deployment ID:** `dd4d2ce8-9bca-475a-95d1-181fe9140a2e`  
**Applied migration:** `20260916120000_hh_golive_01c_posting_mappings_parity`

**27/09/2026 local source checkpoint:** Local commit `b32a519` contains the rebuilt N3 bank/cash account selector, Owner display labels, immutable payment-line snapshots, matching migration `20260927120000_hh_payment_accounts_and_lines.sql`, and a separate split-posting gate. Local build and TypeScript passed; 116 focused financial tests passed and changed-file lint has no errors. GitHub `main` now points to `495b90d900a44bc9b5297d24ca07529b45aff23e` (three equivalent fast-forward commits created through the GitHub integration). Its final tree `719e5932b501bda74d88a6937806e3726b27922d` exactly matches the tested local `b32a519` tree. The commit IDs differ because the connected integration created new GitHub commits. No migration, deployment or HotelHub N3 Create occurred. N3 Cloud UI evidence for split receipt and balanced journals remains distinct from HotelHub API proof. Keep split posting disabled pending tenant Create/read-back and GL verification. The 23/09 repository/deployment pointers below remain historical audit snapshots.

## Purpose

This is the complete numbered HotelHub HH1.0 Project Source pack. It replaces the old unnumbered/stale copies. Keep only one active copy of each file.

The refresh combines:

- current HotelHub product decisions and production evidence;
- accepted tax, folio, presentation and print-performance corrections;
- remaining controlled completion work;
- reusable safety lessons from SH2.2, PMS/ProjectHub, BEC and Van Sales;
- known bug patterns that future builds must actively prevent.

Cross-project experience is guidance only. ServiceHub, ProjectHub, BEC and Van Sales business rules do not become HotelHub requirements unless explicitly approved here.

## Latest accepted bounded result

`HH-GOLIVE-01C POSTING-MAPPINGS SCHEMA AND TYPE PARITY` is **ACCEPTED** for its exact scope at `75ceac11089936778b672c438d3a103b4715609a`.

- One canonical idempotent migration now records the live nullable `jsonb` `posting_mappings` column.
- Generated database types, server access, repository migration and live schema are in parity.
- Existing settings data and posting-mapping values were unchanged.
- Full regression passed 1,419 tests with 20 skips and 0 failures; TypeScript/build passed; lint had 0 errors and 28 pre-existing warnings.
- Production HTTP 200 carried deployment `dd4d2ce8-9bca-475a-95d1-181fe9140a2e`; anonymous session remained deny-by-default and the protected financial-settings API returned HTTP 401.
- Earlier accepted Print Folio, tax, reversal, ordering and presentation behavior remains preserved.
- No N3 write, BEC work or checkout-posting behavior was introduced.

Acceptance of this bounded result does not mean the entire application or final N3 checkout settlement is accepted.

## Replacement rule

Delete the old HotelHub Project Sources before uploading this pack. Upload the extracted `.md` files, not the ZIP. Do not keep numbered and unnumbered duplicates.

## Active files

1. `01-SOURCE_REFRESH_SUMMARY.md`
2. `02-HOTELHUB_COMPLETION_PLAN.md`
3. `03-HOTELHUB_N3_FINANCIAL_POSTING_KNOCKOFF_MASTER_RECORD.md`
4. `04-HOTELHUB_BASE_INDEX.md`
5. `05-VERIFIED_BASELINE_CURRENT.md`
6. `06-HH1.0_PROJECT_SOURCE_REFRESH_REPORT.md`
7. `07-HOTELHUB_INTEGRATION_REGISTRY.md`
8. `08-HOTELHUB_PRODUCT_DECISIONS.md`
9. `09-PROJECT_START_HERE.md`
10. `10-LOVABLE_GOVERNANCE.md`
11. `11-CROSS_PROJECT_LESSONS_AND_BUG_PREVENTION.md`

## Current next action

Next: use the published `495b90d` tree for release preparation; complete authorized selected single and split receipt Create/read-back and balanced journal proof in the owner-designated N3 sandbox. Keep split posting disabled until that proof, then release matching code and migration together through the separate release process. Prior Cloud UI matching and refund tests need no repetition.
