import { describe, expect, it } from "vitest";
import {
  parseDateRange,
  sanitize,
  classifyGlAccount,
  evaluateGlAccount,
  classifyOrOrigin,
  compareReceiptKnockoffs,
  compareRefundKnockoffs,
  applyFilters,
  FINANCIAL_BUNDLE_SCHEMA_VERSION,
} from "@/lib/n3-financial.server";
import { hasPermission } from "@/lib/rbac";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---- Baseline (preserved from prior run) ----------------------------------

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

describe("Run 5D0 — sanitize (recursive, case-insensitive)", () => {
  it("redacts sensitive keys at the top level", () => {
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
  it("redacts nested and case-variant secret + identity keys", () => {
    const out = sanitize({
      Level1: {
        Level2: {
          BEARER: "abc",
          ApiKey: "def",
          Passport: "A1234567",
          MyKadNo: "900101-14-5555",
          Email: "u@x",
          Address1: "1 Jln Test",
          Postcode: "50000",
          Kept: "keep-me",
        },
      },
    }) as { Level1: { Level2: Record<string, unknown> } };
    const inner = out.Level1.Level2;
    expect(inner.BEARER).toBe("[redacted]");
    expect(inner.ApiKey).toBe("[redacted]");
    expect(inner.Passport).toBe("[redacted]");
    expect(inner.MyKadNo).toBe("[redacted]");
    expect(inner.Email).toBe("[redacted]");
    expect(inner.Address1).toBe("[redacted]");
    expect(inner.Postcode).toBe("[redacted]");
    expect(inner.Kept).toBe("keep-me");
  });
  it("redacts secret keys inside arrays of objects", () => {
    const out = sanitize([{ ClientSecret: "s", ok: 1 }, { access_token: "t" }]) as Array<
      Record<string, unknown>
    >;
    expect(out[0].ClientSecret).toBe("[redacted]");
    expect(out[0].ok).toBe(1);
    expect(out[1].access_token).toBe("[redacted]");
  });
});

describe("Run 5D0 — permissions", () => {
  it("gates n3:financial_verify to owner only", () => {
    expect(hasPermission("owner", "n3:financial_verify")).toBe(true);
    expect(hasPermission("front_desk", "n3:financial_verify")).toBe(false);
    expect(hasPermission("housekeeper", "n3:financial_verify")).toBe(false);
  });
});

// ---- Corrected GL classification -----------------------------------------

describe("Run 5D0 — GL eligibility (strict)", () => {
  it("returns bank when SpecialType + active + posting all present", () => {
    const r = evaluateGlAccount({
      Id: "gl-1",
      SpecialType: "Bank Account",
      Name: "Maybank",
      Active: true,
      IsPostingAccount: true,
      Code: "1100",
    });
    expect(r.eligibility).toBe("bank");
  });
  it("returns cash when SpecialType + active + posting all present", () => {
    const r = evaluateGlAccount({
      Id: "gl-2",
      SpecialType: "Cash Account",
      Name: "Cash on Hand",
      Active: true,
      IsLeaf: true,
      Code: "1000",
    });
    expect(r.eligibility).toBe("cash");
  });
  it("returns unknown when SpecialType is bank/cash but active/posting flags are missing", () => {
    const r = evaluateGlAccount({ Id: "gl-3", SpecialType: "Bank Account", Name: "Maybank" });
    expect(r.eligibility).toBe("unknown");
    expect(r.reasons).toEqual(
      expect.arrayContaining(["missing_active_flag", "missing_posting_or_leaf_flag"]),
    );
  });
  it("rejects name-only heuristic — 'Bank' in the name is not proof", () => {
    const r = evaluateGlAccount({ Id: "gl-4", Name: "Bank Charges", Active: true, IsPostingAccount: true });
    expect(r.eligibility).toBe("unknown");
    expect(r.reasons).toContain("missing_special_type");
    // classifyGlAccount is the backward-compat alias.
    expect(classifyGlAccount({ Id: "gl-4", Name: "Bank Charges", Active: true, IsPostingAccount: true })).toBe(
      "unknown",
    );
  });
  it("returns ineligible for revenue accounts (SpecialType present, non-bank/cash)", () => {
    expect(
      classifyGlAccount({
        Id: "gl-5",
        SpecialType: "Revenue",
        Name: "Room Revenue",
        Active: true,
        IsPostingAccount: true,
      }),
    ).toBe("ineligible");
  });
  it("returns unknown when immutable id is missing", () => {
    const r = evaluateGlAccount({
      SpecialType: "Bank Account",
      Name: "X",
      Active: true,
      IsPostingAccount: true,
    });
    expect(r.eligibility).toBe("unknown");
    expect(r.reasons).toContain("missing_immutable_id");
  });
  it("normalizes SpecialType casing and whitespace", () => {
    const r = evaluateGlAccount({
      Id: "gl-6",
      SpecialType: "  bank  account ",
      Name: "X",
      Active: true,
      IsPostingAccount: true,
    });
    expect(r.eligibility).toBe("bank");
    expect(r.normalizedSpecialType?.toLowerCase()).toBe("bank account");
  });
});

// ---- OR origin classification --------------------------------------------

describe("Run 5D0 — OR origin classification", () => {
  it("flags GL-originated OR by Source hint", () => {
    expect(classifyOrOrigin({ Source: "GL", DocNo: "OR-888" })).toBe("gl_originated_or");
  });
  it("classifies AR receipt when a customer id is present", () => {
    expect(classifyOrOrigin({ CustomerId: "C1", DocNo: "OR-001" })).toBe("ar_receipt");
  });
  it("does not classify a doc-number-only 'OR-*' row as AR receipt", () => {
    expect(classifyOrOrigin({ DocNo: "OR-999" })).toBe("unknown");
  });
});

// ---- OR ↔ Cash Memo comparison (all four outcomes) -----------------------

describe("Run 5D0 — OR ↔ Cash Memo comparison", () => {
  it("Immutable ID confirmed", () => {
    const receipts = [
      {
        Id: "REC-1",
        DocNo: "OR-001",
        CustomerId: "C1",
        knockoff: {
          DocType: "INV",
          DocId: "D5F5D5BF-2E7D-4211-B1AA-7F3A045F39AF",
          DocNo: "CS-001-TEST",
          DocCode: "CS-001",
          AppliedAmount: "100.00",
        },
      },
    ];
    const cs = [
      {
        Id: "D5F5D5BF-2E7D-4211-B1AA-7F3A045F39AF",
        DocNo: "CS-001-TEST",
        DocCode: "CS-001",
        CustomerId: "C1",
      },
    ];
    const out = compareReceiptKnockoffs(receipts, cs);
    expect(out).toHaveLength(1);
    expect(out[0].correlation).toBe("immutable_id");
    expect(out[0].evidenceLabel).toBe("Immutable ID confirmed");
    expect(out[0].sameUuid).toBe(true);
    expect(out[0].customerMatch).toBe(true);
    expect(out[0].appliedAmount).toBe(100);
    expect(out[0].docCode).toBe("CS-001");
  });
  it("Document-number only — not proven (when DocId absent)", () => {
    const receipts = [
      {
        Id: "REC-2",
        DocNo: "OR-002",
        knockoffs: [{ DocType: "inv", DocNo: "CS-999" }], // plural + lowercase type
      },
    ];
    const cs = [{ Id: "SOME-OTHER-UUID", DocNo: "CS-999" }];
    const out = compareReceiptKnockoffs(receipts, cs);
    expect(out[0].correlation).toBe("document_number_only");
    expect(out[0].evidenceLabel).toBe("Document-number only — not proven");
    expect(out[0].sameUuid).toBe(null);
  });
  it("Mismatch when both DocId and DocNo present but DocId disagrees", () => {
    const receipts = [
      {
        Id: "REC-3",
        DocNo: "OR-003",
        knockoff: { DocType: "INV", DocId: "AAA", DocNo: "CS-3" },
      },
    ];
    const cs = [{ Id: "BBB", DocNo: "CS-999" }];
    const out = compareReceiptKnockoffs(receipts, cs);
    expect(out[0].correlation).toBe("mismatch");
    expect(out[0].evidenceLabel).toBe("Mismatch");
  });
  it("Not available when Cash Sales list has no candidate", () => {
    const receipts = [
      {
        Id: "REC-4",
        DocNo: "OR-004",
        knockoff: { DocType: "INV", DocId: "ZZZ", DocNo: "CS-ZZZ" },
      },
    ];
    const out = compareReceiptKnockoffs(receipts, []);
    expect(out[0].correlation).toBe("not_available");
    expect(out[0].evidenceLabel).toBe("Not available");
  });
});

// ---- Refund → OR comparison ----------------------------------------------

describe("Run 5D0 — Refund ↔ OR identity check", () => {
  const receipts = [
    { Id: "OR-ID-1", DocNo: "OR-100", CustomerId: "C1" },
    { Id: "OR-ID-2", DocNo: "OR-200", CustomerId: "C1" },
  ];
  it("Immutable ID confirmed", () => {
    const rf = [
      {
        Id: "RF-1",
        DocNo: "RF-001",
        CustomerId: "C1",
        knockoff: { DocType: "OR", DocId: "OR-ID-1", DocNo: "OR-100", AppliedAmount: 50 },
      },
    ];
    const out = compareRefundKnockoffs(rf, receipts);
    expect(out[0].evidenceLabel).toBe("Immutable ID confirmed");
    expect(out[0].sameUuid).toBe(true);
  });
  it("Document-number only", () => {
    const rf = [
      {
        Id: "RF-2",
        DocNo: "RF-002",
        knockoff: { DocType: "OR", DocNo: "OR-200" },
      },
    ];
    const out = compareRefundKnockoffs(rf, receipts);
    expect(out[0].evidenceLabel).toBe("Document-number only — not proven");
  });
  it("Mismatch", () => {
    const rf = [
      {
        Id: "RF-3",
        DocNo: "RF-003",
        knockoff: { DocType: "OR", DocId: "WRONG", DocNo: "OR-100" },
      },
    ];
    const out = compareRefundKnockoffs(rf, receipts);
    expect(out[0].evidenceLabel).toBe("Mismatch");
  });
  it("Not available", () => {
    const rf = [
      {
        Id: "RF-4",
        DocNo: "RF-004",
        knockoff: { DocType: "OR", DocId: "NONE", DocNo: "NONE" },
      },
    ];
    const out = compareRefundKnockoffs(rf, receipts);
    expect(out[0].evidenceLabel).toBe("Not available");
  });
});

// ---- Filter engine + diagnostics -----------------------------------------

describe("Run 5D0 — applyFilters (AND logic + diagnostics)", () => {
  const rows = [
    { Id: "1", DocNo: "OR-001", ReferenceNo: "HH-1", CustomerCode: "700-C001" },
    { Id: "2", DocNo: "OR-002", ReferenceNo: "HH-2", CustomerCode: "700-C001" },
    { Id: "3", DocNo: "OR-003", ReferenceNo: "HH-3", CustomerCode: "700-C002" },
  ];
  it("AND filters intersect and diagnostics record before/after counts + resolved fields", () => {
    const { rows: kept, diagnostic } = applyFilters(
      "ar_receipts",
      rows,
      { docNumber: "or-001", customerCode: "700-c001" },
      { code: "700-C001" },
    );
    expect(kept.map((r) => (r as { Id: string }).Id)).toEqual(["1"]);
    expect(diagnostic.beforeCount).toBe(3);
    expect(diagnostic.afterCount).toBe(1);
    expect(diagnostic.resolvedFields.docNumber).toBe("DocNo");
    expect(diagnostic.resolvedFields.customerCode).toBe("CustomerCode");
  });
  it("rejects customerCode not matching tenant-configured HotelHub customer", () => {
    const { rows: kept, diagnostic } = applyFilters(
      "ar_receipts",
      rows,
      { customerCode: "999-XXXX" },
      { code: "700-C001" },
    );
    expect(kept).toEqual([]);
    expect(diagnostic.rejected?.field).toBe("customerCode");
    expect(diagnostic.rejected?.reason).toBe("customer_code_not_configured_hotelhub_customer");
  });
  it("mismatches include filter names whose field is absent from rows", () => {
    const { diagnostic } = applyFilters(
      "ar_receipts",
      [{ Id: "x", DocNo: "OR-1" }],
      { hotelReference: "HH-X" },
      null,
    );
    expect(diagnostic.mismatches).toContain("hotelReference");
    expect(diagnostic.resolvedFields.hotelReference).toBe(null);
  });
  it("gl_accounts ignores transactional filters", () => {
    const { rows: kept } = applyFilters(
      "gl_accounts",
      rows,
      { docNumber: "does-not-exist" },
      null,
    );
    expect(kept).toEqual(rows);
  });
});

// ---- Bundle schema + tests --------------------------------------------

describe("Run 5D0 — bundle schema constant", () => {
  it("is versioned 5d0.2", () => {
    expect(FINANCIAL_BUNDLE_SCHEMA_VERSION).toBe("5d0.2");
  });
});

// ---- Route module has no write methods -----------------------------------

describe("Run 5D0 — route module is GET-only against N3", () => {
  it("financial-verification route never issues N3 writes", () => {
    const src = readFileSync(
      resolve(__dirname, "../../routes/api/n3/financial-verification.ts"),
      "utf8",
    );
    // The route may accept POST from the browser; it must not construct
    // any N3 request using write verbs.
    expect(/callN3Path\s*\([^)]*,\s*['"]POST/i.test(src)).toBe(false);
    expect(/callN3Path\s*\([^)]*,\s*['"]PUT/i.test(src)).toBe(false);
    expect(/callN3Path\s*\([^)]*,\s*['"]PATCH/i.test(src)).toBe(false);
    expect(/callN3Path\s*\([^)]*,\s*['"]DELETE/i.test(src)).toBe(false);
  });
  it("n3-financial.server never issues N3 writes", () => {
    const src = readFileSync(resolve(__dirname, "../n3-financial.server.ts"), "utf8");
    expect(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(src)).toBe(false);
  });
});

// ---- GL query endpoint precedence ----------------------------------------

describe("Run 5D0 — GL endpoint precedence", () => {
  it("puts /api/GLAccounts/Query first in the GL candidates", () => {
    // Introspect the RESOURCE_CANDIDATES constant indirectly by scanning
    // the module source — this is intentionally coupled so the correction
    // cannot silently regress the endpoint order.
    const src = readFileSync(resolve(__dirname, "../n3-financial.server.ts"), "utf8");
    const glBlock = src.match(/gl_accounts:\s*\[([^\]]+)\]/);
    expect(glBlock).toBeTruthy();
    const first = glBlock![1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))[0];
    expect(first).toBe("/api/GLAccounts/Query");
  });
});

// ---- Ensure N3-only guardrails intact ------------------------------------

describe("Run 5D0 — Supabase browser-auth guardrails", () => {
  it("functionMiddleware remains []", () => {
    const src = readFileSync(resolve(__dirname, "../../start.ts"), "utf8");
    expect(src).toMatch(/functionMiddleware:\s*\[\s*\]/);
    expect(src).not.toMatch(/attachSupabaseAuth/);
  });
});
