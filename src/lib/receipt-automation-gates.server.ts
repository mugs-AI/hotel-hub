import type { ReceiptControlActor } from "./receipt-controls-evidence.server";
import type { N3UpdateContract } from "./n3-receipt-update.server";
import { isDepositWriteEnabled } from "./deposits-store.server";
import type { ScopedDeposit } from "./receipt-controls-evidence.server";
import type { AutomationRequestRow } from "./receipt-automation-store.server";
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

// Dormant preparation for the Owner-selected HH-created test fixture. The source
// manifest alone grants no financial write: the separate runtime flag defaults
// OFF, and activation/amount cases/expiry require their own reviewed release.
export const SCOPED_RECEIPT_UAT = Object.freeze({
  tenantId: "075e94a3-3876-4293-8ec5-3c541c028a09",
  n3TenantKey: "ca75ed66-69ac-40d9-92f1-f6b3a8780fdd",
  reservationId: "cab3c4fd-ad27-498b-8681-15b32f114abe",
  depositId: "6d4995db-80d6-43f7-a032-1848b3e3e069",
  receiptId: "e0f206a5-43b6-49fb-18d1-08df276e8ec7",
  docCode: "OR2610/003",
  reference: "HH-6d4995db80d643f7a0321848",
  customerId: "1382639",
  customerCode: "700-7001",
  accountId: "c3c22459-c2b7-4c43-8e43-8b52a9adabda",
  accountCode: "700-0310",
  documentDate: "2026-10-11",
  expiresAt: Date.parse("2026-10-13T20:00:00+08:00"),
});
const sameId = (value: unknown, expected: string) =>
  typeof value === "string" && value.toLowerCase() === expected.toLowerCase();
function scopedRuntimeReady(
  actor: ReceiptAutomationActor,
  schemaReady: boolean,
  contract: N3UpdateContract | null,
  env: Record<string, string | undefined>,
  now: number,
) {
  return (
    env.HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED === "true" &&
    // This lane cannot be mistaken for activating the normal tenant-wide writer.
    env.HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT !== "true" &&
    Number.isFinite(now) &&
    now < SCOPED_RECEIPT_UAT.expiresAt &&
    actor.role === "owner" &&
    sameId(actor.tenantId, SCOPED_RECEIPT_UAT.tenantId) &&
    sameId(actor.n3TenantKey, SCOPED_RECEIPT_UAT.n3TenantKey) &&
    canAutoUpdate(actor, schemaReady, contract, {
      ...env,
      HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT: "true",
    })
  );
}
export function canCreateScopedReceiptUat(
  actor: ReceiptAutomationActor,
  schemaReady: boolean,
  contract: N3UpdateContract | null,
  env: Record<string, string | undefined>,
  selection: { reservationId: string; deposit: ScopedDeposit },
  now = Date.now(),
): boolean {
  const f = SCOPED_RECEIPT_UAT,
    d = selection.deposit;
  return (
    scopedRuntimeReady(actor, schemaReady, contract, env, now) &&
    sameId(selection.reservationId, f.reservationId) &&
    sameId(d.reservationId, f.reservationId) &&
    sameId(d.id, f.depositId) &&
    d.status === "posted" &&
    sameId(d.n3ReceiptId, f.receiptId) &&
    d.n3DocCode === f.docCode &&
    d.n3ReferenceNo === f.reference &&
    d.n3CustomerId === f.customerId &&
    d.n3CustomerCode === f.customerCode &&
    d.currencyCode === "MYR" &&
    d.paymentLines.length === 1 &&
    sameId(d.paymentLines[0]!.id, f.accountId) &&
    d.paymentLines[0]!.code === f.accountCode
  );
}
export function canExecuteScopedReceiptUat(
  actor: ReceiptAutomationActor,
  schemaReady: boolean,
  contract: N3UpdateContract | null,
  env: Record<string, string | undefined>,
  row: Pick<
    AutomationRequestRow,
    "generation" | "tenantId" | "reservationId" | "depositId" | "original" | "proposal"
  >,
  now = Date.now(),
): boolean {
  const f = SCOPED_RECEIPT_UAT,
    o = row.original,
    p = row.proposal;
  return (
    scopedRuntimeReady(actor, schemaReady, contract, env, now) &&
    row.generation === 2 &&
    sameId(row.tenantId, f.tenantId) &&
    sameId(row.reservationId, f.reservationId) &&
    sameId(row.depositId, f.depositId) &&
    sameId(o.receiptId, f.receiptId) &&
    o.docCode === f.docCode &&
    o.documentDate === f.documentDate &&
    o.reference === f.reference &&
    o.customerId === f.customerId &&
    o.customerCode === f.customerCode &&
    o.currency === "MYR" &&
    o.paymentLines.length === 1 &&
    sameId(o.paymentLines[0]!.accountId, f.accountId) &&
    o.paymentLines[0]!.code === f.accountCode &&
    o.paymentLines[0]!.amountCents === o.amountCents &&
    p.kind === "correction" &&
    sameId(p.accountId, f.accountId) &&
    ((o.amountCents === 7000 && p.amountCents === 8500) ||
      (o.amountCents === 8500 && p.amountCents === 7000)) &&
    (["customerName", "remark1", "remark2", "remark3", "remark4"] as const).every(
      (key) => o.contact[key] === p.contact[key],
    )
  );
}

/** Only the chosen deposit is reserved to the scoped lane when that lane is ON.
 * Denial uses route identity, so bad stored metadata cannot fall into manual
 * persistence. Other deposits retain their existing manual workflow. */
export function scopedReceiptUatSelected(
  actor: ReceiptControlActor,
  depositId: unknown,
  env: Record<string, string | undefined>,
): boolean {
  return (
    env.HOTELHUB_RECEIPT_SCOPED_UAT_ENABLED === "true" &&
    env.HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT !== "true" &&
    sameId(actor.tenantId, SCOPED_RECEIPT_UAT.tenantId) &&
    sameId(depositId, SCOPED_RECEIPT_UAT.depositId)
  );
}
