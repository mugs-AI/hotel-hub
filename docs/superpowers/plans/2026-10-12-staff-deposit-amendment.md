# Staff deposit amendment implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** N3-authorised Front Desk staff complete deposit create/direct correction and recovery inside HH; Owner approval produces verified notification.
**Architecture:** Reuse the existing one-dispatch ledger and full-DTO updater. Bind direct correction to its requester at server and SQL boundaries. Extend the existing scoped revision reader with verified events and a single AppShell observer.
**Tech Stack:** TypeScript, TanStack Start/Query, PostgreSQL, Vitest, isolated PGlite.
**Spec:** docs/project-sources/HH_DEPOSIT_WORKFLOW_AND_N3_PERMISSIONS_20261012.md (Owner approved 12/10).

## Global constraints
- Keep existing N3-only encrypted session and caller token; never substitute Owner credentials.
- Approval decisions, settings, reports and legacy manual execution stay Owner-only.
- Same receipt identity; no repeat financial dispatch after unknown outcome.
- Applied migration history is immutable; candidate migration remains unapplied.
- No main merge, publication, runtime activation, operational writes, N3 operations or BEC work in this implementation.

## Review focus
- Another staff member's request cannot be dispatched or reconciled by Front Desk.
- Policy tightening before dispatch stops a direct request; relaxation never upgrades legacy requests.
- A role/session change during preflight prevents mutation or effective projection.
- First load/reload and auth switches never replay historical successes.
- An event appearing during a failed refresh must not expose stale money or repeat sound.

### Task 1: Staff authority through server and SQL
Files: src/lib/rbac.ts, receipt-automation-{execution,deps,gates}.server.ts, new receipt-staff-authority.server.ts, receipt request route, additive migration, related tests.
- [x] Write failing tests for Front Desk direct update, ON denial, other requester denial and revoked session; watch RED.
- [x] Add fresh caller context validation; preserve Owner approval; requester-bound apply/check capability and direct request routing.
- [x] Replace only v2 authorize/reserve/hold/settle via additive migration; preserve same attempt and policy fences. Front Desk cannot approve/reject or act on others.
- [x] Run focused unit and isolated SQL tests, types and full suite; save task evidence.

### Task 2: Reservation recovery and verified notification
Files: ReceiptControlRequestDialog.tsx, new deposit notification module/component, change revision route/client, AppShell.tsx, tests.
- [x] Write RED tests for event baseline, dedup, auth change, failure and direct recovery inside reservation.
- [x] Show Applying/verified/held within reservation and Check N3 result for saved unknown attempts; do not redirect direct workflow to Owner queue.
- [x] Return only own committed applied v2 correction event metadata with monotonic revision. No raw evidence/contact/queue data.
- [x] Observe in one AppShell mount, show bottom-right visual and short chime once; mute control; audio failure preserves visual.
- [x] Run focused and mounted regressions; type/lint/full suite/build.

### Task 3: Review checkpoint
- [x] Review all changes, authority and migration ordering; independent review and one regression fix pass.
- [ ] Save exact local checkpoint and remote review tree; verify clean tracked status and remote identity.
- [x] Record source-only results and unapplied schema/runtime/publication/real N3/two-session acceptance requirements.
