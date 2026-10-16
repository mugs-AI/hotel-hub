// Browser-safe, fixed codes/messages only. No database text or guest facts.
export const SETTLEMENT_LOCK_CODES = ["settlement_locked", "settlement_busy"] as const;
export type SettlementLockCode = (typeof SETTLEMENT_LOCK_CODES)[number];
export function settlementLockCode(error: unknown): SettlementLockCode | null {
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return message === "settlement_locked" || message === "settlement_busy" ? message : null;
}
export function settlementLockMessage(code: unknown): string | null {
  if (code === "settlement_locked")
    return "Billing is frozen for this stay. Review its settlement before making financial changes.";
  if (code === "settlement_busy")
    return "Another reservation operation is running. Refresh before making changes.";
  return null;
}
