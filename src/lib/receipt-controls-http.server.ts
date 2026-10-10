// Shared HTTP plumbing for receipt-control endpoints: permission gate,
// same-origin writes, safe error codes. Never returns N3 bodies.
import { requirePermission } from "./session-context.server";
import { logAudit } from "./audit.server";
import type { Permission } from "./rbac";
import { ReceiptControlError } from "./receipt-controls";
import type { ReceiptControlActor } from "./receipt-controls-evidence.server";

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return Boolean(site);
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function statusForReceiptControlError(code: string): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "deposit_not_found":
    case "not_found":
    case "request_not_found":
      return 404;
    case "change_controls_unavailable":
    case "receipt_controls_unavailable":
      return 503;
    case "n3_evidence_unavailable":
    case "n3_evidence_incomplete":
    case "n3_evidence_mismatch":
      return 502;
    case "receipt_control_store_failed":
      return 500;
    case "receipt_control_key_conflict":
    case "receipt_control_active_exists":
    case "bill_to_changed":
    case "bill_to_locked":
    case "version_required":
    case "approval_required":
    case "claim_stale":
    case "version_conflict":
    case "invalid_transition":
    case "claim_conflict":
    case "claim_not_found":
    case "receipt_restricted":
    case "journal_unproven":
    case "deposit_not_controllable":
    case "account_not_allowed":
    case "split_correction_unsupported":
    case "automation_unavailable":
      return 409;
    default:
      return 400;
  }
}

export async function withReceiptActor(
  request: Request,
  permission: Permission,
  write: boolean,
  run: (actor: ReceiptControlActor) => Promise<Response>,
): Promise<Response> {
  if (write && !sameOrigin(request)) return json({ error: "cross_site_denied" }, 403);
  const { ctx, decision } = await requirePermission(permission);
  if (!decision.ok) {
    await logAudit({
      tenantId: ctx.session?.tenantId ?? undefined,
      n3UserKey: ctx.session?.n3UserKey ?? undefined,
      eventType: "hotel.receipt_control.denied",
      detail: { reason: decision.reason, permission },
    });
    return json({ error: decision.reason }, decision.reason === "unauthenticated" ? 401 : 403);
  }
  const actor: ReceiptControlActor = {
    tenantId: ctx.session.tenantId!,
    n3UserKey: ctx.session.n3UserKey,
    n3Token: ctx.session.n3Token,
    role: ctx.role!,
  };
  try {
    const res = await run(actor);
    if (write && res.ok) {
      // Best effort: with no transport configured this only marks alerts "disabled".
      try {
        const { deliverReceiptAlerts, supabaseAlertDeliveryDb } =
          await import("./receipt-alert-delivery.server");
        await deliverReceiptAlerts(actor.tenantId, supabaseAlertDeliveryDb());
      } catch {
        /* outbox keeps the alert pending; status stays visible */
      }
    }
    return res;
  } catch (err) {
    const code = err instanceof ReceiptControlError ? err.code : "receipt_control_store_failed";
    if (code === "unauthorized") {
      const { denyN3Unauthorized } = await import("@/routes/api/hotel/reservations.$id.deposits");
      return denyN3Unauthorized("receipt_controls");
    }
    if (!(err instanceof ReceiptControlError))
      console.error("[receipt-controls] failed", (err as Error).message?.slice(0, 200));
    return json({ error: code }, statusForReceiptControlError(code));
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {
    /* fallthrough */
  }
  throw new ReceiptControlError("invalid_body");
}
