// Browser-safe settlement facts and DTOs. No transport or credential storage.
export type Cents = number;
export type Revision = string;
export type SettlementScope = { tenantId: string; reservationId: string };
export type EvidenceResult<T> =
  | { kind: "confirmed"; value: T }
  | { kind: "contradiction" | "unavailable"; code: string };

export type SourceVersion = { table: string; id: string; version: string };
export type ChargeLine = {
  localLineId: string;
  kind: string;
  stockId: number;
  uomId: number;
  taxCodeId: number;
  qty: number;
  unitCents: Cents;
  subtotalCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
  description: string;
  mappingEvidence: Record<string, unknown>;
};
export type PaymentSnapshot = {
  accountId: string;
  accountCode: string;
  accountName: string;
  amountCents: Cents;
};
export type LinkedReceipt = {
  depositId: string;
  reservationId: string;
  receiptId: string;
  reference: string;
  customerId: number;
  currency: string;
  amountCents: Cents;
  receiptDate: string;
  payments: PaymentSnapshot[];
};
export type BillToSnapshot = {
  name: string;
  company: string;
  address: string;
  phone: string;
  email: string;
};
export type SettlementSnapshot = SettlementScope & {
  folioId: string;
  digest: string;
  revision: Revision;
  currency: string;
  currencyId: number;
  currencyRate: number;
  propertyTimezone: string;
  billDate: string;
  customerId: number;
  billTo: BillToSnapshot;
  lines: ChargeLine[];
  totalCents: Cents;
  receipts: LinkedReceipt[];
  sourceVersions: SourceVersion[];
};
export type SettlementState =
  | "frozen"
  | "bill_dispatched"
  | "bill_verified"
  | "allocating"
  | "awaiting_payment"
  | "balance_dispatched"
  | "settled"
  | "closing"
  | "closed"
  | "needs_review"
  | "abandoned";
export type StepKind = "bill" | "deposit_allocation" | "balance_receipt" | "balance_allocation";
export type DispatchClaim = {
  attemptId: string;
  intentId: string;
  kind: StepKind;
  receiptId?: string;
  expectedRevision: Revision;
  payloadDigest: string;
};
export type DispatchOutcome = {
  kind: "confirmed" | "rejected" | "unknown";
  code: string;
  documentId?: string;
  httpStatus?: number;
};
export type Intent = SettlementScope & {
  id: string;
  revision: Revision;
  state: SettlementState;
  snapshot: SettlementSnapshot;
  dispatches: Array<{ claim: DispatchClaim; outcome: DispatchOutcome | null }>;
};
export type SettlementStepInput =
  | {
      action: "post_bill";
      clientRequestId: string;
      snapshotDigest: string;
      expectedRevision: Revision;
      intentId?: string;
    }
  | {
      action: "apply_deposits" | "receive_balance" | "apply_balance" | "close";
      intentId: string;
      expectedRevision: Revision;
      selectedAccountId?: string;
    };
export type AcceptedContract = {
  operation: StepKind;
  evidenceHash: string;
  concurrencyProofHash: string | null;
  allocationMode: "preserve_existing" | null;
  billTarget?: "same_id_INV" | null;
};
export type SettlementView = SettlementScope & {
  intentId: string | null;
  snapshotDigest: string | null;
  revision: Revision;
  state: SettlementState | null;
  currency: string;
  bill: {
    id: string;
    code: string;
    documentDate: string;
    totalCents: Cents;
    outstandingCents: Cents;
  } | null;
  receipts: Array<{
    id: string;
    code: string;
    documentDate: string;
    amountCents: Cents;
    allocatedCents: Cents;
    remainderCents: Cents;
  }>;
  blockers: string[];
  allowedActions: SettlementStepInput["action"][];
  verifiedAt: string | null;
};
