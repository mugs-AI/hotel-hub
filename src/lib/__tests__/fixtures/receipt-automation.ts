import { receiptSnapshot } from "./receipt-controls";
import type { N3UpdateContract } from "../../n3-receipt-update.server";
export const RECEIPT_50 = receiptSnapshot({ reference: "HH-0123456789abcdef01234567" });
export const PROPOSAL_65 = {
  kind: "correction" as const,
  amountCents: 6500,
  accountId: RECEIPT_50.paymentLines[0]!.accountId,
  contact: RECEIPT_50.contact,
};
// SYNTHETIC only: expectedVersion is deliberately NOT a claim about N3 updatedAt.
export const RECEIPT_50_RAW = {
  id: RECEIPT_50.receiptId,
  docCode: RECEIPT_50.docCode,
  docDate: RECEIPT_50.documentDate,
  docType: "AROR",
  customerId: RECEIPT_50.customerId,
  currencyCode: "MYR",
  referenceNo: RECEIPT_50.reference,
  totalAmount: 50,
  netTotalAmount: 50,
  outstandingAmount: 50,
  refundAmount: 0,
  knockoff: [],
  isCancelled: false,
  cancelledDate: null,
  isReconciled: false,
  isMultiPayment: true,
  accountId: PROPOSAL_65.accountId,
  multiPayments: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      accountId: PROPOSAL_65.accountId,
      accountCode: "BANK-T",
      amount: 50,
    },
  ],
  ...RECEIPT_50.contact,
  expectedVersion: "test-version-1",
  description: "Preserve this",
};
export const UPDATE_CONTRACT_TEST_ONLY: N3UpdateContract = {
  proofId: "FIXTURE_ONLY",
  receiptFields: Object.keys(RECEIPT_50_RAW),
  paymentFields: ["id", "accountId", "accountCode", "amount"],
  conditionalWrite: { sourceField: "expectedVersion", requestField: "expectedVersion" },
  noWriteRejectionCodes: ["TEST_STALE"],
};
