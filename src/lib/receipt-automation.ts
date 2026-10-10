import type { ChangePolicy, ChangeCategories } from "./hotel-change-controls";
import type { ReceiptControlRequestDTO } from "./receipt-controls";

export type ReceiptAutomationMeta = {
  generation: 2;
  policy: ChangePolicy;
  authorizationKind: "manual_approval" | "direct_policy" | null;
  authorizedBy: string | null;
  authorizedAt: string | null;
  categories: ChangeCategories;
};
export type ReceiptAutomationDTO = ReceiptControlRequestDTO & {
  automation: ReceiptAutomationMeta | null;
  canApply: boolean;
  canCheckResult: boolean;
};
export type ReceiptApplyResult = {
  request: ReceiptAutomationDTO;
  outcome: "applied" | "on_hold" | "needs_review";
  code: string;
};
