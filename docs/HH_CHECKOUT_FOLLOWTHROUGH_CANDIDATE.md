# HotelHub checkout followthrough review candidate

Date: 03/10/2026, Asia/Kuala_Lumpur. Upload to Project Sources: No.
Status: IMPLEMENTED / TESTED REVIEW CANDIDATE; not merged, deployed or published.
Branch: review/hh-receipt-diagnostic-20261002.
Implementation parent: 30fb04a2abb5ac340fcf583c5f73bb708847d9fd.
Fresh remote main and Lovable synced source: af6c47732dd79a2f944b34576b48abc53783e703.
Main tree: face85a1a4cdb3c657445e148f0342efb4efd201.
Exact candidate SHA: the commit containing this record; resolve its Git history
and the review ref before merge. Compare the exact tested tree and fresh main.

## Authorization and environment

Owner replied APPROVE to the bounded design in this conversation: compact Late
Checkout fields, booking departure-day time input, specific refusal/Extend Stay
guidance, truthful manual receipt approval copy and dependent operation refreshes.
This approves implementation and testing, not merge, publishing, DB changes or N3
financial transactions. DirectBuild governs; no Lovable AI Build message was sent.

Project d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76 and workspace JRQygHE7tZl2GgPN8a8N
were reverified. Lovable latest remains af6c477, ready, agentFinished=true.
Existing linked worktree was reused, with a clean starting tree. Existing
dependencies were reused; no package/lock or protected authentication edits.
Lovable Cloud is enabled, stack supabase, shared operational backend; a review
branch is not staging. No separate Supabase sign-in or new backend was introduced.
Runtime and hosting remain the established TanStack Start/Nitro/Lovable deployment.

## Changes and impact

- Late Checkout shows the saved departure date as DD/MM/YYYY and labels property
  local time. A time-only picker plus reason share a row from sm upward; below sm
  they stack. Another-day stays are directed to Extend Stay.
- The request combines that saved date with HH:mm and uses the existing
  expectedCheckOutLocal contract. Empty/malformed time or invalid date cannot be
  submitted from this form. The server still independently resolves timezone and
  enforces date, standard time, stage, tenant/role, approval and idempotency rules.
- late_checkout_out_of_range and late_checkout_not_later now explain the refusal
  instead of a generic retry. No server rule was relaxed. Other unexpected server
  failures retain their existing generic error/support-reference handling.
- Receipt deltas are labeled Requested change until applied, then Verified change.
  Approved manual requests explicitly say to complete in N3 and verify here;
  totals update only after verification. The button is Verify N3 change and its
  tooltip describes a read, not an edit. Needs review/mismatch messages survive.
- Successful operation requests, decisions and check-in also invalidate Departures,
  checkout-preview, folio and housekeeping. Existing reservation/calendar/timeline
  invalidation remains. This refreshes timing, readiness and room handoff readers;
  it does not fabricate financial values or change report calculations.

Only four product files changed: ReservationOperations.tsx,
ReceiptApprovalQueue.tsx, operations-client.ts and reservations.$id.tsx.
One new regression test file uses synthetic fixtures only. API/server validation,
N3 transport, accounting proof, SQL/RPCs, migrations, generated integration types,
authentication and all frozen financial controls remain unchanged.

The stable companion HH_CHANGE_IMPACT_MAP.md remains the Project Source to upload.
Current task evidence and changing SHAs stay in this repository, not Project Sources.

## Verification

| Gate                        | Evidence                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Full clean baseline         | 120 files passed / 3 skipped; 1921 tests passed / 20 skipped; exit 0                                                                            |
| Initial regression RED      | 14 failed / 1 passed; missing messages/helper/UI and dependent invalidations                                                                    |
| Initial focused GREEN       | 4 files / 88 tests passed; exit 0                                                                                                               |
| Mounted-reader RED          | Removing only checkout-preview invalidation retained old time; 1 failed / 15 skipped                                                            |
| Final full suite            | 121 files passed / 3 skipped; 1937 tests passed / 20 skipped / 0 failures; exit 0                                                               |
| TypeScript                  | tsc --noEmit exit 0, no type errors                                                                                                             |
| ESLint / formatting         | 0 errors / 37 existing warnings; full src Prettier passed; new test rechecked                                                                   |
| Production build            | Vite/Nitro build exit 0; application source unchanged after build                                                                               |
| Protected baseline          | AGENTS.md, package.json, bun.lock, src/start.ts, src/integrations, hotel-store.server.ts exactly match a68664f56e38bfb74e32972c14becdc6e6938449 |
| Whitespace / DB-source diff | git diff --check exit 0; supabase unchanged                                                                                                     |
| Responsive artifact         | Production CSS includes the sm two-column minmax grid; markup has a one-column default                                                          |
| Independent review          | No Critical/Important issues; 34 focused tests passed, then added mounted-reader test passed independently                                      |

There are 16 new tests. They cover original different-day refusal, too-early time
message, date/time composition plus real server timezone conversion, malformed
values, Malaysian date/time-only rendering, real operation-mutation cache effects,
a refused operation preserving data, a mounted QueryObserver refetch with amount
unchanged, and receipt authorization versus completed verification copy.

20 existing credential-gated tests remain skipped: reservations.schema.sql,
reservations.sql and provision-owner.sql. No live write opt-in or credentials were
supplied to unblock them. Existing npm proxy/plugin and Nitro build warnings do not
constitute failures. Command output is in evidence/HH_CHECKOUT_FOLLOWTHROUGH_GATES_20261003.txt.

Independent review confirmed route/form wiring, true query-key families, responsive
source structure and preserved financial boundaries. A suggested mounted-reader
coverage improvement was added, observed failing with its refresh removed, restored
byte-for-byte, and verified passing. No remaining blocker was found.

## Live financial state and limits

Fresh project-scoped read-only SQL at 2026-10-03T06:16:22.060965Z confirms the actual
receipt request remains approved_awaiting_n3, manual, original 5000 / proposed 6000 cents,
original deposit posted MYR50.00, execution count 0, verified version count 0.
No live N3 edit, receipt correction/void/refund, approval, Late Checkout apply,
Extend Stay, checkout or external alert was performed by the coordinator.

Request creation and approval were already Owner-observed in the prior handover.
Manual N3 completion and exact Verify acceptance remain pending; receipt P1 is not
closed. This UI correction does not make requested RM60 effective prematurely.

Native mobile picker appearance and an actual Actions click/submission were not
browser-tested. Markup, payload helper, server validation, active/inactive cache
effects, compiled responsive CSS and source wiring were checked. Signed-in live
operational persistence and N3 readback are not established by isolated tests.
No public serving identity was rechecked or changed for this unpublished candidate.

## Next gate

Review/approve this exact candidate for code merge to main after a fresh
remote/Lovable sync check. Keep database, runtime deployment, N3 writes and public
publishing separate. Preserve the review branch and handover across devices.
