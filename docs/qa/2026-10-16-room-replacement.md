# Reservation room replacement

Scope: confirmed reservations, Owner and Front Desk full-edit permissions. Based on main e8341907. The separate billing candidate remains excluded.

## Diagnosis

Guest room assignment dropdowns list only the reservation's booked rooms. The editor offered adding/removing rooms but no direct replacement of its only room. The editor placeholder could also clear a valid assignment, blocking Save changes. The detail assignment draft retained old allocation IDs after a room refresh.

## Behavior

- Reservation detail's Guest room assignments card links to **Change booked room** in the existing editor.
- In **Rooms & rates**, each booked room has a replacement selector for the stay's available rooms. Rooms already on another row are excluded; rooms too small for current occupants/assigned guests are disabled.
- A new room starts at its displayed normal rate. Agreed rate remains editable with the existing mandatory override reason. Returning to an original room restores that original allocation and booked rate.
- The room's stable draft key retains guest assignments. The existing atomic update creates a new allocation, removes the omitted one, and remaps guest links together. No migration or direct booking update is needed.
- Availability loading/errors disable room selection, with a visible retry. The server still decides availability at save time. Failed saves retain the draft.
- Assignment selects only booked rooms, cannot clear a valid assignment through the placeholder, and refresh with the saved reservation version.
- Checked-in room inventory remains read-only in this editor; the existing operational Change room flow and approval policy apply.

## Verification

Mounted route tests exercise actual editor state, validation and same-origin PATCH calls with synthetic HTTP replies: 101→202 at MYR300, guest key retention, restore-before-save, re-adding the original room, duplicate room exclusion, capacity, availability error/retry, server conflict, post-check-in restriction, assignment refresh, and detail entry point.

Disposable in-memory PostgreSQL tests load the August 7 production migration's unchanged update routine, with minimum parent schema and real guest-room FK/room uniqueness. They verify atomic replacement and guest remapping, stored identity retention, idempotent replay, overlap rollback, stale-version rejection, tenant isolation, and checked-in denial. These are functional SQL checks, not a native concurrent race test or a live booking mutation. The reduced fixture does not include the later event-type correction or production event vocabulary constraint; the checked-in SQL case stops at the correction-reason guard. Those two minor evidence gaps were recorded by review; the mounted capability test covers the editor's checked-in restriction.

Commands (external DOM/PostgreSQL test modules supplied via environment; no package/lock changes):

```sh
npm test
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint 'src/routes/reservations.$id_.edit.tsx' src/components/GuestRoomAssignmentCard.tsx src/lib/__tests__/reservation-room-replacement-{mounted,postgres}.test.ts
npm run build
```

## On-screen acceptance

1. Open the confirmed test reservation. In Guest room assignments select **Change booked room** (or open Edit Reservation).
2. Under **Rooms & rates**, change 101 to 202. Check agreed rate MYR300 and that the guest's Assigned room now shows 202. Select **Save changes**.
3. Reopen the reservation: room and guest assignment must both show 202. Refresh once and confirm the same result. This release does not itself alter a guest booking or post N3 financial documents.

## Release checks

Final bounded source: full suite **2,419 passed, 22 skipped, 0 failed**; TypeScript, scoped lint (0 errors, 2 pre-existing Fast Refresh warnings), build and whitespace checks pass. Eighteen focused mounted/SQL regressions are included in that suite. One independent review found the re-add-original allocation issue; its failing mounted regression was observed, the allocation reuse was fixed, and the full checks reran green. The two minor SQL-evidence limits above remain documented.
