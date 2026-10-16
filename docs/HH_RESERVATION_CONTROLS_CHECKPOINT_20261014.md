# HotelHub reservation controls checkpoint — 14/10/2026

Upload to Project Sources: **Yes** — promoted by the user as an additional dated recovery reference; retain existing master sources.
Historical reservation-controls snapshot. Latest continuation: `HH_BILLING_PROGRESS_20261014.md`.
Status: bounded source fixes implemented and tested; billing/no-show execution plan approved; subsequent implementation is recorded separately. No release or financial transaction occurred.

## Source and observed baseline

Repository: `mugs-AI/hotel-hub`. Isolated branch: `review/hh-reconstruction-20261011`.
Starting design/broad-source checkpoint: `eddd7cf009e94f0bfd64460505c36b2484559b28`.
Initial implementation: `33dd8985e87e0e07bf837817b4b6a687150a6b26`.
Final product source: `de7cc669af5fab3643b1c1785f58b614f672e3ea`, tree
`2604ebba875232d3c0d06ae15ee60edf78874c80`. A later documentation commit preserves this product source.

Fresh read-only main/Lovable inspection matched `ce4c12d028df33894499b718f162468eb9d638b2`, ready/agent finished. That is the existing published receipt release; the broad review branch is not the live product or a clean main-based release packet. No review push, main merge, Lovable build request, SQL installation, runtime/secrets change, N3 call/write or publication occurred in this continuation.

Existing backend remains managed through the same Lovable project. No separate Supabase account was used or required. Supabase CLI2.120.0 was used only for offline migration-file generation; it was not linked/logged in or used for operational execution.

## Implemented source

- Explicit per-reservation action and approval drafts; keyed detail remount isolates transient child state. Timeline drawer state uses its own reservation key.
- Pending and error state survive navigation. Hook-level settlement callbacks clear only the matching flow and work after observer unmount. Pending work blocks cancellation/tab closure and replacement flows; failures retain the request identity and recovery message.
- Shared information triggers are transparent and have no outer border. Hit targets, keyboard/focus behavior and readable white icons on gradient headers remain.
- Owner-only **Enable Change rate** control, default ON. Separate server adapter/RPC avoids changing the protected hotel-settings projection. Lossless revision fences, same-origin/role/tenant guards and service-only grants remain explicit.
- SQL trigger denies new rate requests and approved/applied transitions while OFF, retaining the ability to reject/history-read. Policy row locking serialises disable/application in the prepared SQL.
- Date metadata and server preflight block confirmed stays on/after departure, including an attempted early override. Both existing SQL check-in implementation bodies receive the same upper bound. The guard reads actual wall-clock property date after the reservation lock; completed-check-in replay exits stay ahead of it.
- Reintegrated the already published receipt account-change updater and direct-save refresh/legacy recovery fixes into the older broad billing source. Existing receipt/settlement freezes were retained; no new financial authority was introduced.

Candidate migration: `supabase/migrations/20261014001420_hh_reservation_operation_controls.sql`.
It adds two settings columns, scoped policy RPCs, the rate trigger and bounded forward check-in-definition patches. It preserves inspected bodies/grants and fails on unexpected function shape. It is **UNAPPLIED**. Installation must run once in a transaction through the verified Lovable controller, followed by actual catalog/grants/schema inspection. No migration history was fabricated.

## Fresh verification

| Check                                                    | Observed result                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Full Vitest, isolated Happy DOM and PGlite lanes enabled | **2,862 passed / 22 skipped / zero failed**, 200 files passed / 3 skipped; exit0                                              |
| TypeScript                                               | `npx --no-install tsc --noEmit`, exit0                                                                                        |
| Production build                                         | `npm run build`, exit0; final Nitro output confirmed                                                                          |
| Changed TypeScript ESLint                                | exit0, no errors;12 existing/export FastRefresh warnings                                                                      |
| Full ESLint                                              | **exit1**,307 formatting errors /39 warnings; errors only in the four unchanged files below                                   |
| Whitespace/protected parity                              | diffcheck clean; AGENTS, package/lock, start, integrations and hotel-store byte-equivalent to input                           |
| New SQL checks                                           | 9 disposable single-session assertions; **not native multi-session proof**                                                    |
| Independent review                                       | One fresh reviewer; no Critical issues, two Important issues reproduced RED then fixed GREEN; no second reviewer pass claimed |
| Installed RPCs/schema, browser/mobile/live N3            | **NOT VERIFIED** for this source candidate                                                                                    |

The initial whole suite exposed13 failures: missing date/settings preflight fixtures, an outdated helper mock, and regression assertions not yet ported alongside the published asynchronous receipt refresh/recovery. Their assertions were preserved or updated to the already released behavior; all passed in the final suite. No failure is omitted from the final result.

Full-lint baseline errors, unchanged by hash/diff against the starting checkpoint:

| File                                                            | Errors |
| --------------------------------------------------------------- | ------ |
| `db/checks/hh-security-cash.mjs`                                | 88     |
| `db/migrations-pending/checks/receipt-controls.multisession.ts` | 51     |
| `db/migrations-pending/checks/receipt-controls.pglite.ts`       | 119    |
| `docs/evidence/HH_N3_RECOVERY_COUNTEREXAMPLES_20261008.mjs`     | 49     |

These are formatting errors, not a passing full-lint result. Existing evidence/check scripts were left intact; resolve or explicitly accept this debt before a whole-billing release. Logs for the baseline, RED cases, targeted checks and final commands remain in the preserved session workspace. No application dependencies or lockfile were changed.

## Review fix pass and decisions

1. **Pending navigation:** RED deferred success/error tests reproduced enabled remounted forms, lost completion/error and pending-tab discard in both action and Owner approval cards. GREEN uses matching flow IDs, retained pending/error fields, close blocks and hook-level callbacks. Whole suite passed after the fix. Cost if wrong: a local action could be submitted or discarded twice; live two-device/reload acceptance remains separate.
2. **Expiry clock:** RED disposable SQL returned success when the transaction-style property clock was a day behind actual wall clock. GREEN checks `clock_timestamp()` in the property's timezone after lock acquisition. This skew test proves clock-source behavior, not an actual native lock wait; native midnight/lock concurrency remains pending.
3. **Legacy overload test:** the two original overloads have defaults, so a direct six-argument SQL call is ambiguous. Only the disposable test DB aliases the exact six-argument implementation to exercise its body; production defaults were not changed. Seven-argument server calls and both guarded bodies were tested. Actual PostgREST overload/runtime behavior is still a release check.
4. **Integration:** port only the tested published receipt differences rather than replace whole files with the narrower release tree. This preserves broad billing/cash fences. Cost if wrong: source reconciliation could regress already released receipts; retained receipt regressions and full suite passed, live receipt UAT is not re-claimed.
5. **Review scope:** installed backend compatibility, native concurrency, signed-in browser behavior, N3 proof and release readiness were declined by the reviewer and remain explicitly pending. No source/mock result substitutes for them. No deferred Minor findings were reported.

Official technical references checked during the fix: TanStack Query mutation lifecycle documentation (`https://tanstack.com/query/latest/docs/framework/react/guides/mutations`); PostgreSQL datetime functions (`https://www.postgresql.org/docs/current/functions-datetime.html`).

## Remaining scope and next approval

The manual no-show transition and confirmed-folio/bill/payment workflow are **not implemented by this checkpoint**. Existing master/financial gates remain closed, source whole-stay close is unavailable and the required billing/accountant schemas are not installed. The new seven-task plan is at `docs/superpowers/plans/2026-10-14-billing-completion.md`; it reuses the previously approved foundations, adds own-identity Front Desk authority, actual single/split payment, matching recovery, guest/source close and accountant/print readers. Door access follows accepted billing.

The design approval on14/10 is recorded. Superpowers writing-plans requires review of the new execution plan before architectural implementation; the selected inline method is preserved. This is not another approval of the already implemented bounded fixes or old deposit work. Review-branch checkpoint push, operational SQL, N3 proof transactions, main integration and publication remain distinct lanes.

Pre-existing untracked adoption source and Supabase temporary directory were preserved. No cleanup/discard of earlier billing work or evidence was performed.
