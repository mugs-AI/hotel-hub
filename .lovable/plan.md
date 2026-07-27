
# Run 5D0 Correction — Lock the N3 Financial Read Contract

Read-only correction to the existing Owner console. No N3 writes, no schema changes, no route renames, no publish. Preserve `functionMiddleware: []` and N3-only identity.

## Files to change

- `src/lib/n3-financial.server.ts` — full rewrite of the discovery, filter, detail-fan-out, GL classification, refund and evidence layers.
- `src/routes/api/n3/financial-verification.ts` — thread the tenant-configured N3 customer through the run, surface filter/detail diagnostics.
- `src/routes/settings_.n3-financial-verification.tsx` — render new evidence sections (endpoint attempts, filter diagnostics, detail evidence, refund knockoffs, Cash Sales↔OR outcomes, GL eligibility with reasons); download filename now includes run timestamp + reference.
- `src/lib/__tests__/run-5d0-financial-verification.test.ts` — extended regression suite (see below).
- Delete only if truly unused: `src/integrations/supabase/client.ts` (audit shows the sole reference is a self-comment; server files use `client.server.ts`).

## A — Resource contracts and GL accounts

- GL: attempt `GET /api/GLAccounts/Query` first (preserving exact casing in evidence), then fall back only to endpoints already proven in this app (`/api/glaccounts/list`). Drop the guessed `/api/chartofaccount/list` and `/api/coa/list`.
- For every resource add a semantic contract validator that inspects the first successful page and requires distinguishing fields (see D). A 2xx page whose rows do not identify the intended resource is recorded as `Mismatch` with sanitized evidence, never as `Live N3 Confirmed` and never parsed.
- Customer Refunds validator explicitly rejects payloads whose rows resemble AR Credit Notes / Sales Credit Notes (e.g. `CreditNoteType`, `SalesCreditNote`, `CN-` doc-number series without a refund payment account) — those are surfaced as `Mismatch`.
- GL eligibility (`classifyGlAccount`) now returns `{ eligibility: "bank"|"cash"|"unknown"|"ineligible", reasons: string[] }`. Requires **all** of: immutable ID, active flag true, posting/leaf flag true, and `SpecialType` normalised (case + whitespace) to exactly `Bank Account` or `Cash Account`. Missing any → `unknown` with reasons. Name heuristics removed entirely.

## B — Exact filters with diagnostics

- Add `applyFilters(rows, filters, fieldMap)` that runs after envelope normalization and before detail fan-out.
- `docNumber`, `hotelReference`, `customerCode` are all trimmed + case-insensitive exact match, AND-combined.
  - `docNumber` matches against `DocNo`/`docNo`/`DocCode`/`docCode`.
  - `hotelReference` matches against `ReferenceNo`/`referenceNo`/`Reference`/`reference`/`OurRef`/`ourRef`.
  - `customerCode` matches against `CustomerCode`/`customerCode`/`DebtorCode`/`debtorCode`, and is only used if the code equals the tenant's configured HotelHub N3 customer (loaded server-side via existing `hotel-store.server.ts`), otherwise the filter is rejected with a diagnostic and no rows are returned for that resource.
- Emit `filterDiagnostics`: normalized filter values, resolved source field names per resource, before/after counts, and a `mismatch` entry when a requested field is absent from returned rows.

## C — Bounded detail reads by immutable ID

- After filtering, for each transaction resource (AR receipts, cash sales, customer refunds) call the resource's detail endpoint per matched immutable N3 ID.
  - Detail paths: `/api/arreceive/{id}`, `/api/cashsales/{id}`, `/api/customerrefunds/{id}` (mirror the confirmed list path root; not a write path). Never fabricate; each candidate is recorded and marked `Not Available` if all fail.
- Hard cap: 20 detail reads per resource. If more matched, skip fan-out and set `detailFanOut.skipped=true` with `reason: "narrow_filters_required"`.
- All detail calls are GET, tenant-scoped through existing `callN3Path`, and produce evidence rows `{ sourceListId, sourceListDocNo, endpoint, httpStatus, envelopeCode, sanitizedSample, fieldNamesObserved }`.
- After detail fan-out, expand relationships strictly via immutable IDs returned in the detail payload (e.g. OR knockoff `docId` → look up Cash Sales detail if not already fetched, up to the same 20-cap total).
- No document-number joins when an ID relationship exists.

## D — Live field parsing

Add small normalized adapters per resource. Each returns `{ normalized, sourceFieldMap }` so evidence preserves actual N3 field names.

- **Receive Payment (OR)**: id, docNo, docCode, docDate, customerId/code/name, referenceNo, description, depositTo (account id/code/name), currency, total, appliedAmount, unallocated, cancelled/void, knockoffs.
  - Parse singular `knockoff` first, plural aliases (`knockOffs`, `knockoffs`, `Knockoffs`, `KnockOffs`) as documented fallbacks.
  - Per knockoff: `docId`, `docType` (compare case-insensitively but export original), `docCode`, `docNo`, `appliedAmount` (numeric or numeric-string).
  - `orOrigin`: `ar_receipt` only when a `customerId`/`customerCode` and non-empty knockoffs exist; otherwise `gl_originated_or` when source suggests GL entry, else `unknown`. Do not classify by doc-number prefix alone.
- **Cash Sales**: id, docNo, docCode, docDate, customer, referenceNo, description, postToAr flag, total, matched, outstanding, cancelled.
- **Customer Refund**: id, docNo, docCode, docDate, customer, referenceNo, description, paymentBy account, amount, cancelled, refund knockoffs (`docId`,`docType`,`docNo`,`docCode`,`appliedAmount`).

### OR ↔ Cash Memo comparison (rewritten)

For each OR knockoff, resolve target Cash Sales by immutable id first, then by docNo only when id is missing. Emit one of:
- `Immutable ID confirmed`
- `Document-number only — not proven`
- `Mismatch` (both id and docNo present but disagree)
- `Not available` (target Cash Sales absent from the returned+detail set)

Include applied amount, customer match, both docCodes, both docNos.

### Refund ↔ OR comparison

Same shape: `Immutable ID confirmed` / `Document-number only` / `Mismatch` / `Not available`.

## E — Safe evidence export

Bundle schema (`schemaVersion: "5d0.2"`):

```
{
  schemaVersion, runId, runAt, tenant: { code, name },
  dateRange: { from, to },
  filters: { normalized, diagnostics: [...] },
  resources: [{ resource, endpointAttempts, chosenEndpoint, contractValidation, listSample, filterCounts, detailFanOut }],
  comparisons: { orToCashMemo, refundToOr },
  glEligibility: [{ id, code, name, specialType, active, posting, eligibility, reasons }],
  fieldMaps: { arReceipt, cashSales, customerRefund, glAccount },
  conclusions: [{ resource, label, note }]  // uses fixed evidence labels
}
```

Sanitizer changes:
- Recursive, case-insensitive; expanded key blacklist (`bearer`, `apikey`, `api_key`, `api-key`, `x-api-key`, `secret`, `access_token`, `refresh_token`, `connection`, `dbpassword`, `ic`, `icNo`, `nric`, `mykad`, `mykadNo`, `mypr`, `passport`, `passportNo`, `phone`, `mobile`, `email`, `address`, `postcode`, `city`, `state`, `country`, `dob`, `birth`).
- Whitelisted synthetic marker fields (`ReferenceNo`, `Description`, `Remark`) pass through **only for transaction tables**, still capped in length.
- Filename: `hotelhub-5d0-{yyyymmddThhmmss}-{hotelRef|noref}.json`.

## Regression tests (append to existing file)

Add cases for:
1. `/api/GLAccounts/Query` is tried first; envelope pages correctly.
2. Wrong-resource 2xx → `Mismatch`.
3. Credit-note payload rejected for Customer Refunds.
4. Exact filters (docNumber, referenceNo, customerCode) work with AND logic.
5. Filter diagnostics contain field names + before/after counts.
6. Singular `knockoff`, `docId`, `docType`, `docCode`, numeric-string amount all parse.
7. Detail fan-out uses immutable IDs, stops at 20, keeps ID expansion.
8. Cash Sales id vs knockoff docId produces all four outcomes.
9. Refund-to-OR parsing (all four outcomes).
10. GL eligibility requires SpecialType + active + posting; name-only rejected as `unknown`.
11. Nested + casing-variant secret/identity redaction (deep + array).
12. Owner-only + N3 401 destroys session + 31-day cap intact (existing tests preserved).
13. Route module contains no write methods (`POST|PUT|PATCH|DELETE` string absent from `callN3Path` invocations in the module).

## Supabase guardrail audit result

`src/integrations/supabase/client.ts` has zero real imports (only its own doc comment mentions itself). It will be removed. `client.server.ts` remains — it is the only surface used by server stores. `src/start.ts` stays `functionMiddleware: []`.

## Verification

- `bunx vitest run src/lib/__tests__/run-5d0-financial-verification.test.ts` (focused).
- Full `bun test`, `tsgo` typecheck, `bun run build`.
- Playwright QA on `/settings/n3-financial-verification`: hard refresh, blank-filter run, one filtered run showing before/after count change, download JSON round-trip; confirm `/settings` still shows Booking Sources.

## Out of scope

No payments, matching, CashMemo writes, refunds, retries, reconciliation, or mapping saves. No route renaming. No reservation/room/calendar changes. Not publishing.

Reply **go** to execute this correction.
