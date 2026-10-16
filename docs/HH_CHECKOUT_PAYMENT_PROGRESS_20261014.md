# HotelHub checkout and payment progress — 14/10/2026

Upload to Project Sources: **Yes** — add this dated recovery reference; retain the existing billing-progress and reservation-controls sources.

Status: payment-entry preparation implemented and tested locally. **Final billing, ordinary Front Desk N3 posting, matching and complete checkout are not complete or live.**

## Source checkpoint

Repository: `mugs-AI/hotel-hub`.
Preserved branch: `review/hh-reconstruction-20261011`.
Starting source: `9db11f6`.
Product commit: `7651aede1dffeb3019cacde74d68de442f794210`.
Tree: `f1ee0f316f82d29f0272fe676896e393eae197a8`.
Local workspace: `/workspace/scratch/90b6973e3a7b/hotel-hub-reconstruction`.

PR12/main/editor `6e92a5a969ad9d47d1e0efb2a84487aed5266c2a` is the published **read-only billing-master evidence capture**, with exact approved local candidate744b4b6 tree. It is a diagnostic prerequisite, not completion of billing or the source-only reservation/no-show work. The broad branch must not be merged as a ready production release.

## Front Desk workflow already approved

Prepare Checkout is the main action screen:

1. Review complete prepared folio, stay dates, taxes and payer details.
2. **Confirm Folio & Post to N3** creates the intended N3 bill through the existing durable intent/claim, then independently verifies detail and GL. Reads, refresh and print never create a financial document.
3. Apply and verify only eligible receipts linked to this booking/customer. Existing advance is money already received; allocation does not create new cash.
4. **Receive Payment** accepts actual cash/card/other permitted-account amounts totalling the fresh positive guest outstanding; one-method and split entry share the same receipt intent. No automatic collection inference or extra deposits.
5. Verify receipt and matching. **Complete Checkout** requires verified guest settlement and the whole-stay room-release/Dirty handoff; a button cannot replace that evidence.

Ordinary Front Desk actions will use their own N3 permissions; no Owner-token delegation. Owner setup/payer overrides/accountant reports remain separate. Split writer and automatic matching retain independent evidence gates.

## Implemented in this preparation slice

- Exact positive decimal amounts parsed into cents; up to10 distinct immutable account IDs; malformed/ambiguous authority, duplicate account aliases, partial/overpaid/stale totals refused.
- HTTP `paymentLines` DTO with backward-compatible single `selectedAccountId`; supplying both forms is refused.
- Single explicit entry reuses the existing independently verified balance-OR path. An entered amount is checked against current proven outstanding before account validation/claim/dispatch.
- Split entry is prepared and reviewed in UI. Split dispatch stops **before claiming or writing** with `n3_split_balance_contract_unverified`; no speculative N3 split payload, first-account fallback or duplicate ORs.
- Booking/session-scoped payment drafts and durable pending/error state; navigation/remount retains the original booking and prevents repeated submission. Confirmation binds current bill, revision, outstanding and each account/amount.
- Payment-account choices use identity/booking-scoped queries; failed account lookup can be explicitly refreshed. Refresh remains available after status errors and runs scoped reads only.
- A failed initial confirmation can be retried deliberately only after an authoritative scoped, action-ready read proves no saved intent; its original request UUID is retained. Existing/uncertain saved attempts still require explicit reconciliation.
- Action labels are **Confirm Folio & Post to N3**, **Receive Payment**, **Complete Checkout** in the existing source checkout card. No live screen changed this turn.

## Verified checks and review

Final full Vitest: **2978 passed /22 skipped /0 failed**;210 files passed,3 skipped, isolated DOM/PGlite lanes enabled. Final typecheck and production build exit0. Changed-file lint exit0 with1 existing FastRefresh warning. Protected AGENTS/package/lock/start/integrations/hotel-store blobs unchanged.

Full lint is **not green**:307 existing formatting errors in unchanged scripts (88 security-cash check,51 multisession receipt check,119 PGlite receipt check,49 N3 recovery counterexamples),39 warnings.

One independent read-only reviewer found no Critical,2 Important and1 Minor. Both Important recovery issues were independently reproduced and fixed in one RED→GREEN pass; final mounted checks pass. Minor deferred: a cached payment form can remain actionable during automatic background refresh; fresh server account/outstanding validation still prevents incorrect posting. Explicit Refresh is serialized and blocks submission.

Ruling: advance independent Task4 payment entry/validation while master-dependent Tasks2/3 remain blocked. Cost: this code cannot settle a live stay until accepted adapters/contracts and the remaining SQL/own-role boundaries are complete. Reviewer declines on live/master/staff/SQL/source legs/whole-plan completion are accepted as outside this preparation slice, not treated as verified.

## Remaining acceptance and next permitted action

The existing approved14/10 spec/plan/inline method remain valid; no repeat design or plan approval is needed. Current N3 master responses/relationships have **not** been captured and accepted. Owner should open HH through N3, Settings → N3 Financial Verification → Current billing master evidence, capture current configured master IDs and supply the sanitized downloaded JSON for contract review. Captured is not accepted.

Complete Task2 production snapshot/master/payer adapters and Task3 confirmation/source-leg integration. Finish Task4 own-token Front Desk RBAC/transport/store/SQL parity and the exact split Create/readback/GL contract. Complete Task5 privately bound external matching and upstream concurrency acceptance, then Task6 whole-stay close/accountant/report/print readers. Preserve prior journal captures; do not repeat financial proof jobs or post a real booking as an agent test. Missing accepted concurrency keeps automatic matching closed.

The existing Lovable-managed backend remains; no separate Supabase account. No database/schema/env change, N3 financial operation, shared push/main merge or publication occurred in this build turn. Existing source-only reservation/no-show/billing work stays preserved. Door access follows verified financial checkout acceptance; BEC remains later. The new source commit has not been uploaded publicly; authorizing commit744b4b6 did not authorize sharing this different payload.
