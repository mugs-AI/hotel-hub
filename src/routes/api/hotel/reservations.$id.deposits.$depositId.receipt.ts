// GET-only printable receipt evidence. Owner + Front Desk, tenant scoped.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { isUuidLike } from "@/lib/deposits-store.server";
import { DepositReceiptError, loadPrintableDepositReceipt } from "@/lib/deposit-receipt.server";
import { deny, denyN3Unauthorized } from "./reservations.$id.deposits";

export async function handleDepositReceipt({
  params,
}: {
  params: { id?: string; depositId?: string };
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:deposits:view");
  if (!decision.ok) return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  const reservationId = params.id ?? "";
  const depositId = params.depositId ?? "";
  if (!isUuidLike(reservationId) || !isUuidLike(depositId)) return deny(400, "invalid_id");
  try {
    const receipt = await loadPrintableDepositReceipt({
      tenantId: ctx.session.tenantId!,
      reservationId,
      depositId,
      n3Token: ctx.session.n3Token,
    });
    return Response.json({ receipt }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof DepositReceiptError) {
      if (err.code === "unauthorized") return denyN3Unauthorized("deposit.receipt");
      return deny(err.status, err.code);
    }
    console.error("[deposit.receipt] failed", (err as Error).message?.slice(0, 120));
    return deny(500, "receipt_read_failed");
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/deposits/$depositId/receipt")({
  server: { handlers: { GET: handleDepositReceipt } },
});
