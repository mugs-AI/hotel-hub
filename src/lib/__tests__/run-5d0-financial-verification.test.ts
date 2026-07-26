import { describe, expect, it } from "vitest";
import {
  parseDateRange,
  sanitize,
  classifyGlAccount,
  classifyOrOrigin,
  compareReceiptKnockoffs,
} from "@/lib/n3-financial.server";
import { hasPermission } from "@/lib/rbac";

describe("Run 5D0 — parseDateRange", () => {
  it("accepts a valid inclusive range within 31 days", () => {
    expect(parseDateRange("2026-07-01", "2026-07-07")).toEqual({
      ok: true,
      from: "2026-07-01",
      to: "2026-07-07",
    });
  });
  it("rejects malformed dates", () => {
    expect(parseDateRange("2026/07/01", "2026-07-07")).toEqual({
      ok: false,
      error: "date_from_invalid",
    });
  });
  it("rejects reversed range", () => {
    expect(parseDateRange("2026-07-07", "2026-07-01")).toEqual({
      ok: false,
      error: "date_to_before_from",
    });
  });
  it("rejects range exceeding 31 days", () => {
    expect(parseDateRange("2026-01-01", "2026-02-05")).toEqual({
      ok: false,
      error: "date_range_exceeds_31_days",
    });
  });
});

describe("Run 5D0 — sanitize", () => {
  it("redacts sensitive keys", () => {
    const out = sanitize({
      authorization: "Bearer x",
      cookie: "s=abc",
      identityNo: "900101-14-5555",
      name: "Alice",
    }) as Record<string, unknown>;
    expect(out.authorization).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
    expect(out.identityNo).toBe("[redacted]");
    expect(out.name).toBe("Alice");
  });
  it("caps large arrays with a marker", () => {
    const big = Array.from({ length: 300 }, (_, i) => i);
    const out = sanitize(big) as unknown[];
    expect(out.length).toBeLessThanOrEqual(201);
    expect(String(out[out.length - 1])).toContain("more");
  });
});

describe("Run 5D0 — permissions", () => {
  it("gates n3:financial_verify to owner only", () => {
    expect(hasPermission("owner", "n3:financial_verify")).toBe(true);
    expect(hasPermission("front_desk", "n3:financial_verify")).toBe(false);
    expect(hasPermission("housekeeper", "n3:financial_verify")).toBe(false);
  });
});

describe("Run 5D0 — GL classification", () => {
  it("recognises bank via SpecialType", () => {
    expect(classifyGlAccount({ SpecialType: "Bank Account", Name: "Maybank" })).toBe("bank");
  });
  it("recognises cash via SpecialType", () => {
    expect(classifyGlAccount({ SpecialType: "Cash Account", Name: "Cash on Hand" })).toBe(
      "cash",
    );
  });
  it("returns ineligible for revenue accounts", () => {
    expect(classifyGlAccount({ SpecialType: "Revenue", Name: "Room Revenue" })).toBe(
      "ineligible",
    );
  });
});

describe("Run 5D0 — OR origin classification", () => {
  it("flags GL-originated OR", () => {
    expect(classifyOrOrigin({ Source: "GL", DocNo: "OR-888" })).toBe("gl_originated_or");
  });
  it("classifies AR receipt when customer id is present", () => {
    expect(classifyOrOrigin({ CustomerId: "C1", DocNo: "OR-001" })).toBe("ar_receipt");
  });
});

describe("Run 5D0 — OR ↔ Cash Memo comparison", () => {
  it("proves identity match when knockoff docId equals Cash Sales UUID", () => {
    const receipts = [
      {
        Id: "REC-1",
        DocNo: "OR-001",
        CustomerId: "C1",
        knockOffs: [
          {
            DocType: "INV",
            DocId: "D5F5D5BF-2E7D-4211-B1AA-7F3A045F39AF",
            DocNo: "CS-001-TEST",
            AppliedAmount: 100,
          },
        ],
      },
    ];
    const cs = [
      { Id: "D5F5D5BF-2E7D-4211-B1AA-7F3A045F39AF", DocNo: "CS-001-TEST", CustomerId: "C1" },
    ];
    const out = compareReceiptKnockoffs(receipts, cs);
    expect(out).toHaveLength(1);
    expect(out[0].sameUuid).toBe(true);
    expect(out[0].correlation).toBe("immutable_id");
    expect(out[0].customerMatch).toBe(true);
  });
  it("labels document-number-only correlation when UUID missing", () => {
    const receipts = [
      {
        Id: "REC-2",
        DocNo: "OR-002",
        knockOffs: [{ DocType: "INV", DocNo: "CS-999" }],
      },
    ];
    const cs = [{ Id: "SOME-OTHER-UUID", DocNo: "CS-999" }];
    const out = compareReceiptKnockoffs(receipts, cs);
    expect(out[0].correlation).toBe("document_number_only");
    expect(out[0].sameUuid).toBe(null);
  });
});
