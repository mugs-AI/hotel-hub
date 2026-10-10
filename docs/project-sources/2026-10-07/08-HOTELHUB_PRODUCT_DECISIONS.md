# HotelHub product decisions

Version: 07/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: **Yes** — replace the same logical source; keep one active copy.

## 1. Decision labels

- **Approved:** Product Owner decision controls target behavior.
- **Implemented:** present in source; not automatically live verified.
- **Verified:** reproducible evidence exists.
- **Unknown:** decision or contract proof is missing.
- **Deferred:** valid future work outside current scope.
- **Superseded:** historical only.

## 2. Product and property

### HH-DEC-001 — Product model

**Approved.** HotelHub is a multi-tenant N3 extension for boutique hotels and will be sold to multiple customers. Never hard-code one tenant/property as the product model.

### HH-DEC-002 — Initial property

**Approved.** Initial target is one building with approximately 20 rooms.

### HH-DEC-003 — Café and retail

**Approved.** Ground-floor café/retail uses N3 Cloud POS on a cash basis. Café/retail charges are not posted to hotel rooms in current scope.

### HH-DEC-004 — Test tenant

**Approved.** Development/live acceptance uses only the Product Owner’s permitted N3 tenant. Never test financial writes in another customer’s tenant.

## 3. Identity, tenancy and access

### HH-DEC-010 — Identity source

**Approved and frozen.** N3 is the sole user identity source. HotelHub has no separate local username/password login and no browser Supabase Auth identity.

### HH-DEC-011 — Session and tenant authority

**Approved and frozen.** N3 launch credential is consumed/validated server-side. Raw N3 token remains encrypted server-side; browser receives only a secure HttpOnly HotelHub session. Tenant/company and actor are server-resolved.

### HH-DEC-012 — Roles

**Approved.** Exactly three HotelHub roles exist:

- `owner`
- `front_desk`
- `housekeeper`

Do not import ServiceHub Admin/Technician/Primary PIC roles or introduce free-text roles.

### HH-DEC-013 — HotelHub user control

**Approved.** Any eligible N3 user may launch the app, but non-owner access is granted only through HotelHub’s tenant-scoped user control/allowlist. Email is the owner-friendly selection/search field; after the N3 actor is matched, immutable N3 user ID is the authority binding.

Rules:

- current active N3 Owner resolves as HotelHub `owner`;
- eligible non-owner requires one active HotelHub assignment to `front_desk` or `housekeeper`;
- former Owner loses Owner power immediately and continues only if such an assignment exists;
- deleted, inactive, unmatched or conflicting N3 user fails closed;
- browser-supplied tenant/role/email never grants authority;
- Owner-only role changes require suitably fresh N3 Owner revalidation.

## 4. Product-wide UX and language

### HH-DEC-020 — UX principle

**Approved.** `Recognize → Act → Confirm` controls new user-facing work.

- one obvious primary action;
- concise hotel-language labels;
- secondary explanations behind an `[i]` popover;
- popover closes on outside click/tap and works without hover;
- cards avoid long story paragraphs;
- colours aid recognition but text/status remains explicit;
- loading, empty, error, locked and success states are visible;
- errors identify the failed action and what the user can do next;
- Standard and Full Width layouts remain usable;
- mobile/iPhone layouts are part of acceptance.

### HH-DEC-021 — Visual language

**Approved.** Keep a restrained professional navy/teal/gold HotelHub identity, using subtle background colour for operational/financial attention. Do not use loud random colours or colour as the only signal.

### HH-DEC-022 — Date standard

**Approved.** All user-facing screen, picker, report and print dates use `DD/MM/YYYY`. APIs/storage may use ISO. Never parse an ambiguous displayed date as MM/DD.

## 5. Rooms, rates and reservations

### HH-DEC-030 — Room mapping

**Approved.** Room number is the HotelHub operational identity and maps to an immutable N3 Stock item. Store immutable N3 ID; show Stock Code/name as display snapshots.

### HH-DEC-031 — Rate authority

**Approved.** HotelHub controls room rates. A reservation preserves the agreed rate/rate segment; later base-rate changes do not rewrite historical stay charges.

### HH-DEC-032 — Capacity and double booking

**Approved.** Guest assignments and adults/children cannot exceed Max Guests. Reservation/occupancy ranges use half-open date behavior and database conflict protection.

### HH-DEC-033 — Booking sources

**Approved.** Initial manual sources: Walk-in, Phone, WhatsApp, hotel website, Agoda and Booking.com. Agoda/Booking.com are labels only; no OTA synchronization is approved.

### HH-DEC-034 — Multi-room and multi-guest

**Approved.** One booking can contain multiple rooms and guests. Every guest is assigned to a reservation room and exactly one primary guest exists.

### HH-DEC-035 — Reservation screen

**Approved.** Reservation list uses readable/larger text, sortable columns, clear today-arrival/departure highlighting and guest phone through a compact tooltip/popover. Calendar shows room number; room name is secondary detail/tooltip.

### HH-DEC-036 — Reservation operations

**Approved.** Early check-in, late checkout, room change and extension exist with approved readiness/approval rules. Operational approval/check-in is independent of N3 financial settlement.

## 6. Guest privacy

### HH-DEC-040 — Identity protection

**Approved.** Raw guest identity numbers must not appear in URL/query state, client idempotency signatures, unsafe logs, broad DTOs, ordinary exports or analytics. Use server-side keyed processing when identity-derived deduplication is necessary.

### HH-DEC-041 — Role-minimized data

**Approved.** Housekeepers receive only room-turnaround information. They do not receive room rates, deposits, N3 accounting, identity documents or unnecessary guest PII.

## 7. Taxes, charges and folio

### HH-DEC-050 — Charge categories

**Approved.** Keep these concepts separate:

- government Service Tax/SST;
- Tourism Tax;
- configurable state/local levy;
- hotel service charge;
- rounding;
- discount;
- positive/negative adjustment.

Discounts/adjustments are folio components, not government taxes.

### HH-DEC-051 — Configuration model

**Approved.** One left-side ON/OFF switch exists for each charge/tax type. The right panel contains only that type’s relevant amount/rate/effective date and N3 Stock/UOM/Tax Code mappings. Do not duplicate an Accounting Mapping editor elsewhere.

The selected N3 Tax Code already supplies its rate. Do not show a separate “Use suggested %” button.

### HH-DEC-052 — Tax authority and scale

**Approved and live corrected.** N3-selected tax-code rate is authoritative. Decimal fractions normalize correctly (`0.08 = 8%`, `0.10 = 10%`). Ambiguous/missing rates block readiness; never guess.

Different charge classes may select different N3 tax codes/rates. Do not hard-code one universal tax rate.

### HH-DEC-053 — Settings save/readiness

**Approved and live corrected.** Browser sends immutable mapping IDs. Server canonicalizes the mapping/rate, saves it and returns authoritative settings. On success, UI replaces its cache immediately so readiness warnings disappear without stale reload behavior. Errors must name the save that failed.

**Accepted implementation evidence:** at SHA `75ceac11089936778b672c438d3a103b4715609a`, migration `20260916120000_hh_golive_01c_posting_mappings_parity` records the nullable `jsonb` `posting_mappings` column and generated types match. This is schema/type parity only; it does not authorize or prove N3 posting.

### HH-DEC-054 — Folio order and visibility

**Approved and live corrected.** Guest folio and print use:

1. active room charges and extras;
2. enabled taxes/levies;
3. Discount as the final detail row.

Disabled tax/charge types do not appear.

### HH-DEC-055 — Reversals

**Approved and live corrected.** Hide both the reversed original and negative reversal from guest screen/print. Preserve both in hidden audit/history. Excluding a reversed pair must not cancel a separate valid item of the same amount.

### HH-DEC-056 — Extra colours and Tax %

**Approved and live corrected.** Each extra catalogue item receives a stable, subdued professional colour identity; the selector and posted row use the same identity. `Tax %` follows Description on screen and print. Percentage taxes show their server-authoritative percentage; non-percentage items show `—`.

### HH-DEC-057 — Print behavior

**Approved, implemented and accepted.** Print Folio opens in a new tab and normal print does not start live N3 deposit verification. It renders the prepared folio and invokes print after two paint frames. Verified deposit balance is an explicit optional read-only action.

## 8. Deposits and checkout

### HH-DEC-060 — Reservation deposit

**Approved and implemented.** Controlled deposit posts to N3 AR Receive Payment (`AROR`) using server-derived accounting context and exactly-once safeguards.

**07/10 current boundary:** Account selector/aliases/visibility source is in published main; original RM 50 sandbox receipt recorded. Full-client/split acceptance remains separate. Historical source/schema checkpoint details are archived; strict account/detail/journal and role gates retained.

**Approved payment decision:** The collecting operator chooses the actual N3 Current Assets Bank or Cash Special Account Type for each Receive Payment. Owner Settings may show a verified Maybank account as `QR DuitNow` or a verified cash account as `CashNote`; labels do not rename the N3 account or reroute money. Split lines must be distinct, positive and sum exactly to the receipt total. The N3 UI sandbox showed MYR 70 Maybank + MYR 80 Public Bank / Cr customer AR MYR 150. The owner’s `700-0410` cash code was an example; the sandbox journal shows `700-0400`, so verify the live tenant’s code and ID. HotelHub split API Create/read-back and GL proof remain open; the recorded single RM 50 receipt has its own scoped evidence.

**Role boundary:** The current guarded deposit writer is Owner-only; Front Desk sees the ledger. Any Front Desk financial-write permission change needs an explicit product/role decision and server-side authorization update. The selected-account requirement also applies to a future checkout balance receipt, whose write vertical is not yet built.

### HH-DEC-061 — Walk-in customer

**Approved.** Use tenant-configured N3 walk-in customer. Historical `700-C001 WALK-IN` is an environment label, not a universal hard-coded authority. Immutable N3 customer ID controls matching.

### HH-DEC-062 — Checkout charge target

**Approved target, not accepted as implemented.** Use N3 Cash Sales/CashMemo with Post to AR, subject to exact contract proof. Do not substitute Sales Invoice merely because it seems similar.

### HH-DEC-063 — Deposit matching and balance

**Approved target, not accepted as implemented.** Match eligible prior AR Receipts to the checkout AR item. Collect a positive remainder with one new stable Receive Payment and match it.

### HH-DEC-064 — Settlement authority

**Approved.** N3 owns accounting truth. Local `Paid` requires current N3 document/allocation/outstanding evidence with no contradiction.

### HH-DEC-065 — Prepare Checkout

**Approved current boundary.** Prepare Checkout is read-only. It must not create N3 documents, allocate money, refund, mark checked out, release room, change housekeeping state or update door access.

### HH-DEC-066 — Refund

**Approved target, contract unproven.** Eligible excess/cancelled funds use the proven N3 Customer Refund/AR Refund flow after detailed rules and API behavior are approved.

## 9. Housekeeping and maintenance

### HH-DEC-070 — Housekeeping lifecycle

**Approved.** Normal lifecycle is `Dirty → Cleaning → Inspected → Ready` with corrective `Cleaning → Dirty`, `Inspected → Cleaning`, `Ready → Dirty`. Forbidden shortcuts remain forbidden for Owner too.

`Ready` means housekeeping-cleared; it does not mean vacant/available/unreserved.

### HH-DEC-071 — DND

**Approved.** DND is an occupied-room overlay, not a cleanliness state. It preserves condition, blocks starting/resuming cleaning and clears on completed room-change-away/future checkout.

### HH-DEC-072 — Modes and roles

**Approved.** One engine has Simple and Dedicated experiences. In Simple mode Owner/Front Desk perform legal transitions; Housekeeper has no housekeeping authority. In Dedicated mode Owner retains full control, Housekeeper performs the lifecycle/DND, and Front Desk has the approved restricted actions.

### HH-DEC-073 — Readiness and occupancy

**Approved.** Physical check-in/early check-in/room-change destination requires `Ready`, DND off and all reservation/capacity gates. `checked_in + occupied` remains Occupied even after planned departure; show `Departure overdue` instead of falsely marking Vacant.

### HH-DEC-074 — Existing room initialization

**Approved.** Do not fabricate historical `Ready`. Existing uninitialized rooms fail closed until Owner explicitly initializes `Ready` or `Dirty` with audit.

### HH-DEC-075 — Vacated room

**Approved.** Completed room change and future checkout clear DND and send the vacated room to `Dirty`, never directly to `Ready`.

### HH-DEC-076 — Maintenance

**Required.** Maintenance/repair job, history and safe availability impact are required. Severity, assignment, approval, out-of-service vocabulary and emergency-room rules remain to be finalized in a bounded milestone.

### HH-DEC-077 — History retention

**Approved requirement.** Operational history shows username/display name, not email. Settings should support an explicitly controlled retention/purge policy such as keeping the latest 30 days where legally/operationally appropriate. Financial/security audit must not be silently purged with routine operational history.

## 10. BEC and licensing

### HH-DEC-080 — One package and room lots

**Approved direction 07/10:** All current HotelHub functions in one commercial
package/module. Default 30 rooms per licence lot;1=30,2=60,3=90.
Supersedes suggested 25/50/100 and separate paid feature selection. Internal code,
role boundaries and financial contract/activation gates remain.

**Proposed edit design:** MUGS/BEC operator edits positive lot size/count with
effective date/reason/version/audit; tenant Owner cannot self-grant. Existing
licences retain purchased lot-size snapshot when product default changes.
Read BEC companion; no lot/bridge implementation currently present.

### HH-DEC-081 — Trial and immutable authority

**Recorded prior Owner direction:** HotelHub trial 15 days; earliest server-verified
first join immutable, local provisional join synchronizes to BEC and never restarts.
Stable N3 tenant ID+HOTELHUB, not email/company name/tenantCode fallback.
BEC policy 15 days currently disabled. Observed user 3/offline7 are not fresh approval
of HotelHub seat/expiry terms. Count/grace/offline/login frequency/renewal unresolved.
Historical general BEC preferences require explicit HH applicability reconciliation.
Research and source/spec creation authorized; BEC/HH integration plan/releases separate.

## 11. Room-door access

### HH-DEC-090 — Integration strategy

**Approved direction.** Door-card writing is a vendor-adapter integration, not generic browser hardware access. Keys/low-level commands remain outside browser code.

### HH-DEC-091 — Current status

**Discovery updated 07/10.** PzUsbSdk protocol 3.2 and Windows x86/.NET 4 C# sample received and read statically. Vendor/lock/writer model, driver, actual card compatibility, licensing, ABI discrepancy resolution, physical kit/lock acceptance and HotelHub adapter remain unproven.

## 12. Open Product Owner decisions

Resolve before affected implementation:

1. maintenance severity/assignment/approval and availability impact;
2. cancellation/no-show fee and refundability rules;
3. checkout posting/confirmation roles;
4. deposits after check-in;
5. exact refund approval and allocation reversal rules;
6. BEC count exceptions, trial capacity/users, price/term, grace/offline/login frequency/renewal; one-package/default 30 direction already decided;
7. room-door vendor and operational policy;
8. final dashboard/report catalogue;
9. production monitoring, backup, retention and support expectations.

## 13. Approved October decisions

### HH-DEC-100 — Independent approval controls

Deposit approval ON/contact approval OFF defaults. OFF permits authorized direct
application, not role escalation. Local folio contact saves permitted to Owner/FD
when contact OFF; ON requires proposals on every save path. Mixed change needs
approval if any affected category ON.

### HH-DEC-101 — One Owner approval, one proven effect

Dashboard row shows booking/receipt, before→after, requester/reason together,
Approve at right. One click claims/executes/proves once and updates every reader.
No mandatory extra agreement checkbox/Review expansion/Verify on successful
automatic flow. Unknown outcomes remain visible, GET-only recovery, no false success.
Small-hotel bossOwner approval OFF uses same safe direct pipeline. FD N3 write
permission remains separately unapproved. Legacy manual requests never auto-run.

### HH-DEC-102 — Contact scope

Local guest-folio bill-to differs from selected N3 receipt contact and customer
master. Name target/scope; no silent master/all-receipts edits. N3 target retains
accounting proof; local target retains tenant/role/stage/audit/approval.

### HH-DEC-103 — Compact actions and cross-device consistency

Late Checkout requested time/reason one desktop row, wraps on mobile. Same-day
departure time; extra night uses Extend Stay. Stage/refusal meaningful, no financial
checkout advancement. Reservation/Prepare Checkout intentionally different cards.
Same-session and other-device effective refresh is acceptance.

### HH-DEC-104 — Evidence and launch

Approved automatic source incomplete/dormant; published flow manual; new SQL
unapplied/production contract null.01/11/2026 target waives no security/accounting/DB/
publishing gate. Preserve current Tasks 7–9 for resumption under HH-DEC-105; don't repeat
Tasks 1–6 or completed N3 UI tests. BEC written specification for review, no activation.

## 14. Current continuation

### HH-DEC-105 — Latest delivery priority, 07/10/2026

Owner explicitly prioritizes N3 billing and correct receipt matching, followed by
access cards. Recommended dependency order: safe billing/matching → final checkout/
room handoff → access-card adapter → BEC one-package/default 30-room enforcement →
whole-client UAT/cutover. Essential hotel/security/recovery functions precede BEC;
optional enhancements need not all finish first. Preserve automatic correction work
for later resumption. This changes ordering, not separate financial/DB/release gates.

Read dated baseline/impact/execution ledger and billing-first completion plan.
Review the BEC contract and preserve existing approved automatic work. Current source/schema/
runtime/host facts always freshly verified. Existing RM 65 cannot become a test write.
