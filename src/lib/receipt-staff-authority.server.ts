import { ReceiptControlError } from "./receipt-controls";
import type { ReceiptAutomationActor } from "./receipt-automation-gates.server";
import type { RequestContext } from "./session-context.server";

export function assertFreshReceiptContext(
  actor: ReceiptAutomationActor,
  ctx: RequestContext,
): void {
  if (!ctx.authenticated) throw new ReceiptControlError("unauthorized");
  if (
    !["owner", "front_desk"].includes(actor.role) ||
    ctx.role !== actor.role ||
    ctx.session.tenantId !== actor.tenantId ||
    ctx.session.n3UserKey !== actor.n3UserKey ||
    ctx.session.n3Token !== actor.n3Token
  )
    throw new ReceiptControlError("forbidden");
}

/** Caller credentials and local assignment are revalidated at each financial fence.
 * N3's receipt endpoint decides operation rights; directory roles never grant them. */
export async function requireFreshReceiptActor(actor: ReceiptAutomationActor): Promise<void> {
  const [
    { invalidateNeutralValidation },
    { invalidateOwnershipCacheForUser },
    { readRequestContext },
  ] = await Promise.all([
    import("./n3-token-validation.server"),
    import("./n3-owner.server"),
    import("./session-context.server"),
  ]);
  invalidateNeutralValidation(actor.n3Token);
  invalidateOwnershipCacheForUser(actor.tenantId, actor.n3UserKey);
  assertFreshReceiptContext(actor, await readRequestContext());
}
