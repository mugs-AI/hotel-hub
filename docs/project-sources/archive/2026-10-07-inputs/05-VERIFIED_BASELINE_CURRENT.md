# VERIFIED_BASELINE_CURRENT

## HotelHub HH1.0 Current Evidence Ledger

**Pack version:** 23/09/2026, Asia/Kuala_Lumpur  
**Evidence cut-off:** 23/09/2026  
**Repository / branch:** `mugs-AI/hotel-hub` / `main`  
**Verified GitHub main SHA:** `4d46404e949499840f481a9379a673ec1e03661d`  
**Observed production deployment:** `c8714cc4-d944-47c5-b98c-ae4a91993687` at `https://hotelrooms.lovable.app`  
**Exact production server SHA:** **UNKNOWN — not exposed by the deployment**  
**Latest formal result:** HH-GOLIVE-01G current-main and live-parity audit completed; full go-live remains blocked.

## 0. Later local financial checkpoint — 27/09/2026

Next: use the published `495b90d` tree for release preparation; complete authorized selected single and split receipt Create/read-back and balanced journal proof in the owner-designated N3 sandbox. Keep split posting disabled until that proof, then release matching code and migration together through the separate release process. Prior Cloud UI matching and refund tests need no repetition.

Owner-run N3 Cloud UI evidence in the separate MUGS AI LAB TEST sandbox shows `OR2609/002` MYR150 split MYR70 Maybank + MYR80 Public Bank: journal Dr 70 + Dr 80 / Cr customer AR 150. It was applied to `CS2609/001`, leaving MYR114.02 outstanding. The earlier MUGS Perfect Software desktop/CSV evidence has distinct provenance. Full facts and limits are in `03-HOTELHUB_N3_FINANCIAL_POSTING_KNOCKOFF_MASTER_RECORD.md`.

Release gate: verify the published GitHub `495b90d` tree is present in the target checkout, pair the migration with its matching code, prove the tenant's selected single and split `ARReceipts/Create` payload and detail/GL posting, and separately authorize deployment. The split-write flag must remain off. GitHub `main` is verified at `495b90d`; Lovable source synchronization and the production SHA have not been re-audited here.

## 1. Evidence labels

- **Verified:** reproducible evidence tied to the stated source or environment.
- **Implemented:** present in source; live acceptance may be incomplete.
- **Accepted:** Product Owner/controller formally accepted a bounded scope.
- **Partial:** meaningful scope exists but required acceptance is incomplete.
- **Unknown:** insufficient evidence; do not guess.
- **Deferred:** intentionally outside current scope.
- **Superseded:** historical only; must not control current work.

## 2. Source and deployment control

| Evidence | Result |
|---|---|
| GitHub repository | `mugs-AI/hotel-hub` |
| Canonical branch | `main` |
| Local HEAD | `4d46404e949499840f481a9379a673ec1e03661d` |
| Local `origin/main` | `4d46404e949499840f481a9379a673ec1e03661d` |
| Read-only remote GitHub `main` | `4d46404e949499840f481a9379a673ec1e03661d` |
| Working tree | Clean before and after audit |
| Lovable project ID | `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76` |
| Observed production deployment ID | `c8714cc4-d944-47c5-b98c-ae4a91993687` |
| Production host | HTTP 200 on 22/09/2026 UTC |
| Exact production Git SHA | Unknown; deployment does not expose a reliable commit identity |
| HH-GOLIVE-01G mutations | None |

The previous accepted baseline at `3e557fda6ec7c4728d71cd01a86f968a562580ab` and deployment `a351da7a-36cc-4bad-8b11-533b06fb4842` is now historical. Its bounded Print Folio acceptance remains valid, but it no longer identifies current GitHub `main` or the observed production deployment.

## 3. Current-main change layers

Current GitHub `main` contains three later correction checkpoints above `3e557fda…`:

| SHA | Scope | Current evidence |
|---|---|---|
| `75ceac11089936778b672c438d3a103b4715609a` | HH-GOLIVE-01C posting-mappings schema/type parity | Implemented in source; database column was historically confirmed; no migration was applied during 01G |
| `de3e1540117a43167f3a51ebe12f98a2b02fdbcb` | HH-GOLIVE-01E UAT corrections | Implemented; deposit and Early Check-in client markers observed in production |
| `4d46404e949499840f481a9379a673ec1e03661d` | HH-GOLIVE-01F N3 StockMaster-detail room import | Current GitHub `main`; room-import client contract observed in production |

Client marker parity does not prove that every deployed server module equals the GitHub tree. Exact server parity remains unknown until a reliable deployment/source link is obtained.

## 4. HH-GOLIVE-01G live evidence

- Production returned HTTP 200 with strict transport security and no-cache response controls.
- Public launch screen directs the user to open HotelHub from N3 Marketplace/My Apps and states that the browser does not receive the N3 launch token.
- Anonymous GET requests to rooms, reservations, housekeeping, settings and departures APIs returned `401 unauthenticated`.
- Production room-import client code states that room Type, Floor, Max Guests, Display Name and Base Rate start from N3 Category, Group, Class, Stock Name and List Price.
- Production includes fail-closed messages for missing Stock Name/Category, non-numeric Group, invalid Class and invalid List Price.
- Production includes the corrected deposit enablement explanation and Early Check-in failure guidance.
- Prepare Checkout states that financial posting is disabled: no CashMemo, deposit matching, refund or room-status change.
- No BEC connector, licence enforcement, BEC credential, BEC table or BEC migration was found in current HotelHub source.

## 5. Engineering evidence boundary

HH-GOLIVE-01G was expressly read-only. Tests, TypeScript, lint and production build were not rerun, and no existing build output was treated as current evidence.

Historical evidence tied to `3e557fda…` remains:

- 1,414 tests passed; 20 skipped;
- TypeScript passed;
- production build passed;
- ESLint reported 0 errors and 28 pre-existing warnings;
- Product Owner Print Folio UAT was approximately 11 seconds versus 90–120 seconds previously.

Those historical results must not be relabelled as a fresh `4d46404…` verification.

## 6. Current capability classification

| Capability | Classification |
|---|---|
| N3-only launch/session boundary | Implemented; public boundary verified |
| Server-derived tenant, actor and effective role | Implemented; fresh authenticated live matrix incomplete |
| Owner/Front Desk/Housekeeper RBAC | Implemented, deny-by-default |
| Rooms and N3 StockMaster-detail import | Implemented at current `main`; client deployed; successful post-01F live import not evidenced |
| Reservations and room assignment | Implemented |
| Standard check-in | Implemented; prior Product Owner UAT observed |
| Early Check-in correction | Implemented; post-correction successful live UAT missing |
| Stay extension, room change and rate change | Implemented; current complete regression missing |
| Housekeeping, readiness and DND | Implemented; full current role/tenant UAT missing |
| Folio extras, discount, tax and rounding presentation | Implemented; corrected client behavior deployed |
| Print Folio fast path | Historically accepted at `3e557fda…` |
| Deposit AR Receive Payment | Implemented but administrator allowlist-gated; approved-tenant live evidence incomplete |
| Prepare Checkout | Verified read-only boundary |
| CashMemo, deposit allocation, balance collection and refund | Not accepted as an implemented vertical |
| Final checkout and room release | Blocked by incomplete financial settlement |
| Maintenance/out-of-service | Required but incomplete |
| Promotion/rate-plan module | Not implemented; product contract not yet approved |
| Reports, monitoring, backup/recovery and support | Partial |
| HotelHub–BEC licensing | Frozen/deferred; no implementation present |
| USB room-door card writer | Discovery only |

## 7. Preserved accepted folio behavior

- Room charges and active extras appear before enabled taxes and levies.
- Discount is the final detail row and participates in its mapped taxable basis.
- Both sides of a reversed pair are hidden from the guest folio and printout while remaining in hidden audit history.
- Every extra catalogue item has a stable professional pastel identity.
- `Tax %` appears after Description; basis points display correctly.
- Fixed/non-percentage items show `—`.
- Rounding is shown in totals/footer rather than as a duplicate itemized line.
- Print opens in a new tab and the normal path does not start live N3 deposit verification.

## 8. Defect and blocker ledger

### P0

None proven by HH-GOLIVE-01G. This was not a penetration test or complete authenticated production acceptance.

### P1 — go-live blockers

| ID | Finding |
|---|---|
| `01G-01` | Exact deployed server source cannot be tied to GitHub `4d46404…`. |
| `01G-02` | Fresh authenticated Owner, Front Desk, Housekeeper and cross-tenant live regression evidence is missing. |
| `01G-03` | Early Check-in correction lacks successful post-fix live UAT evidence. |
| `01G-04` | StockMaster-detail room import lacks post-01F success evidence for Category, Group, Class and List Price. |
| `01G-05` | Deposit writes remain administrator allowlist-gated; approved-tenant live evidence is incomplete. |
| `01G-06` | Checkout settlement, matching, refund, final checkout and room release remain incomplete. |
| `01G-07` | Maintenance/out-of-service remains incomplete. |
| `01G-08` | No immutable current-`4d46404…` test/build/deployment evidence is recorded. |

### P2 — controlled debt

| ID | Finding |
|---|---|
| `01G-09` | **Closed 23/09/2026:** the three authoritative control records (`04`, `05`, `09`) were refreshed in place. The other eight records remain unchanged and must not override these newer control pointers. |
| `01G-10` | Promotion/rate-plan functionality has no approved product contract or bounded roadmap package. |
| `01G-11` | Monitoring, backup/recovery, report catalogue and support acceptance remain incomplete. |

## 9. Formal result and safe checkpoint

**HH-GOLIVE-01G AUDIT EXECUTION: PASS.**  
**GITHUB MAIN INTEGRITY: PASS at `4d46404…`.**  
**CLIENT-SIDE LIVE PARITY: PARTIAL PASS.**  
**FULL SERVER/DEPLOYMENT PARITY: NOT PROVEN.**  
**FULL HOTELHUB GO-LIVE: FAIL / BLOCKED.**  
**BEC FREEZE: PASS — intact.**

No code, database, migration, N3, GitHub, Lovable, publication, deployment or BEC mutation occurred during 01G.

## 10. Current single next action

Next: use the published `495b90d` tree for release preparation; complete authorized selected single and split receipt Create/read-back and balanced journal proof in the owner-designated N3 sandbox. Keep split posting disabled until that proof, then release matching code and migration together through the separate release process. Prior Cloud UI matching and refund tests need no repetition.
