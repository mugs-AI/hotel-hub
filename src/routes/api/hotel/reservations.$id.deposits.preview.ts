// POST /api/hotel/reservations/:id/deposits/preview
// Owner only. READ-ONLY: builds the confirmation preview from authoritative
// server sources (reservation, tenant walk-in mapping, GET /api/ARReceipts/New).
// Returns labels only — never internal N3 ids, tokens or raw payloads.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import {
  buildDepositPreview,
  DepositError,
  DEPOSIT_ERROR_CODES,
  isUuidLike,
} from "@/lib/deposits-store.server";
import { deny, denyN3Unauthorized, isSameOriginWrite, statusForDepositError } from "./reservations.$id.deposits";

export async function handleDepositPreview({
  request,
  params,
}: {
  request: Request;
  params: { id?: string };
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "cross_site_denied");
  const { ctx, decision } = await requirePermission("hotel:deposits:create");
  if (!decision.ok) {
    await logAudit({
      tenantId: ctx.session.tenantId ?? undefined,
      n3UserKey: ctx.session.n3UserKey ?? undefined,
      eventType: "hotel.deposit.denied",
      detail: { reason: decision.reason, permission: "hotel:deposits:create", action: "preview" },
    });
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!isUuidLike(id)) return deny(400, "invalid_id");

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return deny(400, "invalid_json");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return deny(400, "invalid_body");
  }
  const body = parsed as Record<string, unknown>;
  for (const k of Object.keys(body)) {
    if (k !== "amount") return deny(400, "unknown_field");
  }

  try {
    const preview = await buildDepositPreview({
      tenantId: ctx.session.tenantId!,
      n3TenantKey: ctx.session.n3TenantKey,
      reservationId: id,
      n3Token: ctx.session.n3Token,
      amount: body.amount as number,
    });
    return Response.json({ preview }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const code =
      err instanceof DepositError && DEPOSIT_ERROR_CODES.has(err.code)
        ? err.code
        : "deposit_read_failed";
    if (code === "unauthorized") return denyN3Unauthorized("deposits.preview");
    if (!(err instanceof DepositError)) {
      console.error("[deposits.preview] failed", (err as Error).message?.slice(0, 200));
    }
    return deny(statusForDepositError(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/deposits/preview")({
  server: { handlers: { POST: handleDepositPreview } },
});
