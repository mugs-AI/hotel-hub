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
  validateContract,
  assessDetailResponse,
  assertNoInternalOrSecretFields,
  normalizeRefundDetail,
  deriveRefundLinkState,
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
    const r = evaluateGlAccount({
      Id: "gl-4",
      Name: "Bank Charges",
      Active: true,
      IsPostingAccount: true,
    });
    expect(r.eligibility).toBe("unknown");
    expect(r.reasons).toContain("missing_special_type");
    // classifyGlAccount is the backward-compat alias.
    expect(
      classifyGlAccount({ Id: "gl-4", Name: "Bank Charges", Active: true, IsPostingAccount: true }),
    ).toBe("unknown");
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
    const cs = [{ Id: "BBB", DocNo: "CS-3" }];
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
    const { rows: kept } = applyFilters("gl_accounts", rows, { docNumber: "does-not-exist" }, null);
    expect(kept).toEqual(rows);
  });
});

// ---- Bundle schema + tests --------------------------------------------

describe("Run 5D0 — bundle schema constant", () => {
  it("is versioned 5d0.3", () => {
    expect(FINANCIAL_BUNDLE_SCHEMA_VERSION).toBe("5d0.3");
  });
});

describe("Run 5D0 — route module is GET-only against N3", () => {
  it("financial-verification route never issues N3 writes", () => {
    const src = readFileSync(
      resolve(__dirname, "../../routes/api/n3/financial-verification.ts"),
      "utf8",
    );
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

describe("Run 5D0.3 — GL endpoint precedence", () => {
  it("puts /api/AccountCodes/Leaf/Query first in the GL candidates", () => {
    const src = readFileSync(resolve(__dirname, "../n3-financial.server.ts"), "utf8");
    const glBlock = src.match(/gl_accounts:\s*\[([^\]]+)\]/);
    expect(glBlock).toBeTruthy();
    const first = glBlock![1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))[0];
    expect(first).toBe("/api/AccountCodes/Leaf/Query");
  });
});

// ---- 5d0.3 correction regression tests -----------------------------------

describe("Run 5D0.3 — AR receipts list contract (no knockoff required)", () => {
  it("accepts the proven live list shape without knockoff/DepositTo", () => {
    const cv = validateContract(
      "ar_receipts",
      [
        {
          id: "R1",
          docCode: "OR-001",
          docDate: "2026-07-01",
          customerCode: "700-C001",
          totalAmount: 100,
        },
      ],
      "Get customer receipt list success",
    );
    expect(cv.passed).toBe(true);
  });
});

describe("Run 5D0.3 — Cash Sales list contract (live fields)", () => {
  it("recognises customer/customerName + netTotalAmount + isPostToAR", () => {
    const cv = validateContract(
      "cash_sales",
      [
        {
          id: "CS1",
          docCode: "CS-001",
          docDate: "2026-07-01",
          customer: "C1",
          customerName: "Alice",
          netTotalAmount: 200,
          outstandingAmount: 0,
          referenceNo: "HH-1",
          isPostToAR: false,
        },
      ],
      "Get cash sales list success",
    );
    expect(cv.passed).toBe(true);
  });
});

describe("Run 5D0.3 — Customer Refund rejects credit-note envelope", () => {
  it("rejects empty page whose envelope identifies AR credit note", () => {
    const cv = validateContract("customer_refunds", [], "Get AR credit note list success");
    expect(cv.passed).toBe(false);
    expect(cv.suspectedResource).toBe("ar_credit_note");
  });
  it("also rejects a non-empty page identified as credit note", () => {
    const cv = validateContract(
      "customer_refunds",
      [{ Id: "X", DocNo: "CN-1", CreditNoteType: "AR" }],
      "Get AR credit note list success",
    );
    expect(cv.passed).toBe(false);
  });
  it("empty page without a credit-note envelope cannot prove refund", () => {
    const cv = validateContract("customer_refunds", [], "Get customer refund list success");
    expect(cv.passed).toBe(false);
    expect(cv.reason).toBe("empty_page_cannot_prove_customer_refund");
  });
});

describe("Run 5D0.3 — ID resolves but docNo disagrees → Mismatch", () => {
  it("OR knockoff: id matches Cash Sale id but docNo differs", () => {
    const receipts = [
      {
        id: "REC-1",
        docNo: "OR-001",
        customerId: "C1",
        knockoffs: [
          {
            docType: "INV",
            docId: "CS-UUID-1",
            docNo: "CS-WRONG",
            docCode: null,
            appliedAmount: 100,
            docTypeNormalized: "INV",
          },
        ],
      },
    ];
    const cs = [{ id: "CS-UUID-1", docNo: "CS-RIGHT", customerId: "C1" }];
    const out = compareReceiptKnockoffs(receipts, cs);
    expect(out[0].correlation).toBe("mismatch");
    expect(out[0].sameUuid).toBe(true);
    expect(out[0].docNoAgrees).toBe(false);
  });
  it("Refund knockoff: id matches OR id but docNo differs", () => {
    const receipts = [{ id: "OR-ID-1", docNo: "OR-RIGHT", customerId: "C1" }];
    const rf = [
      {
        Id: "RF-1",
        DocNo: "RF-001",
        CustomerId: "C1",
        knockoff: { DocType: "OR", DocId: "OR-ID-1", DocNo: "OR-WRONG" },
      },
    ];
    const out = compareRefundKnockoffs(rf, receipts);
    expect(out[0].correlation).toBe("mismatch");
  });
});

describe("Run 5D0.3 — export sanitization asserts no internal properties", () => {
  it("throws on rawItems/rawTotal/body/matchedRawRows", () => {
    expect(() => assertNoInternalOrSecretFields({ x: { rawItems: [] } })).toThrow(/rawItems/i);
    expect(() => assertNoInternalOrSecretFields({ x: { body: {} } })).toThrow(/body/i);
    expect(() => assertNoInternalOrSecretFields({ x: { matchedRawRows: [] } })).toThrow(
      /matchedRawRows/i,
    );
  });
  it("throws on tenant.id in the bundle", () => {
    expect(() =>
      assertNoInternalOrSecretFields({ tenant: { id: "abc-uuid", code: "T", name: "n" } }),
    ).toThrow(/tenant_id/);
  });
  it("throws on secret headers anywhere", () => {
    expect(() =>
      assertNoInternalOrSecretFields({ a: [{ b: { Authorization: "Bearer xxx" } }] }),
    ).toThrow();
  });
  it("passes a clean bundle-shaped object", () => {
    expect(() =>
      assertNoInternalOrSecretFields({
        schemaVersion: "5d0.3",
        tenant: { code: "T", name: "N" },
        resources: [{ resource: "ar_receipts", rows: [{ DocNo: "OR-1" }] }],
      }),
    ).not.toThrow();
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

// ---- Run 5D0.3A source-review corrections --------------------------------

import { existsSync } from "node:fs";

describe("Run 5D0.3A — regenerated browser-auth files are absent", () => {
  const forbidden = [
    "src/integrations/supabase/auth-attacher.ts",
    "src/integrations/supabase/auth-middleware.ts",
    "src/integrations/supabase/client.ts",
  ];
  for (const rel of forbidden) {
    it(`does not exist: ${rel}`, () => {
      expect(existsSync(resolve(__dirname, "../../..", rel))).toBe(false);
    });
  }
  it("keeps src/integrations/supabase/client.server.ts", () => {
    expect(
      existsSync(resolve(__dirname, "../../..", "src/integrations/supabase/client.server.ts")),
    ).toBe(true);
  });
  it("src/start.ts keeps functionMiddleware: []", () => {
    const src = readFileSync(resolve(__dirname, "../../start.ts"), "utf8");
    expect(src).toMatch(/functionMiddleware:\s*\[\s*\]/);
    expect(src).not.toMatch(/attachSupabaseAuth/);
  });
});

describe("Run 5D0.3A — empty pages cannot establish Live N3 Confirmed", () => {
  it("AR Receipts: empty rows fail contract even with receipt envelope", () => {
    const cv = validateContract("ar_receipts", [], "Get AR receipt list success");
    expect(cv.passed).toBe(false);
    expect(cv.reason).toBe("empty_page_cannot_prove_ar_receipts");
  });
  it("Cash Sales: empty rows fail contract even with cash-sale envelope", () => {
    const cv = validateContract("cash_sales", [], "Get cash sale list success");
    expect(cv.passed).toBe(false);
    expect(cv.reason).toBe("empty_page_cannot_prove_cash_sales");
  });
  it("Customer Refunds: empty rows fail contract", () => {
    const cv = validateContract("customer_refunds", [], "Get customer refund list success");
    expect(cv.passed).toBe(false);
    expect(cv.reason).toBe("empty_page_cannot_prove_customer_refund");
  });
  it("GL Accounts: empty rows fail contract", () => {
    const cv = validateContract("gl_accounts", [], null);
    expect(cv.passed).toBe(false);
    expect(cv.reason).toBe("empty_page_cannot_prove_gl_accounts");
  });
});

describe("Run 5D0.3A — Customer Code filter recognises live `customer` field", () => {
  it("matches Cash Sales row whose CODE lives in `customer` (not customerName)", () => {
    const rows = [
      { docNo: "CS-1", customer: "WALKIN", customerName: "Walk In Guest", netTotalAmount: 100 },
      { docNo: "CS-2", customer: "OTHER", customerName: "Somebody Else", netTotalAmount: 50 },
    ];
    const out = applyFilters("cash_sales", rows, { customerCode: "WALKIN" }, { code: "WALKIN" });
    expect(out.rows.length).toBe(1);
    expect((out.rows[0] as { docNo: string }).docNo).toBe("CS-1");
    expect(out.diagnostic.resolvedFields.customerCode).toBe("customer");
  });
  it("never treats customerName as a customer code", () => {
    const rows = [{ docNo: "CS-3", customerName: "WALKIN", netTotalAmount: 25 }];
    const out = applyFilters("cash_sales", rows, { customerCode: "WALKIN" }, { code: "WALKIN" });
    expect(out.rows.length).toBe(0);
    expect(out.diagnostic.mismatches).toContain("customerCode");
  });
});

describe("Run 5D0.3A Closure — detail response acceptance gate", () => {
  const validReceipt = {
    code: "0000",
    message: "Get customer receipt success",
    data: {
      id: "receipt-id-1",
      docNo: "OR-0001",
      customerCode: "WALKIN",
      totalAmount: 100,
    },
  };

  it("accepts a 2xx success envelope with a matching transaction DTO", () => {
    const out = assessDetailResponse({
      resource: "ar_receipts",
      httpStatus: 200,
      envelopeCode: "0000",
      body: validReceipt,
      sourceListId: "receipt-id-1",
    });
    expect(out.accepted).toBe(true);
    expect(out.normalized?.id).toBe("receipt-id-1");
    expect(Object.keys(out.dto ?? {})).toContain("totalAmount");
    expect(out.rejectionReason).toBeNull();
  });

  it("rejects a 2xx non-success N3 envelope", () => {
    const out = assessDetailResponse({
      resource: "ar_receipts",
      httpStatus: 200,
      envelopeCode: "9999",
      body: { code: "9999", message: "Not found", data: validReceipt.data },
      sourceListId: "receipt-id-1",
    });
    expect(out.accepted).toBe(false);
    expect(out.normalized).toBeNull();
    expect(out.rejectionReason).toBe("n3_error_envelope");
  });

  it("rejects a success envelope with null data", () => {
    const out = assessDetailResponse({
      resource: "ar_receipts",
      httpStatus: 200,
      envelopeCode: "0000",
      body: { code: "0000", message: "Success", data: null },
      sourceListId: "receipt-id-1",
    });
    expect(out.accepted).toBe(false);
    expect(out.normalized).toBeNull();
    expect(out.rejectionReason).toBe("empty_or_invalid_detail_data");
  });

  it("rejects an HTTP 404 response", () => {
    const out = assessDetailResponse({
      resource: "ar_receipts",
      httpStatus: 404,
      envelopeCode: null,
      body: { message: "Not found" },
      sourceListId: "receipt-id-1",
    });
    expect(out.accepted).toBe(false);
    expect(out.normalized).toBeNull();
    expect(out.rejectionReason).toBe("http_not_success");
  });

  it("rejects a valid-looking DTO whose immutable ID disagrees", () => {
    const out = assessDetailResponse({
      resource: "ar_receipts",
      httpStatus: 200,
      envelopeCode: "0000",
      body: validReceipt,
      sourceListId: "different-id",
    });
    expect(out.accepted).toBe(false);
    expect(out.normalized).toBeNull();
    expect(out.dto).toBeNull();
    expect(out.rejectionReason).toBe("detail_id_mismatch");
  });

  it("rejects a DTO with an ID but no document identity", () => {
    const out = assessDetailResponse({
      resource: "cash_sales",
      httpStatus: 200,
      envelopeCode: "0000",
      body: { data: { id: "cash-id-1", netTotalAmount: 50 } },
      sourceListId: "cash-id-1",
    });
    expect(out.accepted).toBe(false);
    expect(out.rejectionReason).toBe("missing_document_identity");
  });

  it("does not expose error-envelope fields as accepted detail fields", () => {
    const out = assessDetailResponse({
      resource: "customer_refunds",
      httpStatus: 200,
      envelopeCode: "5000",
      body: { code: "5000", message: "Internal error", error: "failed" },
      sourceListId: "refund-id-1",
    });
    expect(out.accepted).toBe(false);
    expect(out.dto).toBeNull();
    expect(Object.keys(out.dto ?? {})).not.toContain("error");
  });

  it("renders performed, requested, and normalized counts separately", () => {
    const src = readFileSync(
      resolve(__dirname, "../../routes/settings_.n3-financial-verification.tsx"),
      "utf8",
    );
    expect(src).toMatch(
      /detailFanOut\.performed[\s\S]*performed[\s\S]*detailFanOut\.requested[\s\S]*requested[\s\S]*detailFanOut\.normalized[\s\S]*normalized/,
    );
  });
});

// ---- Run 5D0.3B — Customer Refund RF contract -----------------------------

const LIVE_RF_ROW = {
  id: "71060db7-b73b-49d1-f843-08deed8f951a",
  docCode: "M1RF260701",
  docDate: "2026-07-30",
  docType: "RF",
  customerCode: "777-W001",
  customerName: "WALK-IN CUSTOMER HOTEL",
  description: "Customer Payment Refund",
  netTotalAmount: 200,
  outstandingAmount: 200,
  status: "Unapplied",
  isCancelled: false,
  account: {
    id: "74ba5c46-082f-430c-bbdb-07ce23be92a1",
    code: "700-0301",
    name: "CIMB",
    type: "BCA",
    specialCode: "BAC",
    isActive: true,
  },
};
const MISLEADING_ENVELOPE = "Get AR credit note list success";

describe("Run 5D0.3B — Customer Refund validated by RF structure", () => {
  it("accepts the proven live RF row despite the AR credit note envelope", () => {
    const cv = validateContract("customer_refunds", [LIVE_RF_ROW], MISLEADING_ENVELOPE);
    expect(cv.passed).toBe(true);
  });
  it("reports suspectedResource customer_refunds", () => {
    const cv = validateContract("customer_refunds", [LIVE_RF_ROW], MISLEADING_ENVELOPE);
    expect(cv.suspectedResource).toBe("customer_refunds");
  });
  it("uses a refund-specific success reason", () => {
    const cv = validateContract("customer_refunds", [LIVE_RF_ROW], MISLEADING_ENVELOPE);
    expect(cv.reason).toBe("customer_refund_rf_structure_confirmed");
    expect(cv.reason).not.toBe("credit_note_envelope_rejected_as_refund");
  });
  it("retains the misleading envelope message as diagnostic evidence", () => {
    const cv = validateContract("customer_refunds", [LIVE_RF_ROW], MISLEADING_ENVELOPE);
    expect(cv.envelopeMessage).toBe(MISLEADING_ENVELOPE);
    expect(cv.requiredHits.envelopeMentionsCreditNote).toBe(true);
  });
  it("rejects a real credit-note row (non-RF docType) under the same envelope", () => {
    const cv = validateContract(
      "customer_refunds",
      [{ ...LIVE_RF_ROW, docType: "ARCN", docCode: "M1CN260701" }],
      MISLEADING_ENVELOPE,
    );
    expect(cv.passed).toBe(false);
    expect(cv.reason).toBe("non_rf_document_type_rejected_as_refund");
  });
  it("rejects generic document/customer/amount rows without an RF discriminator", () => {
    const { docType: _dt, ...noType } = LIVE_RF_ROW;
    void _dt;
    const cv = validateContract("customer_refunds", [noType], MISLEADING_ENVELOPE);
    expect(cv.passed).toBe(false);
    expect(cv.reason).toBe("missing_rf_document_type_discriminator");
  });
  it("empty page with AR credit note envelope still cannot prove refund", () => {
    const cv = validateContract("customer_refunds", [], MISLEADING_ENVELOPE);
    expect(cv.passed).toBe(false);
    expect(cv.reason).toBe("empty_page_cannot_prove_customer_refund");
  });
});

describe("Run 5D0.3B — live refund detail normalization", () => {
  const detailBody = {
    code: "0000",
    message: MISLEADING_ENVELOPE,
    data: {
      value: {
        ...LIVE_RF_ROW,
        referenceNo: "REF-1",
        currencyCode: "MYR",
        customer: {
          id: "cust-uuid-1",
          code: "777-W001",
          name: "WALK-IN CUSTOMER HOTEL",
        },
        knockoff: [],
      },
    },
  };
  it("normalizes lower-camel-case refund fields, customer and account objects", () => {
    const n = normalizeRefundDetail(detailBody)!;
    expect(n.id).toBe(LIVE_RF_ROW.id);
    expect(n.docCode).toBe("M1RF260701");
    expect(n.docType).toBe("RF");
    expect(n.docDate).toBe("2026-07-30");
    expect(n.customerCode).toBe("777-W001");
    expect(n.customerName).toBe("WALK-IN CUSTOMER HOTEL");
    expect(n.customerId).toBe("cust-uuid-1");
    expect(n.netTotalAmount).toBe(200);
    expect(n.outstandingAmount).toBe(200);
    expect(n.status).toBe("Unapplied");
    expect(n.isCancelled).toBe(false);
    expect(n.currencyCode).toBe("MYR");
    expect(n.referenceNo).toBe("REF-1");
    expect(n.account).toEqual({
      id: "74ba5c46-082f-430c-bbdb-07ce23be92a1",
      code: "700-0301",
      name: "CIMB",
      type: "BCA",
      specialCode: "BAC",
      isActive: true,
    });
  });
  it("accepts an empty knockoff array as a valid normalized detail", () => {
    const n = normalizeRefundDetail(detailBody)!;
    expect(n).not.toBeNull();
    expect(n.knockoffs).toEqual([]);
  });
});

describe("Run 5D0.3B — refund link state derivation", () => {
  const normalized = () => normalizeRefundDetail({ data: { value: { ...LIVE_RF_ROW, knockoff: [] } } })!;
  it("successful refund with zero knockoffs is unapplied, not not_available", () => {
    const s = deriveRefundLinkState({
      resourceStatus: "success",
      contractPassed: true,
      refundDetails: [normalized()],
      comparisonRows: 0,
    });
    expect(s.state).toBe("unapplied");
    expect(s.label).toBe("Unapplied — No OR Linked");
  });
  it("linked when knockoffs produce comparison rows", () => {
    const withKo = normalizeRefundDetail({
      data: {
        value: {
          ...LIVE_RF_ROW,
          knockoff: [{ docId: "REC-1", docType: "OR", docNo: "OR-001", appliedAmount: 200 }],
        },
      },
    })!;
    const s = deriveRefundLinkState({
      resourceStatus: "success",
      contractPassed: true,
      refundDetails: [withKo],
      comparisonRows: 1,
    });
    expect(s.state).toBe("linked");
  });
  it("not_available when the resource failed or nothing normalized", () => {
    expect(
      deriveRefundLinkState({
        resourceStatus: "failed",
        contractPassed: false,
        refundDetails: [],
        comparisonRows: 0,
      }).state,
    ).toBe("not_available");
    expect(
      deriveRefundLinkState({
        resourceStatus: "success",
        contractPassed: true,
        refundDetails: [],
        comparisonRows: 0,
      }).state,
    ).toBe("not_available");
  });
  it("console renders the derived refund state, not a row-count guess", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/settings_.n3-financial-verification.tsx"),
      "utf8",
    );
    expect(src).toContain("data.refundLinkState");
    expect(src).toContain('data-testid="refund-link-state"');
  });
});
