import { vi } from "vitest";
import { settlementFixture } from "./settlement";
import { n3BillingClient } from "../../n3-billing.server";
import { proveBill, proveReceiptBefore } from "../../settlement-evidence.server";
import type { EvidenceResult } from "../../settlement";
import type { SettlementActor } from "../../settlement-context.server";
export const fixtureActor: SettlementActor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  n3UserKey: "synthetic-owner",
  n3Token: "synthetic-token",
  role: "owner",
};
export const fixtureBillId = "22222222-2222-4222-8222-222222222222",
  fixtureIntentId = "44444444-4444-4444-8444-444444444444";
const arId = "55555555-5555-4555-8555-555555555555",
  salesId = "66666666-6666-4666-8666-666666666666";
export function evidenceSnapshot() {
  const s = settlementFixture();
  s.lines[0].mappingEvidence = {
    arAccountId: arId,
    arAccountCode: "SYNTHETIC-AR",
    salesAccountId: salesId,
    salesAccountCode: "SYNTHETIC-SALES",
  };
  return s;
}
export function evidenceValue<T>(r: EvidenceResult<T>): T {
  if (r.kind !== "confirmed") throw new Error("synthetic fixture not confirmed: " + r.code);
  return r.value;
}
function gl(
  accountId: string,
  code: string,
  debit: number,
  credit: number,
  docCode: string,
  referenceNo: string,
  docDate: string,
) {
  return {
    isCancelled: false,
    accountId,
    account: { id: accountId, code },
    debit,
    credit,
    docCode,
    referenceNo,
    docDate,
    currencyId: 1,
    currencyRate: 1,
    customerId: 7,
  };
}
export async function evidenceBill(outstanding = 30, s = evidenceSnapshot()) {
  const referenceNo = "HH-B-" + fixtureIntentId.replace(/-/g, ""),
    docCode = "CS-SYNTHETIC";
  const detail = {
    isCancelled: false,
    id: fixtureBillId,
    docType: "CS",
    docCode,
    docDate: s.billDate,
    referenceNo,
    customerId: s.customerId,
    currencyId: s.currencyId,
    currencyCode: s.currency,
    currencyRate: 1,
    isPostToAR: true,
    totalAmount: 500,
    netTotalAmount: 500,
    subtotalAmount: 500,
    taxTotalAmount: 0,
    outstandingAmount: outstanding,
    itemDetails: [
      {
        pos: 1,
        stockId: 101,
        uomId: 1,
        taxCodeId: 8,
        qty: 1,
        unitPrice: 500,
        amount: 500,
        taxAmount: 0,
        netAmount: 500,
        description: "Room charge",
      },
    ],
  };
  const journal = [
    gl(arId, "SYNTHETIC-AR", 500, 0, docCode, referenceNo, s.billDate),
    gl(salesId, "SYNTHETIC-SALES", 0, 500, docCode, referenceNo, s.billDate),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input) =>
        new Response(
          JSON.stringify({
            code: "0000",
            data: String(input).includes("GLPosting") ? journal : detail,
          }),
        ),
    ),
  );
  return evidenceValue(
    proveBill(
      s,
      await n3BillingClient.readBill(fixtureActor, fixtureBillId),
      await n3BillingClient.readBillJournal(fixtureActor, fixtureBillId),
      fixtureActor,
      { intentId: fixtureIntentId, billId: fixtureBillId },
    ),
  );
}
export function priorRow(amount = 10, docId = "88888888-8888-4888-8888-888888888888") {
  return {
    customerId: 7,
    receiptDocType: "OR",
    receiptDocId: evidenceSnapshot().receipts[0].receiptId,
    docType: "INV",
    docId,
    paymentAmount: amount,
    currencyCode: "MYR",
    currencyRate: 1,
  };
}
export async function evidenceReceipt(
  prior: unknown[] = [],
  remainder = 50,
  s = evidenceSnapshot(),
) {
  const r = s.receipts[0],
    docCode = "OR-SYNTHETIC",
    p = r.payments[0];
  const detail = {
    isCancelled: false,
    id: r.receiptId,
    docType: "AROR",
    docCode,
    docDate: r.receiptDate,
    referenceNo: r.reference,
    customerId: 7,
    customerCode: "SYNTHETIC-AR",
    currencyId: 1,
    currencyCode: "MYR",
    currencyRate: 1,
    totalAmount: 50,
    netTotalAmount: 50,
    accountId: p.accountId,
    accountCode: p.accountCode,
    refundAmount: 0,
    outstandingAmount: remainder,
    knockoff: prior,
  };
  const journal = [
    gl(p.accountId, p.accountCode, 50, 0, docCode, r.reference, r.receiptDate),
    gl(arId, "SYNTHETIC-AR", 0, 50, docCode, r.reference, r.receiptDate),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input) =>
        new Response(
          JSON.stringify({
            code: "0000",
            data: String(input).includes("GLPosting") ? journal : detail,
          }),
        ),
    ),
  );
  return evidenceValue(
    proveReceiptBefore(
      s,
      r,
      await n3BillingClient.readReceipt(fixtureActor, r.receiptId),
      await n3BillingClient.readReceiptJournal(fixtureActor, r.receiptId),
      fixtureActor,
    ),
  );
}
export function accountResponse() {
  const s = evidenceSnapshot();
  return {
    id: s.receipts[0].payments[0].accountId,
    code: "SYNTHETIC-BANK",
    name: "Synthetic bank",
    accountType: { typeCode: "BCA" },
    specialCode: "BAC",
    isActive: true,
    hasChildren: false,
    currencyId: 1,
  };
}
