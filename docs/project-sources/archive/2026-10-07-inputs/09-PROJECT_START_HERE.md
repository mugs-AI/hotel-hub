# PROJECT_START_HERE

## HotelHub HH1.0 — Current Controller Summary

**Pack version:** 29/09/2026, Asia/Kuala_Lumpur  
**Repository / branch:** `mugs-AI/hotel-hub` / `main`  
**Verified GitHub main SHA:** `ebc0eff6df5eac6dabc20d1be81cd5e10301fd5a`  
**Production:** `https://hotelrooms.lovable.app`  
**Latest production deployment ID:** `440c804f-204e-475a-ac6f-764df581003f` (public HTTP response matched; Lovable source SHA `ebc0eff6…`)  
**Latest bounded checkpoint:** HH-GOLIVE-01G current-main and live-parity audit — **COMPLETED**  
**Go-live result:** **BLOCKED** pending authenticated live parity, operations closure and financial settlement completion.  
**Active work:** a separately approved local receipt/journal read-back candidate is complete; HH-GOLIVE-01H remains separate.

**27/09/2026 local source checkpoint:** Local commit `b32a519` contains the rebuilt N3 bank/cash account selector, Owner display labels, immutable payment-line snapshots, matching migration `20260927120000_hh_payment_accounts_and_lines.sql`, and a separate split-posting gate. Local build and TypeScript passed; 116 focused financial tests passed and changed-file lint has no errors. GitHub `main` now points to `495b90d900a44bc9b5297d24ca07529b45aff23e` (three equivalent fast-forward commits created through the GitHub integration). Its final tree `719e5932b501bda74d88a6937806e3726b27922d` exactly matches the tested local `b32a519` tree. The commit IDs differ because the connected integration created new GitHub commits. No migration, deployment or HotelHub N3 Create occurred. N3 Cloud UI evidence for split receipt and balanced journals remains distinct from HotelHub API proof. Keep split posting disabled pending tenant Create/read-back and GL verification. The 23/09 repository/deployment pointers below remain historical audit snapshots.

**Owner workflow decision, 27/09/2026:** Do not log in to N3 or operate N3 Cloud/API on the Owner’s behalf in future HotelHub work. Hand every N3 job to the Owner as a short, exact test list with expected account debits/credits and required read-back evidence. Codex handles HotelHub source, safe local checks, and analysis of the Owner’s returned N3 results. Never request N3 credentials in chat or repeat the Owner’s completed Cloud UI matching/refund tests. The attempted N3 browser sign-in was rejected once, with four attempts remaining; no API receipt was created.

**Owner evidence update, 27/09/2026:** The owner has completed N3 UI single receipt `OR2609/003` (Public Bank MYR10; Dr bank/Cr customer MYR10), split receipt `OR2609/004` (Maybank MYR7 + Public Bank MYR8; Dr both banks/Cr customer MYR15), and balanced journal checks. The receipt UUIDs are in N3 detail URLs and in the owner's custom print-preview heading; a reporting task URL is not the receipt UUID. The owner confirms `OR2609/002` knocked off `CS2609/001` by MYR150, with printed Payment Details; CS001 showed MYR114.02 outstanding. OR003 and OR004 are unapplied. See `03-HOTELHUB_N3_FINANCIAL_POSTING_KNOCKOFF_MASTER_RECORD.md` for exact UUIDs, accounts and evidence limits. Do not request backend database access, UI-created receipt API response JSON, or repeat these UI tests. HotelHub's own future Create response and authenticated receipt/journal GETs are separate proof; split posting remains disabled.

**28/09/2026 local read-back candidate:** Product Owner approved local build only. Branch `hh-receipt-journal-readback`, commit `72fa776973bc7f6c25d0f33f58db6c7164854710`, from `b32a519`. It requires receipt detail and balanced GL journal read-back before a new local deposit becomes `posted`; uncertain evidence remains `unknown` with the known N3 identity retained and GET-only recovery. 42 focused tests, TypeScript, changed-file lint, diff check and build passed. The actual tenant GLPosting response shape has not been observed through HotelHub. No N3 call, migration, push, merge, deployment or release; split posting remains disabled. See financial master record for exact evidence boundary.

**28/09/2026 published-app incident (MIGRATION APPLIED; OWNER UI RECHECKED):** Owner published `https://hotelrooms.lovable.app` and reported Settings (except User Control and Booking Sources), Housekeeping, Departures and BK260925001 detail failing while the reservation list renders. Direct authenticated `GET /api/hotel/settings` returned HTTP 500 with HotelHub's generic catch page. The Owner supplied the 28/09/2026 10:00 Malaysia-time Lovable Server log: `hotel_settings read failed: column hotel_settings.payment_account_aliases does not exist` (ray `a41f26e3ee969245`). Verified GitHub source at Lovable-reported latest SHA `495b90d900a44bc9b5297d24ca07529b45aff23e` selects that column in `src/lib/hotel-store.server.ts`. The live database is missing both `hotel_settings.payment_account_aliases` and `hotel_reservation_deposits.payment_lines`, and its migration ledger lacks `20260927120000`. The exact source migration adds these columns and extends the existing deposit immutability trigger. The same tenant (`9AC-0D9-2F1`) has one property-settings row and BK260925001 with one room and one guest; there are zero existing HotelHub deposit rows and zero pending housekeeping handoffs. This schema drift **proves the Settings failure** and is a strong shared-cause explanation for Housekeeping, Departures and reservation detail because those paths read settings; verify each after migration rather than claiming they are already fixed. The local receipt/journal read-back candidate `72fa776` is not deployed. No N3 action is needed. The Owner explicitly approved only migration `20260927120000`. It was applied to Hotel Hub project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76` in one database transaction on 28/09/2026; the matching ledger row exists, both expected columns have the correct JSONB types/default/nullability, the deposit immutability function protects `payment_lines`, and the tenant settings row reads an empty `{}` alias map. A PostgREST schema refresh was requested. There were zero deposit rows before and after. No N3 action, code publish, or other migration occurred; `20260925160000` remains unapplied. Owner screenshots later showed all four operational pages rendering, with Departures succeeding after reload. The initial >1-minute Departures delay remains unmeasured and may recur. Published deployment SHA remains unproven beyond the source and runtime log evidence.

**28/09/2026 Owner UI check and header candidate:** The Owner's screenshots show Settings Property, Housekeeping, Departures after browser reload, and BK260925001 detail rendering following the approved schema migration. Departures initially loaded for more than one minute, then succeeded on reload; no repeatable server cause or first-load latency measurement has been established. The header still displays `—` for Company because the permission-neutral launch deliberately skips Owner-only N3 BasicInfo and the tenant row has a null `company_name`. An isolated local candidate `hh-company-header` at `8b79f20695332a723ee688106fda5b3420fe339f` (from tree-equivalent `b32a519` / GitHub `495b90d` source) lets a current N3 Owner perform a bounded, optional, read-only BasicInfo sync after launch, verifies immutable tenant identity, saves only the scoped company display name, and lets staff sessions read the saved value. It does not require staff Company Profile permission, N3 login by Codex, N3 posting or a migration. Local build, TypeScript, changed-file lint/diff check and 14 focused tests passed. This candidate is not on GitHub main and is not published. No live header outcome is yet proven. A production publish requires the separate source-release authorization. If Departures is slow again, capture the failing request timing and server log before changing its checkout path.

**28/09/2026 20:20 MYT header correction (local candidate):** The Owner's new production screenshot still shows Company `—`, tenant `9AC-0D9-2F1` openly beside Company, and user email `QNE.MUGS@GMAIL.COM` in the visible User slot. This is expected from the still-published older source: the previous company-name candidate `8b79f20` was local only and was never merged or published. The same bounded branch `hh-company-header` now has final local commit `e26361f00437e18bdf40de55710c8f6b84bfc1c2`: Owner-only optional N3 BasicInfo sync saves the validated tenant company name; an Owner N3 Users read matches their exact immutable user ID to obtain a human display name, with BasicInfo as fallback; staff read only their own tenant-scoped saved name or validated session name. Email-shaped strings never become visible names. The header shows the company and user display name, with the tenant code/N3 tenant key and email separately behind [i] popovers. No N3 token or upstream body reaches the browser. GitHub `main` remains `495b90d900a44bc9b5297d24ca07529b45aff23e`; its tree matches the candidate's starting tree `b32a519`. Local TypeScript, changed-file lint/diff check, 16 focused tests and production build passed. No migration, N3 login by Codex, N3 write, GitHub push, merge or Lovable publish. Exact live company/person names remain to be checked by the Owner after a separately authorized release.

**28/09/2026 20:40 MYT authorized header release:** Product Owner explicitly authorized push, merge and Lovable publication of the header candidate. Remote GitHub `main` was verified at `495b90d900a44bc9b5297d24ca07529b45aff23e` with tree `719e5932b501bda74d88a6937806e3726b27922d`, equal to tested local base. Direct Git push lacked local HTTPS credentials, so the connected GitHub integration created a single commit `9832d5b9a32d5cb7c1e9c70444a59fdea107e8ea` with parent `495b90d` and tree `b5d9aca48dd4f8a7ec0a0fab63b9326ee46a2917`, exactly equal to tested `e26361f` tree. The nine changed paths matched the reviewed diff. Named remote candidate `hh-company-header-release` was one commit ahead and zero behind; `main` was fast-forwarded without force and independently compared identical to candidate. Lovable project `Hotel Hub` (`d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`) loaded exact SHA `9832d5b`, and publish was invoked for `https://hotelrooms.lovable.app`; it returned `status: pending`, deployment ID `71319485-b806-463d-b444-b32cab09e78e`. A later project read showed ready project state and current source SHA, but not a definitive deployed SHA. Direct HTTP verification from the current workspace timed out; therefore do not claim live header acceptance yet. No new database migration or N3 login/write by Codex. Owner to confirm after deployment: visible company and actual user name; tenant identifiers/email only in their [i] panels; one staff reload without Company Profile permission.

**28/09/2026 20:53 MYT batched local checkpoint:** The Owner's post-release screenshot proves the N3 company name now renders as `MUGS AI LAB TEST SDN. BHD.` and the tenant identifier is behind Company [i]. The User slot still says `Sync N3 name`. A tenant-scoped read-only database check found both recorded N3 user `display_name` fields contain email-shaped login IDs, so HotelHub cannot honestly display a human name from those values. On current production `main` SHA `9832d5b`, the Owner may see a retry label until a real name is supplied; email remains in User [i]. Two local branches were prepared without N3 operation or production mutation. Safe UI candidate `hh-dashboard-names` at `d4cada5` adds a permission-scoped arrivals/departures/housekeeping dashboard and Owner-editable HotelHub display names in Settings → User Control, keyed only by immutable N3 user ID and scoped tenant, with same-origin and fresh N3 Owner checks. The chosen name persists across relaunch; this changes neither N3 username/email nor HotelHub role. Integrated finance candidate `hh-batch-next` at `d0d0fc9` adds the separate receipt detail/balanced-GL read-back guard from `72fa776` on top of those UI changes, but is NOT approved for release until the tenant's actual N3 API result/journal shape is proven. Safe UI candidate typecheck, 41 focused tests, changed-file lint (one pre-existing Fast Refresh warning), diff check and production build passed. Integrated candidate 79 focused tests, typecheck, changed-file lint and production build passed. No GitHub push, migration, Lovable publish or N3 write for these candidates. Do not mark CashMemo/knock-off/refund/checkout as implemented.

**28/09/2026 23:33 MYT authorized dashboard/name release:** Product Owner explicitly authorized one combined GitHub merge and Lovable publish of safe UI candidate `hh-dashboard-names` (`d4cada56e420b726c172f0a0c84d220520a8ba78`). GitHub `main` and Lovable source both began at `9832d5b9a32d5cb7c1e9c70444a59fdea107e8ea`. The connected GitHub integration created release commit `ea0ad70bbcc78ace3de986dbc2c583132bdc7d5b`, parent `9832d5b`, tree `df2f079061b32774f25ab8e784d1ed73907ec04f`, exactly equal to the tested local tree. The 14 changed paths were reviewed; named candidate `hh-dashboard-names-release` was one commit ahead and zero behind. `main` was fast-forwarded without force and compared identical to the candidate. Lovable project `Hotel Hub` (`d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`) then reported exact source SHA `ea0ad70`, and the one requested publish for `https://hotelrooms.lovable.app` returned `pending`, deployment ID `1afd89ac-6e9f-479a-be90-bcf0353b0c59`. This is a publish request, not yet independent proof of live deployed SHA or Owner/staff behavior. No migration, N3 login/write, or financial read-back code was included. Previous manual Lovable publishes did not alter GitHub history; a published version and GitHub source could differ if published before source alignment, so record both exact SHA and deployment evidence.

**28/09/2026 23:50 MYT folio print correction candidate (LOCAL ONLY):** The Owner's five available screenshots show the current guest folio: print dialog set to A4 with 150% scale and browser headers/footers on, resulting in much larger type and wrapping than the on-screen A4 sheet after cancel. No separate three invoice sample images were present in this turn. Local branch `hh-folio-invoice-print`, commit `5e1028d172755cdc4d82987776a3560a14c668e3`, tree `44a93baf4005e4f27f571b0628785f1cf3b6a8f8`, starts from tested `d4cada5` tree `df2f079` (equal to released GitHub `main` `ea0ad70` tree). It gives screen and print one 210×297 mm A4 box with 16 mm internal margin, fixed invoice-style numeric columns and currency heading, concise room-night/date lines, compact totals, 8.5 pt body and 5 pt note defaults, two signatures, optional company address/phone/email, and an Owner-controlled property-wide print setting. Printer 150% scale and browser-supplied headers/footers are outside app control; use A4/100% and disable browser headers/footers for matching output. Matching migration `20260928235000_hh_folio_print_typography.sql` adds five settings columns with defaults/checks; generated types, server validation and tenant-scoped settings/UI are included. TypeScript, 43 focused tests, changed-file lint (no errors; existing Fast Refresh warnings), diff check and production build passed. Real A4 printer/PDF visual acceptance has not been observed. This commit is local only. Do NOT push/merge/publish before separately authorizing and applying the exact migration before code deployment; do not repeat the September missing-column incident. No N3 work, finance read-back or settlement change.

**29/09/2026 08:50 MYT authorized folio release:** The Owner replied `continue` to the immediately preceding exact folio migration/verification/GitHub merge/Lovable publish gate. Before mutation GitHub `main` and Lovable source both matched `ea0ad70bbcc78ace3de986dbc2c583132bdc7d5b`; tested local parent tree matched remote `main` tree `df2f079061b32774f25ab8e784d1ed73907ec04f`. Live Hotel Hub project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76` had none of the five new columns or three constraints and no `20260928235000` ledger record. The exact migration was applied in one database transaction with a matching ledger record. Read-back showed five correct types/defaults/nullability, all three checks, and all 10 existing hotel settings rows with 8.5/5 pt and empty contact defaults; `select pg_notify('pgrst','reload schema')` requested PostgREST refresh. No N3 action or financial data mutation. The connected GitHub integration created release commit `fbf8525341a703f7bd71ac63641ca0699487af8a` with parent `ea0ad70` and tree `44a93baf4005e4f27f571b0628785f1cf3b6a8f8`, exactly equal to tested local `5e1028d` tree. Remote `hh-folio-invoice-print-release` was one commit ahead, zero behind with exactly the 10 reviewed paths; `main` was fast-forwarded without force and compared identical. Lovable then reported source SHA `fbf8525` and one publish was requested for `https://hotelrooms.lovable.app`; response `pending`, deployment `cc1318e3-79f5-407c-909d-0e5b150616fb`. Source sync is proven; final live deployed SHA and physical/PDF print appearance remain Owner acceptance checks. Historical local-only paragraph above records the state before this release.

**29/09/2026 urgent Departures/folio candidate (local only):** Owner screenshots prove the dashboard Overdue occupied count 1 linked to Departures' default Today bucket 0, while the Overdue and All buckets contained BK260920001. The bounded candidate `3d504d1f0dc541349b4fb49f89870199d88b92fd` on local `hh-folio-invoice-print` starts from the tree of GitHub `main`/Lovable source `fbf8525341a703f7bd71ac63641ca0699487af8a`. Dashboard links to the selected Overdue bucket; Departures preserves bucket in URL, shortens status/action, makes booking clickable and shows a secondary checked-in line. Guest folio card and A4 print remove internal room stock code and repeated line metadata, put the stay date on the first line in a box, strengthen the prepared total, show Bill to name/company/address/phone/email, and put hotel signature left with guest signature/name right. Reservation and checkout screens mount a collapsible, tenant-scoped bill-to editor; a new `hotel_folio_bill_to` table and matching generated type require migration `20260929090000_hh_folio_bill_to.sql` before code deployment. Settings explains invalid combined email/social text; the user must save a valid single email to show hotel contact address. Focused bill-to security tests, all 1,469 passing tests (20 skipped), TypeScript, production build and diff check pass; final visual print and live role/tenant checks remain unverified. **No GitHub push, Cloud migration or Lovable publish was performed for this candidate.** N3 remains Owner-operated. Door-card vendor/model/encoder/card type/SDK/OS/licensing/key custody/test kit are still unproven, so a working physical link cannot yet be claimed or safely built; request those exact artifacts from the vendor.

**29/09/2026 approved urgent Departures/folio release:** Owner's `Approve` applied to the exact migration → GitHub main merge → Lovable publish gate, without N3 login/posting or financial workflow expansion. Preflight GitHub `main` and Lovable source both matched `fbf8525341a703f7bd71ac63641ca0699487af8a`; local candidate parent tree `44a93baf4005e4f27f571b0628785f1cf3b6a8f8` equalled released parent tree. The Hotel Hub database had no `hotel_folio_bill_to` table or `20260929090000` ledger row. Applied exact migration `20260929090000_hh_folio_bill_to.sql` in one transaction with the ledger row and PostgREST schema notification. Read-back: ledger count 1, table present, RLS enabled, service-role select/insert/update allowed, authenticated direct select denied, check/PK/composite tenant-reservation FK present. Connected GitHub release branch `hh-departures-folio-billto-release` contains one commit `ebc0eff6df5eac6dabc20d1be81cd5e10301fd5a`, parent `fbf8525`, tree `7e50f3cf18af890f7128572dc3d6001a612dbc7b` exactly equal to tested local `3d504d1` tree; 17 reviewed paths, one ahead/zero behind before the non-force main fast-forward. GitHub `main` and Lovable loaded source both verified `ebc0eff6…`, then one Lovable publish requested deployment `440c804f-204e-475a-ac6f-764df581003f`. Public `https://hotelrooms.lovable.app` responded HTTP 200 with that exact `x-deployment-id`; anonymous bill-to GET returned 401. This proves source/deployment identifier and unauthenticated denial, **not** signed-in print layout or role/tenant UAT. Owner must test Overdue navigation, booking link, bill-to save and A4 folio appearance. Door-card physical integration remains discovery until vendor artifacts/kit arrive; N3 stays Owner-operated. The preceding local-only paragraph is the historical pre-release checkpoint.

## 1. Product purpose

HotelHub is a multi-tenant boutique-hotel PMS launched from N3 AI Cloud Accounting. Initial property is one building with approximately 20 rooms. Café/retail stays in N3 Cloud POS and does not charge hotel rooms in current scope.

## 2. Read these sources

For a new chat, read:

1. this file;
2. `04-HOTELHUB_BASE_INDEX.md`;
3. `05-VERIFIED_BASELINE_CURRENT.md`;
4. `08-HOTELHUB_PRODUCT_DECISIONS.md`;
5. `02-HOTELHUB_COMPLETION_PLAN.md`;
6. the specialist record for the task;
7. `10-LOVABLE_GOVERNANCE.md` before any mutation.

## 3. Current verified checkpoint

- Local `main`, local `origin/main` and read-only remote GitHub `main` all resolved to `4d46404e949499840f481a9379a673ec1e03661d`.
- Repository working tree was clean before and after HH-GOLIVE-01G.
- Production returned HTTP 200 and exposed deployment ID `c8714cc4-d944-47c5-b98c-ae4a91993687`.
- Production client bundles contain the HH-GOLIVE-01E deposit/early-check-in messages and HH-GOLIVE-01F N3 StockMaster room-import contract.
- Anonymous requests to protected rooms, reservations, housekeeping, settings and departures APIs returned `401 unauthenticated`.
- The production deployment does not expose an exact Git commit identity. Client markers prove partial parity, not complete server parity.
- No BEC connector, licensing enforcement, BEC credential, BEC table or BEC migration exists in current HotelHub source.

## 4. Current capability position

### Implemented or preserved

- N3-only launch and server-held session foundation.
- Server-derived tenant, actor and effective role.
- Deny-by-default Owner, Front Desk and Housekeeper permissions.
- Rooms, rates, reservations, guests and room assignments.
- Check-in and approved in-stay operations.
- Housekeeping lifecycle, readiness and DND foundation.
- N3 tax selector, rate normalization and authoritative settings refresh.
- Prepared folio calculation, extras, discounts, taxes and rounding presentation.
- Stable professional extra colours and Tax % display.
- Print Folio fast path; accepted Product Owner timing remains 11 seconds for its historical bounded release.
- Deposit AR Receive Payment vertical, gated by an administrator-controlled tenant allowlist.
- Prepare Checkout as a read-only calculation and evidence screen.

### Not yet accepted for full go-live

- Exact deployed server tree equal to GitHub `4d46404…`.
- Fresh authenticated Owner, Front Desk, Housekeeper and cross-tenant matrix.
- Successful post-correction live UAT for Early Check-in.
- Successful post-01F room import proving N3 Category → Type, Group → Floor, Class → Max Guests, Stock Name → Display Name and List Price → Base Rate.
- Approved-tenant live deposit evidence.
- CashMemo/Post-to-AR, deposit allocation, balance receipt, refund and final checkout.
- Maintenance/out-of-service.
- Complete reports, monitoring, backup/recovery and support acceptance.
- Promotion/rate-plan module and its approved product contract.

## 5. Frozen foundation

Do not change without a proven defect and approved scope:

- N3-only identity;
- server-held encrypted N3 token and secure HttpOnly HotelHub session;
- server-resolved tenant and actor;
- active N3 user/current Owner validation;
- roles `owner`, `front_desk`, `housekeeper` only;
- non-owner HotelHub allowlist/role assignment;
- no browser Supabase Auth;
- service-role/database secrets server-only;
- tenant-scoped access and immutable N3 IDs;
- no blind retry for unknown financial writes;
- GET-only reconciliation;
- DD/MM/YYYY user-facing dates;
- approved folio/tax/reversal/print behavior.

## 6. Recurring bugs to prevent

- Wrong N3 tax scale (`0.1` displayed/calculated as `0.1%`).
- Discount reduces the visible charge total but not the taxable basis.
- Rounding appears as both an itemized line and a footer total.
- Two extras receive the same visual identity without being the same catalogue item.
- Selector appears changed but browser never sends/saves the mapping.
- Readiness uses stale cache after a successful save.
- Room import trusts the stock list summary instead of authoritative StockMaster detail.
- N3 Stock Group/Class text is guessed into numeric Floor/Max Guests.
- External N3 verification blocks normal printing.
- Lovable says “up to date” while tracking an old branch.
- Candidate, GitHub `main`, Lovable source and deployed server are treated as identical without proof.
- N3 label/name is used as authority instead of immutable ID.
- User-visible dates drift to MM/DD/YYYY.
- Long card explanations make mobile screens unusable.

See `11-CROSS_PROJECT_LESSONS_AND_BUG_PREVENTION.md` for the full register.

## 7. Working rules

- Inspect exact GitHub state before every write.
- Verify ChatGPT project, Lovable project ID, repository, branch and input SHA.
- Use one bounded vertical per authorization.
- Preserve unrelated user changes and protected files.
- Run formatting/lint/typecheck/tests/build/diff gates only when the approved package permits them.
- Test direct API denial, roles, tenant isolation, retries and mobile behavior where affected.
- Merge only after exact candidate comparison.
- Publish only the accepted SHA.
- Verify live output independently after publish.
- Update sources only after accepted evidence exists.

## 8. BEC and room-door boundaries

- HotelHub–BEC remains frozen. No BEC implementation, credential, table, migration or enforcement is authorized.
- USB door-card writing remains a later vendor-adapter discovery/pilot. Do not build until the exact lock vendor, lock model, writer model, card technology, SDK/protocol, host OS, licensing and physical test kit are proven.

## 9. Current single next action

Next: once Lovable publish completes, the Owner opens one prepared folio and compares the on-screen A4 sheet with Save as PDF/print at A4, 100% scale and browser headers/footers off, checking item columns, 8.5 pt body, 5 pt note, both signatures, company contact, and a multipage case if available. The dashboard/name release also needs one combined Owner/staff check: set actual human names in Settings → User Control; confirm header [i] details and dashboard arrivals/departures/room readiness. If Departures is slow again, capture the `/api/hotel/departures` timing and Server log. Finance remains separate: one controlled HotelHub sandbox single-account deposit with chosen Bank/Cash, then HotelHub receipt/status and N3 receipt detail/journal proof; do not repeat completed N3 UI manual receipt/matching/refund checks. Split posting and the financial read-back candidate remain unreleased.
