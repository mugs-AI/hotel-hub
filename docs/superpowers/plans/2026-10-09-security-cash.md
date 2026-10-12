# Security Cash Custody Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install the approved separate refundable cash ledger, physical return controls, and accountant custody statements.

**Architecture:** Service-only PostgreSQL RPCs enforce transactional custody transitions and idempotency. Server routes derive actor and tenant from the N3 session. Separate reservation cards and printable receipts expose local custody facts without calling any N3 financial API.

**Tech Stack:** Existing TanStack Start, React, TypeScript, Supabase PostgreSQL; disposable PGlite for SQL checks.

**Spec:** docs/superpowers/specs/2026-10-09-security-deposit-design.md

## Global Constraints

- Preserve existing advance switches and all posted N3 receipts, including disputed OR2610/001.
- Malaysian cash only; default RM50 per room per stay. No security cash applied to guest AR.
- Service-only tables, server identity, safe integer cents, append-only audit, no retention purge.
- Owner controls policy, waiver, deductions, corrections and unresolved departure exceptions.
- Pending physical returns never expire or automatically complete. No automatic financial retries.
- Existing holdings remain returnable when new collection is off.
- Prepare migrations only; do not apply to operational Cloud or publish dependent UI.
- Protected files and package/lock dependencies remain unchanged.

## Review Focus

- Stale requests after tenant/user switch must fail the expected-identity precondition.
- Parallel or interrupted physical handovers must not permit a second payout.
- A room move, removed allocation or closed booking must preserve its historical holding.
- Disputed deductions remain physically held until a separately acknowledged movement.
- Printing/as-at queries must not change money or fabricate historical balances.

### Task 1: Transactional custody engine

**Files:** Create CLI-generated `supabase/migrations/*_hh_security_cash.sql`, `db/checks/hh-security-cash.mjs`.

**Interfaces:** Produces service-only RPCs `hh_security_read(p_tenant uuid,p_reservation uuid)` -> policy/holdings; `hh_security_command(p_tenant uuid,p_reservation uuid,p_actor text,p_role text,p_key uuid,p_body jsonb)` -> holding/result; `hh_security_report(p_tenant uuid,p_from timestamptz,p_as_at timestamptz)` -> immutable event-derived report; `hh_security_statement(...)` -> signed snapshot.

- [ ] Write SQL behavior checks with literal cash assertions: collect5000, approve2000 deduction leaves held5000/returnable3000, reserve/confirm3000 leaves held2000, transfer2000 leaves held0. Assert duplicate same-body collection same receipt; altered-body key conflicts; second return blocked; stale version blocked; alien tenant/housekeeper denied; module off preserves return; Owner-only reasoned waiver/correction; room move preserves receipt; month carry-forward; two/single-person statements and immutable events.
- [ ] Run `node db/checks/hh-security-cash.mjs`. Expected: missing custody RPC before implementation.
- [ ] Implement atomically numbered SDYYMM00001 holdings, events, return operations, exceptions, custody policies and shift statements. Policy defaults required=true when module enabled, amount5000; record terms snapshot. SQL guards check-in required collection/waiver and checkout unresolved security cases without replacing guest-bill gates. Room movement adds audit without collection. Events derive balances; stored totals are checked projections, not editable inputs.
- [ ] Run `node db/checks/hh-security-cash.mjs`. Expected: PASS behavioral checks and grants/RLS. Record native multi-session scheduling limitation.
- [ ] Commit exact SQL/check files.

### Task 2: Session-scoped local API and printable readers

**Files:** Create `src/lib/security-cash.ts`, `src/lib/security-cash.server.ts`, `src/routes/api/hotel/security-cash.ts`, `src/routes/api/hotel/reservations.$id.security-cash.ts`, `src/lib/__tests__/security-cash-api.test.ts`, `src/lib/__tests__/security-cash.test.ts`. Modify operation error mapping and sensitive query purge only.

**Interfaces:** Consumes Task1 RPCs. Produces `readSecurityCash(actor,reservationId)`, `writeSecurityCash(actor,reservationId,key,body)`, `readSecurityReport(actor,from,asAt)`, `writeSecurityStatement(actor,key,body)`. Actor contains trusted tenantId/userKey/role. Browser commands have no tenant/actor fields; exact whitelists and UUID/version/amount validation.

- [ ] Write failing API tests: role/tenant scope, cross-site write denial, changed identity denial, strict command validation, missing schema unavailable, sanitized DB error, no N3 dependency. Write pure command tests for unsafe cents and return amount/method injection denial.
- [ ] Run `npm test -- security-cash`. Expected: missing exports, then behavior failures before implementation.
- [ ] Implement GET/POST endpoints, Owner report/policy/exception controls and staff custody actions. Return reservation holding snapshots with no unnecessary identity data. Housekeeping inspection endpoint uses its permitted role but cannot read/change cash. Failure codes guide counting/reconciliation instead of retries.
- [ ] Run `npm test -- security-cash`. Expected: PASS. Commit task files.

### Task 3: Reservation workflow, receipt and custody statements

**Files:** Create `src/components/SecurityCashCard.tsx`, `src/components/SecurityCashSettings.tsx`, `src/components/SecurityCashReport.tsx`, `src/lib/__tests__/security-cash-render.test.ts`; modify reservation/checkout mounting, Deposits settings and query purge.

**Interfaces:** Consumes Task2 endpoints. Identity-scoped queries/drafts and expected-identity writes. Receipt view uses holding terms/number/payer/time plus server property metadata; never N3 print/verify.

- [ ] Write failing rendering tests: separate cash card; locked server-loaded return amount/method; pending return reconciliation; Owner deduction/correction/waiver; module-off hides collection but keeps returns; report print has carry-forward/variance and no financial action.
- [ ] Run `npm test -- security-cash-render`. Expected: missing components before implementation.
- [ ] Implement responsive collection/inspection/two-step return, Owner exceptions, storage moves/deductions/transfers and local receipt Copy printing. Owner Deposits settings includes amount/terms/required-policy CAS; staff shift count and Owner property report have explicit acknowledgments, single-person review and immutable statement print/export. Checkout mounts the same card; no unrelated bill changes.
- [ ] Run `npm test`, `npx tsc --noEmit`, `npm run build`, changed-file lint and SQL checks. Expected: tests/type/build/lint pass; retain known settings warning. Attempt local interaction verification; distinguish from live/mobile acceptance.
- [ ] Commit implementation and evidence; one fresh whole-package review followed by one RED→GREEN fix pass if needed. Preserve verified checkpoint and report actual release lanes.
