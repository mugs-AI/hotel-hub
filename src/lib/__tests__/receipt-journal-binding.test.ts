import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readReceiptControlEvidence,
  type EvidenceDeps,
  type ScopedDeposit,
} from "../receipt-controls-evidence.server";
import { n3Receipts, type N3Outcome } from "../n3-receipts.server";

const RID = "11111111-1111-4111-8111-111111111111";
const CUST = "22222222-2222-4222-8222-222222222222";
const BANK = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const REF = "HH-0123456789abcdef01234567";
const actor = { tenantId: "t1", n3UserKey: "u1", n3Token: "fixture-token", role: "owner" as const };
const deposit: ScopedDeposit = {
  id: "d1",
  reservationId: "r1",
  status: "posted",
  n3ReceiptId: RID,
  n3DocCode: "OR-T/001",
  n3CustomerId: CUST,
  n3CustomerCode: "700-7001",
  n3ReferenceNo: REF,
  currencyCode: "MYR",
  paymentLines: [{ id: BANK, code: "700-0310", name: "Test bank", amount: 50 }],
};
const detail = () => ({
  id: RID,
  docCode: "OR-T/001",
  docType: "AROR",
  referenceNo: REF,
  docDate: "2026-10-01T00:00:00",
  customerId: CUST,
  customerName: "Fixture Guest",
  currencyCode: "MYR",
  totalAmount: 50,
  outstandingAmount: 50,
  refundAmount: 0,
  accountId: BANK,
  accountCode: "700-0310",
  isMultiPayment: false,
  isCancelled: false,
  knockoff: [],
  remark1: "",
  remark2: "",
  remark3: "",
  remark4: "",
});
const rows = () => [
  {
    accountId: BANK,
    accountCode: "700-0310",
    debit: 50,
    credit: 0,
    docCode: null as unknown,
    referenceNo: REF,
  },
  {
    accountId: OTHER,
    accountCode: "700-7001",
    debit: 0,
    credit: 50,
    docCode: null as unknown,
    referenceNo: REF,
  },
];
const envelope = (data: unknown) => ({ code: "0000", success: true, data });
const response = (data: unknown): N3Outcome => ({
  kind: "response",
  status: 200,
  body: envelope(data),
  durationMs: 1,
});

// Mock only HTTP. Keep the real fixed-path client and evidence reader in the test.
function fixture(
  options: {
    rows?: unknown[];
    after?: Record<string, unknown>;
    afterStatus?: number;
    glBody?: unknown;
    deposit?: ScopedDeposit;
  } = {},
) {
  let details = 0;
  const reads: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect(init.method).toBe("GET"); // Any accidental write fails the fixture.
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-token");
    const path = new URL(url).pathname + new URL(url).search;
    reads.push(path);
    if (path === `/api/ARReceipts/${RID}`) {
      details++;
      return new Response(
        JSON.stringify(envelope(details === 1 ? detail() : { ...detail(), ...options.after })),
        { status: details === 1 ? 200 : (options.afterStatus ?? 200) },
      );
    }
    if (path === `/api/ARReceipts/GLPosting?key=${RID}`)
      return new Response(JSON.stringify(options.glBody ?? envelope(options.rows ?? rows())));
    throw new Error(`Unexpected fixture path: ${path}`);
  });
  const deps: EvidenceDeps = {
    loadDeposit: async (tenant, id) =>
      tenant === "t1" && id === "d1" ? (options.deposit ?? deposit) : null,
    n3: n3Receipts,
    now: () => "2026-10-03T04:00:00.000Z",
  };
  return { deps, reads };
}
afterEach(() => vi.unstubAllGlobals());

describe("receipt journal correlated immutable-key reads", () => {
  it("accepts explicit null row numbers only after bound GET and unchanged second detail", async () => {
    const { deps, reads } = fixture();
    const snap = await readReceiptControlEvidence(actor, "d1", deps);
    expect(snap.journalExact).toBe(true);
    expect(snap.journalDiagnostics).toBeUndefined();
    expect(snap.docCode).toBe("OR-T/001");
    expect(snap.amountCents).toBe(5000);
    expect(reads).toEqual([
      `/api/ARReceipts/${RID}`,
      `/api/ARReceipts/GLPosting?key=${RID}`,
      `/api/ARReceipts/${RID}`,
    ]);
  });

  it.each([
    { totalAmount: 60, outstandingAmount: 60 },
    { docCode: "OTHER/001" },
    { id: OTHER },
    { customerId: OTHER },
    { currencyCode: "USD" },
    { referenceNo: "HH-ffffffffffffffffffffffff" },
    { accountId: OTHER },
    { isCancelled: true },
    { knockoff: [{ docId: OTHER, amount: 1 }] },
    { refundAmount: 1 },
    { remark1: "changed" },
    { docDate: "2026-10-02T00:00:00" },
  ])("refuses a receipt change between detail and journal reads (%o)", async (after) => {
    const { deps } = fixture({ after });
    await expect(readReceiptControlEvidence(actor, "d1", deps)).rejects.toMatchObject({
      code: expect.stringMatching(/^n3_evidence_/),
    });
  });

  it("fails closed when the second detail read is unauthorized", async () => {
    const { deps } = fixture({ afterStatus: 401 });
    await expect(readReceiptControlEvidence(actor, "d1", deps)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it.each(["business", "malformed", "network"])(
    "fails closed on second-detail %s failure",
    async (kind) => {
      const { deps } = fixture();
      let details = 0;
      vi.stubGlobal("fetch", async (url: string) => {
        if (new URL(url).pathname.endsWith("GLPosting"))
          return new Response(JSON.stringify(envelope(rows())));
        if (++details === 1) return new Response(JSON.stringify(envelope(detail())));
        if (kind === "network") throw new Error("fixture disconnect");
        return new Response(
          kind === "malformed"
            ? "not json"
            : JSON.stringify({ code: "FAIL", success: false, data: detail() }),
        );
      });
      await expect(readReceiptControlEvidence(actor, "d1", deps)).rejects.toMatchObject({
        code: "n3_evidence_unavailable",
      });
    },
  );

  it("fails closed on a timed-out second detail read", async () => {
    const { deps } = fixture();
    const getById = deps.n3.getById;
    let reads = 0;
    deps.n3 = {
      ...deps.n3,
      getById: (token, key) =>
        ++reads === 2
          ? Promise.resolve({ kind: "transport_error", reason: "timeout", durationMs: 20_000 })
          : getById(token, key),
    };
    await expect(readReceiptControlEvidence(actor, "d1", deps)).rejects.toMatchObject({
      code: "n3_evidence_unavailable",
    });
  });

  it("does not trust provenance supplied inside an upstream response", async () => {
    const { deps } = fixture();
    deps.n3 = {
      getById: async () => response(detail()),
      getGLPosting: async () => ({
        ...response(rows()),
        binding: { receiptId: RID, token: actor.n3Token },
        requestedKey: RID,
      }),
    };
    expect((await readReceiptControlEvidence(actor, "d1", deps)).journalExact).toBe(false);
  });

  it("refuses real transport provenance for a different key", async () => {
    const { deps } = fixture();
    vi.stubGlobal(
      "fetch",
      async (url: string) =>
        new Response(
          JSON.stringify(envelope(new URL(url).pathname.endsWith("GLPosting") ? rows() : detail())),
        ),
    );
    deps.n3 = { ...n3Receipts, getGLPosting: (token) => n3Receipts.getGLPosting(token, OTHER) };
    expect((await readReceiptControlEvidence(actor, "d1", deps)).journalExact).toBe(false);
  });

  it("refuses provenance from a different authenticated token", async () => {
    const { deps } = fixture();
    vi.stubGlobal(
      "fetch",
      async (url: string) =>
        new Response(
          JSON.stringify(envelope(new URL(url).pathname.endsWith("GLPosting") ? rows() : detail())),
        ),
    );
    deps.n3 = {
      ...n3Receipts,
      getGLPosting: () => n3Receipts.getGLPosting("other-fixture-token", RID),
    };
    expect((await readReceiptControlEvidence(actor, "d1", deps)).journalExact).toBe(false);
  });

  it.each([
    [undefined, "journal_row_doc_code_absent"],
    ["", "journal_row_doc_code_blank"],
    [false, "journal_row_doc_code_invalid"],
    ["WRONG/001", "journal_row_doc_code_mismatch"],
  ])("keeps unsupported/wrong document numbers blocked (%s)", async (value, reason) => {
    const changed = rows().map((row) => {
      const copy = { ...row };
      if (value === undefined) delete (copy as Record<string, unknown>).docCode;
      else copy.docCode = value;
      return copy;
    });
    const { deps } = fixture({ rows: changed });
    const snap = await readReceiptControlEvidence(actor, "d1", deps);
    expect(snap.journalExact).toBe(false);
    expect(snap.journalDiagnostics).toContain(reason);
  });

  it("rejects a present wrong document code alongside a null row", async () => {
    const changed = rows();
    changed[1]!.docCode = "WRONG/001";
    const { deps } = fixture({ rows: changed });
    const snap = await readReceiptControlEvidence(actor, "d1", deps);
    expect(snap.journalExact).toBe(false);
    expect(snap.journalDiagnostics).toContain("journal_row_doc_code_mismatch");
  });

  it.each([false, "", { unreadable: true }])(
    "does not ignore an invalid alias beside a valid number in a correlated journal (%o)",
    async (DocNo) => {
      const changed = rows();
      Object.assign(changed[0]!, { docCode: "OR-T/001", DocNo });
      const { deps } = fixture({ rows: changed });
      expect((await readReceiptControlEvidence(actor, "d1", deps)).journalExact).toBe(false);
    },
  );

  it("accepts a mixed numbered/null journal when every present number agrees", async () => {
    const changed = rows();
    changed[0]!.docCode = "OR-T/001";
    const { deps } = fixture({ rows: changed });
    expect((await readReceiptControlEvidence(actor, "d1", deps)).journalExact).toBe(true);
  });

  it("ignores only object-key ordering when confirming the receipt", async () => {
    const { deps } = fixture();
    let reads = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (new URL(url).pathname.endsWith("GLPosting"))
        return new Response(JSON.stringify(envelope(rows())));
      reads++;
      const value = reads === 1 ? detail() : Object.fromEntries(Object.entries(detail()).reverse());
      return new Response(JSON.stringify(envelope(value)));
    });
    expect((await readReceiptControlEvidence(actor, "d1", deps)).journalExact).toBe(true);
  });

  it("rejects a copied transport outcome without its private provenance", async () => {
    const { deps } = fixture();
    deps.n3 = {
      ...n3Receipts,
      getGLPosting: async (token, id) => ({ ...(await n3Receipts.getGLPosting(token, id)) }),
    };
    expect((await readReceiptControlEvidence(actor, "d1", deps)).journalExact).toBe(false);
  });

  it("keeps the fingerprint stable across re-reads and binds changed null/number evidence", async () => {
    const a = await readReceiptControlEvidence(actor, "d1", fixture().deps);
    const b = await readReceiptControlEvidence(actor, "d1", fixture().deps);
    expect(a.sourceFingerprint).toBe(b.sourceFingerprint);
    const changed = rows();
    changed[0]!.docCode = "OR-T/001";
    const c = await readReceiptControlEvidence(actor, "d1", fixture({ rows: changed }).deps);
    expect(c.sourceFingerprint).not.toBe(a.sourceFingerprint);
  });

  it.each([
    [{ debit: 49 }, {}],
    [{ accountId: OTHER }, {}],
    [{ referenceNo: "OTHER" }, {}],
    [{}, { credit: 49 }],
    [{}, { accountCode: "700-9999" }],
    [{}, { referenceNo: null }],
    [{ DocNo: "WRONG/001", docCode: "OR-T/001" }, {}],
  ])(
    "retains accounting and reference refusals with transport proof (%o)",
    async (bank, customer) => {
      const changed = rows();
      Object.assign(changed[0]!, bank);
      Object.assign(changed[1]!, customer);
      const { deps } = fixture({ rows: changed });
      expect((await readReceiptControlEvidence(actor, "d1", deps)).journalExact).toBe(false);
    },
  );

  it("refuses a business-error envelope despite HTTP success", async () => {
    const { deps } = fixture({ glBody: { code: "FAIL", success: false, data: rows() } });
    expect((await readReceiptControlEvidence(actor, "d1", deps)).journalExact).toBe(false);
  });

  it("never reads N3 for a deposit outside the actor's tenant", async () => {
    const { deps, reads } = fixture();
    await expect(
      readReceiptControlEvidence({ ...actor, tenantId: "other" }, "d1", deps),
    ).rejects.toMatchObject({ code: "deposit_not_found" });
    expect(reads).toEqual([]);
  });
});
