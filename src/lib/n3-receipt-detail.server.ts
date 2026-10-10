import { ReceiptControlError } from "./receipt-controls";
import { isUuid } from "./reservations-store.server";
import { AR_RECEIPT_DETAIL_FIELDS } from "./n3-receipt-update-fields";
const fail = (): never => {
  throw new ReceiptControlError("n3_update_unproven");
};
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  return v as Record<string, unknown>;
};
const cents = (v: unknown) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  Number.isSafeInteger(Math.round(v * 100)) &&
  Math.abs(v * 100 - Math.round(v * 100)) < 1e-6
    ? Math.round(v * 100)
    : null;
export function assertReceiptCustomerLookup(
  value: unknown,
  customerId: string,
  customerCode: string | null,
) {
  if (value === null || value === undefined) return;
  const lookup = object(value);
  if (
    String(lookup.id) !== customerId ||
    (lookup.code !== undefined &&
      lookup.code !== null &&
      (typeof lookup.code !== "string" || !customerCode || lookup.code !== customerCode))
  )
    return fail();
}
export const RECEIPT_HEADER_AMOUNT_FIELDS = [
  "totalAmount",
  "netTotalAmount",
  "totalAmountLocal",
  "netTotalAmountLocal",
  "outstandingAmount",
  "outstandingAmountLocal",
  "subtotalAmount",
  "subtotalAmountLocal",
  "taxExclusiveTotalAmount",
  "taxExclusiveTotalAmountLocal",
] as const;
export const RECEIPT_ZERO_AMOUNT_FIELDS = [
  "taxTotalAmount",
  "taxTotalAmountLocal",
  "wTaxTotalAmount",
  "wTaxTotalAmountLocal",
  "wVatTotalAmount",
  "wVatTotalAmountLocal",
  "bankChargesAmount",
  "bankChargesAmountLocal",
  "roundingAdjustment",
  "roundingAdjustmentLocal",
  "refundAmount",
  "refundAmountLocal",
  "totalServiceAmount",
  "totalServiceAmountLocal",
  "taxExemptionTotalAmount",
  "taxExemptionTotalAmountLocal",
  "amountExemptedFromTax",
  "amountLocalExemptedFromTax",
  "rentalLeaseExemptedTaxTotalAmount",
  "rentalLeaseExemptedTaxTotalAmountLocal",
] as const;
export function assertSimpleReceiptHeaderAmounts(
  raw: Record<string, unknown>,
  amountCents: number,
) {
  for (const key of RECEIPT_HEADER_AMOUNT_FIELDS)
    if (key in raw && cents(raw[key]) !== amountCents) return fail();
  for (const key of RECEIPT_ZERO_AMOUNT_FIELDS)
    if (key in raw && cents(raw[key]) !== 0) return fail();
}
/** One documented untaxed MYR receipt detail; preserve its full identity. */
export function buildSingleReceiptDetail(
  details: unknown,
  receiptId: string,
  customerId: string,
  customerCode: string | null,
  beforeCents: number,
  afterCents: number,
): Record<string, unknown> {
  if (!Array.isArray(details) || details.length !== 1) return fail();
  const detail = object(details[0]);
  if (
    Object.keys(detail).some((k) => !AR_RECEIPT_DETAIL_FIELDS.includes(k)) ||
    !isUuid(detail.id) ||
    detail.id === "00000000-0000-0000-0000-000000000000" ||
    detail.receiptId !== receiptId ||
    String(detail.customerId) !== customerId ||
    detail.isTaxInclusive !== false
  )
    return fail();
  for (const key of [
    "taxCodeId",
    "taxCode",
    "tariffCodeId",
    "tariffCode",
    "wTaxCodeId",
    "wTaxCode",
    "wVatCodeId",
    "wVatCode",
    "accountId",
    "account",
    "deferredCurrencyRate",
    "deferredTaxPostingDate",
  ])
    if (key in detail && detail[key] !== null) return fail();
  assertReceiptCustomerLookup(detail.customer, customerId, customerCode);
  for (const key of [
    "taxRate",
    "taxAmount",
    "taxAmountLocal",
    "taxAmountAdjustment",
    "serviceAmount",
    "serviceAmountLocal",
    "taxExemptionRate",
    "taxExemptionAmount",
    "taxExemptionAmountLocal",
    "amountExemptedTax",
    "amountExemptedTaxLocal",
    "wTaxRate",
    "wTaxAmount",
    "wTaxAmountLocal",
    "wTaxAmountAdjustment",
    "wVatRate",
    "wVatAmount",
    "wVatAmountLocal",
    "rentalLeaseExemptedRate",
    "rentalLeaseExemptedTaxAmount",
    "rentalLeaseExemptedTaxAmountLocal",
  ])
    if (key in detail && cents(detail[key]) !== 0) return fail();
  const updated = structuredClone(detail);
  for (const key of [
    "amount",
    "amountLocal",
    "subAmount",
    "subAmountLocal",
    "netAmount",
    "netAmountLocal",
    "taxExclusiveAmount",
    "taxExclusiveAmountLocal",
  ]) {
    if (cents(detail[key]) !== beforeCents) return fail();
    updated[key] = afterCents / 100;
  }
  return updated;
}
