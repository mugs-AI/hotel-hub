import type { AcceptedContract, EvidenceResult, StepKind } from "./settlement";

// Activation requires separately reviewed API evidence. Never read browser/env flags here.
export function billingContractGate(_operation: StepKind): EvidenceResult<AcceptedContract> {
  return { kind: "unavailable", code: "n3_billing_contract_unverified" };
}

/** Split Create and exact multi-debit readback require their own acceptance. */
export function splitBalanceReceiptGate(): EvidenceResult<never> {
  return { kind: "unavailable", code: "n3_split_balance_contract_unverified" };
}
