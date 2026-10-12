# Receipt account correction candidate — 12/10/2026

Upload to Project Sources: **No** — engineering release candidate.
Status: prepared locally; not uploaded, merged or published. No database, runtime setting, live request decision or N3 write performed.

## Base and scope

Verified current GitHub main / Lovable source: 0fd05b7dc9383a02a4fee826f33e51eccec2065a.
Main tree: 2ef178d0d0a01e6aea20e353cb5d91c10504a21e.
Local isolated branch review/hh-receipt-account-fix-20261012 starts from 1f797d39416e514e50f1e43db573ba7518427d8d, whose tree exactly equals that remote main tree. Local ancestry is reconstructed; export any approved candidate with actual remote main as its parent, never claim a local commit is already present remotely.
Code candidate: b08f18caf68874749b2d25428ff042d8efabeff9; code tree 6119b3cab6b024a815ab333baca0b0d566688447.

## Diagnosis and correction

Amount-only receipt corrections work. Changed payment accounts stopped before dispatch because buildReceiptUpdatePayload unconditionally rejected any proposed account ID differing from the original. The saved automatic intent remained needs_review and was shown as another Dashboard approval task; repeated approval hit the same payload restriction, not a new N3 rejection.

The candidate resolves the changed account through the signed-in tenant's fixed N3 account-detail GET using the shared execution deadline. It requires exact ID, active leaf bank/cash classification and receipt currency. Existing account visibility/eligibility checks remain. The payload changes header/payment account IDs and coherent amounts, and replaces stale bank metadata with the verified target lookup. Receipt/customer/payment identity, customer-credit detail account and unrelated fields remain bound to the original; N3 receipt + journal read-back still precedes HH projection.

Originally direct-policy failed requests stay in reservation recovery while no approval is needed. Real Owner approval remains visible if policy later tightens. Legacy/manual and approval-ON cards remain. No request is silently cleared, converted or financially resent.

## Validation

Failing regression observed before the builder/queue fix. Final full suite: 2,325 passed, 22 skipped, with external HappyDOM/PGlite. TypeScript and production build pass. Changed-file lint: zero errors, one Fast Refresh warning for the exported queue predicate. git diff --check passes.

A normal HTTP route / production dependency / fixed transport regression covers single-payment amount33→30 plus changed account: one Update, unchanged receipt/customer-detail identity, changed bank/cash debit, independent receipt/journal proof and one HH projection. This is isolated source acceptance, not live N3 account-change acceptance. Independent reviewer found no Important/Critical issue.

## Release actions requiring approval

Upload this exact candidate code and packet to mugs-AI/hotel-hub on a review branch based on the freshly checked production main. Compare tree and reviewed diff. Merge only this bounded patch and publish it to the existing Lovable HotelHub project after sync/readiness checks. No SQL migration, runtime/secret edit, account expansion or agent N3 financial action is required or requested.

Owner acceptance afterward: use the existing saved account-change intent with its current permitted action; if current settings require approval, Owner approval remains required. Verify the same receipt's bank/cash account and amount in N3, HH refreshed values and completion behavior. Do not issue a new financial request if an attempt is unknown/applying.

Old unwanted manual correction: Owner Reject closes that request and removes it from the open Dashboard queue while retaining its audit history. It does not reverse or delete the N3 receipt.

Only sanitized engineering metadata is in this packet. Guest details, tenant identifiers, operational snapshots and uploaded screenshots are excluded from public GitHub evidence.
