import type { ReceiptSnapshot } from "../../receipt-controls";

/** Synthetic MYR50 unmatched active receipt. No live N3 or guest data. */
export function receiptSnapshot(overrides: Partial<ReceiptSnapshot> = {}): ReceiptSnapshot {
  return {
    receiptId: "11111111-1111-4111-8111-111111111111",
    docCode: "OR-TEST/001",
    documentDate: "2026-10-01",
    customerId: "22222222-2222-4222-8222-222222222222",
    currency: "MYR",
    amountCents: 5000,
    paymentLines: [
      {
        accountId: "33333333-3333-4333-8333-333333333333",
        code: "BANK-T",
        savedName: "Test Bank",
        amountCents: 5000,
      },
    ],
    contact: {
      customerName: "Test Guest",
      remark1: "1 Test Street",
      remark2: "",
      remark3: "0100000000",
      remark4: "guest@example.test",
    },
    documentState: "active",
    matchingState: "unmatched",
    sourceFingerprint: "fp-original",
    verifiedAt: "2026-10-02T00:00:00.000Z",
    ...overrides,
  };
}
