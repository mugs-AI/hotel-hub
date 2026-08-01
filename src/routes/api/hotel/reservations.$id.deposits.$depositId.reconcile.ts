// POST /api/hotel/reservations/:id/deposits/:depositId/reconcile
// Owner only. GET-only against N3: resolves an uncertain deposit by looking up
// the server-generated reference. It can never create an N3 document.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import {
  DepositError,
  DEPOSIT_ERROR_CODES,
  isUuidLike,
  reconcileDeposit,
  toDepositDTO,
} from "@/lib/deposits-store.server";
import { deny, denyN3Unauthorized, isSameOriginWrite, statusForDepositError } from "./reservations.$id.deposits";

export async function handleDepositReconcile({
  request,
  params,
}: {
  request: Request;
  params: { id?: string; depositId?: string };
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "cross_site_denied");
  const { ctx, decision } = await requirePermission("hotel:deposits:create");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  const depositId = params.depositId ?? "";
  if (!isUuidLike(id) || !isUuidLike(depositId)) return deny(400, "invalid_id");
  try {
    const deposit = await reconcileDeposit({
      tenantId: ctx.session.tenantId!,
      n3TenantKey: ctx.session.n3TenantKey,
      reservationId: id,
      depositId,
      actorN3UserKey: ctx.session.n3UserKey,
      n3Token: ctx.session.n3Token,
    });
    return Response.json(
      { deposit: toDepositDTO(deposit) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const code =
      err instanceof DepositError && DEPOSIT_ERROR_CODES.has(err.code)
        ? err.code
        : "deposit_write_failed";
    if (!(err instanceof DepositError)) {
      console.error("[deposits.reconcile] failed", (err as Error).message?.slice(0, 200));
    }
    return deny(statusForDepositError(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/deposits/$depositId/reconcile")({
  server: { handlers: { POST: handleDepositReconcile } },
});
