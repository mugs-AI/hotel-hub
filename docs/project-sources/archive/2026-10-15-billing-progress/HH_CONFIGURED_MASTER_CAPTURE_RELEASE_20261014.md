# HotelHub saved billing IDs — exact release candidate

Date: 14/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: **No** — engineering release packet. Add the companion `HH_BILLING_MASTER_SETUP_PROGRESS_20261014.md` as a recovery source instead.
Status: **SOURCE TESTED; NOT UPLOADED, MERGED OR PUBLISHED**.

## Problem and behavior

The published Owner capture screen starts with empty internal-ID fields. This candidate adds **Use saved billing IDs**, reading the current Owner's saved HH mappings without starting an N3 master capture. References fill in batches of at most 20. The Owner captures and downloads each batch using the existing buttons. Current N3 response review still controls contract acceptance; no financial workflow is activated.

## Exact candidate

- Destination: **public** GitHub repository `mugs-AI/hotel-hub`.
- Branch: `review/hh-configured-master-capture-20261014`.
- Source commit: `dc6e7f564f83c95f7fe60843c6352f5acb12a4a9`.
- Source tree: `44ddcb309098e8fc36f6f07b412ff032538ea5fc`.
- Base: fresh main `6e92a5a969ad9d47d1e0efb2a84487aed5266c2a`.
- Lovable target: HotelHub project `d6c78e7b-c2f2-4bee-bf99-c9c47ff29b76`, existing workspace `JRQygHE7tZl2GgPN8a8N`, live `hotelrooms.lovable.app`.
- Source checkpoint is followed by a documentation-only release-packet commit. Verify both and their exact diff before upload.

## Seven application/test files

1. `src/components/BillingMasterCapturePanel.tsx`
2. `src/routes/api/n3/settlement-master-capture.ts`
3. `src/lib/n3-settlement-master-config.server.ts`
4. `src/lib/n3-settlement-master-config.http.server.ts`
5. `src/lib/__tests__/n3-settlement-master-config.test.ts`
6. `src/lib/__tests__/n3-settlement-master-config-api.test.ts`
7. `src/lib/__tests__/billing-master-capture-mounted.test.ts`

The accompanying packet is the only additional documentation payload. No unfinished checkout/no-show migration, source-leg SQL, financial adapter, package/lockfile, protected launch/store/integration file or runtime gate is included. Existing tables/columns were confirmed read-only through Lovable. API/browser acceptance of the new helper remains pending.

## Validation and review

Full candidate Vitest: **2,379 passed /22 skipped /0 failed**; explicit existing DOM/PGlite lanes. Typecheck, changed-file lint, build and `git diff --check` passed. Seven application/test files are byte-equivalent to broad source `6a9526a`; its full suite passed **3,023 /22 skipped /0 failed**.

Full candidate lint still reports **170 errors/38 warnings**. Error-bearing legacy scripts are byte-identical to main. This documented baseline formatting debt was accepted for the earlier capture patch and is unchanged; do not call full lint green. No dependencies were changed.

One independent checkpoint review, then one RED→GREEN fix pass: exact count/data parity prevents silent local truncation; failed recapture cannot resurrect an older batch report. Deferred Minor: shared Capturing label during saved-ID loading. No second review or live billing proof is claimed.

## Independent release lanes

| Lane | Requested scope |
| --- | --- |
| Source upload | Upload this exact candidate and packet to the public repository review branch; check the remote tree. |
| Merge/sync | Reviewed merge into freshly reverified main, then exact Lovable sync. |
| Database | No migration, RPC, grants or data change. |
| Runtime settings | No configuration/activation/secret change. |
| Public release | Publish only this saved-ID helper through the existing Lovable project. |
| N3 operations | No agent-operated N3 capture or financial writes. Owner performs the later explicit read-only capture. |

Existing approval to continue the source plan is recorded. The exact new public source payload and its merge/publication require release authorization, independently of the previous released commit `744b4b6`.

## Acceptance and recovery

After release, reopen HH through N3 as Owner; select **Use saved billing IDs**. Confirm expected configured identities, visible missing/invalid mappings and any batches. Capture/download each batch. No saved IDs or failed load must not clear manual entries; staff must be denied. New read-only captures still need contract review and cannot post a bill.

On source drift, stop and compare rather than overwriting either branch. On capture failure, keep financial contracts closed and troubleshoot GET evidence. The broad checkout branch remains preserved and unpublished. This candidate does not complete billing or checkout.
