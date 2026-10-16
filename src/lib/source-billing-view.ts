import type { SettlementView } from "./settlement";
import type { BillingLegKind } from "./source-billing";
// Allowlisted browser projection; never serialize raw snapshots/credentials.
export type SourceStayView = {
  reservationId: string;
  revision: string;
  planDigest: string;
  legs: Array<{ legId: string; kind: BillingLegKind; hhNumber: string; view: SettlementView }>;
  blockers: string[];
  canClose: boolean;
};
