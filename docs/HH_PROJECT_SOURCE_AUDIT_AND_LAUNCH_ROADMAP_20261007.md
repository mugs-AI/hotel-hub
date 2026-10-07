# HotelHub source audit and launch roadmap

Date: 07/10/2026, Asia/Kuala_Lumpur. Client target: **01/11/2026**.
Upload to Project Sources: **No** — repository audit and proposed delivery schedule.
Status: **AUDIT COMPLETE; FULL CLIENT LAUNCH NOT READY.** Dates below are targets,
not delivery guarantees or authority for new implementations or side effects.

## Intent and scope

The Owner requested a deep review of all attached Project Sources and instructions,
and a current roadmap for the first client to start using HotelHub on 01/11/2026.
There are 25 calendar days between the two dates. This audit inspects existing
source and release evidence; it does not restart the interrupted implementation.
It proposes a documentation refresh and a bounded launch programme. Already
approved automatic-correction implementation remains authorized. New checkout,
maintenance and other verticals still need their concrete designs and normal gates.

Assumption: the client needs a usable hotel lifecycle, including departure and
room turnover. An operations-only pilot without working checkout is not represented
as a complete hotel launch. The client's actual N3 tenant, roles, room count,
opening balances, current bookings and exception policies are NOT VERIFIED.

## Fresh evidence

| Lane / surface | Observation on 07/10/2026 |
| --- | --- |
| Repository | mugs-AI/hotel-hub; public; default branch main |
| Remote main | 734ac405c82e653a7098ce0ef22d51586382bd9d |
| Lovable latest source | Same SHA as main; ready; agentFinished=true |
| Lovable identity | Project d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76; workspace JRQygHE7tZl2GgPN8a8N |
| Review head before this audit documentation | 30d5df57faf0bf01bb356489ef548ff9e17103e2 |
| Latest pushed product implementation | b4a783f3ba3a90a743905ea65374e36e8f4297a7; approval-controls candidate incomplete |
| Existing local worktree | hh-review; review/hh-receipt-diagnostic-20261002; HEAD b4a783f; unfinished revision changes preserved |
| Live host | Cache-bypassed HEAD https://hotelrooms.lovable.app/ returned HTTP 200 and deployment 3480110d-0dd7-4ad1-8ad7-b3843ab39be5 |
| Live Git attribution | 03/10 publication record links this deployment to 734ac405; today's public header proves deployment ID, not a Git SHA or signed-in acceptance |
| Backend | Existing Lovable Cloud, enabled, Supabase stack; configured reference fkakhdzelilnejyehwfk. No separate staging environment established |
| Applied history | Fresh SELECT includes 20260916120000, 20260927120000, 20260928235000, 20260929090000, 20260930135429, 20261002053219 and 20261002053302 |
| New approval schema | 20261003120216 absent from history; policy/revision/attempt/bill-to-proposal tables absent |
| Existing receipt schema | hotel_receipt_control_requests and hotel_receipt_versions exist, RLS enabled |
| Generated types | Existing generated type file has no receipt-control/version or new approval-table declarations; bounded adapters exist. Type/schema reconciliation remains a separate reviewed task |
| Lovable project Knowledge | Empty, read through the connector |
| Lovable workspace Knowledge | Empty, read through the connector; HotelHub-specific rules should go into project Knowledge, not indiscriminately into workspace rules |
| ChatGPT Project Instructions settings | Exact saved text is not exposed by the available inspection tools. Supplied instructions were reviewed; no claim that the settings were read or changed |

No new product tests or production builds were run for this documentation audit.
Recorded tests retain their source boundaries: 2,008 passed / 33 skipped at Task 5
e4fc313; 80 UI targeted passes at Task 6; 12 isolated WASM SQL passes / 1 native race
skip. Initial uncommitted revision work previously had 53 targeted passes. None
certifies the final candidate, native concurrency or signed-in client workflows.

## Why the documents need refreshing

The pack is mostly dated 17–29 September. Different files call 75ceac1, 4d46404,
495b90d or ebc0eff the current head; current main is 734ac405. Start Here contains
both September release additions and an older section still called Current verified
checkpoint. Old preparation and blocked-upload statements coexist with later
released code. These are useful historical records but unsafe continuation pointers.

The approved October decision is an approval requirement, not an editing ban:
deposit approval defaults ON, contact approval defaults OFF. An Owner's approval
should execute and prove the N3 change once; approval OFF permits authorized direct
application. Current production remains manual; the automatic implementation is
only a dormant review candidate. Both facts must appear explicitly.

### Per-file audit: all 17 active attachments

| Attached source | Required action and reason | Upload replacement to Project Sources? |
| --- | --- | --- |
| 00-MUGS_DIRECTBUILD_PROTOCOL.md | Retain supplied v1.1. Repository copy remains v1.0 and should be aligned through a documentation-only update. Preserve independent lanes and no-credit-consuming fallback | No replacement needed for the already supplied v1.1 |
| MDB-01_HOTELHUB_ADOPTION.md | Refresh preparation-only status to actual Owner-authorized adoption; add locked workspace/backend, established runtime and pointers to current evidence; recheck identities before actions | Yes, when refreshed |
| 01-SOURCE_REFRESH_SUMMARY.md | Replace stale September current pointers with one versioned pack manifest and current audit links; do not treat mapping parity as full launch acceptance | Yes |
| 02-HOTELHUB_COMPLETION_PLAN.md | Replace obsolete next action with launch priorities/dependencies and dated exit gates; keep approved target finance flow | Yes |
| 03-HOTELHUB_N3_FINANCIAL_POSTING_KNOCKOFF_MASTER_RECORD.md | Preserve completed Owner UI proof and its provenance. Add actual deployed deposit/receipt controls, manual production versus dormant Update, independent switches, strict proof and current checkout gaps | Yes |
| 04-HOTELHUB_BASE_INDEX.md | Add protocol/adoption as first reads, include all six newer companions, resolve authority conflicts, point to one current repository checkpoint | Yes |
| 05-VERIFIED_BASELINE_CURRENT.md | Replace obsolete current SHA/deployment/defect ledger with dated lane evidence; keep September snapshots in clearly historical sections | Yes |
| 06-HH1.0_PROJECT_SOURCE_REFRESH_REPORT.md | Record this refresh after its replacements exist. Its statement that all implementation is unauthorized is obsolete for the approved October package | Yes |
| 07-HOTELHUB_INTEGRATION_REGISTRY.md | Refresh Cloud migration/runtime facts and add correction/contact/report contracts. Keep API-documentation proof distinct from tenant API execution and live acceptance | Yes |
| 08-HOTELHUB_PRODUCT_DECISIONS.md | Append actual approved October decisions: separate approval switches, one-click Owner execution, local folio versus N3 receipt contact, compact request card, cross-device effective-data refresh. Add client deadline as a target, not launch acceptance | Yes |
| 09-PROJECT_START_HERE.md | Replace long competing current snapshots with a concise handover and repository links; archive history; do not repeat completed development approvals | Yes |
| 10-LOVABLE_GOVERNANCE.md | Amend the builder/prompt-centric method for DirectBuild; prohibit Lovable AI Build messages; preserve target locks, reviews and financial/schema/publish gates | Yes |
| 11-CROSS_PROJECT_LESSONS_AND_BUG_PREVENTION.md | Keep safety lessons; append approval-versus-effect, legacy-request fencing, safe upstream concurrency, cross-session cache and interruption recovery lessons; replace obsolete next step | Yes |
| HH_DEPOSIT_VERIFICATION_CHECKPOINT.md | Convert to historical deposit evidence with links to later releases/live proof; do not claim its old local-only branch identifies current implementation | Yes |
| HH_PAYMENT_METHOD_CONTROLS_CHECKPOINT.md | Resolve old CODE NOT MERGED/UPLOAD BLOCKED status against source now in main and later release history. Preserve the old automatic-review rejection as history, not a current instruction to request disclosure approval again | Yes |
| HH_UI_NAVIGATION_HELP_CHECKPOINT.md | Preserve release evidence; update current source/acceptance pointers. Later first deposit evidence supersedes asking for an initial deposit again. Still require actual client/mobile UAT where unproven | Yes |
| HH_CHANGE_IMPACT_MAP.md | Distinguish today's manual production flow from approved automatic target; retain void/refund/replacement OFF; cover revision/policy/local contact and future settlement readers | Yes |

Scratch contains duplicate copies of the three checkpoint attachments with shifted
numeric prefixes; each pair is byte-identical. This does not prove duplicates in
ChatGPT's actual Project Sources. Keep exactly one active uploaded copy per logical
source; retain historical evidence in the repository. Do not delete financial
evidence or bulk remove sources before replacements are ready.

### Repository and instruction surfaces

- AGENTS.md: keep unchanged. Its anti-history-rewrite rule remains valid; it is a
  protected file. Use the existing DirectBuild governance document for delivery rules.
- README and recovery checkpoint: latest remote README has a correct incomplete
  banner, but lower paragraphs still say plan execution has not begun. Reconcile
  these and the older checkpoint headings using the execution ledger. Avoid replaying
  Tasks 1–6 merely because an earlier spec or plan header says Awaiting approval.
- docs/00-MUGS_DIRECTBUILD_PROTOCOL.md: align to supplied v1.1 without inventing a
  new global protocol or changing another product's rules.
- ChatGPT Project Instructions: use the separate proposed short draft; installation
  into the real settings is pending. Sources and instructions are not global memory.
- Lovable project Knowledge: prepare the same permanent product/DirectBuild rules
  for explicit installation. Do not send an AI Build message to install them. No
  Knowledge setting was changed in this audit.

## Current capability and launch gaps

| Area | Current evidence | Launch requirement |
| --- | --- | --- |
| Rooms, reservations, assignments, check-in, calendar | Source implemented; historical Owner observations | Current client fixture, concurrency, actual import, DD/MM/YYYY and mobile acceptance |
| Housekeeping, DND and room change | Source implemented | Role/mode tests; occupied versus Ready truth; vacated rooms Dirty; no sold room released early |
| Early/Late Checkout and Extend Stay | Rules exist; Late Checkout input/refusal/refresh correction published | Signed-in accepted and refused scenarios; same-day late time versus additional-night extension; optional paid add-on distinct |
| Folio, extras, taxes, printing | Prepared folio and print implementation | Client stock/UOM/tax mapping, discounts, rounding, billing details, A4/PDF, multi-room/long-stay checks |
| Deposit creation | Existing gated Owner writer and saved receipt evidence | Actual client tenant enablement only after approved sandbox proof; single/split capabilities separately classified; unknown outcomes cannot retry Create |
| Deposit/contact correction | Manual production; incomplete dormant automatic candidate | Finish revision/proof/review; demonstrate N3 Update and strict journal proof; one Owner click and requester refresh; independent switch matrix |
| Checkout charge and settlement | main checkout-preview.server.ts returns financialPostingEnabled:false; no complete charge/allocation/refund mutation vertical found | Cash Sale Post-to-AR, eligible receipt matching, balance collection, N3 outstanding proof and recovery |
| Final checkout | Read-only Departures/Prepare Checkout; no accepted final close vertical | Verified settlement then fenced local close/allocation release/Dirty handoff, replay and interruption recovery |
| Financial reports | Owner monthly deposits and receipt exports exist; Sales/Collections unavailable | Authoritative posted billing/collection source if these figures are required; no prepared-folio revenue; deduplicate deposits and balance receipts |
| Maintenance | Full repair/job/out-of-service workflow absent; active-room toggle alone is not a proved room-blocking lifecycle | Accepted minimal room blocking/recovery and existing-booking handling; full work-order module can follow |
| Production operations | Full client restore/support/cutover evidence absent | Backups, isolated restore rehearsal, safe diagnostics, support runbook, onboarding, opening balances and current booking reconciliation |

Front Desk cannot currently create deposits or execute N3 corrections; Owner can.
Switching approval OFF does not grant Front Desk financial-write permission. A
small-hotel boss using the Owner identity is supported by the agreed design. The
client's actual staffing workflow must be established before launch; a new payment
or checkout role would require its own reviewed server-side permission decision.

Existing manual RM65 request must not be retroactively auto-executed. It is not a
sandbox proof fixture. Approval alone cannot change receipt, checkout or report totals.

## External research and blockers

Official Lovable Git-sync documentation confirms external IDE coding is supported,
only the synced branch reaches Lovable, sync does not publish, and synced migration
or Edge Function files do not execute/deploy automatically. Database SQL-editor
execution is available separately; no separate Supabase login is presumed.
HotelHub is TanStack Start/Nitro on the existing hosting; publication deploys its
application runtime. No .github deployment workflow or standalone supabase/functions
source was found at inspected main. This does not establish all external configuration.

Official Lovable database documentation describes daily snapshots, roughly 14 days
retention and a restore that rolls back schema/data and loses later changes. Actual
HotelHub backup availability and recovery objectives were NOT inspected. A database
restore does not undo N3 transactions: financial mappings must be reconciled after
recovery. Never test a restore on the shared operational backend to prove the runbook.

Current public N3 sales-v1.json was fetched without authentication. SHA256:
d9375f8fac7af01fe5f6fc8828ab948f433151bf1d48a610df10c00077404143.
The whole normalized document differs from the 03/10 capture, but the four inspected
Update, CashSale Create, allocation Update and Refund Create operations are unchanged.
ARReceiptDto.updatedAt is integer/int64. Update exposes only the two override query
flags and the DTO, with no documented conditional header/version parameter or stale
write rejection guarantee. A timestamp field is not proof of atomic concurrency.
ProductionUpdateContract therefore remains null; fixture-only proof cannot activate it.

| Blocker | Resolution needed | Decision checkpoint |
| --- | --- | --- |
| Native SQL race proof and browser tests unavailable in prior run | Recover isolated native PostgreSQL/browser capability; run actual races and mounted two-session checks; no Cloud write substitute | 12/10 |
| Upstream conditional Update/accounting proof | Owner-run exact sandbox package; obtain QNE clarification if stale-write rejection is unsupported; do not weaken the guard | 13/10 |
| Checkout vertical not complete | Bounded contract/design/build for bill, allocation, balance and close; existing Cloud UI examples do not prove HotelHub API execution | 21/10 feature-freeze gate |
| Client operating model/tenant not verified | Identify client target, Owner/FD duties, rooms/settings/bookings and exception procedure; consolidate required decisions in one checklist | 09/10 readiness inventory |
| Monthly 100-candidate limit | Test 100/101 boundary and estimate real client receipt volume; preserve Unavailable above 100 unless a separately reviewed authoritative solution is approved | 13/10 capacity decision |

A 20-room hotel can exceed 100 receipt candidates in a month. Do not promise that
monthly deposits will always remain available, increase the cap without proof, or
show partial totals as complete. Pending this separate capacity decision, N3's
authoritative financial reporting remains distinct from HotelHub estimates.

## Proposed delivery roadmap

| Target dates (Malaysia) | Work package | Exit evidence |
| --- | --- | --- |
| 08–09/10 | Reconcile source pack/instructions; preserve/recover remaining work; client onboarding inventory; read-only checkout contract review | One active source set; fresh lane ledger; client setup/role/exception gaps listed; no duplicate implementation |
| 08–12/10 | Finish already-approved automatic-controls Tasks 7–9, native SQL proof and mobile/two-session checks; prepare dormant Owner sandbox tool | Exact complete review SHA/tree, full regression/type/lint/build with skips explained, independent review, separate migration and sandbox packages |
| 12–13/10 | After relevant lane approval, Owner performs bounded Update proof; measure managed runtime; settle client permissions and report capacity | Proven stale-write rejection and exact after-journal, or explicit unsupported result; no automatic production fallback |
| 14–21/10 | Next bounded launch finance package: charge, deposit allocation, balance receipt, verified close/room handoff; integrate authoritative report sources; minimum maintenance blocking and operational regressions | End-to-end safe hotel lifecycle with duplicate/timeout/recovery/tenant tests; no guessed final balances; feature freeze by 21/10 |
| 22–25/10 | Whole-system client UAT and defect closure | Owner/FD/Housekeeper, two devices, mobile/desktop, agreed payment modes, exceptions, room/calendar/folio/report consistency; zero open launch P0/P1 |
| 26–28/10 | Accepted-client pilot, support rehearsal and release candidate | Repeated complete stays including room reuse; backups/recovery plan and reconciliation; documented latency and known non-blocking limits |
| 29–31/10 | Separately approved production configuration, data cutover, merge/runtime/publish and smoke/UAT | Correct client tenant; opening bookings/deposits reconciled; exact source/schema/runtime/deployment evidence; client sign-off and support contacts |
| 01/11 | Client start and staffed support | Daily booking/receipt/N3 reconciliation, incident ownership and no speculative money retries |

Dependencies control the dates. Sandbox proof may require a separately approved
schema apply and deployed proof runtime. Checkout work is not covered merely by
approval of automatic corrections. Prepare its concrete spec/plan before requesting
its execution authorization; preserve existing authorizations without repeating them.
Independent read-only contract/onboarding work can proceed while a dependent gate
is blocked. Finish the current package before an unrelated release.
Before checkout development, locate and inspect the older recovered checkout work
referenced at a92d9234f8aceaa34c6e4a34976d8956225f3ef4 and its pending posting-ledger
migration. Its current availability and acceptance are not established by the old
UI checkpoint. Preserve it, assess what can be reused, and never import or rerun it
wholesale or start a duplicate implementation merely because it is unaccepted.

13/10 is an early scope decision, not a last-minute discovery date. If safe Update
cannot be proven, leave it OFF and report the impact on the promised approval system.
Do not silently replace the requested automatic behavior with manual Verify. If
checkout or launch P1 remains after 25/10, full launch on 01/11 is a no-go. Any
limited pilot/manual-accounting alternative needs an explicit client/Owner acceptance
and an audited closing/room-release design; it is not a bypass already in this app.

## Launch acceptance checklist

- Correct client tenant, company, immutable room/customer/account mappings and N3
  permissions; no copied sandbox data, secrets or another product's configuration.
- Complete booking → check-in → extras/stay changes → bill → payment/matching →
  N3 zero-outstanding proof → checkout → Dirty → Ready → rebook cycle.
- Actual single/split modes advertised only when separately proven; underpayment,
  excess deposit, cancellation/no-show and refund handled by an accepted exception
  procedure. Automatic void/replacement/refund/unmatch remain disabled unless a
  separate exact contract and implementation are approved and verified.
- Deposit/contact policy matrix and requester/Owner/two-session updates proven;
  unknown financial outcomes visibly held, no repeat POST, original intent immutable.
- Current/revoked Owner, FD, Housekeeper, expired session and alien-tenant denial;
  failed auth/period reads hide stale amounts, drafts and exports.
- Availability/capacity/housekeeping/maintenance races; room nights and tax totals
  remain server-owned; browser date locale cannot change property dates.
- All affected financial readers use confirmed effective versions once. Final
  billing and collections use authoritative posted sources, not prepared folios.
- Exact-source full engineering checks, native DB grants/races, clean protected
  diff, actual schema/type/RPC compatibility, mobile and signed-in acceptance.
- Recovery objectives accepted, usable backups confirmed, isolated restore exercise
  and N3 reconciliation runbook; documented support and cutover rollback/forward plan.

## Deferred after initial launch

Door-card hardware integration, OTA/channel-manager APIs, BEC room-package/trial
enforcement, promotions, advanced analytics and broad maintenance work orders.
External alert delivery stays disabled until its provider and recipients are set
and a separate delivery scope is approved. Financial/security audit is retained;
the requested operational-history purge is not a launch shortcut.

## Research references and evidence boundaries

- https://docs.lovable.dev/integrations/git-sync-overview — current official Git,
  backend-sync, external-development and publication behavior, read 07/10.
- https://docs.lovable.dev/features/database — current official backups, SQL editor
  and restore behavior, read 07/10; no claim of inspected HotelHub backups.
- https://openapi.account.qne.cloud/doc/sales-v1.json — current unauthenticated
  published API, fetched 07/10; no tenant N3 call or financial write.
- docs/HH_AUTOMATIC_CORRECTION_CANDIDATE.md at remote 30d5df5; dated execution
  evidence and approved automatic spec/plan — current implementation boundary.
- docs/evidence/HH_CHECKOUT_FOLLOWTHROUGH_PUBLICATION_20261003.md — last accepted
  bounded publication, current deployment ID freshly matched by public HEAD.
- docs/HH_MONTHLY_FINANCIAL_SOURCE_CONTRACT.md and HH_RECEIPT_CONTROL_N3_CONTRACT.md
  — source availability, accounting proof and disabled-operation boundaries.

This audit changes no product code, database, N3 transaction, secret, Knowledge
setting, main branch, runtime or website. Only audit/instruction documentation is
prepared for the review branch. Latest SHAs after its documentation commit must be
resolved through Git; the reviewed product source remains b4a783f.
