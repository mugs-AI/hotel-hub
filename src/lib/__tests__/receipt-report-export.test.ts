import { describe, expect, it } from "vitest";
import { csvText, receiptReportCsv } from "../receipt-report-export.server";
import type { ReceiptReportRow } from "../financial-reporting";

const row = (o: Partial<ReceiptReportRow> = {}): ReceiptReportRow => ({
  id: "r1",
  receiptId: "rid",
  receiptNumber: "OR2610/1",
  documentDate: "2026-10-01",
  bookingReference: "BK1",
  customerLabel: "Walk-in",
  currency: "MYR",
  amount: 80,
  creationAmount: 50,
  savedPaymentName: "Maybank",
  accountCode: "310-000",
  status: "voided",
  replacementOf: null,
  replacementReceiptId: "rid-2",
  requesterLabel: "Aina",
  approverLabel: "Owner",
  reason: "Wrong amount",
  confirmedVoidAt: "2026-10-05T01:00:00Z",
  ...o,
});

describe("receiptReportCsv", () => {
  it("quotes commas, newlines and quotes", () => {
    expect(csvText('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it("escapes leading formula triggers", () => {
    for (const t of ["=1+1", "+cmd", "-2", "@SUM(A1)", "\tx", "\rx"])
      expect(csvText(t).startsWith(`"'`)).toBe(true);
    expect(csvText("Maybank")).toBe('"Maybank"');
  });
  it("keeps amounts numeric and includes void audit fields", () => {
    const csv = receiptReportCsv([row({ customerLabel: '=HYPERLINK("x")' })]);
    const line = csv.split("\r\n")[1]!;
    expect(line).toContain(",80.00,50.00,");
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain('"Wrong amount"');
    expect(line).toContain('"rid-2"');
    expect(line).toContain('"Voided"');
  });
});
