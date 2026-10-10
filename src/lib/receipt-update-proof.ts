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
  // Optional for reports written before diagnostics were available.
  attempt?: ProofAttempt;
  readback?: ProofReadback;
};
export type ProofAttempt = {
  stage:
    | "owner_refresh"
    | "update_preflight"
    | "update"
    | "readback"
    | "owner_readback"
    | "complete";
  dispatch: "not_started" | "attempted";
  reason: string | null;
  httpStatus: number | null;
  envelopeCode: string | null;
  durationMs: number;
};
export type ProofReadback = {
  outcome: "verified" | "mismatch" | "unavailable";
  observedCents: number | null;
  reason: string | null;
};
