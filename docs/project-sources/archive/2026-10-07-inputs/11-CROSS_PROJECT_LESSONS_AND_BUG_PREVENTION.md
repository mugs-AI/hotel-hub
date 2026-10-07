# CROSS-PROJECT LESSONS AND BUG PREVENTION

## HotelHub HH1.0 Safety Transfer Record

**Pack version:** 17/09/2026  
**Sources of experience:** HotelHub, SH2.2/ServiceHub, PMS/ProjectHub, BEC and Van Sales  
**Rule:** Transfer proven engineering/safety lessons only. Do not transfer another product’s business workflow without explicit HotelHub approval.

## 1. Project-boundary rule

The following are reusable:

- identity/session safety;
- tenant isolation;
- immutable external IDs;
- exact-SHA release control;
- migration/type parity;
- idempotency/reconciliation;
- concise/mobile UX;
- audit/privacy practices.

The following do not automatically transfer:

- ServiceHub jobs, technicians, Primary PIC or renewal rules;
- ProjectHub BOQ, project codes or construction billing;
- BEC purge/license policy details;
- Van Sales stock transfer/routes/cash-account assignments.

## 2. Authentication and ownership lessons from SH2.2

### Never copy these unsafe patterns

- raw N3 token in browser localStorage/sessionStorage;
- browser forwarding raw bearer to every API;
- unverified decoded JWT claims used as server authority;
- BasicInfo 403 ignored/fail-open;
- `/api/Users` 401/403 converted into a generic normal user;
- unmatched/inactive N3 user allowed access;
- sticky local Owner record preserving a former Owner’s privilege;
- Supabase browser Auth/preview-token broker as a second identity;
- long privileged-role cache without fresh validation for Owner actions.

### Required HotelHub behavior

- server consumes and validates N3 launch credential;
- N3 token remains encrypted server-side;
- secure HttpOnly HotelHub session only in browser;
- server resolves BasicInfo tenant and active N3 actor;
- current N3 Owner becomes HotelHub Owner;
- former Owner immediately loses Owner;
- former Owner continues only with active HotelHub assignment;
- unmatched/inactive/deleted actor gets 403;
- 401 invalidates session; 403 denies authority; malformed upstream fails closed;
- every record access combines server tenant plus record identity;
- UI hiding never substitutes for server enforcement.

## 3. Repository and Lovable lessons from PMS/HotelHub

| Observed failure | Prevention |
|---|---|
| Work sent to wrong/similar Lovable project | Verify project ID, repo and branch, not display name |
| Lovable tracked an old branch while `main` was newer | Inspect loaded source/SHA before publish |
| “Website is up to date” but intended fix absent | Verify live bundle/workflow independently |
| Generated auth/dependency drift entered a feature build | Protect auth/package/lock/environment paths and inspect exact diff |
| Component existed but user could not access it | Require route import, mount, navigation and permission proof |
| Lovable completion report treated as acceptance | Re-run/check gates and perform exact-SHA live UAT |
| CAPTCHA/manual publish confused with successful deployment | Record user action, then independently verify deployment/live source |
| Local and remote candidate SHAs differ after recreation | Compare exact trees/files, not commit title alone |

## 4. Database lessons

| Bug/risk | Prevention |
|---|---|
| UI built before required column exists | Migration/schema gate before release |
| Migration file exists but Cloud not applied | Verify Cloud migration ledger |
| Cloud schema changed but generated types stale | Regenerate/verify types in same vertical |
| Applied migration edited/deleted later | Never rewrite history; use additive correction |
| Browser service key/auth used for convenience | Server-only database authority |
| Tenant ID accepted from browser | Server-resolve tenant and filter every query/mutation |
| Purge removes audit/financial truth | Separate operational retention from protected audit/finance; explicit authorization |

## 5. N3 mapping and contract lessons

### Immutable identities

Use immutable N3 IDs for Customer, Stock, UOM, Tax Code, Account and documents. Display codes/names may change and cannot be unique authority.

### Browser payload

Send only the approved immutable selection IDs plus genuine user-entered values. Do not send a whole upstream object and trust its mutable rate/account fields.

### Server canonicalization

Server re-fetches/validates selected N3 identity, derives tenant/accounting context, saves canonical snapshot and returns the authoritative saved state.

### External write safety

No financial write without stable local intent, claim, unique correlation, strict success evidence, `unknown` state and GET-only recovery. Never equate HTTP 2xx alone with valid accounting settlement.

## 6. Tax/settings bugs already experienced

### BUG-TAX-001 — Decimal fraction scale

N3 returned `0.1` for 10%. Code assumed whole percentage and produced 0.1%/wrong amount.

**Permanent prevention:** one tested normalization function used by display, save, calculation, readiness and print. Regression examples: `0.10 → 10%`, `0.08 → 8%`, `0.06 → 6%`, `0 → 0%`; ambiguous values block.

### BUG-SET-001 — Selector changed but save never reached server

UI showed the selected Tax Code, then generic error; no request was persisted and readiness read old server state.

**Permanent prevention:** test from real browser payload through server canonicalization/database response; submit immutable ID; use actionable error; replace settings/readiness cache from successful response.

### BUG-SET-002 — Duplicated activation/mapping controls

Two control areas created conflicting state.

**Permanent prevention:** exactly one switch and one configuration panel per type; one server model.

### BUG-DATE-001 — Effective date displayed non-Malaysian

**Permanent prevention:** all user-facing date format/parse tests use DD/MM/YYYY; internal ISO conversion remains explicit.

## 7. Folio bugs already experienced

### BUG-FOLIO-001 — Discount in first row

**Prevention:** deterministic presentation sorter: active charges/extras → enabled taxes/levies → Discount last.

### BUG-FOLIO-002 — Reversal mechanics exposed to guest

**Prevention:** presentation projection hides both members of a matched reversal pair; audit/history keeps them.

### BUG-FOLIO-003 — Reversal distorted total

The prior logic excluded the original but still counted the negative reversal, cancelling another valid same-value charge.

**Prevention:** calculation and presentation share one tested reversal-pair classifier. Matched pair contributes zero; unrelated active item remains counted.

### BUG-FOLIO-004 — Screen and print drift

**Prevention:** share normalized rows, tax display and ordering helpers; test both consumers with the same fixture.

### BUG-FOLIO-005 — Guest cannot identify extras easily

**Prevention:** stable catalogue-ID-derived professional colour, same identity in selector/screen/print; colour never replaces description.

## 8. Print/performance bugs already experienced

### BUG-PRINT-001 — 90–120 second preview

Print page automatically performed live N3 deposit verification, with multiple requests/concurrency and long timeouts.

**Permanent prevention:** default print makes zero N3 verification requests. Optional verified balance is a separate user action.

### BUG-PRINT-002 — New tab/popup blocked

**Prevention:** open/navigate the print tab directly from the user click before unrelated long asynchronous work. The print route loads only prepared folio data needed for output.

### BUG-PRINT-003 — Calling print before styles/layout settle

**Prevention:** wait for required data and two animation frames; avoid arbitrary multi-second sleeps.

### Performance acceptance

Measure separately:

- click → print route visible;
- route data/render time;
- app calls to N3/database;
- `window.print()` invocation;
- Chrome/native “Preparing preview” time.

Do not blame native browser preview for an application network wait, or vice versa.

## 9. UI/mobile lessons from SH2.2 and PMS

| Problem | HotelHub prevention |
|---|---|
| Tall cards and repeated explanation text | Keep title/action/status; move short help to `[i]` popover |
| Hover-only help fails on iPhone | Popover opens by tap/click and dismisses on outside tap |
| Too many equal buttons | One primary action; progressive disclosure for rare actions |
| Colour used as only meaning | Always include explicit label/status/icon |
| Desktop looks fine but mobile overflows | Acceptance includes iPhone widths, long names, tables and sticky actions |
| Settings scattered across navigation | Consolidate system/role/integration controls under Settings |
| Stale optimistic state after mutation | Render authoritative server response, then background refresh |
| One global pending flag blocks whole board | Track pending state by room/item/action |
| Technical upstream error shown to clerk | Safe actionable wording with correlation ID for support |

## 10. BEC licensing lessons

- Stable key is N3 tenant + HotelHub product, not browser/email alone.
- Preserve first join; do not issue unlimited new trials on relaunch/reinstall.
- License/trial enforcement is server-side.
- Marketing consent/capture is separate from access authority.
- Define fallback/grace/outage behavior before enforcement.
- An inactive license may block approved product access but never deletes hotel/accounting data.
- “Purge Transactions” and “Clean & Delete” are distinct destructive actions and require explicit authority.
- A BEC outage cannot become permission to switch tenant or retry N3 money writes.

## 11. Multi-tenant lessons from all projects

Every sensitive query/mutation/test must prove:

- tenant is server-resolved;
- record belongs to that tenant;
- actor is active and permissioned;
- cross-tenant record ID returns 404/403 without leakage;
- unique keys include tenant where appropriate;
- caches are keyed by tenant/user/role and cannot bleed;
- background jobs carry verified tenant context;
- logs/exports/support tools do not expose another tenant;
- fixtures include at least two tenants for negative tests.

## 12. Release regression checklist

Before accepting any future correction:

- [ ] exact input and output SHA recorded;
- [ ] changed files equal authorized scope;
- [ ] protected auth/package/lock/environment paths checked;
- [ ] migration ledger/types checked or N/A stated;
- [ ] immutable N3 IDs used;
- [ ] server tenant/role enforcement tested directly;
- [ ] 401/403/malformed upstream fail closed;
- [ ] duplicate click/race/timeout recovery tested where relevant;
- [ ] DD/MM/YYYY checked;
- [ ] desktop and iPhone/mobile checked;
- [ ] loading/empty/error/locked/success wording checked;
- [ ] screen/print/export consistency checked where relevant;
- [ ] tests/typecheck/build/lint/diff gates passed;
- [ ] candidate tree matched remote;
- [ ] `main` fast-forwarded without unrelated changes;
- [ ] Lovable loaded the exact accepted SHA;
- [ ] live authenticated UAT performed;
- [ ] Project Sources updated after acceptance.

### Latest completed checkpoint

HH-GOLIVE-01C satisfied the applicable checklist at SHA `75ceac11089936778b672c438d3a103b4715609a`: exact six-file scope, clean protected-path diff, migration/schema/generated-type parity, unchanged data fingerprint, 1,419 regression tests passed with 20 skips, TypeScript/build passed, lint 0 errors, exact-SHA publication, production HTTP 200, anonymous session deny-by-default and protected financial-settings HTTP 401.

## 13. Current single next action

Use this checklist for the proposed separately authorized `HH-GOLIVE-01D — N3 Checkout Contract Proof (read-only only)`. Do not turn contract inspection into implementation, N3 mutation, HH-BEC work or an unbounded redesign.
