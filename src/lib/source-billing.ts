// Browser-safe frozen payer facts. A presentation title is not an N3 document type.
import type { SettlementScope, SettlementSnapshot } from "./settlement";

export type CollectionMode = "guest" | "source";
export type SourceBillingPolicy = {
  sourceId: string;
  version: string;
  defaultCollectionMode: CollectionMode;
  allowedCollectionModes: CollectionMode[];
  sourceCustomerId: number | null;
  guestCustomerId: number;
  guestDocumentTitle: string;
  guestItemDescription: string;
  showRoomPrices: boolean;
};
export type ReservationPayerSnapshot = {
  policy: SourceBillingPolicy;
  collectionMode: CollectionMode;
  confirmedBy: string;
  confirmedAt: string;
};
export type BillingLegKind = "source_room" | "guest";
export type BillingLegSnapshot = {
  legId: string;
  kind: BillingLegKind;
  customerId: number;
  collectionMode: CollectionMode;
  documentTitle: string;
  itemDescription: string;
  showPrices: boolean;
  snapshot: SettlementSnapshot;
};
export type SourceBillPlan = {
  version: 1;
  scope: SettlementScope;
  payer: ReservationPayerSnapshot;
  legs: BillingLegSnapshot[];
  totalCents: number;
  digest: string;
};
