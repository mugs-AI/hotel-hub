import type { EvidenceResult } from "./settlement";
export type SourceBillingDocumentContract = {
  documentType: "cash_sale";
  postToAR: true;
  evidenceHash: string;
};
// Existing Cash Sale shape has isPostToAR=true. That does not establish current
// source-debtor credit behavior or caller numbering acceptance. No flag unlocks it.
export function sourceBillingDocumentGate(): EvidenceResult<SourceBillingDocumentContract> {
  return { kind: "unavailable", code: "n3_source_billing_contract_unverified" };
}
// Sales Invoice Create/read DTOs and legal print semantics require their own
// accepted evidence. Do not route a custom print title to a guessed SI endpoint.
