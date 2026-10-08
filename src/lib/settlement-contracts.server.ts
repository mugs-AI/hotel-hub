import type { AcceptedContract, EvidenceResult, StepKind } from "./settlement";

// Activation requires separately reviewed API evidence. Never read browser/env flags here.
export function billingContractGate(_operation: StepKind): EvidenceResult<AcceptedContract> {
  return { kind: "unavailable", code: "n3_billing_contract_unverified" };
}
