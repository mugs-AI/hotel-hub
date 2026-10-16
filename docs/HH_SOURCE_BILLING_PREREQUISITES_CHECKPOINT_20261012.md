# HotelHub source billing prerequisite checkpoint — 12/10/2026

Upload to Project Sources: **No** — repository implementation/recovery evidence.
Status: **Partial source candidate. No operational release or full-plan completion.**

## Exact recovery and authority

The Owner authorized continuation of the existing approved build. Recovered the
existing isolated worktree `/workspace/scratch/90b6973e3a7b/hotel-hub-reconstruction`,
branch `review/hh-reconstruction-20261011`, input commit
`0c913912f930477edc463f84f6ddcf7cf70e26e3`. Existing dirty source-policy store/SQL/
tests and execution documentation were preserved and completed to a tested
prerequisite checkpoint. Original billing and receipt worktrees remain untouched.
This corrects the earlier recovery limitation: those worktrees were outside the
current conversation folder, and are now available. Never restart their work.

Current remote main and Lovable latest: `6ac17dee7b503b96daf89015afdc9fb3995e1b68`.
Lovable ready/agentFinished=true. Database access is through that existing Lovable
project only. Owner has no separate Supabase account and must not be asked for one.
SELECT-only actual history still has latest migration `20261003120216`. No source/
billing/security candidate migration was applied here. No N3 request was sent.

## Source implemented in this continuation

- Fixed, service-owned source-policy and reservation-payer persistence adapter;
  exact tenant/source/reservation ownership, active role and policy/payer/version/
  reservation-timestamp fencing; SQL-stamped actor/time; append-only audit.
- Once-only compatibility seed for the existing walk-in mapping, without changing
  historical stays or using a customer display code as immutable identity.
- Pure, copied/immutable source-versus-guest partition: RM300/RM40 and RM300/RM80,
  explicit shared adjustments, cent conservation, guest-only owned advances,
  source-debtor bill-to/currency evidence, no whole sibling folio copied.
- Durable local HH bill/receipt/refund identifiers, server property date for new
  reservations, same-operation replay, cross-reservation rejection and overflow
  fencing. Local numbering creates no N3 document or refund and does not assert
  N3 accepts custom numbers.
- Allowlisted guest/accounting display and escaped HTML: source guest copy omits
  room monetary fields and raw room descriptions; guest extras remain visible;
  accounting copy retains full values; unverified output is preparation only.

## Fresh evidence

| Check | Result |
| --- | --- |
| Recovered baseline | 2,648 passed, 38 skipped |
| Final entire repository | 2,673 passed, 38 skipped, zero failed; 177 files passed, four skipped |
| Focused source prerequisite suites | 45 passed, independently repeated by reviewer |
| Disposable source-policy/numbering SQL | 20 passed: 14 policy and six numbering; independently repeated |
| Generation isolation SQL | Five generation-2 legacy-RPC refusals passed |
| Existing settlement SQL | Single-session closure/Dirty/DND/handoff/replay/permission checks passed |
| TypeScript | `npx tsc --noEmit`, exit 0 |
| Changed TypeScript ESLint | Nine-file check, exit 0 |
| Local production build | `npm run build`, exit 0; final Nitro generation confirmed |
| Diff whitespace | Pass |
| Protected paths vs main | AGENTS, package/lock, start, integrations, hotel-store unchanged |
| Independent continuation review | No Critical/Important defect established; one deferred Minor below |

TDD: partition, numbering and print modules absent RED, then GREEN. Numbering SQL
RED with the appended schema omitted (six failures), then full-schema20/20 GREEN.
Earlier recovered policy/store RED evidence stays in its original execution
ledger; this run freshly repeated its tests rather than claiming a new RED.
The recovered mock needed an explicit RPC return type for TypeScript; no financial
behavior or dependency change was involved.

Minor deferred: `HH_SOURCE_SQL_POLICY_ONLY=true` deliberately omits numbering
schema but still runs its six tests to reproduce RED. The name may mislead a tester
expecting a green policy-only suite. Normal full-suite invocation has no such flag.

## Explicit incomplete units and release holds

This does **not** complete the six-task source-billing plan. Task1 still needs the
accepted current N3 customer-master reader, Settings and booking lifecycle adoption.
Task2 still needs persisted plan/line attribution and freeze/mutation integration.
Task3 still needs durable leg/intent association and sibling/legacy read isolation.
Task4 two-leg posting/GET-only uncertain recovery and Task5 guest-settled/source-
issued close/accountant cases are pending. Task6 mounted readers/prints/exports/
mobile and formal-document acceptance are pending. Pure HTML is not live printing.

The default source-customer master registry intentionally remains unavailable;
no mounted new settings/payer writer is provided. Tests inject trusted observations,
not live N3 contracts. Source/guest currency/contact evidence is mandatory; no
customer-ID-only snapshot rewrite is an acceptable shortcut. Existing negative
adjustment/master adapters and formal document contracts remain independently
unaccepted. Native multi-session/deadlock behavior is NOT VERIFIED: PGlite's one
connection and Promise.all are not native PostgreSQL concurrency proof.

No normal receipt editing activation, scoped financial test, operational SQL,
Lovable build/settings change, main merge or public deployment occurred. Local
production build is not a Lovable AI build. Normal editing stays OFF as the
existing release direction; runtime-secret values were not inspected here.

## Rulings and next permitted work

1. Retain Task1 runtime as setup-required until exact current N3 evidence is accepted;
   code/stored IDs do not create a master contract. Cost if wrong: operational setup
   is delayed, rather than financial authority being fabricated.
2. Prepare independent partition while runtime is held. Require explicit trusted
   source-debtor contacts/currency, omit whole sibling folio projection. Cost if
   wrong: additional adapter/printing acceptance is required before dispatch.
3. Keep the missing-numbering-schema RED switch, record its intended failing use.
   Cost if wrong: a tester sees the six documented expected failures.
4. Treat review exclusions as release holds: native concurrency, operational schema/
   runtime, all unbuilt lifecycle/leg/coordinator/close/accountant/reader integration,
   live N3/mobile/printing/legal documents, earlier reconstructed branch not re-reviewed
   in this delta. Cost if wrong: no operational release claim can be made.

Next: establish the current-master adapter and lifecycle contract; complete durable
plan/leg ownership and the accountant-case dependencies before two-leg execution/
close. Reuse existing receipt/scoped-UAT/security work; do not repeat completed N3
proofs, enable unaccepted contracts or apply migrations without their release lane.
Client UAT20/10 and launch01/11 remain targets; not certified readiness.

Candidate SHA is the commit containing this document; resolve via Git history.
Worktree/ledger remain for recovery. No new Project Source upload is required.
