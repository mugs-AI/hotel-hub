import type { HotelFinancialEvent } from "../../financial-reporting";

/** A confirmed MYR50 HotelHub deposit dated 2026-10-01. */
export function financialEvent(overrides: Partial<HotelFinancialEvent> = {}): HotelFinancialEvent {
  return {
    transactionId: "dep-1",
    documentId: "11111111-1111-4111-8111-111111111111",
    documentCode: "OR2610/900",
    documentDate: "2026-10-01",
    bookingReference: "BK261001001",
    customerLabel: "Walk-in",
    currency: "MYR",
    amountCents: 5000,
    creationAmountCents: 5000,
    kind: "deposit",
    state: "active",
    receiptStatus: "active",
    savedPaymentName: "Maybank",
    paymentAccountId: "acc-1",
    accountCode: "310-000",
    replacementOf: null,
    replacementReceiptId: null,
    requesterLabel: null,
    approverLabel: null,
    reason: null,
    confirmedVoidAt: null,
    ...overrides,
  };
}
