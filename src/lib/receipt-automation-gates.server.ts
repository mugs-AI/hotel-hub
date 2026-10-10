import type { ReceiptControlActor } from "./receipt-controls-evidence.server";
import type { N3UpdateContract } from "./n3-receipt-update.server";
import { isDepositWriteEnabled } from "./deposits-store.server";
export type ReceiptAutomationActor = ReceiptControlActor & { n3TenantKey: string };
export function automationBudgetMs(env: Record<string, string | undefined>): number | null {
  const value = env.HOTELHUB_RECEIPT_EXECUTION_BUDGET_MS;
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
export function canAutoUpdate(
  actor: ReceiptAutomationActor,
  schemaReady: boolean,
  contract: N3UpdateContract | null,
  env: Record<string, string | undefined>,
): boolean {
  return (
    actor.role === "owner" &&
    schemaReady &&
    contract !== null &&
    contract.proofId !== "FIXTURE_ONLY" &&
    env.HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT === "true" &&
    automationBudgetMs(env) !== null &&
    isDepositWriteEnabled(actor.n3TenantKey, env) &&
    (env.HOTELHUB_RECEIPT_EDIT_TENANT_ALLOWLIST ?? "")
      .split(",")
      .map((x) => x.trim())
      .includes(actor.n3TenantKey)
  );
}
