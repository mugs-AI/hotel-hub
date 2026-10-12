// Browser-safe observations. No posting, persistence, spendable-credit or close authority.
export type SavedDocumentCheck = {
  tenantId: string;
  reservationId: string;
  intentId: string;
  status: "confirmed" | "waiting" | "needs_review" | "unauthorized";
  code: string;
  checkedAt: string;
  observations: number;
  persistenceProven: false;
  billOutstandingCents: number | null;
  documents: Array<{ id: string; code: string; kind: "bill" | "receipt" }>;
  responses: Array<{
    documentId: string;
    operation: "detail" | "journal";
    httpStatus: number | null;
    businessCode: string | null;
  }>;
  attempts: Array<{ attemptId: string; operation: string; code: string }>;
  checks: Array<{
    name: "identity" | "status" | "money" | "journal" | "relationships" | "completeness";
    status: "observed" | "unavailable";
    code: string;
  }>;
};

export type SavedDocumentSelection = {
  tenantId: string;
  reservationId: string;
  intentId: string | null;
  currency: string;
};
