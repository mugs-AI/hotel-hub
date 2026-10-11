# Held receipt test recovery — review candidate

Upload to Project Sources: No. Scope: approved read-only recovery patch, 11/10/2026.
Target: mugs-AI/hotel-hub / existing Lovable project d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76.
Remote input main: 35088ce4ac7c99afdae43d6b8e23609ab9cc4864; Lovable confirmed the same SHA and ready.
Local baseline: 3ce9eaf6a223a1b85e17b730fec907fbb854cbff; prior operational documents preserved separately.

## Behavior

An Owner opening a new tab can discover the existing reserved/unknown test permit after
package expiry or when new tests are disabled. The server SELECT is restricted to the
current HotelHub tenant and N3 Owner; the coordinator rechecks both tenant identities,
Owner identity, package validity/hash and held phase. Only safe summaries leave the server.
The browser Recover button GETs the existing permit/report. Listing and restoration have
no Prepare, claim, finish, financial read or financial send. They do not renew expiry.
Check N3 result remains the existing evidence-check operation: N3 GETs, with existing
local report persistence for unknown permits; reserved permits remain observation-only.

A changed detail ID now has the distinct diagnostic receipt_detail_id_changed alongside
the actual observed amount. The verifier, financial POST adapter, approved package and
normal-edit activation are unchanged. Correct RM65 alone never marks the test verified.

## Financial evidence and unresolved boundary

Supplied capture hotelhub-5d0-20261010T234205-noref.json (2026-10-10T23:42:05.451Z)
shows the same OR2610/002 UUID at RM65, bank/customer posting RM65 each and a changed
internal detail UUID. It does not capture the original Update response or identify its actor.
The earlier RM50 capture preceded the later N3 updatedAt and was not proof of failed Update.

The supplied 97.8s Recording 2026-10-11 090931.mp4 shows Custom Bill creating BIL2610/001,
N3 saving supplier invoice number 2222222, that value loading in Custom Bill's Edit screen,
and Custom Bill's changed supplier number 311133 appearing in N3 on the same invoice UUID.
The displayed invoice totals are zero. This proves the demonstrated field round trip,
not a purchase amount/GL change or ARReceipt detail-ID semantics. The private ChatGPT
conversation URL was inaccessible through retrieval; its contents were not inferred.

Urgent OR2610/001 / BK260920001 remains separate and unresolved; no fresh readback or
write was performed here. Security cash was not modified. Automatic editing remains off.
Further normal editing work requires resolving acceptable internal-row replacement evidence,
then a separate controlled financial verification scope; this patch does not claim it fixed.

## Validation before review

- Test-first red: missing held discovery/recovery and missing changed-ID diagnostic reproduced.
- Focused server/diagnostic tests: 40 passed.
- DOM interaction tests: 6 passed, including expired new-tab recovery and zero POSTs.
- Full suite: 2219 passed, 38 skipped; 145 files passed, 4 skipped.
- Typecheck: passed after updating the existing mock-store interface.
- Scoped ESLint: passed. Whole-repository lint was not rerun; existing baseline remains
  170 errors / 37 warnings from the prior release, so no global-clean claim.
- Production build: passed. These are offline checks, not signed-in live acceptance.

## Release and Owner instructions

This candidate is not merged or published. No migration, database write, N3 write,
expiry extension, reset or new Lovable build was requested or performed for this patch.
Existing migration 20261003120216 must not be reapplied.

After separate candidate release approval and verified publication:
1. Open HotelHub from N3 as the same Owner in 9AC-0D9-2F1 MUGS AI LAB TEST SDN. BHD.
2. Open Settings / N3 Financial Verification / Receipt amount edit test.
3. Choose Recover OR2610/002. Do not Prepare, Update, or create another receipt.
4. Choose Check N3 result; download the result and provide the JSON.
5. If the changed-ID message appears with RM65, retain Needs review; no repeated financial POST.

For now the Owner need not perform another test; leave OR2610/002 unchanged.
