// Run 5D3.1 — read-only departures + checkout preview regression tests.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyDepositReceipt,
  computeRoomFolio,
  departureBucket,
  departuresDateRange,
  hasHistoricalEvidenceGap,
  parseDeparturesQuery,
  propertyTodayIso,
  buildSummary,
  type FolioRoomInput,
} from "../checkout-preview";
import { nightsBetween, toCents, multiplyCents } from "../checkout-money";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const room = (over: Partial<FolioRoomInput> = {}): FolioRoomInput => ({
  reservationRoomId: "11111111-1111-4111-8111-111111111111",
  roomNumber: "101",
  displayName: null,
  n3StockName: "Deluxe",
  n3StockId: "22222222-2222-4222-8222-222222222222",
  n3StockCode: "RM-DLX",
  agreedRate: 150,
  baseRateSnapshot: 180,
  allocationStatus: "occupied",
  ...over,
});

describe("money + nights", () => {
  it("rejects >2-decimal rates", () => {
    expect(toCents(150.005)).toBeNull();
    expect(toCents(150.5)).toBe(15050);
  });
  it("counts half-open nights", () => {
    expect(nightsBetween("2026-08-01", "2026-08-04")).toBe(3);
    expect(nightsBetween("2026-08-04", "2026-08-04")).toBeNull();
  });
  it("multiplies in integer cents", () => {
    expect(multiplyCents(15050, 3)).toBe(45150);
  });
});

describe("computeRoomFolio", () => {
  const base = {
    arrivalDate: "2026-08-01",
    departureDate: "2026-08-04",
    currency: "MYR",
    historyGap: false,
  };

  it("charges the agreed rate, not the base rate snapshot", () => {
    const r = computeRoomFolio({ ...base, rooms: [room()] });
    expect(r.calculationStatus).toBe("calculated");
    expect(r.roomChargeTotalCents).toBe(45000);
    expect(r.lines[0].unitRate).toBe(150);
    expect(r.lines[0].baseRateReference).toBe(180);
  });

  it("blocks when a room/rate change exists in history", () => {
    const r = computeRoomFolio({ ...base, rooms: [room()], historyGap: true });
    expect(r.calculationStatus).toBe("blocked");
    expect(r.roomChargeTotalCents).toBeNull();
    expect(r.blockers.map((b) => b.code)).toContain("historical_charge_evidence_incomplete");
  });

  it("blocks on a missing N3 stock mapping", () => {
    const r = computeRoomFolio({
      ...base,
      rooms: [room({ n3StockId: null, n3StockCode: null })],
    });
    expect(r.blockers.map((b) => b.code)).toContain("room_stock_mapping_missing");
    expect(r.roomChargeTotalCents).toBeNull();
  });

  it("blocks with no allocation at all", () => {
    const r = computeRoomFolio({ ...base, rooms: [] });
    expect(r.blockers.map((b) => b.code)).toContain("room_allocation_missing");
  });
});

describe("history evidence", () => {
  it("treats room_changed and rate_changed as gaps", () => {
    expect(hasHistoricalEvidenceGap(["checked_in", "room_changed"])).toBe(true);
    expect(hasHistoricalEvidenceGap(["checked_in", "guest_updated"])).toBe(false);
  });
});

describe("property date + buckets", () => {
  it("computes the KL calendar date, not UTC", () => {
    expect(propertyTodayIso("Asia/Kuala_Lumpur", new Date("2026-08-01T17:30:00Z"))).toBe(
      "2026-08-02",
    );
  });
  it("fails closed on a bad timezone", () => {
    expect(propertyTodayIso("Not/AZone")).toBeNull();
  });
  it("buckets by property date", () => {
    expect(departureBucket("2026-08-01", "2026-08-02")).toBe("overdue");
    expect(departureBucket("2026-08-02", "2026-08-02")).toBe("today");
    expect(departureBucket("2026-08-03", "2026-08-02")).toBe("upcoming");
  });
  it("derives SQL bounds before pagination", () => {
    expect(departuresDateRange({ bucket: "overdue", from: null, to: null }, "2026-08-02").lt).toBe(
      "2026-08-02",
    );
    expect(
      departuresDateRange({ bucket: "today", from: null, to: null }, "2026-08-02"),
    ).toMatchObject({ gte: "2026-08-02", lte: "2026-08-02" });
  });
});

describe("parseDeparturesQuery", () => {
  it("rejects unknown params", () => {
    expect(parseDeparturesQuery(new URLSearchParams("bucket=today&evil=1")).ok).toBe(false);
  });
  it("rejects an out-of-range limit", () => {
    expect(parseDeparturesQuery(new URLSearchParams("limit=500")).ok).toBe(false);
  });
  it("accepts a clean query", () => {
    const r = parseDeparturesQuery(new URLSearchParams("bucket=overdue&limit=10&offset=20"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query).toMatchObject({ bucket: "overdue", limit: 10, offset: 20 });
  });
});

describe("classifyDepositReceipt — fail closed", () => {
  const expected = {
    n3ReceiptId: "33333333-3333-4333-8333-333333333333",
    n3DocCode: "OR-0001",
    n3ReferenceNo: "HH-0123456789abcdef01234567",
    n3CustomerId: "44444444-4444-4444-8444-444444444444",
    currencyCode: "MYR",
    amountCents: 30000,
  };
  const goodBody = {
    data: {
      value: {
        id: expected.n3ReceiptId,
        docCode: "OR-0001",
        docType: "AROR",
        referenceNo: expected.n3ReferenceNo,
        customerId: expected.n3CustomerId,
        currencyCode: "MYR",
        netTotalAmount: 300,
        // Affirmative proof the receipt is still entirely unapplied.
        knockoff: [] as unknown[],
      },
    },
  };

  it("counts a fully matching, unapplied receipt", () => {
    const v = classifyDepositReceipt({ kind: "response", status: 200, body: goodBody }, expected);
    expect(v.counted).toBe(true);
  });

  it("does not count on transport failure", () => {
    const v = classifyDepositReceipt({ kind: "transport_error", reason: "timeout" }, expected);
    expect(v).toMatchObject({ counted: false, code: "n3_deposit_verification_unavailable" });
  });

  it("flags a 401 so the session can be destroyed", () => {
    const v = classifyDepositReceipt({ kind: "response", status: 401, body: null }, expected);
    expect(v).toMatchObject({ counted: false, unauthorized: true });
  });

  it("rejects a customer mismatch", () => {
    const body = structuredClone(goodBody);
    body.data.value.customerId = "55555555-5555-4555-8555-555555555555";
    expect(classifyDepositReceipt({ kind: "response", status: 200, body }, expected)).toMatchObject(
      {
        counted: false,
        code: "deposit_customer_mismatch",
      },
    );
  });

  it("rejects a currency mismatch", () => {
    const body = structuredClone(goodBody);
    body.data.value.currencyCode = "SGD";
    expect(classifyDepositReceipt({ kind: "response", status: 200, body }, expected)).toMatchObject(
      {
        counted: false,
        code: "deposit_currency_mismatch",
      },
    );
  });

  it("rejects an amount mismatch", () => {
    const body = structuredClone(goodBody);
    body.data.value.netTotalAmount = 250;
    expect(classifyDepositReceipt({ kind: "response", status: 200, body }, expected)).toMatchObject(
      {
        counted: false,
        code: "deposit_live_evidence_incomplete",
      },
    );
  });

  it("rejects a receipt that is already knocked off", () => {
    const body: { data: { value: Record<string, unknown> } } = structuredClone(goodBody);
    body.data.value.knockoff = [{ amount: 300 }];
    expect(classifyDepositReceipt({ kind: "response", status: 200, body }, expected)).toMatchObject(
      {
        counted: false,
      },
    );
  });

  it("rejects a receipt with no affirmative entirely-unapplied evidence", () => {
    const body: { data: { value: Record<string, unknown> } } = structuredClone(goodBody);
    delete body.data.value.knockoff;
    expect(classifyDepositReceipt({ kind: "response", status: 200, body }, expected)).toMatchObject(
      {
        counted: false,
        code: "deposit_live_evidence_incomplete",
      },
    );
  });

  it("counts a receipt proven unapplied by a full outstanding amount", () => {
    const body: { data: { value: Record<string, unknown> } } = structuredClone(goodBody);
    delete body.data.value.knockoff;
    body.data.value.outstandingAmount = 300;
    expect(classifyDepositReceipt({ kind: "response", status: 200, body }, expected).counted).toBe(
      true,
    );
  });
});

describe("summary", () => {
  it("never produces a negative balance and surfaces excess deposits", () => {
    expect(buildSummary(45000, 50000)).toMatchObject({ estimatedBalance: 0, excessDeposit: 50 });
    expect(buildSummary(45000, 20000)).toMatchObject({ estimatedBalance: 250, excessDeposit: 0 });
  });
  it("returns nulls when either side is unproven", () => {
    expect(buildSummary(null, 100)).toMatchObject({ estimatedBalance: null });
  });
});

describe("scope + guardrails", () => {
  const server = read("lib/checkout-preview.server.ts");

  it("performs no N3 writes from the checkout path", () => {
    expect(server).not.toMatch(/n3Receipts\.(create|post|update|void|delete|match)/);
    expect(server).not.toMatch(/"POST"|'POST'/);
  });

  it("never mutates reservation, room or housekeeping state", () => {
    expect(server).not.toMatch(/\.update\(|\.insert\(|\.upsert\(|\.delete\(|\.rpc\(/);
    expect(server).not.toMatch(/checked_out|Vacant/);
  });

  it("keeps the N3-only auth boundary", () => {
    expect(read("start.ts")).toMatch(/functionMiddleware:\s*\[\s*\]/);
  });

  it("exposes checkout reads to owner and front desk only", () => {
    const rbac = read("lib/rbac.ts");
    expect(rbac).toMatch(/"hotel:checkout:view":\s*new Set\(\["owner", "front_desk"\]\)/);
  });

  it("computes no money in the browser client", () => {
    const client = read("lib/checkout-client.ts");
    expect(client).not.toMatch(/[*+-]\s*100\b/);
    expect(client).not.toMatch(/reduce\(/);
  });
});
