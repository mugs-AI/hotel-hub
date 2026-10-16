import type { BillingReadLimit } from "./n3-billing.server";
import type { SettlementActor } from "./settlement-context.server";
export type SourceBillingReadScope = BillingReadLimit & {
  authorize(actor: SettlementActor): Promise<boolean>;
};
/** Recheck before and after each awaited boundary; a late read must not start
 * another operation under an ended session or expired/cancelled request. */
export async function assertSourceRead(
  scope: SourceBillingReadScope | undefined,
  actor: SettlementActor,
): Promise<void> {
  if (!scope) return;
  const live = () => {
    if (scope.signal.aborted || Date.now() >= scope.deadlineAt)
      throw Error("n3_verification_cancelled");
  };
  live();
  if (!(await scope.authorize(actor))) throw Error("n3_session_expired");
  live();
}
