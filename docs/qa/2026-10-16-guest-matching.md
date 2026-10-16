# Saved guest-bill matching check

Continuation of the approved billing-completion plan, Task 5. This is source implementation; it does not claim a live N3 posting or completed checkout.

The separate-payer workflow previously had no matching-check control for its saved guest leg. The existing checker selected the legacy single-bill intent. A guest bill now uses its exact saved leg, frozen plan and current revision for the existing two-observation N3 check. The source bill is excluded from guest collection and matching controls. No alternate N3 document IDs, URLs or financial amounts can be supplied.

The matching check is an explicit read action. It does not create a receipt, change an allocation, mark the stay settled, release a room or enable an unaccepted financial contract. A successful observation remains distinct from the final settlement and room handoff.

The new binding rejects a different plan, source leg, stale revision, changed actor/session or wrong booking. Binding, snapshot and database reads share the checker deadline and cancellation. Existing legacy checks keep their original request shape. Loading a card never starts the matching check.

Validation includes mounted guest-only entry and request binding, HTTP allowlisting, real scoped-store reads, revision and identity fencing, and deadline exhaustion. The existing matching checker retains its complete two-observation and receipt-conservation tests.

Release remains gated by actual application-schema installation, accepted N3 financial evidence and authenticated workflow acceptance. Current source checks must not be reported as a successful live financial transaction. No extra Project Sources upload is needed for this engineering checkpoint.

One independent continuation review found one Important cancellation issue and no Critical or Minor issues. The initial race bounded the response while the inner snapshot could continue after cancellation. Four failing regressions reproduced continuation after cancellation/session loss and missing master-read cancellation/authorization. The fix passes the shared deadline, cancellation, byte budget and own-session guard through the frozen-state, master and receipt readers. The same tests then pass. No second review was performed.

Review exclusions remain explicit: live N3 financial acceptance; installed schema/runtime/publication; final settlement/close integration; and earlier broad implementation. This continuation does not certify those lanes. The first unrestricted full test run timed out importing the existing booking-wizard DOM dependency; a complete three-worker rerun passed without changing a test timeout. Final checks after the cancellation fix are recorded in the execution checkpoint.

Final continuation verification: 3,521 tests passed, 22 skipped, 0 failed (three workers); TypeScript and production build pass; full lint has 0 errors and 39 existing warnings; whitespace and protected-file checks pass. No SQL migration or financial activation changed.
