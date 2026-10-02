import { beforeEach, describe, expect, it } from "vitest";
import { handleFinancialRequest, type ActorResult, type FinancialHttpDeps } from "../financial-reporting-http.server";
import { clearFinancialCache, type FinancialReportingDeps } from "../financial-reporting-store.server";
import type { ReceiptSnapshot } from "../receipt-controls";
import { hasPermission } from "../rbac";

const owner = { tenantId: "tenant-a", n3UserKey: "u", n3Token: "t", role: "owner" as const };

function data(rowsCount = 3, failing = false): { deps: FinancialReportingDeps; reads: string[] } {
  const reads: string[] = [];
  const deposits = Array.from({ length: rowsCount }, (_, i) => ({
    id: `d${i}`,
    reservationId: "res",
    n3ReceiptId: `00000000-0000-4000-8000-00000000000${i}`,
    n3DocCode: `OR2610/${i}`,
    n3ReferenceNo: `HH${i}`,
    customerLabel: i === 0 ? "=cmd|' /C calc'!A0" : "Walk-in",
    currency: "MYR",
    amountCents: 5000,
    paymentLines: [{ id: "acc", code: "310", name: "Bank", amount: 50 }],
    createdAt: "2026-10-01T00:00:00Z",
  }));
  const deps: FinancialReportingDeps = {
    settings: async (t) => (reads.push(t), { timezone: "Asia/Kuala_Lumpur", currency: "MYR" }),
    depositPage: async (t, _w, after) => {
      reads.push(t);
      if (failing) throw new Error("down");
      return after ? [] : deposits;
    },
    depositsByIds: async () => [],
    voidedDepositIds: async () => [],
    versions: async () => [],
    unresolved: async () => [],
    requests: async () => [],
    bookingRefs: async () => new Map([["res", "BK1"]]),
    userLabels: async () => new Map(),
    revision: async () => `${rowsCount}${failing}`,
    verifyReceipt: async (_a, id) => {
      const d = deposits.find((x) => x.id === id)!;
      return {
        receiptId: d.n3ReceiptId,
        docCode: d.n3DocCode,
        documentDate: `2026-10-0${(Number(id.slice(1)) % 9) + 1}`,
        customerId: "c",
        currency: "MYR",
        amountCents: 5000,
        paymentLines: [],
        contact: { customerName: "x", remark1: "", remark2: "", remark3: "", remark4: "" },
        documentState: "active",
        matchingState: "unmatched",
        journalExact: true,
        sourceFingerprint: "f",
        verifiedAt: "x",
      } satisfies ReceiptSnapshot;
    },
  };
  return { deps, reads };
}

function http(actor: ActorResult, d = data()): FinancialHttpDeps & { reads: string[] } {
  return { actor: async () => actor, data: () => d.deps, reads: d.reads };
}
const req = (path: string) => new Request(`https://hotel.example${path}`);

beforeEach(() => clearFinancialCache());

describe("financial report APIs", () => {
  it("only Owners hold the permission", () => {
    expect(hasPermission("owner", "hotel:financial_reports:view")).toBe(true);
    expect(hasPermission("front_desk", "hotel:financial_reports:view")).toBe(false);
    expect(hasPermission("housekeeper", "hotel:financial_reports:view")).toBe(false);
  });

  it("denies every non-Owner state before reading sources", async () => {
    const cases: Array<[ActorResult, number]> = [
      [{ ok: false, reason: "unauthenticated" }, 401],
      [{ ok: false, reason: "unprovisioned" }, 403],
      [{ ok: false, reason: "role_unassigned" }, 403], // revoked Owner
      [{ ok: false, reason: "forbidden" }, 403],
      [{ ok: true, actor: { ...owner, role: "front_desk" } }, 403],
      [{ ok: true, actor: { ...owner, role: "housekeeper" } }, 403],
    ];
    for (const [actor, status] of cases)
      for (const ep of ["dashboard", "report", "export"] as const) {
        const h = http(actor);
        const res = await handleFinancialRequest(req("/api/hotel/x?month=2026-10"), ep, h);
        expect(res.status).toBe(status);
        expect(h.reads).toEqual([]);
        const body = await res.text();
        expect(body).not.toMatch(/tenant-a|MYR|OR2610/);
      }
  });

  it("rejects browser tenant/actor/currency overrides and bad input", async () => {
    for (const q of ["tenantId=tenant-b", "currency=USD", "actor=x", "month=2026-13", "month=2026-10&month=2026-11"]) {
      const res = await handleFinancialRequest(req(`/api/hotel/financial-dashboard?${q}`), "dashboard", http({ ok: true, actor: owner }));
      expect(res.status).toBe(400);
    }
    for (const q of ["tenantId=b", "limit=1000", "offset=-5", `receiptNumber=${"x".repeat(101)}`, "fromDate=2026-11-01"]) {
      const res = await handleFinancialRequest(req(`/api/hotel/receipt-reports?month=2026-10&${q}`), "report", http({ ok: true, actor: owner }));
      expect(res.status).toBe(400);
    }
  });

  it("dashboard returns no-store Owner DTO from the session tenant", async () => {
    const h = http({ ok: true, actor: owner });
    const res = await handleFinancialRequest(req("/api/hotel/financial-dashboard?month=2026-10"), "dashboard", h);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.deposits.amount).toBe(150);
    expect(body.sales.status).toBe("unavailable");
    expect(new Set(h.reads)).toEqual(new Set(["tenant-a"]));
  });

  it("report sorts/filters/paginates server-side and counts the full set", async () => {
    const h = http({ ok: true, actor: owner }, data(30));
    const res = await handleFinancialRequest(req("/api/hotel/receipt-reports?month=2026-10&limit=25&offset=25&sort=documentCode&direction=asc"), "report", h);
    const body = await res.json();
    expect(body.total).toBe(30);
    expect(body.items).toHaveLength(5);
  });

  it("export contains the complete matching set, escaped, reconciling with the report", async () => {
    const h = http({ ok: true, actor: owner }, data(30));
    const res = await handleFinancialRequest(req("/api/hotel/receipt-reports/export?month=2026-10"), "export", h);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain("current verified state");
    const dataLines = csv.split("\r\n").filter((l) => l.startsWith('"OR2610/'));
    expect(dataLines).toHaveLength(30);
    expect(csv).toContain(`"'=cmd|' /C calc'!A0"`);
    const sum = dataLines.reduce((s, l) => s + Number(l.split(",")[5]), 0);
    expect(sum).toBe(1500);
  });

  it("export refuses an incomplete source instead of an empty file", async () => {
    const h = http({ ok: true, actor: owner }, data(3, true));
    const res = await handleFinancialRequest(req("/api/hotel/receipt-reports/export?month=2026-10"), "export", h);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "report_source_incomplete" });
  });
});
