import { describe, expect, it } from "vitest";
import {
  financialMonth,
  selectReportRows,
  summarizeFinancialMonth,
  validateReceiptReportFilter,
  type FinancialSource,
  type HotelFinancialEvent,
} from "../financial-reporting";
import { financialEvent } from "./fixtures/financial-reporting";

const KL = "Asia/Kuala_Lumpur";
const complete = (rows: HotelFinancialEvent[]): FinancialSource<HotelFinancialEvent> => ({
  status: "complete",
  rows,
  verifiedAt: "2026-10-02T00:00:00Z",
  reasonCode: null,
});
const unavailable: FinancialSource<HotelFinancialEvent> = {
  status: "unavailable",
  rows: [],
  verifiedAt: null,
  reasonCode: "final_billing_source_not_connected",
};
const oct = financialMonth("2026-10", KL);
const sum = (receipts: HotelFinancialEvent[], extra: Partial<Record<"sales" | "otherCollections", FinancialSource<HotelFinancialEvent>>> = {}) =>
  summarizeFinancialMonth(
    oct,
    { receipts: complete(receipts), sales: extra.sales ?? complete([]), otherCollections: extra.otherCollections ?? complete([]) },
    "MYR",
  );

describe("financialMonth", () => {
  it("uses the property month, not UTC, at a date boundary", () => {
    // 2026-09-30 17:30 UTC is already 1 October in Kuala Lumpur.
    expect(financialMonth(undefined, KL, new Date("2026-09-30T17:30:00Z")).month).toBe("2026-10");
    expect(financialMonth(undefined, "UTC", new Date("2026-09-30T17:30:00Z")).month).toBe("2026-09");
  });
  it("handles December→January and leap February", () => {
    expect(financialMonth("2026-12", KL)).toMatchObject({ startDate: "2026-12-01", endExclusive: "2027-01-01" });
    expect(financialMonth("2028-02", KL).endExclusive).toBe("2028-03-01");
  });
  it("rejects invalid months and timezones", () => {
    for (const m of ["2026-13", "2026-1", "26-10", "2026-10-01", "abcd-ef"])
      expect(() => financialMonth(m, KL)).toThrow("invalid_month");
    expect(() => financialMonth("2026-10", "Mars/Base")).toThrow("invalid_timezone");
  });
});

describe("summarizeFinancialMonth", () => {
  it("counts a RM50 deposit once in deposits and collections", () => {
    const r = sum([financialEvent()]);
    expect(r.deposits.amount).toBe(50);
    expect(r.collections.amount).toBe(50);
    expect(r.deposits.status).toBe("complete");
  });
  it("allocation repetitions of the same transaction never give 100", () => {
    const r = sum([financialEvent()], { otherCollections: complete([financialEvent({ kind: "settlement" })]) });
    expect(r.collections.amount).toBe(50);
  });
  it("posted sale without payment affects Sales only", () => {
    const sale = financialEvent({ transactionId: "inv-1", kind: "sale", amountCents: 111455 });
    const r = sum([], { sales: complete([sale]) });
    expect(r.sales.amount).toBe(1114.55);
    expect(r.collections.amount).toBe(0);
    expect(r.deposits.amount).toBe(0);
  });
  it("RM50 corrected to 80 then voided: zero deposits, void activity 80", () => {
    const voided = financialEvent({ state: "voided", receiptStatus: "voided", amountCents: 0 });
    const voidEvent = financialEvent({
      transactionId: "void:dep-1:2",
      kind: "void",
      state: "active",
      receiptStatus: "voided",
      amountCents: 8000,
      confirmedVoidAt: "2026-10-05T03:00:00Z",
    });
    const r = sum([voided, voidEvent]);
    expect(r.deposits.amount).toBe(0);
    expect(r.collections.amount).toBe(0);
    expect(r.voids.amount).toBe(80);
    expect(r.voids.count).toBe(1);
  });
  it("void activity follows the property-local void date", () => {
    const v = financialEvent({ kind: "void", amountCents: 5000, confirmedVoidAt: "2026-09-30T17:00:00Z" });
    expect(sum([v]).voids.amount).toBe(50); // 1 Oct 01:00 KL
  });
  it("unsupported sales/other collections stay unavailable while deposits remain 50", () => {
    const r = sum([financialEvent()], { sales: unavailable, otherCollections: unavailable });
    expect(r.sales).toMatchObject({ amount: null, status: "unavailable" });
    expect(r.collections).toMatchObject({ amount: null, status: "unavailable" });
    expect(r.sales.explanation).toContain("final billing source not connected");
    expect(r.deposits).toMatchObject({ amount: 50, status: "complete" });
  });
  it("mixed currency, overflow, missing dates and partial sources never give a complete total", () => {
    const usd = sum([financialEvent(), financialEvent({ transactionId: "d2", currency: "USD" })]);
    expect(usd.deposits).toMatchObject({ amount: null, status: "needs_review" });
    const big = sum([
      financialEvent({ amountCents: Number.MAX_SAFE_INTEGER }),
      financialEvent({ transactionId: "d2" }),
    ]);
    expect(big.deposits.status).toBe("needs_review");
    expect(big.deposits.amount).toBeNull();
    const noDate = sum([financialEvent({ documentDate: "" })]);
    expect(noDate.deposits).toMatchObject({ amount: null, status: "unavailable" });
    const partial = summarizeFinancialMonth(
      oct,
      { receipts: { ...complete([financialEvent()]), status: "unavailable", reasonCode: "source_incomplete" }, sales: unavailable, otherCollections: unavailable },
      "MYR",
    );
    expect(partial.deposits).toMatchObject({ amount: null, status: "unavailable" });
  });
  it("a Needs review receipt marks the metric needs_review", () => {
    expect(sum([financialEvent({ receiptStatus: "needs_review" })]).deposits.status).toBe("needs_review");
  });
  it("excludes rows dated outside the month", () => {
    expect(sum([financialEvent({ documentDate: "2026-11-01" })]).deposits.amount).toBe(0);
  });
});

describe("validateReceiptReportFilter", () => {
  const v = (q: string) => validateReceiptReportFilter(new URLSearchParams(q), oct);
  it("accepts defaults", () => {
    expect(v("")).toMatchObject({ tab: "receipts", limit: 25, offset: 0, sort: "documentDate" });
  });
  it("rejects bad paging, unknown filters and oversized text", () => {
    expect(() => v("limit=30")).toThrow("invalid_paging");
    expect(() => v("offset=-1")).toThrow("invalid_paging");
    expect(() => v("offset=1.5")).toThrow("invalid_paging");
    expect(() => v("tenantId=x")).toThrow("unknown_filter");
    expect(() => v(`bookingReference=${"x".repeat(101)}`)).toThrow("invalid_filter");
    expect(() => v("month=2026-11")).toThrow("invalid_month");
  });
  it("rejects February 30, out-of-month and reversed ranges", () => {
    const feb = financialMonth("2026-02", KL);
    expect(() => validateReceiptReportFilter(new URLSearchParams("fromDate=2026-02-30"), feb)).toThrow("invalid_date_range");
    expect(() => v("fromDate=2026-11-01")).toThrow("invalid_date_range");
    expect(() => v("fromDate=2026-10-10&toDate=2026-10-02")).toThrow("invalid_date_range");
    expect(v("fromDate=2026-10-02&toDate=2026-10-10").toDate).toBe("2026-10-10");
  });
});

describe("selectReportRows", () => {
  it("filters, sorts with a stable id tie-break and keeps void rows separate", () => {
    const rows = [
      financialEvent({ transactionId: "b", documentCode: "OR/2" }),
      financialEvent({ transactionId: "a", documentCode: "OR/1" }),
      financialEvent({ transactionId: "v", kind: "void", amountCents: 8000, confirmedVoidAt: "2026-10-05T00:00:00Z" }),
    ];
    const f = validateReceiptReportFilter(new URLSearchParams("sort=documentCode&direction=asc"), oct);
    expect(selectReportRows(rows, f, oct).map((r) => r.id)).toEqual(["a", "b"]);
    const vf = validateReceiptReportFilter(new URLSearchParams("tab=voided"), oct);
    const voids = selectReportRows(rows, vf, oct);
    expect(voids).toHaveLength(1);
    expect(voids[0]).toMatchObject({ amount: 80, documentDate: "2026-10-05" });
  });
});
