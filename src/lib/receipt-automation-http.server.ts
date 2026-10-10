import { ReceiptControlError } from "./receipt-controls";
export function validateAutomaticActionBody(
  value: unknown,
  action: "approve" | "apply",
): { expectedVersion: number; action: "approve" | "apply" } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ReceiptControlError("invalid_body");
  const b = value as Record<string, unknown>;
  if (
    Object.keys(b).some((k) => !["expectedVersion", "decision"].includes(k)) ||
    !Number.isSafeInteger(b.expectedVersion) ||
    Number(b.expectedVersion) < 1 ||
    (b.decision !== undefined && b.decision !== action)
  )
    throw new ReceiptControlError("invalid_body");
  return { expectedVersion: b.expectedVersion as number, action };
}
