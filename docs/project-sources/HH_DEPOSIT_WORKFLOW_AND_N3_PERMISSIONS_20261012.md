# HotelHub deposit workflow and N3 staff permissions — 12/10/2026

Upload to Project Sources: **Yes** — add this clarification and keep the existing deposit sources. This document supersedes the older Owner-only deposit-entry and approval-OFF receipt-execution assumptions. It does not claim that code, permissions or live activation have changed.

Owner clarification recorded at 14:28 Malaysia time: staff launch HH through N3, leave the N3 tab open, and complete their hotel work inside HH. N3 roles must grant the relevant create/update rights. Staff must not be required to learn or operate separate accounting screens for an ordinary successful HH deposit flow.

## Permission and workflow rules

Both layers apply: the signed-in user must be allowed into the hotel/Front Desk role in HH, and N3 must authorise that user's relevant receipt operation. HH does not create N3 rights, substitute an Owner's credentials, or treat approval OFF as authority to bypass N3 permissions. An N3 denial shows a clear message inside HH for the admin to resolve; Front Desk is not told to perform a manual accounting repair.

| Operation | Required flow inside HH |
| --- | --- |
| New room-advance deposit | Authorised Owner or Front Desk saves in the reservation. Use the user's N3 create rights, retain the returned same-document link and verify before treating money as confirmed. Existing collection/account/tenant controls still apply. |
| Receipt correction, approval ON | Front Desk submits the change in the reservation. Owner sees all change details and clicks Approve once in HH. That action initiates the exact N3 Update and independent receipt/journal verification. |
| Receipt correction, approval OFF | Authorised Owner or Front Desk saves the correction in the reservation using their N3 update rights. No Owner-execution handoff or yellow Dashboard approval task for this new direct correction. |
| Applied result | Refresh confirmed deposit amount, checkout balance, folio and relevant reporting readers. Front Desk can continue preparing the folio in HH. |
| Applying or unknown result | Show the saved action and progress in the reservation. Incomplete/unknown evidence cannot be shown as success; read-only recovery remains inside HH and does not resend an Update. |
| Existing legacy manual request | Preserve its history and resolve/reject it explicitly under an agreed recovery action. Changing the switch does not auto-run, erase or silently upgrade an older manual request. |

The correction changes the same OR UUID/number and retains relevant latest full-document fields. It creates no duplicate receipt, extra collection, automatic refund or rematching workaround. Deposit-approval and contact-approval switches remain separate; a combined correction requires approval if any affected category is ON. Settings changes remain Owner-only, revision-checked and audited.

The intended actor change is limited to N3-authorised deposit entry and receipt correction. It does not grant Front Desk setup, Owner approval, financial-report export or other unrelated Owner permissions. Approval ON still requires the Owner action; approval OFF removes that approval requirement, not N3 permission enforcement.

## Front Desk feedback

After an Owner action is independently verified and its HH projection is committed, the affected Front Desk session receives a bottom-right notification, for example:

“Deposit correction completed. OR2610/003: RM70.00 → RM60.00. N3 verified.”

Play a short pleasant chime once for that newly verified result, with a mute control. The first browser visit/reload must not replay historical success sounds. Deduplicate by a stable applied event/version and isolate notification state by tenant and signed-in user. Audio failure does not suppress the visual result. Approval recorded without verified application, rejected requests and unknown outcomes never emit the verified-success notification or chime.

Use the existing same-origin, scoped cross-session revision mechanism where possible. Do not send WhatsApp, email or external messages. Show only the booking/document information appropriate to that Front Desk session. Session/tenant/role loss clears stale money and stops polling; multiple mounted views must not multiply the sound.

With approval OFF, show Applying → N3 verified directly in the reservation. A successfully applied direct correction does not enter the pending Dashboard queue. Existing unresolved exceptions stay auditable and visibly distinct from new approval tasks.

## Implementation amendment and verification

The current code hard-codes Owner-only checks in deposit-create RBAC, receipt execution, fresh-Owner validation and SQL authority boundaries. Revise these together; removing only a UI restriction or one TypeScript role check is insufficient. The server must bind current tenant/user/HH role, current approval policy and the caller's own N3 session. N3 is authoritative for its create/update permission decisions; no unverified permissions DTO or role-name guess may become authority.

Reuse the existing fresh full-DTO updater, durable one-dispatch request/attempt ledger, unknown-outcome recovery, receipt/journal readback and projection. Add migration files only if SQL authority must change; never edit an applied migration, and do not apply schema under code-only approval. Backend remains managed through the verified existing Lovable project; the Owner has no separate Supabase account and must never be asked to create/use one.

Required counterexamples: authorised Front Desk create; OFF direct update with no Dashboard task; ON Front Desk cannot dispatch before Owner approval; denied/revoked N3 rights cannot report success; actor/tenant/policy changes before dispatch; 401/timeout with no repeat POST; verified result refreshes a second session; exactly one notification/chime; reload/auth-switch does not replay or expose another tenant's event; failed/unknown result has no success alert; legacy manual rows are not automatically upgraded.

The earlier review-source tests do not prove this revised staff-permission contract is implemented or live. Receipt-only code review, isolated SQL tests when changed, hosting/runtime activation, exact authorised N3 tests, publication and signed-in two-session acceptance remain separately attributable.

The immediate requested corrections remain BK260924001 / OR2610/003 RM70 → RM60 and BK260920001 / OR2610/001 RM50 → RM51. This document records their desired outcomes; it does not execute either change or approve unrelated amounts. The older proposed RM70 → RM85 trial is not substituted for the Owner's current request.

This is the written amendment for review against the already existing deposit design and implementation plan. Broader billing/accountant work remains preserved; no deposit-module rebuild, BEC work or new Lovable AI Build.
