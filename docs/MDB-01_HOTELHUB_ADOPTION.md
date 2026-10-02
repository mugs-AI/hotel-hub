# MDB-01 adoption — HH1.0 HotelHub

**Date:** 29/09/2026 (Malaysia)  
**Repository observed:** `mugs-AI/hotel-hub`, default `main`  
**Companion:** `00-MUGS_DIRECTBUILD_PROTOCOL.md`  
**Status:** Project Source prepared; attachment to HH ChatGPT Project and any repository governance amendment are separate actions.

## Product boundary

Hotel reservations, room/housekeeping state, folio, deposits, checkout, N3 Cash Sales/AR Receive Payment/refund, taxes, and planned door access are HotelHub concerns. Preserve DD/MM/YYYY display, stable N3 tenant/user and immutable N3 IDs. BEC product code is `HOTELHUB` if/when its contract is approved. This source grants no new N3 or BEC write.

## DirectBuild decision

The existing Lovable project and its backend remain the production target. Use a branch from a freshly verified accepted HH baseline for direct code changes. Before each merge, compare remote `main`, the exact reviewed candidate tree and Lovable's active synced branch. A contemporaneous HH-UAT merge/release must finish or reach a safe checkpoint first; never assume an earlier screenshot SHA is still the head. After merge, wait for Lovable code sync and inspect preview. Publish only as separately authorized.

HH's actual backend kind/project reference and function deployment method must be **observed** at execution. Code sync does not run a migration, deploy an Edge Function or set a secret. A local preview with HH production backend can mutate real reservations or N3 through existing functions. Use isolated fixtures/sandbox for write tests.

## Elevated checks

- No duplicate N3 financial POST on retry or unknown response. Preserve durable local intent/claim, idempotency, external IDs and readback for deposit, checkout, balance and refund.
- Verify room status and booking transitions under concurrent requests; preserve history/audit and actor attribution.
- For migrations, compare actual schema, applied history, generated types, RLS and existing bookings before applying a forward-compatible change.
- For functions, verify deployment and secret presence with the exact HH backend; test tenant and role denial as well as approved actor success.
- A card/door device feature requires its own hardware, credential and physical-operation scope. MDB-01 does not activate it.
- HH/BEC feasibility and production launch remain their separate gates.

## Existing governance reconciliation

Read current HH Project Sources, repository instructions and active UAT checkpoint before adding this source. Replace any categorical “all future work must run through Lovable AI” instruction with a reviewed direct-code option while retaining target locks, N3/DB approval and publish gates. Do not change a running HH merge or other active operation merely to adopt this document.

## HH release evidence

Record `INPUT_SHA`, candidate and `main` SHAs, Lovable synced SHA, backend identity, migration/function status, relevant tests, HH preview, live release ID, and any N3 transaction IDs. Mark each lane independently. A GitHub merge alone is **CODE MERGED**, not **DB APPLIED** or **LIVE VERIFIED**.
