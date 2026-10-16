# Independent Deposit Module Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Native execution remains selected. Scope approved by Owner on 09/10/2026, reaffirmed at14:09 Malaysia time.

**Goal:** Persist two independent collection switches without changing existing receipt recovery, checkout payment or security cash returns.

**Architecture:** A service-only tenant policy table and version-fenced RPC control new collections. A deposit claim trigger serializes against policy updates. Existing hotel settings storage and financial adapters remain intact; the security switch does not advertise collection until custody is installed.

**Tech Stack:** Existing TypeScript, TanStack, React Query, Vitest and PostgreSQL; no application dependencies added.

**Spec:** `docs/superpowers/specs/2026-10-09-security-deposit-design.md`, independent-switch amendment, plus source-billing Task1 approved amendment.

## Global Constraints

- Existing tenants default advanceOn/securityOff. Four boolean combinations are valid policy values.
- Disabled collection preserves existing readback, matching, reporting and returns; advanceOff does not disable ordinary checkout payment.
- Settings never enables an N3 contract or refund writer. Security cash has no N3 financial calls.
- Do not edit protected hotel-store, integrations, package or lockfiles. No operational SQL, N3 write, main merge or public deployment in this package.
- A claimed operation may finish after a switch changes. The durable claim is the collection authorization boundary; settings cannot cancel money already dispatched.

## Review Focus

- Concurrent disable versus claim must serialize; a disabled tenant cannot acquire a fresh claim.
- Missing schema preserves old advances, but permission/network/malformed-row failures must not imply enabled.
- Cross-tenant duplicate keys cannot recover another reservation's receipt.
- Stale settings save must not overwrite another Owner's policy.
- Security unavailable must be visible and cannot be enabled through a hidden API.

### Task 1: Policy, service storage and durable claim guard

**Files:** Create `src/lib/deposit-module-policy.ts`, `src/lib/deposit-module-policy.server.ts`, `src/lib/__tests__/deposit-module-policy.test.ts`, CLI-generated `supabase/migrations/*_hh_deposit_module_controls.sql`, and `db/checks/hh-deposit-module-controls.mjs`.

**Interfaces:** `DepositModulePolicy={roomAdvanceEnabled:boolean;securityDepositEnabled:boolean;version:string}`; `DepositModulePolicyState={policy:DepositModulePolicy;available:boolean;securityReady:boolean}`; `depositModuleCapabilities(policy, readiness:{advance:boolean;security:boolean})` returns collection booleans; `readDepositModulePolicy(tenantId:string):Promise<DepositModulePolicyState>`; `updateDepositModulePolicy(actor:{tenantId:string;userKey:string;role:HotelRole}, input:DepositModulePolicy):Promise<DepositModulePolicyState>`; `assertRoomAdvanceCollectionEnabled(tenantId:string):Promise<void>`. `DepositModulePolicyError.code` is sanitized.

- [ ] Write tests for four independent modes, readiness intersection, strict payloads and legacy defaults. Run `npm test -- src/lib/__tests__/deposit-module-policy.test.ts`; expect RED for missing implementation.
- [ ] Implement pure parsing, capabilities and scoped service storage. Only missing-table errors produce unavailable legacy defaults; malformed data and other errors deny collection. Owner-only saves use SQL version CAS and a tenant lock. Enabling security rejects until a custody installation marker exists.
- [ ] Generate migration with Supabase CLI. Enable RLS, revoke public/anon/authenticated access, grant service_role only. RPC and advance INSERT trigger use the same transaction-scoped tenant advisory lock. Record audit events transactionally. Test actual SQL on a disposable engine: defaults, independent values, stale saves, grants/RLS, disable/claim and existing rows. Embedded PostgreSQL is a syntax/behavior check, not proof of multi-session lock scheduling.
- [ ] Run policy and SQL checks; expect PASS. Commit task files and ledger actual verification limitations.

### Task 2: Settings API/UI and existing advance integration

**Files:** Create `src/routes/api/hotel/deposit-modules.ts`, `src/components/DepositModuleSettingsPanel.tsx`, `src/lib/__tests__/deposit-module-api.test.ts`; modify `src/routes/settings.tsx`, `src/lib/deposits-store.server.ts`, `src/routes/api/hotel/reservations.$id.deposits.ts`, existing deposit tests.

**Interfaces:** GET policy requires `hotel:setup`; PATCH requires same-origin, Owner and exact booleans/version. Advance store checks policy after existing-key recovery and before N3 preflight. List capability intersects current policy without removing saved deposits. Existing checkout/recovery paths consume no collection flag.

- [ ] Write failing API tests for denied role, cross-site, malformed/unknown fields, stale version and unavailable security; extend real deposit-store tests for off-mode denied before N3, same-key recovery when disabled, reservation-scope rejection and trigger-race denial. Run named files; expect RED.
- [ ] Implement handlers with no-store responses and server session identity. Render two independent labelled switches in Settings → Deposits, save with expected version, refresh state on conflict, invalidate deposit queries after save. Missing policy schema disables saving; security pending disables its toggle with clear availability copy.
- [ ] Integrate new-claim guard and list capability. Preserve other operations and claim idempotency. Run targeted tests and TypeScript; expect PASS. Commit.

### Task 3: Final validation and recovery checkpoint

**Files:** Create `docs/evidence/HH_DEPOSIT_MODULE_CONTROLS_20261009.md`.

- [ ] Run `npm test`, `node_modules/.bin/tsc --noEmit`, changed-file lint and `npm run build`; compare each output. Capture untouched baseline failures separately.
- [ ] Fresh reviewer checks this package's base..HEAD against the approved specification and rulings. Correct important findings with RED→GREEN and rerun affected checks/full suite.
- [ ] Record candidate, exact changed files, tests, SQL limitations, operational schema absent, urgent OR needs_review and remaining custody/source/accountant work. Nonforce review checkpoint only after fresh remote comparison; main/public/backend remain independent.

Upload to Project Sources: **No** — engineering execution plan.
