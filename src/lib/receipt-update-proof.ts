// Browser-safe proof summaries. No credentials, contact bodies or financial payloads.
export type ProofSummary = {
  caseId: string;
  companyName: string;
  receiptId: string;
  docCode: string;
  documentDate: string;
  beforeCents: number;
  afterCents: number;
  packageHash: string;
  sourceReference: string;
  expiresAt: number;
};
export type ProofReport = ProofSummary & {
  outcome: "verified" | "needs_review";
  journalVerified: boolean;
  conditionalWrite: "not_proven";
  reservationCount: 1;
  durationMs: number;
};
