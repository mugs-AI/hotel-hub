# HotelHub navigation, card help and payment clarity checkpoint

Date: 01/10/2026 (Malaysia).

Status: locally tested and reviewed candidate; not released; responsive visual and authenticated live UAT NOT VERIFIED.

## Target and authorization

- Product: HH1.0 HotelHub only; repository `mugs-AI/hotel-hub`.
- Lovable project: `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`.
- Branch: `agent/hh-ui-navigation-help` in the existing isolated checkout.
- Local starting checkpoint: `398c637efd465dce45e45f96d22aac1a9aa0ce25`.
- GitHub main and Lovable latest SHA freshly verified before work: `6feacf349df10ec30e00d1cb5229f0256f35f2b7`; published, ready. Local starting checkpoint differs only in subsequent checkpoint documentation, not product code.
- Tested product-code candidate: `698a3eadf49a090270885d609c86c547be2e446a`.
- Owner approved the bounded UI correction. This does not grant a new public source upload, main merge, publish, database/secret change or N3 financial write.

## Implemented

1. Removed the duplicate bottom financial verification entry. Retained the compact top console link with its own info control, explicitly read-only.
2. Moved card explanations into labelled info popovers throughout Property/System/Operations/Integration/User Control/Booking Sources/Charges and Taxes/Rooms and Rates and the affected reservation cards. Operational errors, loading/empty results, warnings and unavailable-action reasons remain visible.
3. Replaced the fixed sidebar with top desktop navigation and a compact mobile header/menu. Deferred placeholders no longer occupy navigation space. The existing role permissions and housekeeping mode authority still decide which links appear.
4. Added active-page semantics, menu dismissal on navigation including the current route, account/display options in a compact popover and horizontally scrollable Settings tabs. Info content caps to viewport width/available height and can scroll.
5. Added a reservation Payment availability card below the folio. It states that final bill posting and balance payment are unavailable; its info explains the intended sequence without asserting an N3 balance or offering a fake posting action.
6. Shortened the disabled-deposit message while keeping it visible. Existing deposit writer, immutable account choices, verification controls and feature gates are unchanged.

## Payment and deposit truth

- Saving a reservation or preparing a folio does not create an N3 accounting bill.
- An advance payment can be recorded as an unapplied N3 AR Receive Payment before a Cash Memo exists. It cannot be knocked off against a nonexistent bill.
- Target flow: controlled deposit → final Cash Sale posted to AR (business label Cash Memo) → read-back → apply eligible deposit receipts → collect/match a positive remainder → approved refund if applicable → verified settlement before checkout.
- The published HotelHub deposit UI reported collection disabled in the Owner's screenshot. The server capability requires both the deposit write switch and the tenant allowlist. The exact deployed secret values were not inspected or changed in this UI task.
- The guarded HotelHub deposit writer exists, but HotelHub-created sandbox receipt/selected-account/balanced-journal acceptance remains unverified. The latest successful financial console is read-only inquiry, not that financial-write proof.
- Cash Memo posting, automatic deposit allocation, balance payment matching and refund completion are not delivered by this UI correction. N3's ability to match documents must not be described as HotelHub's completed automatic workflow.

## Verification

- Fresh baseline: 1,539 passed, 20 skipped; 96 test files passed, 3 skipped.
- Final full `npm test`: 1,544 passed, 20 skipped; 97 test files passed, 3 skipped; exit 0.
- Five added rendered-component regression tests cover menu availability/deferred placeholders, Front Desk navigation permissions, dedicated Housekeeper financial-navigation exclusion, removal of the duplicate integration entry and accessible hidden property explanation.
- `npx tsc --noEmit`: exit 0.
- Changed-file ESLint: exit 0, 0 errors, 12 existing component-export/Fast Refresh warnings.
- Final direct `npm run build`: client and server built, exit 0. Existing dependency directive/tooling notices remain.
- `git diff --check`: passed. Generated route ordering-only churn was compared by identical line multiset and restored; no route-set change.
- Read-only code review and follow-up: no Critical or Important findings.
- Browser proof NOT VERIFIED. A temporary local fixture used synthetic identities and intended to block all writes; no browser test reached the app. Local Chromium was unavailable and its official download failed. The cloud browser denied the localhost preview with `ERR_BLOCKED_BY_CLIENT`. No responsive screenshot or interaction matrix is claimed.
- Temporary preview server stopped. No N3 request, backend query/mutation, secret change, public GitHub write, Lovable build/publish or deployment occurred.

## Next gates

1. UI release needs the separate scope-specific approval required by HotelHub governance. Refresh main/Lovable before any external write; compare the reviewed candidate against the actual current main. Keep all financial/auth/backend paths frozen. Complete preview and authenticated mobile/desktop UAT; do not label the UI live accepted based on local tests.
2. Deposit activation is a separate controlled sandbox financial-proof task: owner-designated sandbox identity, one selected single-account receipt with durable local intent, exact returned immutable receipt identity, receipt/account/journal read-back, unknown-outcome no-repeat behavior, and Owner-only authorization. No tenant IDs or credentials should be requested from the Owner merely for agent convenience. Do not activate split posting from read-only or manual N3 UI evidence alone.
3. Complete the remaining Cash Memo/knock-off/balance/refund vertical under its own reviewed scope. Existing manual N3 UI demonstrations do not need repetition, and failed stream-recovery code must not be silently imported.

This checkpoint records an unreleased candidate. It is not a new formally accepted baseline and does not replace the existing financial master record.
