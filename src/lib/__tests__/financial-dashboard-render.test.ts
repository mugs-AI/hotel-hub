/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MonthlyFinancialDTO, ReceiptReportDTO } from "../financial-reporting";
import { financialMonth } from "../financial-reporting";
import { workspaceTab } from "../workspace-tabs";

const state = vi.hoisted(() => ({ dto: undefined as any, report: undefined as any, calls: [] as any[] }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, search, className }: any) =>
    createElement("a", { href: `${to}?${new URLSearchParams(search ?? {})}`, className }, children),
}));
vi.mock("@/lib/financial-reporting-client", async (orig) => ({
  ...((await orig()) as object),
  useMonthlyFinancialDashboard: (month: string | undefined, enabled: boolean) => {
    state.calls.push({ month, enabled });
    return { isPending: false, isError: false, data: enabled ? state.dto : undefined };
  },
  useReceiptReport: () => ({ isPending: false, isError: false, data: state.report }),
}));

const { FinancialDashboard } = await import("@/components/FinancialDashboard");
const { ReceiptReportTable, ReportStatus } = await import("@/components/ReceiptReports");

const period = financialMonth("2026-10", "Asia/Kuala_Lumpur");
const m = (amount: number | null, status: any, explanation: string | null = null) => ({
  amount,
  count: amount === null ? null : 1,
  currency: "MYR",
  status,
  verifiedAt: "2026-10-02T03:00:00Z",
  explanation,
});

describe("FinancialDashboard", () => {
  it("renders nothing for non-Owners", () => {
    state.dto = undefined;
    expect(renderToStaticMarkup(createElement(FinancialDashboard, { enabled: false }))).toBe("");
  });

  it("Owner sees four cards with availability text; unsupported sources say Unavailable", () => {
    state.dto = {
      period,
      sales: m(null, "unavailable", "Unavailable — final billing source not connected."),
      deposits: m(50, "complete"),
      collections: m(null, "unavailable", "Unavailable — final billing source not connected."),
      voids: m(80, "complete"),
      currentVerifiedState: true,
    } satisfies MonthlyFinancialDTO;
    const html = renderToStaticMarkup(createElement(FinancialDashboard, { enabled: true }));
    for (const l of ["Sales", "Deposits", "Collections", "Voided receipts"]) expect(html).toContain(l);
    expect(html).toContain("MYR 50.00");
    expect(html).toContain("MYR 80.00");
    expect(html).toContain("Unavailable — final billing source not connected.");
    expect(html).toContain("Deposits are included in Collections.");
    expect(html).toContain('href="/receipt-reports?month=2026-10&amp;tab=voided"');
    expect(html).toContain('value="2026-10"');
    // Server default month: the browser never picks it.
    expect(state.calls.at(-1)).toEqual({ month: undefined, enabled: true });
  });
});

describe("Dashboard wiring", () => {
  const src = readFileSync(resolve(__dirname, "../../routes/index.tsx"), "utf8");
  it("keeps the four operational cards on the property day and adds finance separately", () => {
    for (const l of ["Confirmed arrivals", "Departures today", "Overdue occupied", "Rooms needing attention"])
      expect(src).toContain(l);
    expect(src).toContain('<FinancialDashboard enabled={hasPermission(role, "hotel:financial_reports:view")} />');
    expect(src).toMatch(/arrivalFrom: propertyDate/);
  });
  it("report tab and Tools link are Owner-only", () => {
    expect(workspaceTab("/receipt-reports", "", "owner" as any, "simple")?.label).toBe("Receipt reports");
    expect(workspaceTab("/receipt-reports", "", "front_desk" as any, "simple")).toBeNull();
    const shell = readFileSync(resolve(__dirname, "../../components/AppShell.tsx"), "utf8");
    expect(shell).toMatch(/to: "\/receipt-reports",\s+label: "Receipt reports",\s+permission: "hotel:financial_reports:view"/);
  });
});

describe("ReceiptReportTable", () => {
  const base = {
    id: "x",
    receiptId: "11111111-1111-4111-8111-111111111111",
    receiptNumber: "OR2610/9",
    documentDate: "2026-10-05",
    bookingReference: "BK1",
    customerLabel: "Walk-in",
    currency: "MYR",
    amount: 80,
    creationAmount: 50,
    savedPaymentName: "Maybank",
    accountCode: "310-000",
    status: "voided" as const,
    replacementOf: null,
    replacementReceiptId: "22222222-2222-4222-8222-222222222222",
    requesterLabel: "Aina",
    approverLabel: "Owner Lim",
    reason: "Wrong amount",
    confirmedVoidAt: "2026-10-05T01:00:00Z",
  };
  it("voided tab shows pre-void amount, audit fields, replacement link and N3 print", () => {
    const data: ReceiptReportDTO = { period, items: [base], total: 1, sourceStatus: "complete", verifiedAt: "2026-10-02T03:00:00Z" };
    const html = renderToStaticMarkup(
      createElement(ReceiptReportTable, { data, filter: { month: "2026-10", tab: "voided", sort: "documentDate", direction: "desc", limit: 25, offset: 0 } }),
    );
    expect(html).toContain("Amount before void");
    expect(html).toContain("MYR 80.00");
    expect(html).toContain("Original MYR 50.00");
    expect(html).toContain("Maybank");
    expect(html).toContain("Replaced by 22222222");
    expect(html).toContain("Reason: Wrong amount");
    expect(html).toContain("Approved: Owner Lim");
    expect(html).toContain("Print in N3");
  });
  it("no Print link for an unsafe receipt identity; failed source visibly Unavailable", () => {
    const data: ReceiptReportDTO = { period, items: [{ ...base, receiptId: "00000000-0000-0000-0000-000000000000" }], total: 1, sourceStatus: "complete", verifiedAt: null };
    const html = renderToStaticMarkup(
      createElement(ReceiptReportTable, { data, filter: { month: "2026-10", tab: "receipts", sort: "documentDate", direction: "desc", limit: 25, offset: 0 } }),
    );
    expect(html).not.toContain("Print in N3");
    const status = renderToStaticMarkup(createElement(ReportStatus, { data: { ...data, items: [], total: 0, sourceStatus: "unavailable" } }));
    expect(status).toContain("Unavailable");
  });
});
