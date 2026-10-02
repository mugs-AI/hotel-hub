import { describe, expect, it } from "vitest";
import {
  applyEffectiveReceipts,
  computeReceiptOverlay,
  type ReceiptVersionRow,
} from "../effective-receipts";
import { recordedDepositStatement, summarizePostedDeposits } from "../recorded-deposits";

const line = (cents: number, accountId = "acc-1") => [
  { accountId, code: "BANK", savedName: "Maybank", amountCents: cents },
];
const v = (p: Partial<ReceiptVersionRow>): ReceiptVersionRow => ({
  depositId: "d1",
  requestId: "r1",
  versionNo: 1,
  state: "active",
  receiptId: "rcpt-1",
  docCode: "OR-1",
  documentDate: "2026-10-02",
  currency: "MYR",
  amountCents: 8000,
  paymentLines: line(8000),
  replacementOf: null,
  verifiedAt: "2026-10-02T01:00:00Z",
  ...p,
});
const dep = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id,
  status: "posted" as const,
  amount,
  currencyCode: "MYR",
  n3ReceiptId: `rcpt-${id.slice(1)}`,
  n3DocCode: `OR-${id.slice(1)}`,
  createdAt: "2026-10-01T00:00:00Z",
  ...extra,
});

describe("computeReceiptOverlay", () => {
  it("leaves deposits without verified versions untouched (approval alone changes nothing)", () => {
    const o = computeReceiptOverlay([], new Set());
    expect(o.size).toBe(0);
  });
  it("uses the latest verified correction amount", () => {
    const o = computeReceiptOverlay([v({ versionNo: 1, amountCents: 8000 })], new Set());
    expect(o.get("d1")?.confirmed).toMatchObject({
      state: "active",
      amountCents: 8000,
      receiptId: "rcpt-1",
    });
  });
  it("excludes a confirmed void even when no replacement exists", () => {
    const o = computeReceiptOverlay([v({ state: "voided", amountCents: 5000 })], new Set());
    expect(o.get("d1")?.confirmed).toMatchObject({ state: "voided" });
  });
  it("counts a confirmed replacement exactly once and never the voided original", () => {
    const o = computeReceiptOverlay(
      [
        v({ versionNo: 1, state: "voided", amountCents: 5000 }),
        v({ versionNo: 2, receiptId: "rcpt-2", docCode: "OR-2", replacementOf: "rcpt-1" }),
      ],
      new Set(),
    );
    expect(o.get("d1")?.confirmed).toMatchObject({
      state: "active",
      receiptId: "rcpt-2",
      amountCents: 8000,
    });
  });
  it("an unconfirmed replacement (no void evidence) does not count", () => {
    const o = computeReceiptOverlay(
      [v({ versionNo: 1, receiptId: "rcpt-2", replacementOf: "rcpt-1" })],
      new Set(),
    );
    expect(o.get("d1")).toEqual({ confirmed: { state: "original" }, needsReview: true });
  });
  it("marks unresolved requests Needs review while keeping the last confirmed amount", () => {
    const o = computeReceiptOverlay([], new Set(["d1"]));
    expect(o.get("d1")).toEqual({ confirmed: { state: "original" }, needsReview: true });
  });
});

describe("applyEffectiveReceipts + shared totals", () => {
  it("RM50 corrected to RM80 counts RM80 once in summary and statement", () => {
    const rows = applyEffectiveReceipts(
      [dep("d1", 50)],
      computeReceiptOverlay([v({ amountCents: 8000 })], new Set()),
    );
    expect(rows[0]).toMatchObject({ amount: 80, originalAmount: 50, effectiveState: "active" });
    expect(summarizePostedDeposits(rows, "MYR").total).toBe(80);
    expect(recordedDepositStatement(rows, "MYR", 100).netFigure).toBe(20);
  });
  it("voided receipt is excluded from totals and statement items but stays listed", () => {
    const rows = applyEffectiveReceipts(
      [dep("d1", 50), dep("d2", 30)],
      computeReceiptOverlay([v({ state: "voided" })], new Set()),
    );
    expect(rows).toHaveLength(2);
    const s = recordedDepositStatement(rows, "MYR", 100);
    expect(s.total).toBe(30);
    expect(s.count).toBe(1);
    expect(s.items.map((i) => i.n3DocCode)).toEqual(["OR-2"]);
  });
  it("Needs review keeps the amount but flags the summary as unconfirmed", () => {
    const rows = applyEffectiveReceipts(
      [dep("d1", 50)],
      computeReceiptOverlay([], new Set(["d1"])),
    );
    const s = summarizePostedDeposits(rows, "MYR");
    expect(s.total).toBe(50);
    expect(s.hasUnconfirmed).toBe(true);
  });
  it("does not mutate the stored creation record", () => {
    const original = dep("d1", 50);
    applyEffectiveReceipts([original], computeReceiptOverlay([v({})], new Set()));
    expect(original.amount).toBe(50);
    expect(original.n3ReceiptId).toBe("rcpt-1");
  });
});

describe("review blockers: confirmed contribution vs Needs review", () => {
  const voidedThenFailed = [v({ versionNo: 1, state: "voided", amountCents: 5000 })];
  it("confirmed void + failed replacement + unresolved request never resurrects RM50", () => {
    const rows = applyEffectiveReceipts(
      [dep("d1", 50), dep("d2", 30)],
      computeReceiptOverlay(voidedThenFailed, new Set(["d1"])),
    );
    expect(rows[0]).toMatchObject({ effectiveState: "voided", needsReview: true });
    const s = recordedDepositStatement(rows, "MYR", 100);
    expect(s.total).toBe(30);
    expect(s.hasUnconfirmed).toBe(true);
    expect(s.items.map((i) => i.n3DocCode)).toEqual(["OR-2"]);
  });
  it("a later voided replacement is not revived by its earlier active row", () => {
    const o = computeReceiptOverlay(
      [
        v({ versionNo: 1, state: "voided" }),
        v({ versionNo: 2, receiptId: "rcpt-2", replacementOf: "rcpt-1" }),
        v({ versionNo: 3, state: "voided", receiptId: "rcpt-2", replacementOf: "rcpt-1" }),
      ],
      new Set(),
    );
    const rows = applyEffectiveReceipts([dep("d1", 50)], o);
    expect(summarizePostedDeposits(rows, "MYR").total).toBe(0);
  });
  it("two replacement rows count once (latest only) in the real totals consumer", () => {
    const o = computeReceiptOverlay(
      [
        v({ versionNo: 1, state: "voided" }),
        v({ versionNo: 2, receiptId: "rcpt-2", amountCents: 8000, replacementOf: "rcpt-1" }),
        v({ versionNo: 3, receiptId: "rcpt-3", amountCents: 9000, replacementOf: "rcpt-1" }),
      ],
      new Set(),
    );
    const rows = applyEffectiveReceipts([dep("d1", 50)], o);
    expect(summarizePostedDeposits(rows, "MYR")).toMatchObject({ total: 90, count: 1 });
  });
  it("confirmed correction + unresolved later request keeps the confirmed RM80, flagged", () => {
    const rows = applyEffectiveReceipts(
      [dep("d1", 50)],
      computeReceiptOverlay([v({ amountCents: 8000 })], new Set(["d1"])),
    );
    const s = summarizePostedDeposits(rows, "MYR");
    expect(s).toMatchObject({ total: 80, hasUnconfirmed: true });
  });
});
