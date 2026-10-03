# Automatic receipt correction and independent approval controls

Date: 03/10/2026, Malaysia. Upload to Project Sources: No.
Status: WRITTEN SPEC FOR OWNER REVIEW. Concept approved; implementation plan,
product implementation, sandbox financial transactions and activation not approved
by this document. Current automatic edit capability remains disabled.

## 1. Intended result and authority

The Owner wants an approval system that actually applies the approved correction:
staff proposes MYR50 → MYR65, Dashboard displays the comparison, and one Owner
Approve initiates N3 Update and automatic receipt/journal verification. Only proven
success changes HotelHub's effective amount. The requester sees progress and the
result without a normal-success manual Verify step.

A small hotel's boss, signed in with the existing Owner identity while doing
Front Desk work, can save directly when approval is disabled. Deposit approval
and billing-contact approval are separate property settings. This supersedes the
older allow/block-editing interpretation, not the existing security boundaries.

DirectBuild repository coding/testing on a review branch is the delivery method.
No Lovable AI Build message, alternative hosting, Supabase identity replacement,
or exposed N3 token. Database apply, code merge, runtime deployment, N3 writes,
feature activation and public publishing retain separate gates.

## 2. Verified starting point

- Source main and Lovable latest: `734ac405c82e653a7098ce0ef22d51586382bd9d`.
  Review input: `97529fffdcfbb1768fe37d3db1c4add9363df954`, initially clean.
- Project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`, workspace
  `JRQygHE7tZl2GgPN8a8N`; project ready, agentFinished=true at read.
- Lovable Cloud reports enabled, Supabase stack; configured backend reference
  `fkakhdzelilnejyehwfk`. No isolated staging backend established. A branch is
  source isolation, not database isolation. Runtime is TanStack Start/Nitro on
  Lovable's existing hosting; a Git commit does not deploy SQL or publish.
- Fresh read-only migration history includes `20260929090000`,
  `20261002053219`, `20261002053302`. Existing applied migrations are immutable.
- Latest recorded public deployment is `3480110d-0dd7-4ad1-8ad7-b3843ab39be5`
  from `734ac40`; publication evidence is historical to this spec-writing turn.
  The public serving identity was not re-probed here.
- Receipt correction currently has manual verification only. Deposit creation
  and financial execution are Owner-only; FrontDesk may request corrections.
  Local guest-folio bill-to saves currently bypass approval.
- RM65 request for BK260920001 / OR2610/001 is an existing manual Needs review
  request, with no verified corrected version in the last scoped financial read.
  Original posted MYR50 remains the last verified financial state. This turn
  checked migration history, not fresh receipt balances or N3 journals.

Read with `HH_DIRECTBUILD_GOVERNANCE.md`, the DirectBuild protocol/adoption,
`HH_CHANGE_IMPACT_MAP.md`, `HH_RECEIPT_CONTROL_N3_CONTRACT.md`,
`HH_RECEIPT_SQL_VALIDATION.md`, `HH_MONTHLY_FINANCIAL_SOURCE_CONTRACT.md`, the
original receipt/monthly specs and the clarified automatic-correction intent.
Those documents describe current controls; this spec describes proposed changes.

## 3. Settings and actor matrix

Place two Owner-editable switches under Settings → Operations → Deposit & billing
changes. Label the switches as approval requirements, not editing permissions.

| Setting | Default | ON | OFF |
| --- | --- | --- | --- |
| Deposit changes require Admin approval | ON | Submit proposal; Owner Approve applies it | Authorized Owner Save applies it directly |
| Billing-contact changes require Admin approval | OFF | Submit proposal; Owner Approve applies it | Authorized direct Save applies it |

Admin in UI means the existing Owner role. Policy does not grant financial roles.

| Actor / target | Approval ON | Approval OFF |
| --- | --- | --- |
| Owner, N3 receipt amount/contact | Request then explicit one-click approval, including self-request | Direct Save through the same financial execution pipeline |
| FrontDesk, N3 receipt amount/contact | Request; Owner approves and executes | Request; Owner executes because this actor lacks N3 financial-write permission |
| Owner or FrontDesk, local guest-folio bill-to | Request; Owner approves | Direct local save under existing reservation-edit permission |
| Housekeeper | No access | No access |

For FrontDesk receipt requests with the switch OFF, show “Owner execution required”
and a Dashboard “Apply” action for the Owner. This is financial role enforcement,
not an extra policy approval. Do not promise FrontDesk direct N3 writes. Extending
that role requires a separate explicit permission design. This initial design
supports the requested small-hotel boss through the Owner role.

Amount or payment-account changes use the deposit switch. Contact-only changes use
the contact switch. Combined receipt changes use approval if ANY affected category
requires it. A same-value no-op creates no financial request. A reason remains
required, including direct financial saves. Existing account eligibility rules,
field bounds, reservation-stage restrictions and maximum safe cents remain.

Owner settings writes use expected policy revision and are audited. Tightening a
policy before dispatch requires approval for an unapproved direct proposal;
relaxing it never auto-runs an existing pending/manual request. Already-dispatched
attempts continue readback under frozen proposal/authorization evidence. Policy
read failure never defaults to direct execution.

## 4. Target distinctions and user interface

The same contact switch governs two clearly labelled workflows:

1. **Guest folio billing details:** local bill-to snapshot for a reservation,
   independent of any deposit; approval applies an atomic local update.
2. **N3 receipt billing contact:** explicitly selected posted receipt; approval
   executes its bounded N3 Update and verifies contact plus accounting evidence.

Changing local folio details does not silently change posted N3 receipts or the N3
customer master. Changing one N3 receipt does not rewrite every booking receipt or
local bill-to snapshot. UI states the target. No combined cross-system transaction
is promised; each explicit target has its own proposal and result.

Dashboard request cards display booking, document, amount before/after, changed
contact fields, reason, requester, time and current status before the action.
Desktop uses a compact row with Approve/Apply at the right; mobile wraps with
readable field labels. Keep Reject where authorized. Remove the Review expansion
and acknowledgement checkbox as prerequisites; Approve remains an explicit,
audited Owner decision bound to the visible proposal version. Never hide changed
fields behind truncation without an accessible full-value view.

The click disables the action while in flight, shows Applying, then either Applied
with proven values or a specific safe failure/Needs review. Normal automatic
success has no separate Verify N3 change button. Legacy manual requests retain
their labelled manual flow; uncertain new attempts expose **Check N3 result**,
a GET-only reconciliation action that cannot send another financial Update.

Local bill-to Save under approval ON returns “Pending approval” and preserves the
effective values until approval. Draft/requested values are visibly separate.
Do not show “Saved” or print a proposed contact as approved. Prepare Checkout keeps
its distinct card layout and read-only financial projection; no deposit editor is
duplicated there and no correction advances checkout or in-stay stages.

## 5. Application boundaries

- A new server-side change-policy adapter stores/reads the two switches. Add a
  dedicated authenticated policy endpoint; reuse existing settings page and RBAC.
  Avoid changing protected `hotel-store.server.ts` for unrelated settings storage.
- Receipt proposal/decision endpoints orchestrate immutable proposal, fresh
  authorization, preflight, durable attempt, bounded Update and proof completion.
  Requester-controlled IDs are checked against server tenant/reservation/deposit.
- A narrow N3 Update adapter permits only the proven fixed Update route. It
  builds the payload from fresh receipt evidence and an allowlisted proposal;
  never accepts a browser-supplied ARReceiptDto or arbitrary API path.
- A local bill-to proposal service handles local snapshots and atomic decisions
  without requiring an N3 receipt or changing monetary totals.
- A revision-only endpoint and client observer refresh affected views across
  sessions. They carry no N3 token, contact payload or Owner request-queue data.

Keep `AGENTS.md`, package/lock files, `src/start.ts`, `src/integrations/*` and
`src/lib/hotel-store.server.ts` identical to the protected baseline unless a
separately reviewed exception becomes essential. Established N3 identity remains.

## 6. Durable storage and authorization

Use one additive, separately approved migration; never replay the two receipt
migrations or alter their historical SQL. Required storage contracts:

- Tenant-keyed `hotel_change_control_policies`: both booleans, monotonic revision,
  updating Owner and timestamps; defaults deposit ON/contact OFF after installation.
- Add immutable generation, policy snapshot and authorization kind to new receipt
  requests. New generation supports `manual_approval` or `direct_policy`; direct
  authorization records actor/time/role and policy, not invented Admin approval.
  Old requests remain legacy/manual and retain existing approval/Verify rules.
- Durable per-request edit-attempt ledger with one dispatch reservation, attempt
  identity, proposal/payload hashes, actor, claim version, timestamps and outcome.
  Never store session credentials or raw personal bodies in diagnostic logs.
- Local bill-to proposals: compound tenant/reservation binding, immutable before
  and requested values, expected effective revision, reason, actor and decision.
  At most one active proposal per target; versioned local bill-to update detects
  an intervening edit. Audit and decision cannot be best-effort for this flow.
- A tenant change revision incremented in the same transaction as effective
  financial/local bill-to completion. Receipt status changes also notify observers.

All new tables use service-only access with RLS, explicit revocation for anon and
authenticated roles, compound tenant FKs and narrowly granted RPCs. SECURITY DEFINER
functions have a fixed safe search_path. Server sessions resolve tenant/user/role;
neither browser flags nor a service-role connection itself proves actor permission.

Approval/direct authorization, claim and completion use row locking plus expected
versions. Only the matching attempt/version can append a proven effective version.
Financial completion, audit, request status and revision commit atomically. Original
deposit intent remains immutable; repeated completion returns the same result and
cannot append a duplicate. Existing active-request uniqueness remains enforced.

## 7. Automatic financial execution and uncertain results

1. Resolve current Owner session, tenant allowlist, proven-contract/runtime gates,
   proposal version and current policy. Commit the explicit decision or direct
   authorization. An approval may persist even if later preflight cannot proceed;
   display approved/on hold with a reason, never silently retry on page load.
2. Fresh GET evidence must exactly match the original proposal fingerprint and
   eligible posted receipt. Bind identity/document/customer/currency/date/reference,
   contact, total/payment lines and journal; refuse matched, refunded, reconciled,
   cancelled, unknown or unsupported states. Contact-only preserves the allowed
   historical account; amount/account changes recheck enabled eligible account.
3. Prepare only supported amount/contact changes, preserving all other documented
   fields. The same single payment account/line constraint remains. Pass both
   confirmation override flags as false. No forced reconciliation/knockoff.
4. Reserve dispatch durably BEFORE making the one bounded POST. A second click,
   retry, different browser or old worker cannot reserve another dispatch for this
   request. A crash after reservation but before send is conservatively uncertain.
5. Interpret the official business envelope, not HTTP 200 alone. Read back receipt
   and its exact journal, including current correlated-null-code provenance and
   second-detail-read rules. Accept only the immutable identity and approved
   amount/account/contact with a balanced, exact bank/customer posting.
6. Atomically publish the verified effective version and revision. Until proof,
   the original/last verified value remains effective, labelled with unresolved
   status; finance may show Needs review/Unavailable according to existing rules.

This is not an exactly-once transaction across N3 and PostgreSQL. It provides at
most one dispatch reservation per proposal and fenced local completion. Timeout,
disconnect, malformed/business-ambiguous response, process death or post-send DB
failure becomes Needs review/unknown. Never automatically repeat a financial POST.
Read-only reconciliation can complete a later-proven success. A receipt unchanged
at one instant is not proof a timed-out write cannot still arrive; keep the hold
until the upstream outcome is conclusively resolved. An unknown attempt cannot be
rejected to free its active index or replaced by a new correction to bypass it.

Definitive pre-dispatch refusal may permit a separately versioned Retry preflight
action; it sends no Update until a new valid claim. Once dispatch is reserved,
only reconciliation is available. A definitive documented upstream rejection may
close the attempt only with contract-proven no-write semantics; a new proposal
then requires fresh evidence and explicit user action. Do not reuse the existing
300-second manual Verify recovery RPC to release an automatic edit dispatch.

Execution is request-driven with the current Owner's encrypted server session.
No background job persists N3 tokens. Browser response loss does not cause resend;
returning Owner checks the recorded attempt and uses GET-only reconciliation.
Use a shared execution deadline bounded below the measured hosting request budget,
and allocate preflight/write/readback explicitly (current N3 defaults are 20s read,
30s write). Hosting budget measurement is an activation condition; do not assume
several default calls fit. Deadline exhaustion preserves the durable hold.

External N3 concurrency is a distinct blocker: `updatedAt` in a DTO is not a
proven compare-and-set contract. A fresh GET cannot prevent a later outside edit.
Automatic activation requires sandbox evidence of enforced stale-update rejection
or an equivalent documented upstream conditional-write mechanism. Without it,
automatic Update stays disabled; do not replace this with post-write detection,
UI warnings or an assumption that nobody else edits the receipt.

## 8. Effective readers and cross-session refresh

All financial readers use the verified receipt projection, never the requested
amount or approval state. MYR50 → MYR65 contributes MYR65 once, not MYR115.

| Affected surface | After proven receipt completion |
| --- | --- |
| Reservation deposit rows, summary and request dialog | Effective receipt amount/contact/status and fresh original snapshot |
| Dashboard request queue/card | Final outcome and comparison; active item no longer actionable |
| Guest folio / printed folio | Effective deposits and recomputed estimated balance/excess; local contact follows its separate effective snapshot |
| Reservation list/detail, Departures, Prepare Checkout | Recomputed deposit summary and readiness without workflow transition |
| Monthly Finance and receipt reports/export | Same effective version, audit and N3 receipt date; authorization preserved |

Invalidate existing receipt-controls, deposits, folio, reservations, departures,
checkout-preview and financial-reporting prefixes plus the relevant bill-to/policy
keys. Financial server cache revision adds the monotonic change revision while
preserving existing deposit/request/version revisions; the current 30s cache must
not mask a completed change.

Use an authenticated no-store revision GET every two seconds while affected views
are visible, and on focus/reconnect. It reads small local metadata, not N3 journals.
Share the observer per app session, stop while hidden/signed out, and refetch on
resume. Direct actor gets the proven result immediately on completion; another
active browser normally sees it on the next poll plus refetch/network time, not a
zero-latency guarantee. Show reconnecting/stale state on network failure.

Scope every sensitive query/mutation, including bill-to and policy data, by
tenant:user:role; purge on identity change/failed authentication. Revision access
does not grant Owner finance access to FrontDesk. A failed finance period/read
hides stale amounts and exports rather than showing an old month's data.

## 9. Regression and activation proof

Use isolated PostgreSQL and injected N3 fixtures for implementation tests. Never
write to the shared Cloud database through an automated test run. Required evidence:

- Policy/actor/category matrix, defaults, combined changes, no-op, stale policy,
  tightening/relaxing, tenant crossing and auth expiry; server cannot be bypassed
  by local bill-to PUT or altered proposal IDs.
- SQL migrations and real two-connection race tests on disposable PostgreSQL:
  duplicate approval/dispatch/completion, crash phase, late worker, guarded rejection,
  bill-to conflict and denied roles. Source assertions alone are insufficient.
- Receipt Update payload preservation, strict envelopes, account rules, journal
  provenance/conflicts, changed contact, stale fingerprint, ineligible states,
  timeout/unknown and readback-success/local-completion failure.
- UI one-click action, duplicate clicks, clear outcomes, responsive changed fields,
  local pending/effective contact separation and legacy manual controls.
- Two authenticated browsers/actors refresh all affected readers, with identity
  switch, failed auth, month navigation, 100/101 candidates and exports exercised.
- Existing project test/type/style/build gates and protected-baseline comparison.
  Historical 1,937 passing tests are not new-feature verification.

Owner performs all signed-in N3 probe jobs. The companion checklist defines the
separate sandbox proof and evidence. No credentials requested in chat. Listed
public Update operation alone does not satisfy live mutation/concurrency proof.

## 10. Rollout, rollback and fixed boundaries

Implement dormant capability only after written-spec approval and reviewed plan.
Present exact source/tree, migration scripts, isolated SQL results, test results,
Owner proof and activation configuration before their respective approval gates.
Deployment without a proven mutation contract keeps Update disabled. New switches
are disabled with a clear capability message where automatic execution is not
available; existing manual flow keeps working. Never label a manual save automatic.

Activation requires reviewed contract evidence, runtime flag, tenant allowlist,
installed compatible schema and hosting-budget proof. Enable only the tested tenant
and capability. Settings do not themselves activate financial automation.
Turning capability OFF prevents new dispatches; existing attempts remain held and
GET-only reconciliation remains available. Never fall back to a duplicate manual
edit for an uncertain automatic attempt. Rollback never edits original deposits,
deletes audit/attempt records or undoes a proven N3 correction.

Do not retroactively execute existing approved manual requests, including the RM65
request. Their mode/proposal/approval evidence is immutable. Finishing or rejecting
them is a separate explicit financial/user action, not this design's migration.

Void, replacement, deletion, refund, unmatching, cancellation proof relaxation,
automatic reconciliation overrides, customer-master editing and alerts are outside
scope. Sales/Collections stay Unavailable until authoritative final billing exists.
Monthly figures use N3 receipt dates; more than 100 verification candidates remains
Unavailable. Reservation and Prepare Checkout remain distinct. Late Checkout and
other operational workflows receive regression coverage only where touched.

## 11. Review outcome and next gate

Inline self-review covers policy meaning, actor authority, local/N3 separation,
legacy requests, immutable financial intent, one dispatch, uncertain outcome holds,
external concurrency, deadline feasibility and every dependent reader. Missing
sandbox concurrency and hosting evidence are explicit activation conditions, not
assumed capabilities. No product code or migration is contained in this spec.

Next: Owner reviews this written spec. After approval, write an implementation plan
with separate dormant implementation, isolated validation, Owner sandbox proof,
database and activation/release stages. Do not treat conceptual approval or a
review-branch documentation commit as authorization to execute these stages.
