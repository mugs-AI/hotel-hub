// CSV audit/report export for receipt and void reports. Never an N3 voucher.
// Text cells are quoted and leading spreadsheet formula triggers are escaped;
// amounts stay numeric.
import {
  RECEIPT_STATUS_LABEL,
  type FinancialMonth,
  type ReceiptReportRow,
} from "./financial-reporting";

const FORMULA = /^[=+\-@\t\r]/;

export function csvText(value: string | null | undefined): string {
  let v = value ?? "";
  if (FORMULA.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

const csvNumber = (n: number) => {
  if (!Number.isFinite(n)) throw new Error("invalid_amount");
  return n.toFixed(2);
};

export const RECEIPT_REPORT_COLUMNS = [
  "Receipt number",
  "Date",
  "Booking reference",
  "Customer",
  "Currency",
  "Amount",
  "Original amount",
  "Payment account",
  "Account code",
  "Status",
  "Replacement of",
  "Replaced by",
  "Requested by",
  "Approved by",
  "Reason",
  "Void confirmed at",
  "N3 document date",
] as const;

export function receiptReportCsv(rows: readonly ReceiptReportRow[]): string {
  const lines = [RECEIPT_REPORT_COLUMNS.map(csvText).join(",")];
  for (const r of rows)
    lines.push(
      [
        csvText(r.receiptNumber),
        csvText(r.documentDate),
        csvText(r.bookingReference),
        csvText(r.customerLabel),
        csvText(r.currency),
        csvNumber(r.amount),
        csvNumber(r.creationAmount),
        csvText(r.savedPaymentName),
        csvText(r.accountCode),
        csvText(RECEIPT_STATUS_LABEL[r.status]),
        csvText(r.replacementOf),
        csvText(r.replacementReceiptId),
        csvText(r.requesterLabel),
        csvText(r.approverLabel),
        csvText(r.reason),
        csvText(r.confirmedVoidAt),
        csvText(r.n3DocumentDate),
      ].join(","),
    );
  return lines.join("\r\n") + "\r\n";
}

export function receiptReportCsvDocument(
  rows: readonly ReceiptReportRow[],
  meta: {
    period: FinancialMonth;
    tab: "receipts" | "voided";
    currency: string;
    verifiedAt: string | null;
  },
): string {
  const head = [
    `${csvText("HotelHub receipt report — current verified state, not a closing balance")}`,
    `${csvText("Month")},${csvText(meta.period.month)}`,
    `${csvText("Report")},${csvText(meta.tab === "voided" ? "Voided receipts" : "Receipts")}`,
    `${csvText("Currency")},${csvText(meta.currency)}`,
    `${csvText("Verified at")},${csvText(meta.verifiedAt)}`,
    "",
  ].join("\r\n");
  return `\uFEFF${head}\r\n${receiptReportCsv(rows)}`;
}
