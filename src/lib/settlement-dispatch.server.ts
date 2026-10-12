import type { Intent, DispatchClaim, DispatchOutcome } from "./settlement";
import type { AllocationPostRow, BalanceReceiptInput } from "./n3-billing.server";
import type { VerifiedReceiptBefore, SettlementReceipt } from "./settlement-evidence.server";

// Immutable recovery facts. Credentials and raw journals never belong here.
export type DispatchFacts = { snapshotDigest: string } & (
  | { kind: "bill"; payload: Record<string, unknown> }
  | {
      kind: "deposit_allocation" | "balance_allocation";
      payload: AllocationPostRow[];
      billId: string;
      receipt: SettlementReceipt;
      before: VerifiedReceiptBefore;
      expectedTotalToBillCents: number;
      expectedAfterFingerprint: string;
    }
  | {
      kind: "balance_receipt";
      payload: Record<string, unknown>;
      input: BalanceReceiptInput;
      account: { id: string; code: string; name: string };
    }
);
export type StoredDispatch = {
  claim: DispatchClaim;
  outcome: DispatchOutcome | null;
  facts?: DispatchFacts;
};
export type StoredIntent = Omit<Intent, "dispatches"> & {
  dispatches: StoredDispatch[];
  evidence?: Record<string, unknown>[];
};
