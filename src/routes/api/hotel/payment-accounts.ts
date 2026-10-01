// Read-only N3 choices; Owner controls local names and visibility by immutable account ID.
import { createFileRoute } from "@tanstack/react-router";
import { requirePermission } from "@/lib/session-context.server";
import { logAudit } from "@/lib/audit.server";
import { getHotelSettingsReadOnly, setPaymentAccountPreferences } from "@/lib/hotel-store.server";
import {
  DepositError,
  listEligiblePaymentAccounts,
  parseDepositAccount,
  readPaymentAccountCurrency,
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
    if (defaultsOutcome.kind === "response" && defaultsOutcome.status === 403)
      return deny(403, "n3_receipt_access_denied");
    const defaults = readPaymentAccountCurrency(defaultsOutcome);
    if (!defaults.ok) return deny(502, defaults.error);
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
          label: aliases[a.id.toLowerCase()] || `${a.code} — ${a.name}`,
          show: settings?.paymentAccountVisibility?.[a.id.toLowerCase()] !== false,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof DepositError && error.code === "unauthorized")
      return denyN3Unauthorized("payment-accounts.get");
    if (error instanceof DepositError && error.code === "n3_account_access_denied")
      return deny(403, error.code);
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
  if (Object.keys(b).some((k) => k !== "accountId" && k !== "label" && k !== "show"))
    return deny(400, "unknown_field");
  const hasLabel = Object.hasOwn(b, "label");
  const hasShow = Object.hasOwn(b, "show");
  const label = typeof b.label === "string" ? b.label.trim() : null;
  if (
    !isRealN3Id(b.accountId) ||
    (!hasLabel && !hasShow) ||
    (hasShow && typeof b.show !== "boolean") ||
    (hasLabel &&
      (label === null ||
        label.length > 40 ||
        [...label].some((c) => c.charCodeAt(0) < 32 || c === "<" || c === ">")))
  )
    return deny(400, "invalid_payment_preferences");
  try {
    const defaultsOutcome = await n3Receipts.getNew(ctx.session.n3Token);
    if (defaultsOutcome.kind === "response" && defaultsOutcome.status === 401)
      return denyN3Unauthorized("payment-accounts.patch");
    if (defaultsOutcome.kind === "response" && defaultsOutcome.status === 403)
      return deny(403, "n3_receipt_access_denied");
    const defaults = readPaymentAccountCurrency(defaultsOutcome);
    if (!defaults.ok) return deny(502, defaults.error);
    const outcome = await n3Receipts.getAccountById(ctx.session.n3Token, b.accountId);
    if (outcome.kind === "response" && outcome.status === 401)
      return denyN3Unauthorized("payment-accounts.patch");
    if (outcome.kind === "response" && outcome.status === 403)
      return deny(403, "n3_account_access_denied");
    const verified = parseDepositAccount(outcome, b.accountId, defaults.currencyId);
    if (!verified) return deny(400, "n3_deposit_account_invalid");
    const settings = await setPaymentAccountPreferences(
      ctx.session.tenantId!,
      verified.id.toLowerCase(),
      {
        ...(hasLabel ? { label: label! } : {}),
        ...(hasShow ? { show: b.show as boolean } : {}),
      },
    );
    await logAudit({
      tenantId: ctx.session.tenantId!,
      n3UserKey: ctx.session.n3UserKey,
      eventType: "hotel.payment_account.preferences_updated",
      detail: {
        accountCode: verified.code,
        nameChanged: hasLabel,
        ...(hasShow ? { show: b.show } : {}),
      },
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
