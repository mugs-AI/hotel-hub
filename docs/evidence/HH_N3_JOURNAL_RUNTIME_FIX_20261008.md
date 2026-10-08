# Journal transport runtime correction — 08/10/2026

Upload to Project Sources: **No** — repository checkpoint.

## Evidence and diagnosis

Owner run `20261008T131129-hsmd55`, schema5d0.4, selected company
9AC-0D9-2F1 and26/09–27/09/2026. Export SHA256:
`af0fbc4e59b03a4885059c438799d43d285ad6804b28df15830966f54e3aea02`.
Both attached screenshots were read successfully. All four list resources and
six transaction details succeeded. Transaction list rows and sanitized detail
samples exactly match the earlier Owner export; no transaction recreation is needed.
Previously corrected comparisons now show60.01 and150 applied to the cash sale,
and40 refunded to the receipt. These are diagnostic observations, not runtime proof.

All six journal attempts returned unavailable with null HTTP status and0ms.
The deployed journal reader alone used `redirect: "error"`.
Cloudflare workerd's Request constructor explicitly rejects that mode before
dispatch; its supported alternatives are follow/manual:
https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B
(Request constructor / tryParseRedirect). This explains the observed immediate
failure, unlike a returned N3 HTTP error. No actual worker exception log was exposed.

## Bounded correction and validation

Use `redirect: "manual"`; the existing non-2xx branch still rejects/cancels every
redirect response. No following, retry, new endpoint, token export or gate change.
The only runtime delta is this fetch option and its explanatory comment.

Six regression assertions failed before the correction and passed afterward.
Tests use real loopback HTTP/native fetch, substituting only the external origin
and enforcing the documented workerd Request constraint. They cover successful
capture plus301/302/303/307/308, exact one-request paths, and null response samples
for rejected redirects. They do not run actual workerd or contact N3.
Focused journal checks:41passed. Full isolated release:2010passed20skipped0failed;
TypeScript, build and scoped three-file ESLint exit0. Formatting-only cleanup
followed the suite; no semantic code changed afterward. Earlier full-lint
baseline170errors37warnings remains known and is not relabeled clean or rerun.

One fresh read-only delta reviewer found0Critical/0Important/0Minor. No fix pass
or repeated billing/journal algorithm review was required. Declined-to-judge
rulings: broader financial algorithms and safety gates retain their prior
acceptance/limitations; executor checks are executor-owned; actual workerd/N3
behavior and Owner acceptance require another GET-only export after publishing.
Cost of incorrectly promoting any boundary: false financial/live acceptance.

## Release scope and continuation

Existing Owner publish approval covers this correction to the approved read-only
diagnostic console. Verified remote main/Lovable base32ea116d077c511a373b2623fc827d8900146bf6;
existing main-based release worktree reused, no implementation restarted.
Billing and parked automatic-correction worktrees preserved. No migration,
operational DB query, secret/dependency/CI/auth/RBAC change, Lovable AI Build,
N3 query or financial write by Codex. Publishing uses the existing application
server runtime; no standalone Edge Function release.

This checkpoint is pre-publication; append the actual serving deployment result
after release. Journal data, current production-master adapters, refunded-receipt
semantics, preservation and vendor atomic allocation guarantees remain unaccepted.
Tasks1–8 remain completed; Tasks9/10/11 production integration remains partial.
No financial gate opens. Do not repeat existing receipt/cash-sale/refund creation.

After the corrected deployment is verified: refresh HotelHub, retain the same
company/date range, Include GL journals, press Get Result once, then Download JSON.
The needed follow-up is a bounded GET-only read, not a payment operation.
