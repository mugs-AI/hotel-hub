// GET  /api/hotel/reservations/:id/deposits — Owner only. Sanitized ledger.
// POST /api/hotel/reservations/:id/deposits — Owner only. Creates at most ONE
//   N3 AR Receive Payment (AROR) per client request id. Feature-gated.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import {
  createDeposit,
  DepositError,
  DEPOSIT_ERROR_CODES,
  isDepositWriteEnabled,
  isUuidLike,
  listDeposits,
  toDepositDTO,
} from "@/lib/deposits-store.server";

export function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

/** Reject cross-site writes: this API is only ever called by the app itself. */
export function isSameOriginWrite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return Boolean(site); // no Origin and no Sec-Fetch-Site → reject
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function statusForDepositError(code: string): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "deposit_writes_disabled":
      return 403;
    case "reservation_not_found":
    case "deposit_not_found":
      return 404;
    case "reservation_not_eligible":
    case "deposit_not_uncertain":
    case "reference_conflict":
      return 409;
    case "walk_in_customer_not_mapped":
    case "n3_defaults_unavailable":
    case "n3_defaults_invalid":
      return 502;
    case "invalid_amount":
    case "invalid_client_request_id":
      return 400;
    default:
      return 500;
  }
}

export async function handleDepositsList({
  params,
}: {
  params: { id?: string };
}): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:deposits:view");
  if (!decision.ok) {
    return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }
  const id = params.id ?? "";
  if (!isUuidLike(id)) return deny(400, "invalid_id");
  try {
    const rowsList = await listDeposits(ctx.session.tenantId!, id);
    return Response.json(
      {
        deposits: rowsList.map(toDepositDTO),
        capability: { canCreate: isDepositWriteEnabled(ctx.session.n3TenantKey) },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[deposits.list] failed", (err as Error).message?.slice(0, 200));
    return deny(500, "deposit_read_failed");
  }
}

export async function handleDepositCreate({
  request,
  params,
}: {
  request: Request;
  params: { id?: string };
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "cross_site_denied");
  const { ctx, decision } = await requirePermission("hotel:deposits:create");
  if (!decision.ok) {
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
    if (k !== "amount" && k !== "clientRequestId") return deny(400, "unknown_field");
  }

  try {
    const { deposit } = await createDeposit({
      tenantId: ctx.session.tenantId!,
      n3TenantKey: ctx.session.n3TenantKey,
      reservationId: id,
      actorN3UserKey: ctx.session.n3UserKey,
      n3Token: ctx.session.n3Token,
      amount: body.amount as number,
      clientRequestId: String(body.clientRequestId ?? ""),
    });
    return Response.json(
      { deposit: toDepositDTO(deposit) },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const code =
      err instanceof DepositError && DEPOSIT_ERROR_CODES.has(err.code)
        ? err.code
        : "deposit_write_failed";
    if (!(err instanceof DepositError)) {
      console.error("[deposits.create] failed", (err as Error).message?.slice(0, 200));
    }
    return deny(statusForDepositError(code), code);
  }
}

export const Route = createFileRoute("/api/hotel/reservations/$id/deposits")({
  server: { handlers: { GET: handleDepositsList, POST: handleDepositCreate } },
});
