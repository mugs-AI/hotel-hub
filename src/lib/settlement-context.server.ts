import type { HotelRole } from "./rbac";
import type { Cents, SettlementScope } from "./settlement";

// Credential-bearing context must never be serialized with a snapshot/view.
export type SettlementActor = SettlementScope & {
  n3UserKey: string;
  role: HotelRole;
  n3Token: string;
};

declare const settlementProofBrand: unique symbol;
export type SettlementProof = SettlementScope & {
  readonly [settlementProofBrand]: true;
  digest: string;
  billId: string;
  receiptIds: string[];
  billOutstandingCents: Cents;
  receiptRemainders: Array<{ receiptId: string; remainderCents: Cents }>;
  documentDates: Array<{ documentId: string; date: string }>;
  checkedAt: string;
  evidenceFingerprints: string[];
};

declare const settlementProgressBrand: unique symbol;
export type SettlementProgressProof = SettlementScope & {
  readonly [settlementProgressBrand]: true;
  kind: "bill" | "balance_receipt" | "allocation";
  intentId: string;
  snapshotDigest: string;
  digest: string;
  checkedAt: string;
  bill: Record<string, unknown>;
  receipt: Record<string, unknown> | null;
};
