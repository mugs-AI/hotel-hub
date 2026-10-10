# HH receipt-controls staged SQL — final isolated validation (2026-10-02)

Source HEAD at validation: df4c817d1e70b6dbfd09469147de2af5f20ee621. Nothing applied to the connected database; nothing published; no N3 call.

## Exact staged SQL validated (sha256, unchanged by this turn)
- 20261002110000_hh_receipt_controls.sql — 087280536a717ee471e2e96e3f5a9492bf0c7dfe367c8e233cb3cc7fc9f30a89 (430 lines)
- 20261002110100_hh_receipt_alert_outbox.sql — 3bd6ae65ccd7933a32f088ca950150d224bff2da7f2dab34b3ad187ba8d8422f (62 lines)

## 1. Single-connection checks (PGlite, in-process) — 91/91 PASS
`NODE_PATH=/tmp/pg/node_modules bun db/migrations-pending/checks/receipt-controls.pglite.ts` (exit 0).
The original 47 + 44 new: verify_atomic rollback (bad evidence cast, missing evidence, non-voided evidence on failure, stale version) leaves claims/versions/decisions/outbox/state byte-identical; approved-only gating (pending, Hold→Needs review, recover on unapproved, cross-tenant); stale recovery (<300s refused, <60s window refused, version fence, released claim, single 'recover' audit row, old worker claim_not_found before and after a newer claim, re-verify after recovery, rejected terminal untouched); in-flight decision fencing (reject/hold/verify_atomic refused claim_conflict, no writes, claimed worker completes on fenced version); all 7 RPCs service_role-only; all 5 tables RLS on, zero policies, no anon/authenticated privileges; compound tenant FKs (requests, decisions, executions, versions) refused even when bypassing the RPC; UTF-16 decision note 500 accepted / 501 refused.

## 2. True multi-session checks (real PostgreSQL 17.9, throwaway server in /tmp, separate backends) — 14/14 PASS
`PG_URL=postgres://postgres@127.0.0.1:55432/rcms bun db/migrations-pending/checks/receipt-controls.multisession.ts` (exit 0).
- 20 parallel verify_atomic: 1 wins, 19 claim_conflict; 1 version, 1 execution, 1 verify decision.
- 10 parallel approvals: 1 succeeds, 9 version_conflict, 1 decision row.
- Reject in session B blocks on session A's uncommitted claim lock, then refused claim_conflict; request stays needs_review; A completes.
- Recovery committed while old worker's complete waits: old worker claim_not_found; approval kept; no version.
- Old worker's complete committed first: recovery refused version_conflict; applied stays applied.
- 10 parallel creates on one deposit, different keys: exactly 1 active; same key+fingerprint: 1 row, all replay ok.

## Limits
Throwaway local server with stand-in tenant/reservation/deposit tables (not the production schema copy); Supabase roles simulated; no network/pooler (PgBouncer) layer; production apply still awaits independent review.

## Raw output — PGlite
```
PASS both migrations apply on a clean schema
PASS create returns pending v1
PASS same client key + fingerprint replays the same row
PASS same key, different fingerprint conflicts
PASS second active request for the deposit is refused
PASS reason/proposal are immutable
PASS request rows cannot be deleted
PASS pending alert queued exactly once
PASS stale version is refused
PASS approve moves to approved_awaiting_n3 v2
PASS double approval is refused (stale version)
PASS decision records requester and approver separately
PASS decisions are append-only
PASS approval alone writes no effective receipt version
PASS first claim wins, duplicate claim gets nothing
PASS applied without version evidence is refused
PASS verified completion applies the request
PASS exactly one receipt version recorded
PASS receipt versions are append-only
PASS completing the same claim twice is refused
PASS missing evidence holds Needs review, no version
PASS self-approval is flagged in the audit trail
PASS failure alert queued once
PASS Needs review blocks a new conflicting request
PASS alert claim hands out each alert once
PASS compound FK: request cannot point at another tenant's reservation/deposit
PASS compound FK: deposit must belong to the stated reservation
PASS compound FK: receipt version deposit must equal the request's deposit
PASS UTF-16 length counts astral chars as two units
PASS RPC refuses a reason over 500 UTF-16 units (251 astral chars)
PASS RPC refuses an untrimmed reason
PASS RPC accepts exactly 500 UTF-16 units
PASS execution mode is immutable
PASS Hold sets no approval
PASS pending -> Hold -> Needs review cannot be claimed for verify
PASS approval records approver once
PASS approval cannot be rewritten
PASS manual mode refuses a write step claim
PASS completion with a stale claim version is refused
PASS a failed outcome cannot carry ACTIVE (financial success) evidence
PASS confirmed void evidence is recorded even when the replacement step fails
PASS settle without the claim token is refused
PASS stale claim is re-issued with a new token
PASS the stale worker's old token cannot settle the newer claim
PASS current token settles as disabled (no provider)
PASS browser roles have no table or function access
PASS verify_atomic: complete failing on bad evidence cast raises
PASS verify_atomic: failed complete leaves no claim/version/decision/outbox/state change
PASS verify_atomic: applied without evidence raises invalid_transition
PASS verify_atomic: invalid_transition rollback leaves no partial writes
PASS verify_atomic: non-voided evidence on needs_review refused
PASS verify_atomic: that refusal also writes nothing
PASS verify_atomic: stale expected version -> claim_conflict
PASS verify_atomic: stale-version refusal writes nothing
PASS verify_atomic: success commits claim+completion+version+decision together
PASS verify_atomic: applied request cannot verify again
PASS verify_atomic: pending (unapproved) request refused not_approved
PASS verify_atomic: pending->Hold->Needs review refused not_approved
PASS recover: unapproved Needs review refused
PASS unapproved refusals leave no execution/version rows
PASS verify_atomic: tenant mismatch -> request_not_found
PASS recover: fresh claim (<stale window) refused claim_conflict
PASS recover: stale window under 60s refused
PASS recover: wrong expected version refused
PASS recover: Applying returns to approved, approval kept, version bumped
PASS recover: old claim released with result 'recovered'
PASS recover: audit decision 'recover' recorded once
PASS recover: old worker complete() refused claim_not_found
PASS recover: old worker refusal writes nothing
PASS recover: second recovery with nothing claimed refused
PASS recover: Owner re-verifies to proven result after recovery
PASS recover: old worker cannot complete after a newer claim exists
PASS recover: newer claim completes normally
PASS recover: rejected terminal request refused
PASS verify_atomic: rejected terminal request refused
PASS fencing: reject while claim in flight -> claim_conflict
PASS fencing: hold while claim in flight -> claim_conflict
PASS fencing: refused decisions write nothing and keep Needs review
PASS fencing: verify_atomic concurrent with held claim -> claim_conflict
PASS fencing: claimed worker completes on its fenced version
PASS all 7 receipt RPCs: service_role EXECUTE only (no anon/authenticated/PUBLIC)
PASS all 5 receipt tables: RLS on, zero policies, browser roles no privileges, service_role access
PASS RPC: create for another tenant's reservation/deposit refused (deposit_not_found)
PASS FK (bypassing RPC): request with other tenant's reservation+deposit refused
PASS FK (bypassing RPC): request with deposit of a different tenant/reservation refused
PASS FK: decision for request under wrong tenant refused
PASS FK: receipt version bound to a deposit of another request refused
PASS FK: execution under wrong tenant refused
PASS UTF-16: decision note of 501 units (250 astral + 1) refused
PASS UTF-16: refused note wrote nothing
PASS UTF-16: decision note of exactly 500 units accepted
ALL PASS
```
## Raw output — multi-session
```
PASS both staged migrations apply on real PostgreSQL
PASS 20 concurrent verify_atomic: exactly 1 wins (1), rest claim_conflict
PASS 20 concurrent verify_atomic: one version, one execution, one verify decision
PASS 10 concurrent approvals: exactly 1 succeeds, 9 version_conflict, 1 decision row
PASS reject in session B blocks on session A's row lock while claim is uncommitted
PASS after A commits its claim, B's reject is refused claim_conflict
PASS request still needs_review (not rejected, active index not freed)
PASS claimed worker then completes on its fenced version
PASS old worker's complete racing a committed recovery is refused claim_not_found
PASS after race: approved_awaiting_n3, approval kept, no version written
PASS recovery after a committed completion is refused (version_conflict), applied stays applied
PASS 10 concurrent creates, different keys: exactly 1 active request
  same-key outcomes: ["ok"]
PASS 10 concurrent creates, same key+fingerprint: exactly 1 row stored
ALL PASS
```

## 03/10/2026 automatic correction candidate (unapplied)

New migration: `20261003120216_hh_automatic_receipt_controls.sql`.
Isolated PostgreSQL WASM (PGlite 0.5.8 / PG18.3) functional run: **11 passed,
1 skipped**. The skipped native two-connection row-lock race is a blocking gap
before database approval; WASM functional evidence is not native concurrency proof.
Existing applied migrations are unchanged. No Cloud SQL was applied.

Reproduce functional evidence with an external test-tool installation, without
changing package or lock files:

```sh
HH_PGLITE_TEST_MODULE=/absolute/path/to/pglite/dist/index.js node node_modules/vitest/vitest.mjs run src/lib/__tests__/receipt-automation-postgres.test.ts
```

Native proof requires an empty disposable loopback PostgreSQL database and an
external `pg` module. The harness refuses remote hosts, non-`hh_test_` databases,
query options, and missing explicit disposable marker; it does not create/drop a
database or fall back to Cloud. Ordinary database name rejection verified.

```sh
HH_TEST_PG_URL=postgres://127.0.0.1/hh_test_controls HH_TEST_PG_DISPOSABLE=YES HH_PG_TEST_MODULE=/absolute/path/to/pg/lib/index.js scripts/test-hh-change-controls-postgres.sh
```

Native execution is **BLOCKED** here: recovered PostgreSQL initdb refuses root;
an unprivileged runtime is unavailable (setuid returned EINVAL). Required native
race has been authored but not executed. No schema-apply readiness claim.
