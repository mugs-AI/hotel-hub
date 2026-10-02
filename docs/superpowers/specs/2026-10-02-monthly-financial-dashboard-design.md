# HotelHub monthly financial Dashboard and receipt reports

Status: written design for user review. Concept approved on 2 October 2026; this reporting subsystem has not been implemented.

## Intended outcome and scope

Owners can review current or previous months' HotelHub sales, deposits, collections and voided receipts. The four upper action cards remain today's Confirmed arrivals, Departures, Overdue occupied and Rooms needing attention. Current room readiness remains operational rather than pretending to be a historical monthly snapshot.

The financial section defaults to the current property-local month. Its month selector affects the financial cards and their drill-down reports only. Selecting a previous month works across year boundaries. Financial figures, receipt histories and exports are Owner-only at both UI and server boundaries. Front Desk still has its existing reservation/deposit viewing permissions; these are not removed.

## Figure definitions

| Card              | Definition                                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Total sales       | Posted HotelHub-linked N3 sales documents for the selected N3 document month, net of confirmed cancellations. Prepared reservation folios are excluded.                                                                                                              |
| Total deposits    | Confirmed HotelHub deposit receipts for the selected N3 receipt document month, excluding confirmed voids and counting each replacement once.                                                                                                                        |
| Total collections | Confirmed HotelHub money received in the selected month: deposits, later settlement receipts, and direct payments on posted HotelHub sales documents. Deduplicate by authoritative N3 transaction identity so matching or allocation does not count a receipt again. |
| Voided receipts   | Count and effective amount immediately before each confirmed HotelHub receipt void during the selected month. This is an activity/audit card, not a deduction applied a second time to collections.                                                                  |

Deposits are a subset of collections; the cards are never added together as if they were separate income. “Collections” is gross confirmed money received after receipt corrections/void exclusions. Refunds are separately disclosed if and when a verified refund source is added; no guessed refund deduction is applied.

If a receipt is created for RM50.00, corrected to RM80.00 and then voided, the void activity card shows RM80.00. Keep the RM50.00 creation amount, RM80.00 corrected amount and confirmed void amount separately in its audit trail.

Use the N3 document date for sales/receipt activity and the confirmed void event date for void activity. Keep HH request/approval timestamps separately. Dates and month boundaries use the property's configured timezone. Do not substitute a local row's creation timestamp when N3 document-date evidence is absent.

Only HotelHub-linked documents count. A shared walk-in customer or bank account is not proof that a transaction belongs to HotelHub. Use immutable HotelHub operation references/document links. Other N3 business transactions are excluded.

Current checkout is preparation-only and does not post final sales or balance receipts. Therefore Sales and settlement-related Collections remain Unavailable until their verified posting/read sources exist. A confirmed empty source may show RM0.00; absent access, unsupported sources, stale evidence or incomplete data may not. Show completeness and last verification time beside available figures.

## Receipt and void reports

Provide Receipts and Voided receipts tabs. Columns include receipt number, N3 document date, booking reference, customer, saved payment-method name/account code, amount, status and original/replacement links. Voided rows also show requester, approver, reason and confirmed void time. A corrected receipt shows original and current values with its audit trail.

Filters include month/date range, booking reference, receipt number, payment method and status. Apply tenant filtering, sorting and pagination before returning report rows. Receipt printing opens the original N3 document; audit exports clearly identify voided/corrected documents and do not generate an imitation N3 voucher.

The Voided receipts Dashboard card opens its matching filtered report. Previously issued receipts remain discoverable after correction or void. Every reported figure can be traced to contributing rows and their N3 evidence.

## Data flow and permissions

Consume the receipt-controls subsystem's versioned effective projection. Add a read-only monthly aggregation service with bounded N3 pagination and reconciled local evidence. Server-side credential handling and existing N3 tenant restrictions remain in place. No report fetch posts, matches, refunds or modifies receipts.

Do not query N3 once per card or booking. Use one scoped monthly read/verification batch per source and share its result across cards and drill-downs. Include source completeness, verification time and currency. Never sum different currencies into MYR using an assumed rate.

Confirmed voids can restate the original document month's current receipt total while the void activity appears in the month it occurred. Label reports as current verified state, not a frozen historical closing balance. An immutable month-end accounting close is outside this feature.

Notification delivery and receipt approvals are separate modules. Changing a reporting month never changes approvals, notification subscriptions, operational dates or financial documents.

## Acceptance and test examples

- Current-month default and previous-month selection use property-local dates, including December/January transitions.
- Front Desk, Housekeeper, another tenant and unauthenticated callers cannot retrieve financial summaries, reports or exports.
- A deposit of RM50.00 yields deposits RM50.00 and collections RM50.00, not collections RM100.00.
- A later confirmed RM80.00 correction yields effective deposits/collections RM80.00 for that receipt; a confirmed void excludes it once.
- A replacement is counted once. Matching a receipt to a sales document does not create another collection.
- A sales document without confirmed payment counts as sales only; a prepared folio counts as neither posted sales nor collected money.
- Unsupported, unreadable, incomplete, uncertain or currency-conflicting evidence shows Unavailable or Needs review, never a false zero.
- Monthly cards reconcile with filtered report rows. Pagination does not omit contributing receipts.

Implement after the receipt-controls projection is established. Review this written design before preparing a separate reporting implementation plan.
