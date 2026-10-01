# HotelHub navigation, card help and payment clarity checkpoint

Date: 01/10/2026 (Malaysia).

Status: The previous HH1.0 Hotel c6 correction remains PUBLISHED AND SOURCE VERIFIED at `c8dfc87f06ca01f51719b822322cdd209faf2527`. The newly approved saved-reservation deposit correction below is IMPLEMENTED AND VERIFIED LOCALLY, NOT PUBLISHED. Signed-in historical-reservation and N3 financial acceptance remain pending.

## Saved-reservation deposit correction — prepared 01/10/2026

- Owner approved the bounded design after reporting BK260920001's missing entry form and BK260925001's RM50 preview failure. This approval authorizes implementation; publication remains a separate release step under the recovery handover. The prior publication approval below was explicitly limited to that previous release.
- Fresh checkout started from the actual GitHub main and Lovable source `c8dfc87f06ca01f51719b822322cdd209faf2527`, rather than assuming any prior correction completed. Branch: `fix/deposit-saved-reservations`. Local checkout: `work/hotel-hub-deposit-correction` beneath this recovery workspace.
- Deposits now appears after Rooms, before Bill-to/Folio/Payment. Both the page and server allow saved Confirmed and Checked-in reservations; other statuses retain deposit history but cannot create a new deposit. Existing role, tenant and activation permissions still apply.
- The account picker and receipt preview share casing-aware N3 `/New` envelope handling, including `Data.Value`. Conflicting envelopes and malformed account defaults fail closed. A blank default account no longer blocks an explicitly selected payment method that is independently verified against N3; no missing currency, rate or receipt type is invented.
- Receipt-default errors now distinguish unavailable responses, business rejection, receipt type, currency, rate and account problems. The irreversible-posting warning appears only with a valid confirmation preview. Failed previews disable confirmation and do not call N3 Create.
- Small prerequisite typing correction: explicitly type the session response to restore authenticated-user narrowing under the installed React Query/TypeScript combination. Runtime authentication and permissions are unchanged.
- Regression coverage: 30 additional tests, including checked-in eligibility, card order, invalid and valid confirmation messages, PascalCase account-choice lookup, conflicting envelopes, malformed defaults and verified selected-account payloads. Each newly exposed review regression failed before its fix.
- Final verification: **1,603 passed / 20 existing skips**, 102 test files passed / 3 skipped. TypeScript no-emit and production build passed. Changed-source lint passed with 0 errors / 9 existing Fast Refresh warnings; formatting and whitespace checks passed. Whole-project lint currently has 8 errors / 32 warnings; every error file is unchanged. It is not green.
- Independent review: initial account-picker casing and malformed-account diagnostic findings resolved; no remaining Critical/Important findings. Build-generated route ordering was verified to contain identical line multisets and excluded.
- No schema, financial configuration, activation settings, secrets or real N3 financial documents were changed. All financial test responses were simulated.
- Limitation: the actual tenant `/New` response behind BK260925001's original error was unavailable. The exact live failure and a successful real deposit are not established by these tests. After publishing, perform a signed-in Owner preview check on both bookings; any real N3 posting remains separately authorized.
- Production remains the previous release until publication is approved and verified. This section supersedes earlier local candidate status for the new correction only; the historical publication record below remains valid.

## Approved c6 publication — verified 01/10/2026, 19:24 Malaysia

- Authorization: Owner “Approve” to publishing the reviewed correction to the existing HotelHub project, financial settings unchanged and no N3 transactions. This supersedes the earlier local-only release restriction for this publication only.
- Cloud execution stopped during source upload with “Your workspace is out of credits. Add credits to continue.” The local controller recovered the complete 26-file export from the recorded command output and verified every UTF-8 Git blob SHA before uploading the remaining blobs through the existing GitHub connector. No new Lovable AI build or project was created.
- Reviewed application/source/script tree: `a03af358759da76802811bb423ffb46e0d0f5d32`. Source preservation manifest SHA-256: `331ee3f2a2030a6316d30212dfa352f7e52c8a94f7c502e564c49fe229ab07e1`.
- Exact 26-file release tree, including the stable checkpoint: `55178efa0861b4b1d1c385f8c2e628ccebee0029`, identical to the recovered candidate tree. Release commit: `c8dfc87f06ca01f51719b822322cdd209faf2527`; parent: `53345af7b9ef000eefcbd62344d8508281bc04a4`. GitHub main advanced without force or history rewriting.
- GitHub main and Lovable latest source were re-read after publication; both equal the full release commit above. Lovable reports ready, agentFinished true, no project error, and the existing public publication audience.
- Deployment ID: `2d52e66d-7f24-44ec-abd9-507512a834b4`. Initial deploy response was pending. The public site subsequently returned HTTP 200 with an `x-deployment-id` containing this exact deployment ID at `/`, `/reservations`, `/reservations/calendar`, and `/housekeeping`. This confirms the requested deployment is serving production, independently of the initial pending response.
- Live URL: https://hotelrooms.lovable.app/ . The browser reached the expected “Sign in from N3” gate, with no captured browser error logs. Screenshot: `HH_RELEASE_LIVE_SIGN_IN.png`. These are unauthenticated release smoke checks, not evidence of signed-in UI behavior or financial settlement.
- The local browser could not access the private Lovable editor, and the private static preview returned Unauthorized. Neither is represented as a successful editor/preview acceptance check.
- Existing reviewed verification remains applicable because the published application/source/script blobs are unchanged: 1,573 tests passed / 20 existing skips; 39 fixture browser assertions passed; typecheck, production build and changed-file checks passed. Whole-project lint still has 15 errors in unchanged files.
- No financial settings, secrets, database/schema, or N3 financial documents were changed by this publication. No actual deposit, receipt, journal, refund or checkout transaction was performed.
- Pending: signed-in historical-reservation first-open/Add Deposit acceptance, signed-in tab/navigation acceptance, and separately authorized Owner-run N3 receipt/journal/replay proof. Publication does not establish an accepted financial baseline.
- This latest local checkpoint update is documentation only. It does not move the published source commit or initiate another deployment. Replace only this stable UI checkpoint in HH1.0 Project Sources when saving the handover; retain existing deposit/payment checkpoints.

## Current c6 work tabs and Add Deposit correction — 01/10/2026

### Exact checkout and authorization

- Owner approved the bounded correction build: “remember the [Add Deposit] button not function. Approve all.” The earlier recovery prohibited publication. The subsequent explicit Owner “Approve” authorizes publishing this correction to the existing HotelHub project, financial settings unchanged and no N3 transactions. No new project or Lovable AI build is authorized.
- Preserved checkout: `/workspace/scratch/a2fdfd89bcff/hotel-hub-deposit-public-release`.
- Actual branch: `agent/hh-work-tabs-deposit-form`.
- Recovered starting HEAD: `e2e0fffa8b6118a81f5e0341359c59ba1a92f11c`. Expected previous commits `6704b778261f64963bed00bdb9153ff81e783ec6` and `469f253973bafc2aaf536804d199daa48b304911` were absent from this restored execution snapshot. All correction files were preserved. New local correction commit: `c4611cdaf113dbca113f7deadc80350ce768cc45`, tree `a03af358759da76802811bb423ffb46e0d0f5d32`, exactly matching the previously reviewed product tree. No existing changes were discarded or published history rewritten.
- Fresh 25-file source manifest SHA-256: `331ee3f2a2030a6316d30212dfa352f7e52c8a94f7c502e564c49fe229ab07e1`, identical to the reviewed source. Full tests/build were not repeated because source bytes are unchanged and the controller verified the final command outputs.
- Previously recorded published GitHub/Lovable source: `53345af7b9ef000eefcbd62344d8508281bc04a4`, tree `3b6ab0f7a8464dc6acd6218039bffe433221c105`. GitHub main and Lovable latest source were freshly re-queried before publication and both still matched this SHA. Lovable was ready, published, with public audience.
- No earlier build, test or reviewer task was running at recovery inspection. The interrupted browser failure was present in `/tmp/hh-ui-final.log`.

### Current files and behavior

| Files                                                                                                                                                                                                                           | Local correction                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/AppShell.tsx`, `WorkTabs.tsx`, `WorkspaceHeader.tsx`; `src/routes/__root.tsx`; `src/lib/workspace-context.tsx`, `workspace-tabs.ts`                                                                             | Open work tabs, sticky main menu/tab strip/title, highlighted actual role beside the signed-in name. UI memory is scoped to tenant, actor, role and housekeeping mode. Unsaved close confirmation; pending/uncertain save or deposit intents cannot be closed.                                                                                        |
| `src/routes/reservations.$id.tsx`, `reservations.$id_.edit.tsx`; `src/lib/idempotency.ts`                                                                                                                                       | Compact reservation headers; retained existing reservation edit drafts and request identity. Save state survives switching; pending fields/discard are locked, completion does not steal the active tab, and lost-response replay sends the identical original payload/ID/version. Editor and deposit preview instances are keyed to the reservation. |
| `src/routes/reservations.index.tsx`, `reservations.calendar.tsx`                                                                                                                                                                | Retained list filters and calendar floor/collapse/scroll state. Last connected scrollbar position survives route removal.                                                                                                                                                                                                                             |
| `src/routes/housekeeping.tsx`, `src/components/HousekeepingBoard.tsx`                                                                                                                                                           | Property date/timezone inside the main title info; duplicate setup banner and board info removed. Needs attention and Not set up tiles retained. Filters survive tab switching.                                                                                                                                                                       |
| `src/components/DepositsCard.tsx`; `src/lib/deposit-entry.ts`, `deposits-client.ts`                                                                                                                                             | Add Deposit uses the entered payment line total; valid blur formatting `50 → 50.00`, `40.3 → 40.30`. Explicit loading/error/retry/Owner denial; split controls require server capability. Unknown response recovery uses an exact request ID and authoritative posted/failed result, never amount similarity or an automatic re-post.                 |
| `src/routes/api/hotel/reservations.$id.deposits.ts`; `src/lib/deposits-store.server.ts`                                                                                                                                         | Read capability reflects existing role/tenant/split gates. Browser DTO includes the original intent UUID from the existing idempotency column for exact recovery. No POST orchestration, financial verification, gate configuration, schema or migration change.                                                                                      |
| `src/lib/__tests__/deposit-entry.test.ts`, `deposit-capability.test.ts`, `workspace-tabs.test.ts`, `run-5d1-1-deposits.test.ts`, `wp1-ui-correction-housekeeping-workspace.test.ts`; `scripts/verification/hh-workspace-ui.cjs` | Input/gate/private UI memory regressions, exact intent metadata and rendered default housekeeping filter; real local components exercised through intercepted fixture APIs.                                                                                                                                                                           |
| `src/routeTree.gen.ts`                                                                                                                                                                                                          | Preserved generated ordering-only change: identical line multisets to HEAD, 571 insertions/571 deletions, no route-set change. This ordering-only diff is preserved in the correction commit.                                                                                                                                                         |
| `docs/HH_UI_NAVIGATION_HELP_CHECKPOINT.md`                                                                                                                                                                                      | This recovery checkpoint.                                                                                                                                                                                                                                                                                                                             |

### Recovery and final evidence

- Interrupted failure: calendar horizontal position returned `0` rather than `287` after switching tabs. Waiting for effects still failed. Trace showed a connected scroll event saved `287`, then detached effect cleanup read `0` and overwrote it.
- Minimal correction: only remember connected scrollports. Focused browser regression first failed `0` versus `200`, then passed. The full browser flow subsequently retained the original horizontal position.
- Code review also identified a cross-reservation confirmation preview risk. Keying `DepositsCard` by reservation ID removes the previous booking's mutation preview. The fixture switches review B `80.00` to review A `40.30`, requires a fresh read preview with Confirm disabled, and checks the correct amount.
- Full browser verification: **39 assertions passed**, 150 intercepted API requests, **zero real financial/N3 posts**. One simulated Create is held during a tab switch, then its response is deliberately lost; exact ledger reconciliation restores the form without a second simulated Create.
- Browser checks cover first-open deposit entry; Add Deposit enabling and exact derived preview payload; both decimal examples; split gate off; deposit/editor draft retention; dirty close/discard confirmation; locked pending/uncertain saves; identical lost-response edit replay after version advancement; direct cached editor/confirmation tab switching; fixed navigation/title geometry; actual role badge; 390px phone overflow; housekeeping title info/filter; calendar scroll; deposit read failure/retry; Front Desk denial. Desktop/phone fixture screenshots were visually inspected. These are fixture checks, not live authenticated acceptance.
- Final full suite: **1,573 passed / 20 existing skips**, 101 files passed / 3 skipped; exit 0.
- Final TypeScript no-emit and production client/server build: exit 0.
- Changed-file lint: **0 errors / 17 warnings** (Fast Refresh and existing memo dependencies), exit 0. Changed-file Prettier and `git diff --check`: pass.
- Whole-project lint: **15 errors / 32 warnings**, exit 1. All error files were verified unchanged relative to HEAD; whole-project lint is not green.
- Independent read-only review: no remaining Critical/Important findings. Previous pending-save/discard, stale-version retry, unknown deposit recovery, editor-instance and deposit-preview findings were addressed.
- Prior-run evidence logs (not retained in the restored filesystem; command outputs verified by the controller): `/tmp/hh-c6-browser-verified.log`, `/tmp/hh-calendar-recovery-green.log`, `/tmp/hh-c6-tests-final.log`, `/tmp/hh-c6-types-final.log`, `/tmp/hh-c6-build-final.log`, `/tmp/hh-c6-changed-checks.log`, `/tmp/hh-c6-whole-lint.json`.

### Remaining limits and next state

- Correction source was published with the exact reviewed source tree. The current release evidence is recorded above. Signed-in acceptance remains pending.
- Draft retention covers the tested existing reservation editor/deposit forms and workspace filters/scroll within the current authenticated browser session. Refresh, sign-out or scope change clears private UI memory.
- The exact live cause of old reservation deposit fields appearing only after Edit → Discard was not reproduced against the real backend. First-open loading, failure and permission states are covered by fixtures; live historical-record acceptance remains pending.
- No actual HotelHub-created N3 receipt/journal/replay proof was performed. Existing tenant/Owner-only/single-method financial guards remain unchanged. Split activation, Cash Memo, allocation, balance payment, refund and final checkout remain outside this build and incomplete.
- Publication is separately authorized. Live historical-record and financial acceptance remain pending; publication smoke checks cannot establish N3 receipt/journal correctness.

Project Sources: replace only this updated `HH_UI_NAVIGATION_HELP_CHECKPOINT.md` in HH1.0; retain the other existing deposit/payment-method checkpoints.

## Prior compact UI release and sandbox activation — historical, 01/10/2026

- Owner approval: “APPROVE ALL”, responding to the bounded publication plus sandbox-only deposit activation scope. This does not authorize production tenant activation, split posting, Codex-operated N3 transactions, Cash Memo/allocation/refund release or door-card work.
- Input main/Lovable release: `b10dc5e9037b338a989747f597d9d608e0f88eab`.
- Reviewed local checkpoint: `c2ad40275a506e01f7ac729615778a698d9c8001`; product-code candidate remains `3e1625641a76a8a098148edfe4dc41ff4626caa1`.
- GitHub main and Lovable synced source, re-read after release: `53345af7b9ef000eefcbd62344d8508281bc04a4`.
- Exact release tree: `3b6ab0f7a8464dc6acd6218039bffe433221c105`, identical to the reviewed local checkpoint. History preserved; no force push or unfinished checkout import.
- Changed files: 18 UI, UI-test and checkpoint files; 470 insertions / 426 deletions. No financial server, auth/session/RBAC, schema/types, migration, package or lockfile change.
- Fresh release verification: 1,548 tests passed / 20 existing skips; TypeScript no-emit and production build exit 0; changed-file lint exit 0 with 9 warnings. Full-project lint retains the recorded 15 unchanged formatting errors. Generated route ordering churn was checked for equal line multisets and restored.
- Backend: existing HotelHub Lovable Cloud, project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`, workspace `JRQygHE7tZl2GgPN8a8N`; database enabled. A targeted read-only query returned exactly one sandbox company match with immutable N3 tenant key present. No tenant key or credentials are stored in this document or Git.
- Existing server-only configuration saved through Lovable Cloud Secrets: `HOTELHUB_N3_DEPOSIT_WRITE_TENANT_ALLOWLIST` contains only the verified immutable key of **MUGS AI LAB TEST SDN. BHD.**; `HOTELHUB_N3_DEPOSIT_WRITES_ENABLED` is `true`. Saved names appeared in the project secrets list. The existing gate requires both settings and exact tenant-key equality; empty or nonmatching tenant keys deny. All other tenant keys remain excluded. No split-payment enablement was added.
- These are feature configuration values, not new authentication credentials. Existing authentication secrets were not opened or changed. No database mutation/migration, Lovable AI build or N3 operation occurred.
- Lovable states that changed secrets apply immediately in preview and require publication for live use. Both settings were saved BEFORE publication.
- Deployment ID: `8826a0e8-9480-4286-8197-2a8a18ea6a71`. Plugin returned pending; subsequent editor confirmed “Your website was updated”, then “Published” / “Your website is up to date”, with Publish changes disabled.
- Public URL: https://hotelrooms.lovable.app/ . Preview and public page both loaded the N3 sign-in gate after refresh. Lovable project reports ready with no project error.
- Screenshot evidence: `hh-compact-ui-published-confirmed-20261001.jpg`.

Result: **PARTIALLY ACCEPTED**. Engineering, source sync, configuration submission and public publication are verified. Actual signed-in responsive layout, sandbox capability flag, non-sandbox runtime denial and first deposit receipt/journal/replay acceptance remain **NOT VERIFIED**. Configuration/publication must not be described as proven financial settlement.

**Next action:** Owner opens HotelHub from **MUGS AI LAB TEST SDN. BHD.** in N3, chooses one eligible reservation and one shown bank/cash method, and creates one small deposit (for example MYR10) once. Capture the resulting status/reference/receipt ID. If the result is pending or uncertain, use only Check N3/reconciliation; do not create another deposit. The controller then verifies the HotelHub ledger, exact receipt and balanced journal evidence read-only. Cash Memo, knock-off, balance payment, refund and final checkout remain incomplete.

Project Sources: replace only this updated `HH_UI_NAVIGATION_HELP_CHECKPOINT.md` in HH1.0; retain the two existing deposit/payment-method checkpoint files. Publication does not constitute a new formally accepted financial baseline.

## Compact workspace correction preparation — historical, 01/10/2026

Latest explicit Owner request specifies Tools grouping, compact page headers and filters, clearer 30-day scrolling, housekeeping notice placement, removal of the Rooms & Rates Property Settings pointer, more dashboard colour, and priority completion of N3 integration today. This candidate implements the bounded existing UI corrections only. It does not activate financial writes or claim the financial integration is complete.

### Exact state

- Fresh GitHub main and Lovable source input: `b10dc5e9037b338a989747f597d9d608e0f88eab`.
- Deployed release recorded previously: same SHA, deployment `3a0c9001-737c-420b-8e22-df5383f68a3e`; authenticated UAT remains incomplete.
- Finance-specific formally accepted checkpoint in the active master: `75ceac11089936778b672c438d3a103b4715609a`; this proves posting-mapping parity, not financial settlement.
- Tested product-code candidate: `3e1625641a76a8a098148edfe4dc41ff4626caa1`.
- Isolated branch: `agent/hh-compact-tools-calendar`.
- No push, merge, Lovable AI build, public publish, DB/secret change or N3 operation during this correction. A later read-only Cloud tenant identity query is recorded below.

### Changes and classification

| Requirement                                                      | Local state                                                                                                                 | Live state                        |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Tools → Rooms & Rates / Settings / Full Width checkbox           | Implemented; rendered permissions/grouping regression passes                                                                | Not verified                      |
| Existing width preference, checked = full / unchecked = standard | Implemented using existing browser preference hook                                                                          | Not verified                      |
| Desktop menu cannot wrap; smaller screens use compact top menu   | Implemented; no fixed sidebar                                                                                               | Responsive visual not verified    |
| Compact badge/title/info/action header                           | Implemented; naturally wraps where phone width requires it                                                                  | Responsive visual not verified    |
| List / Calendar segmented control inside Filters                 | Implemented; filter controls use two compact desktop rows                                                                   | Not verified                      |
| 30-day calendar horizontal movement                              | Implemented; seven-day arrows, synchronized top scrollbar, sticky date/room headings, narrower label column, viewport bound | Mouse/touchpad/swipe not verified |
| Room display name and maximum guests                             | Preserved; stock code remains in room information                                                                           | Not verified                      |
| Housekeeping setup warning beside main title                     | Implemented from authoritative global board count; explanation in info                                                      | Not verified                      |
| Housekeeping and static page/card explanations                   | Moved into info; errors/actions/operational notices remain visible                                                          | Not verified                      |
| Rooms & Rates Property Settings pointer                          | Removed; actual property settings remain in Settings                                                                        | Not verified                      |
| More colourful dashboard cards                                   | Implemented; counts, queries and permission gates unchanged                                                                 | Visual not verified               |

Additional static descriptions on New Reservation, Departures, Dashboard, N3 Verification, N3 Financial Verification, Guest controls and Housekeeping workflow now use info. Dynamic reservation status, read-only notices, payment blockers, errors, confirmation actions and data fields were preserved. The financial console keeps a visible Read-only badge.

### Engineering evidence

- Baseline suite: 1,544 passed / 20 existing DB skips.
- Final full suite: **1,548 passed / 20 skipped**, 98 files passed / 3 skipped, exit 0.
- TypeScript and client/server production build: exit 0.
- Changed-file lint: 0 errors / 9 existing Fast Refresh and memo-dependency warnings.
- Whole-project lint: 15 pre-existing formatting errors / 28 warnings; all error paths verified unchanged. Full-project lint is not green.
- Changed-file formatting and diff checks: pass.
- Four new regression checks: Tools grouping/permissions and scrollbar smooth-frame echo, subpixel echo, user top-track movement. The synchronization tests failed against unconditional assignments and passed with the guard.
- Calendar minimum-readable-font regression initially failed after compact labels; restored labels to text-sm, focused and final suites pass.
- Generated route ordering churn verified by identical line multisets and restored; no new route or route-set changes.
- Independent read-only review found a reciprocal-scroll assignment could cancel smooth arrows, mismatched scrollbar extents, and mobile Escape propagation. All findings addressed and re-reviewed; no remaining Critical/Important/Minor code findings.
- Top track matches main clientWidth using ResizeObserver; each range replaces both tracks and rebinds measurement. Equal-position/subpixel echoes do not assign back to a smooth-scrolling main track. Mobile Tools expands inline in a bounded popover; Escape closes Tools before its parent.
- No browser-based proof of actual geometry, smooth animation, resize, touchpad/swipe, checkbox persistence or signed-in tenant behavior is claimed. The environment has no installed browser suitable for this local preview.

### Financial inspection and the next dependency

Current published lineage contains only the gated deposit writer plus read-only Prepare Checkout. Deposit preview/Create require the existing server-only enablement flag and immutable-tenant allowlist; split payment has a separate unproven-contract gate. Payment-method loading is not evidence of receipt creation or settlement.

The recovered checkout branch remains separate at `a92d9234f8aceaa34c6e4a34976d8956225f3ef4`. A candidate untracked migration `20260930210000_hh_checkout_posting_ledger.sql` is now present there; its provenance/application/acceptance is not established. It was inspected read-only and not imported, edited, applied or deleted. It does not establish a functioning durable store or mounted financial workflow. Its first-field-wins validators remain unsuitable for release.

Required financial completion sequence remains: advance Receive Payment → Cash Sale with Post to AR (Cash Memo) → verify document/journal → apply eligible deposits → verified balance receipt/allocation → approved excess refund → prove settlement → atomic checkout/room Dirty handoff. No fixed completion time can be asserted before sandbox acceptance.

**Sandbox target checked read-only:** Lovable project remains `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`, database enabled, Supabase stack. A targeted tenant query found exactly one match: **MUGS AI LAB TEST SDN. BHD.**, with local tenant ID, tenant code and immutable N3 tenant key present. No other tenant list, credentials or secret values were output. The gate must use this server-side immutable key, not the display name or browser input. No N3 call was used to identify it.

**Next bounded release/proof scope:** publish the reviewed UI correction and activate the existing single-account deposit gate only for MUGS AI LAB TEST SDN. BHD., for one Owner-run HotelHub deposit test. All other tenant financial gates remain closed; no split activation, migration, allocation or refund release.

**Controlled HotelHub-created sandbox deposit proof:**

- Included: verify the server-resolved owner-designated sandbox identity; activate the existing single-account deposit gate for that sandbox only through the approved server configuration lane; Owner operates one HotelHub deposit with a chosen eligible account; confirm immutable receipt ID, exact customer/currency/amount/reference/account, fully unapplied amount and balanced journal; confirm reload/replay does not create a duplicate; GET-only recovery for an unknown result.
- Excluded: production-tenant activation, Codex operating N3, split-posting activation, automatic allocation/refund, DB migration and door-card integration.
- Frozen: N3 identity/session, tenant/role controls, receipt verification, financial no-blind-retry rules and existing account choices.
- Acceptance: HotelHub ledger and N3 receipt/journal agree; uncertain evidence stays blocked; no second POST on replay; exact deployed SHA and sandbox/role/test evidence recorded.
- Server configuration activation and release require the Owner's separate authorization. Keep N3 operation Owner-run as instructed in the financial master; do not request credentials or repeat completed manual N3 tests.

Door-card vendor contact may proceed independently with exact writer/lock model, card technology, supported USB SDK/protocol, OS/driver requirements and licensing. No hardware implementation or vendor message has been performed.

Project Sources: replace only this stable UI checkpoint in HH1.0 if saving the local candidate history. Keep the deposit/payment checkpoints. This record is HotelHub-specific and must not be uploaded to unrelated product sources.

## Prior UI release evidence — historical

- Owner approval: 01/10/2026 09:17 Malaysia, “approve. (uploaded 3 md files since this morning.)”, following the concrete UI source/merge/preview/publish gate.
- Full test suite repeated before source upload: 1,544 passed, 20 skipped; exit 0.
- Uploaded source tree: `17e418fb403c3fcee4447925c0fd2b8c0770eb3f`, exactly equal to the reviewed local checkpoint tree.
- GitHub main release: `b10dc5e9037b338a989747f597d9d608e0f88eab`, parent `6feacf349df10ec30e00d1cb5229f0256f35f2b7`. History-preserving fast-forward; no force update.
- GitHub main pointer and Lovable latest commit re-read after publication: both exactly `b10dc5e9037b338a989747f597d9d608e0f88eab`.
- Lovable deployment ID: `3a0c9001-737c-420b-8e22-df5383f68a3e`. The initial plugin result was pending. Subsequent editor UI confirmed “Your website was updated”, then “Published” / “Your website is up to date”, with Publish changes disabled.
- Preview and live website loaded HotelHub's N3 sign-in gate successfully. Verified live URL: https://hotelrooms.lovable.app/ . This is a release smoke check, not authenticated navigation, reservation or financial UAT.
- Publication evidence screenshot: `hh-ui-published-20261001.jpg`; chat hidden; Published/up-to-date state visible.
- The release contains UI, rendered-component tests and checkpoint documentation only. No auth/RBAC, server/API, schema, dependency, environment, secret or N3 financial-write change.
- This post-publication checkpoint update is a local documentation-only follow-up. It does not move the published application commit or trigger another application deployment. Replace only this existing checkpoint in Project Sources; retain the other two morning checkpoint files.
