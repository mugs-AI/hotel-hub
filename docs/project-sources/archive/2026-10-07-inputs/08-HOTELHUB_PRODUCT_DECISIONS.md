# HOTELHUB_PRODUCT_DECISIONS

## Approved Business Rules and Decision Register

**Pack version:** 17/09/2026  
**Status:** Active. Unknown items remain explicit and must not be guessed.

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

**27/09/2026 local source checkpoint:** Local commit `b32a519` contains the rebuilt N3 bank/cash account selector, Owner display labels, immutable payment-line snapshots, matching migration `20260927120000_hh_payment_accounts_and_lines.sql`, and a separate split-posting gate. Local build and TypeScript passed; 116 focused financial tests passed and changed-file lint has no errors. GitHub `main` now points to `495b90d900a44bc9b5297d24ca07529b45aff23e` (three equivalent fast-forward commits created through the GitHub integration). Its final tree `719e5932b501bda74d88a6937806e3726b27922d` exactly matches the tested local `b32a519` tree. The commit IDs differ because the connected integration created new GitHub commits. No migration, deployment or HotelHub N3 Create occurred. N3 Cloud UI evidence for split receipt and balanced journals remains distinct from HotelHub API proof. Keep split posting disabled pending tenant Create/read-back and GL verification. The 23/09 repository/deployment pointers below remain historical audit snapshots.

**Approved payment decision:** The collecting operator chooses the actual N3 Current Assets Bank or Cash Special Account Type for each Receive Payment. Owner Settings may show a verified Maybank account as `QR DuitNow` or a verified cash account as `CashNote`; labels do not rename the N3 account or reroute money. Split lines must be distinct, positive and sum exactly to the receipt total. The N3 UI sandbox showed MYR70 Maybank + MYR80 Public Bank / Cr customer AR MYR150. The owner’s `700-0410` cash code was an example; the sandbox journal shows `700-0400`, so verify the live tenant’s code and ID. API Create/read-back and GL proof for HotelHub remain open.

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

### HH-DEC-080 — Future licensing model

**Approved direction only.** HotelHub may later be sold by room package (for example 25/50/100 rooms) and monthly/yearly entitlement through BEC or another approved backend.

License authority must be server-side and tied to stable N3 tenant + product. Expiry may block access according to approved policy, but must never delete property/reservation/N3 data. Exact packages, grace/offline behavior, trial length, renewal and purge rules require a separate decision/build.

## 11. Room-door access

### HH-DEC-090 — Integration strategy

**Approved direction.** Door-card writing is a vendor-adapter integration, not generic browser hardware access. Keys/low-level commands remain outside browser code.

### HH-DEC-091 — Current status

**Discovery.** Vendor, lock/writer model, card technology, SDK/API/protocol, OS, licensing and physical kit remain unproven.

## 12. Open Product Owner decisions

Resolve before affected implementation:

1. maintenance severity/assignment/approval and availability impact;
2. cancellation/no-show fee and refundability rules;
3. checkout posting/confirmation roles;
4. deposits after check-in;
5. exact refund approval and allocation reversal rules;
6. BEC room-package/trial/grace/renewal behavior;
7. room-door vendor and operational policy;
8. final dashboard/report catalogue;
9. production monitoring, backup, retention and support expectations.

## 13. Current single next action

Next: use the published `495b90d` tree for release preparation; complete authorized selected single and split receipt Create/read-back and balanced journal proof in the owner-designated N3 sandbox. Keep split posting disabled until that proof, then release matching code and migration together through the separate release process. Prior Cloud UI matching and refund tests need no repetition.
