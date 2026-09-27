// Read-only N3 Chart of Accounts choices; Owner may set display names by immutable account ID.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import { getHotelSettingsReadOnly, setPaymentAccountAlias } from "@/lib/hotel-store.server";
import {
  DepositError,
  listEligiblePaymentAccounts,
  parseDepositAccount,
  parseNewReceiptDefaults,
} from "@/lib/deposits-store.server";
import { isRealN3Id, n3Receipts } from "@/lib/n3-receipts.server";
import { deny, denyN3Unauthorized, isSameOriginWrite } from "./reservations.$id.deposits";

export async function handlePaymentAccountsGet(): Promise<Response> {
  const { ctx, decision } = await requirePermission("hotel:deposits:view");
  if (!decision.ok) return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  try {
    const defaultsOutcome = await n3Receipts.getNew(ctx.session.n3Token);
    if (defaultsOutcome.kind === "response" && defaultsOutcome.status === 401)
      return denyN3Unauthorized("payment-accounts.get");
    const defaults = parseNewReceiptDefaults(defaultsOutcome);
    if (!defaults) return deny(502, "n3_defaults_unavailable");
    const accounts = await listEligiblePaymentAccounts(
      n3Receipts,
      ctx.session.n3Token,
      defaults.currencyId,
    );
    const settings = await getHotelSettingsReadOnly(ctx.session.tenantId!);
    const aliases = settings?.paymentAccountAliases ?? {};
    return Response.json(
      {
        accounts: accounts.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          kind: a.kind,
          label: aliases[a.id] || `${a.code} — ${a.name}`,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof DepositError && error.code === "unauthorized")
      return denyN3Unauthorized("payment-accounts.get");
    console.error("[payment-accounts.get] failed", (error as Error).message?.slice(0, 200));
    return deny(502, "n3_deposit_account_unavailable");
  }
}

export async function handlePaymentAccountAliasPatch({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (!isSameOriginWrite(request)) return deny(403, "cross_site_denied");
  const { ctx, decision } = await requirePermission("hotel:setup");
  if (!decision.ok) return deny(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return deny(400, "invalid_json");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return deny(400, "invalid_body");
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== "accountId" && k !== "label"))
    return deny(400, "unknown_field");
  const label = typeof b.label === "string" ? b.label.trim() : null;
  if (
    !isRealN3Id(b.accountId) ||
    label === null ||
    label.length > 40 ||
    [...label].some((c) => c.charCodeAt(0) < 32 || c === "<" || c === ">")
  )
    return deny(400, "invalid_alias");
  try {
    const defaultsOutcome = await n3Receipts.getNew(ctx.session.n3Token);
    if (defaultsOutcome.kind === "response" && defaultsOutcome.status === 401)
      return denyN3Unauthorized("payment-accounts.patch");
    const defaults = parseNewReceiptDefaults(defaultsOutcome);
    if (!defaults) return deny(502, "n3_defaults_unavailable");
    const outcome = await n3Receipts.getAccountById(ctx.session.n3Token, b.accountId);
    if (outcome.kind === "response" && outcome.status === 401)
      return denyN3Unauthorized("payment-accounts.patch");
    const verified = parseDepositAccount(outcome, b.accountId, defaults.currencyId);
    if (!verified) return deny(400, "n3_deposit_account_invalid");
    const settings = await setPaymentAccountAlias(ctx.session.tenantId!, verified.id, label);
    await logAudit({
      tenantId: ctx.session.tenantId!,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.payment_account.alias_updated",
      detail: { accountCode: verified.code },
    });
    return Response.json({ settings }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[payment-accounts.patch] failed", (error as Error).message?.slice(0, 200));
    return deny(502, "payment_account_save_failed");
  }
}

export const Route = createFileRoute("/api/hotel/payment-accounts")({
  server: { handlers: { GET: handlePaymentAccountsGet, PATCH: handlePaymentAccountAliasPatch } },
});
