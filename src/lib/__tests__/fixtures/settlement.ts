import type { SettlementSnapshot } from "../../settlement";

// Synthetic facts; never use the owner's disputed receipt as a transaction fixture.
export function settlementFixture(overrides: Partial<SettlementSnapshot> = {}): SettlementSnapshot {
  return {
    tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    folioId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    digest: "d".repeat(64),
    revision: "0",
    currency: "MYR",
    propertyTimezone: "Asia/Kuala_Lumpur",
    billDate: "2026-10-08",
    customerId: 7,
    billTo: { name: "Synthetic guest", company: "", address: "", phone: "", email: "" },
    lines: [
      {
        localLineId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        kind: "room_night",
        stockId: 101,
        uomId: 1,
        taxCodeId: 8,
        qty: 1,
        unitCents: 50000,
        subtotalCents: 50000,
        taxCents: 0,
        totalCents: 50000,
        description: "Room charge",
        mappingEvidence: { verified: true },
      },
    ],
    totalCents: 50000,
    receipts: [
      {
        depositId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        receiptId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        reference: "HH-SYNTHETIC",
        customerId: 7,
        currency: "MYR",
        amountCents: 5000,
        receiptDate: "2026-09-30",
        payments: [
          {
            accountId: "11111111-1111-4111-8111-111111111111",
            accountCode: "SYNTHETIC-BANK",
            accountName: "Synthetic bank",
            amountCents: 5000,
          },
        ],
      },
    ],
    sourceVersions: [],
    ...overrides,
  };
}
