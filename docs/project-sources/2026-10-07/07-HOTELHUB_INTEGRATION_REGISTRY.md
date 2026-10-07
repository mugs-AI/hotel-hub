# HotelHub integration registry

Version: 07/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: **Yes** — replace the same logical source; keep one active copy.

Implementation, contract proof, applied schema, runtime and client acceptance differ.

| Interface | Current boundary |
| --- | --- |
| N3 launch/current role/allowlist | Established server-only N3 identity, encrypted token/HttpOnly session; owner/front_desk/housekeeper |
| Mapping reads | Immutable room/stock/customer/account/UOM/tax, server canonicalization; actual client needed |
| AR Receipt deposit | Gated Owner single writer, recorded RM 50; split proof separate |
| Receipt/detail/GL/Verify | Exact read-only proof/manual production; mismatch never effective money |
| Automatic Update | Dormant review source; upstream concurrent/stale-write and after GL contract unproven |
| Local bill-to | Independent approved contact policy target; every save path/refresh needs acceptance |
| Cash Sale/Post-to-AR | Public contract inspected; complete HH vertical absent |
| Allocation/balance/refund/final close | Separate incomplete mutation/settlement gates |
| Monthly receipts | Owner/property/person scoped, N3 receipt dates, max 100; failure clears stale |
| Sales/Collections | Unavailable until authoritative final billing |
| Cloud DB | Existing target/history; new automatic SQL unapplied; types/adapters require parity |
| Runtime/public | Existing TanStack/Nitro/Cloudflare; synced code≠SQL/runtime/public deploy |
| Folio/print | Prepared statement/fast print; optional verification read-only |
| BEC | HotelHub policy disabled, no HH bridge/lots; new contract for review |
| Alerts | DeliveryOFF until configured |
| Access card | PzUsbSdk protocol 3.2 and Windows x86/.NET 4 sample received and statically read; vendor/model/driver/licence/physical proof and HH adapter absent |
| OTA | Deferred; Agoda/Booking.com labels only |

No browser Supabase Auth or BEC operator login in HotelHub. Every read/write scoped
to server tenant/current actor. Never accept arbitrary N3 path/role/tenant/account
objects. RLS and grants and server authorization all verified; enabled RLS metadata
alone proves no signed-in tenant test. Generated auth/type changes need review.

Existing Cloud controller available, no separate Supabase login presumed.
Migrations/functions synced as files do not execute. Old receipt migrations already
applied. Protected schema/types parity separate from new code.

N3 official sales-v1/gl-v1 at openapi.account.qne.cloud/doc and reporting Swagger at
openapi-reporting.account.qne.cloud/doc/index.html. Not Optimum2019. Success business
envelope required; Create omits details, selected header versus multiPayments proof
independent. Update updatedAt isn't safe conditional write. Empty knockoff not a
proven clear operation. No financial POST retry after unknown outcome.

BEC target: mugs-AI/bec1.0, project b3b02790-a853-464e-ac45-a054381e59b2,
workspace tJObptvCa2MGSCihecnu, configured ref iinmwukhrcectuanhojg.
External HOTELHUB explicitly maps existing BEC lower-casehotelhub without renaming
immutable identity. Current create supports ServiceHub only; no bridge auth/endpoint/
credential. BEC operator role differs from tenant Owner. Read BEC companion/evidence.

Official delivery/security references inspected07/10:
https://docs.lovable.dev/integrations/git-sync-overview
https://supabase.com/docs/guides/database/postgres/row-level-security

## Access-card discovery, 07/10/2026

Sample imports card_operate/card_Read/card_Write from PzUsbSdk.dll. Protocol lists
101 read, 102 write, 103 cancel; PZ22 main card replaces older guest cards only
after it is presented to the lock, PZ23 additional card has no overwrite function.
Issue/extension/late departure/room change/loss/checkout must preserve authorized
stay dates and audit, not independently settle N3 or mark a room Ready. Cancellation
at a writer does not prove a remote offline lock revoked an absent card.

A Windows adapter/agent is a proposed direction based on the native sample, not an
accepted architecture or implemented bridge. Browser raw USB compatibility is
unproven. Never expose system/sector keys, raw generic writes or arbitrary commands
to browser clients. Resolve room/building/floor mapping, card UID/logical number and
tenant/operator/device authority server-side. Physical read-back and lock acceptance
are distinct. Vendor must settle length-buffer and date-format discrepancies before
any device dispatch. SDK source/DLL/EXE and passwords are not published to GitHub.

Repository evidence: docs/evidence/HH_ACCESS_CARD_SDK_DISCOVERY_20261007.md.
