# HOTELHUB_COMPLETION_PLAN

## HotelHub HH1.0 Controlled Production Plan

**Pack version:** 17/09/2026  
**Repository:** `mugs-AI/hotel-hub`  
**Last verified main/deployed SHA:** `75ceac11089936778b672c438d3a103b4715609a`  
**Status:** Active plan. HH-GOLIVE-01C schema/type parity accepted; incomplete financial verticals remain controlled.

**27/09/2026 local source checkpoint:** Local commit `b32a519` contains the rebuilt N3 bank/cash account selector, Owner display labels, immutable payment-line snapshots, matching migration `20260927120000_hh_payment_accounts_and_lines.sql`, and a separate split-posting gate. Local build and TypeScript passed; 116 focused financial tests passed and changed-file lint has no errors. GitHub `main` now points to `495b90d900a44bc9b5297d24ca07529b45aff23e` (three equivalent fast-forward commits created through the GitHub integration). Its final tree `719e5932b501bda74d88a6937806e3726b27922d` exactly matches the tested local `b32a519` tree. The commit IDs differ because the connected integration created new GitHub commits. No migration, deployment or HotelHub N3 Create occurred. N3 Cloud UI evidence for split receipt and balanced journals remains distinct from HotelHub API proof. Keep split posting disabled pending tenant Create/read-back and GL verification. The 23/09 repository/deployment pointers below remain historical audit snapshots.

## 1. Objective

Complete and release a safe, simple, multi-tenant boutique-hotel PMS integrated with N3 AI Cloud Accounting. HotelHub must remain suitable for small hotels and front-desk staff while protecting tenant, guest and financial truth.

## 2. Permanent completion principles

1. N3 is the identity and accounting source of truth.
2. Tenant, actor, role and authoritative N3 mappings are resolved on the server.
3. Browser input is never accounting or tenant authority.
4. One approved full vertical is changed at a time.
5. Accepted, candidate, GitHub `main`, Lovable source and deployed SHA are separate facts until proven identical.
6. A passing build is not live acceptance.
7. Unknown N3 write outcomes are reconciled with GET/read operations; they are never blindly retried.
8. Prepare Checkout remains read-only until charge, allocation, payment, refund and recovery contracts are proven.
9. External N3 verification must not block ordinary UI or printing unless the user explicitly requests that verification.
10. DD/MM/YYYY is the user-facing Malaysian date standard; storage/API values may remain ISO.
11. UX follows `Recognize → Act → Confirm`: concise cards, one obvious action, progressive disclosure and actionable errors.
12. Desktop, tablet and iPhone/mobile behavior are acceptance requirements, not optional polish.

## 3. Current capability classification

| Area | Current classification |
|---|---|
| N3 launch, session and tenant foundation | Implemented; accepted foundation |
| HotelHub allowlist and roles | Implemented foundation; current-role/ownership regression must remain tested |
| Rooms, rates, reservations, guests and assignments | Implemented; consolidate current-SHA audit |
| Check-in and approved stay changes | Implemented; current-SHA regression required |
| Housekeeping/room turnaround | Implemented; current full role/tenant matrix must be reconciled |
| Tax configuration and N3 rate normalization | Implemented and live corrected |
| Folio calculation and guest presentation | Implemented and live corrected |
| Folio colour identities and Tax % | Implemented and live |
| Folio Print Fast-Path | **Accepted** at `3e557fda…`; UAT 11 seconds |
| Posting-mappings schema/migration/generated types | **Accepted** at `75ceac11089936778b672c438d3a103b4715609a`; migration `20260916120000` applied |
| Deposit AR Receive Payment | Implemented and gated; live evidence remains scope-specific |
| Prepare Checkout | Read-only only |
| CashMemo/Post-to-AR settlement | Required; not accepted as a complete write vertical |
| Deposit allocation/knock-off | Required; write contract/evidence incomplete |
| Balance receipt and matching | Required; not accepted |
| Customer refund write | Required; contract/evidence incomplete |
| Final checkout and room release | Required; cannot precede financial truth |
| Maintenance/out-of-service | Partial or future controlled vertical |
| Reports, monitoring, backup and support | Partial / acceptance required |
| Room-door card writer | Discovery only |
| BEC licensing/trial bridge | Future controlled integration; no implementation authority in this pack |

## 4. Preserved accepted folio behavior

- Room charges and active extras appear before enabled taxes and levies.
- Discount is the final detail row.
- Both sides of a reversed pair are hidden from the guest folio and printout.
- Reversal records remain in the hidden audit timeline.
- A reversed pair contributes net zero without cancelling a separate valid charge.
- Every extra catalogue item has a stable professional pastel identity; the posted row uses the same identity.
- `Tax %` appears after Description in screen and print.
- Basis points are displayed correctly: `1,000bp = 10%`, `800bp = 8%`.
- Fixed charges, discounts and non-percentage items show `—`, not a fabricated tax rate.
- Only enabled charges/taxes appear.
- Print opens in a new tab and the normal path does not wait for N3 deposit verification.
- Optional `Load verified deposit balance` is explicitly user-triggered and read-only.

## 5. Remaining controlled work sequence

### Milestone A — Consolidated current-production audit

Read-only audit of exact `main`/production SHA and all major product requirements. Reconcile current code, migrations, mounted routes, database state, role boundaries and live evidence. Produce one defect/status ledger and propose exactly one next milestone.

**Exit:** every major feature is classified `Verified / Implemented / Partial / Unknown / Deferred`, with no stale August checkpoint controlling the result.

**Checkpoint:** completed sufficiently to select and close HH-GOLIVE-01C. This does not convert untested whole-application areas into accepted features.

### Milestone B — Operations closure

Close any current P0/P1 in reservations, assignments, check-in, room changes, housekeeping, maintenance or role/tenant behavior before expanding finance.

Required scenarios include:

- Owner, Front Desk and Housekeeper permission matrix;
- current Owner, former Owner and inactive/deleted N3 user behavior;
- same-tenant and cross-tenant negative access;
- room readiness and physical occupancy truth;
- room-change/checkout-to-Dirty handoff;
- mobile layout and outside-tap dismissal of information popovers;
- DD/MM/YYYY across input, display and print.

### Milestone C — Authoritative folio and checkout readiness

Prove the immutable server-side charge basis for:

- room-night/rate segments;
- extensions, early check-in and late checkout;
- extras;
- discounts and adjustments;
- enabled taxes, Tourism Tax, service charge and local levy;
- cancellation/no-show fees after owner decision;
- currency and rounding;
- line-to-N3 stock/UOM/tax mappings;
- edit/freeze authority and audit.

The guest folio must remain a statement, not proof of N3 settlement.

### Milestone D — N3 checkout contract proof

Use official documentation or sanitized live read evidence to prove:

- exact Cash Sales/CashMemo create/new/detail contract;
- Post-to-AR/open-debtor proof;
- immutable identity and exact-reference lookup;
- allocation/knock-off and deallocation/reversal behavior;
- partial and multiple receipt behavior;
- balance receipt and matching;
- outstanding and rounding truth;
- Customer Refund create/link/reconcile behavior;
- permission, timeout and unknown-result semantics.

No speculative POST is allowed during contract discovery.

The next proposed bounded scope is `HH-GOLIVE-01D`, limited to this read-only contract proof. It requires separate Product Owner authorization.

### Milestone E — Checkout charge write vertical

Create one stable local checkout-charge intent, claim it before the N3 side effect, create/reconcile exactly one N3 charge, verify identity/customer/currency/lines/tax/amount and preserve `unknown` outcomes for GET-only recovery.

**Exit:** retry, double-click, race, timeout and local-update-failure cases cannot create duplicate money documents.

### Milestone F — Deposit allocation and balance settlement

Apply only eligible HotelHub-owned deposits, collect one stable balance receipt if needed, allocate it, and verify N3 outstanding.

**Exit:** deposit-only, exact, deposit-plus-balance, multiple-deposit, partial, excess, retry and contradiction cases are proven.

### Milestone G — Atomic final checkout

Only after N3 settlement truth is proven:

- commit reservation `checked_out`;
- release room allocation;
- send room to `Dirty`;
- preserve settlement snapshot and audit;
- produce approved receipt/folio output;
- prevent a generic bypass.

**Exit:** financial truth, reservation status, availability and housekeeping cannot silently diverge.

### Milestone H — Refunds and exceptions

Implement approved cancellation/no-show/refund rules with stable intents, approval, reconciliation, duplicate-refund protection and exception handling.

### Milestone I — Maintenance, reports and production operations

Complete maintenance/out-of-service, dashboards, reports/exports, monitoring, error diagnostics, backup/recovery, data-retention controls, support runbooks and a full multi-role/multi-tenant regression.

### Milestone J — Door-card discovery/pilot

Run separately. Do not build until vendor, exact lock/writer model, card technology, SDK/protocol, host OS, licensing, key custody, offline behavior and physical test kit are proven.

## 6. Definition of Done

A feature is complete only when every required layer passes:

`decision → schema/migration → generated types → server/domain → API → mounted UI → navigation → permissions → tenant isolation → error states → tests → build → exact-SHA deployment → live acceptance`

Additional requirements:

- loading, empty, error, locked and stale-data states are usable;
- errors identify the failed action and next step;
- test skips are listed separately from passes;
- no protected auth, dependency, migration or generated-type drift enters incidentally;
- no P0/P1 remains;
- Project Sources are refreshed after acceptance, not before proof.

## 7. Current single next action

Next: use the published `495b90d` tree for release preparation; complete authorized selected single and split receipt Create/read-back and balanced journal proof in the owner-designated N3 sandbox. Keep split posting disabled until that proof, then release matching code and migration together through the separate release process. Prior Cloud UI matching and refund tests need no repetition.
