import { describe, expect, it, vi } from "vitest";
import {
  readReceiptControlEvidence,
  receiptControlCapabilities,
  receiptFingerprint,
  verifyReceiptControlResult,
  type EvidenceDeps,
  type ScopedDeposit,
} from "../receipt-controls-evidence.server";
import { receiptSnapshot } from "./fixtures/receipt-controls";
import type { N3Outcome } from "../n3-receipts.server";

const RID = "11111111-1111-4111-8111-111111111111";
const CUST = "22222222-2222-4222-8222-222222222222";
const ACC = "33333333-3333-4333-8333-333333333333";
const actor = { tenantId: "t1", n3UserKey: "u1", n3Token: "tok", role: "owner" as const };

const deposit: ScopedDeposit = {
  id: "d1",
  reservationId: "r1",
  status: "posted",
  n3ReceiptId: RID,
  n3DocCode: "OR-TEST/001",
  n3CustomerId: CUST,
  n3ReferenceNo: "HH-REF-1",
  currencyCode: "MYR",
  paymentLines: [{ id: ACC, code: "BANK-T", name: "Test Bank", amount: 50 }],
};
const receiptBody = (o: Record<string, unknown> = {}) => ({
  code: 0,
  data: {
    id: RID,
    docCode: "OR-TEST/001",
    docType: "AROR",
    referenceNo: "HH-REF-1",
    docDate: "2026-10-01T00:00:00",
    customerId: CUST,
    customerName: "Test Guest",
    currencyCode: "MYR",
    totalAmount: 50,
    outstandingAmount: 50,
    refundAmount: 0,
    accountId: ACC,
    accountCode: "BANK-T",
    isMultiPayment: false,
    isCancelled: false,
    knockoff: [],
    remark1: "1 Test Street",
    remark2: "",
    remark3: "0100000000",
    remark4: "guest@example.test",
    ...o,
  },
});
const AR = "44444444-4444-4444-8444-444444444444";
const gl = (accountId: string, debit: number, credit: number, o: Record<string, unknown> = {}) => ({
  accountId,
  debit,
  credit,
  docCode: "OR-TEST/001",
  referenceNo: "HH-REF-1",
  ...o,
});
const journal = (amount = 50, rows?: unknown[]) => ({
  code: 0,
  data: rows ?? [gl(ACC, amount, 0), gl(AR, 0, amount)],
});
const ok = (body: unknown): N3Outcome => ({ kind: "response", status: 200, body, durationMs: 1 });

function deps(over: Partial<EvidenceDeps> & { detail?: N3Outcome; gl?: N3Outcome } = {}) {
  const getById = vi.fn(async () => over.detail ?? ok(receiptBody()));
  const getGLPosting = vi.fn(async () => over.gl ?? ok(journal()));
  const d: EvidenceDeps = {
    loadDeposit: over.loadDeposit ?? vi.fn(async () => deposit),
    n3: { getById, getGLPosting },
    now: () => "2026-10-02T01:00:00.000Z",
  };
  return { d, getById, getGLPosting };
}
const errCode = async (p: Promise<unknown>) =>
  p.then(
    () => "no_error",
    (e) => e.code,
  );

describe("receipt control evidence", () => {
  it("looks up the tenant-scoped deposit before any N3 call", async () => {
    const order: string[] = [];
    const { d } = deps({
      loadDeposit: vi.fn(async (t: string, id: string) => {
        order.push(`db:${t}:${id}`);
        return null;
      }),
    });
    d.n3.getById = vi.fn(async () => {
      order.push("n3");
      return ok(receiptBody());
    });
    expect(await errCode(readReceiptControlEvidence(actor, "d1", d))).toBe("deposit_not_found");
    expect(order).toEqual(["db:t1:d1"]);
  });
  it("normalizes an active unmatched receipt with a balanced journal", async () => {
    const { d } = deps();
    const snap = await readReceiptControlEvidence(actor, "d1", d);
    expect(snap).toMatchObject({
      amountCents: 5000,
      documentState: "active",
      matchingState: "unmatched",
      documentDate: "2026-10-01",
      paymentLines: [{ accountId: ACC, savedName: "Test Bank", amountCents: 5000 }],
      contact: { customerName: "Test Guest", remark3: "0100000000" },
    });
  });
  it.each([
    [{ customerId: "99999999-9999-4999-8999-999999999999" }],
    [{ currencyCode: "USD" }],
    [{ id: "99999999-9999-4999-8999-999999999999" }],
    [{ docType: "ARIV" }],
  ])("rejects identity mismatch %o", async (o) => {
    const { d } = deps({ detail: ok(receiptBody(o)) });
    expect(await errCode(readReceiptControlEvidence(actor, "d1", d))).toBe("n3_evidence_mismatch");
  });
  it("maps a definite N3 401 to unauthorized", async () => {
    const { d } = deps({ detail: { kind: "response", status: 401, body: null, durationMs: 1 } });
    expect(await errCode(readReceiptControlEvidence(actor, "d1", d))).toBe("unauthorized");
  });
  it.each<[N3Outcome]>([
    [{ kind: "response", status: 404, body: null, durationMs: 1 }],
    [{ kind: "transport_error", reason: "network", durationMs: 1 }],
  ])("treats 404/network as unavailable, never as void", async (outcome) => {
    const { d } = deps({ detail: outcome });
    expect(await errCode(readReceiptControlEvidence(actor, "d1", d))).toBe(
      "n3_evidence_unavailable",
    );
  });
  it("marks missing cancellation and matching fields unknown", async () => {
    const { d } = deps({
      detail: ok(receiptBody({ isCancelled: undefined, knockoff: undefined })),
    });
    const snap = await readReceiptControlEvidence(actor, "d1", d);
    expect(snap.documentState).toBe("unknown");
    expect(snap.matchingState).toBe("unknown");
  });
  it("detects matched, refunded and voided receipts", async () => {
    const m = await readReceiptControlEvidence(
      actor,
      "d1",
      deps({ detail: ok(receiptBody({ knockoff: [{ id: "x" }] })) }).d,
    );
    expect(m.matchingState).toBe("matched");
    const r = await readReceiptControlEvidence(
      actor,
      "d1",
      deps({ detail: ok(receiptBody({ refundAmount: 10 })) }).d,
    );
    expect(r.matchingState).toBe("refunded");
    const v = await readReceiptControlEvidence(
      actor,
      "d1",
      deps({ detail: ok(receiptBody({ isCancelled: true })) }).d,
    );
    expect(v.documentState).toBe("voided");
  });
  it("rejects missing contact name", async () => {
    const { d } = deps({ detail: ok(receiptBody({ customerName: undefined })) });
    expect(await errCode(readReceiptControlEvidence(actor, "d1", d))).toBe(
      "n3_evidence_incomplete",
    );
  });
  it("keeps the saved historical account label for an account no longer offered", async () => {
    const snap = await readReceiptControlEvidence(actor, "d1", deps().d);
    expect(snap.paymentLines[0]!.savedName).toBe("Test Bank");
  });
  it("fingerprint excludes verifiedAt but includes money, contact, matching and journal", async () => {
    const a = await readReceiptControlEvidence(actor, "d1", deps().d);
    const later = deps();
    later.d.now = () => "2027-01-01T00:00:00.000Z";
    const b = await readReceiptControlEvidence(actor, "d1", later.d);
    expect(a.sourceFingerprint).toBe(b.sourceFingerprint);
    for (const o of [
      { totalAmount: 60, outstandingAmount: 60 },
      { remark3: "x" },
      { knockoff: [{ id: 1 }] },
    ]) {
      const c = await readReceiptControlEvidence(
        actor,
        "d1",
        deps({ detail: ok(receiptBody(o)), gl: ok(journal(Number((o as any).totalAmount ?? 50))) })
          .d,
      );
      expect(c.sourceFingerprint).not.toBe(a.sourceFingerprint);
    }
    expect(receiptFingerprint({ ...a, verifiedAt: "x" }, "j")).not.toBe(receiptFingerprint(a, "k"));
  });
  it("is GET-only: no create/update/void method exists on the evidence client", () => {
    const { d } = deps();
    expect(Object.keys(d.n3).sort()).toEqual(["getById", "getGLPosting"]);
  });
});

describe("capabilities", () => {
  it("defaults to manual mode only, even with env flags set", () => {
    process.env.HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT = "true";
    process.env.HOTELHUB_RECEIPT_CONTROL_VOID_REPLACE = "true";
    expect(receiptControlCapabilities()).toEqual({
      directEdit: false,
      voidReplace: false,
      manual: true,
    });
    delete process.env.HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT;
    delete process.env.HOTELHUB_RECEIPT_CONTROL_VOID_REPLACE;
  });
});

describe("verifyReceiptControlResult", () => {
  const original = receiptSnapshot();
  const corr = {
    kind: "correction" as const,
    amountCents: 8000,
    accountId: ACC,
    contact: original.contact,
  };
  it("verifies an expected corrected receipt", () => {
    const ev = receiptSnapshot({
      amountCents: 8000,
      paymentLines: [{ ...original.paymentLines[0]!, amountCents: 8000 }],
      sourceFingerprint: "new",
    });
    expect(verifyReceiptControlResult(original, corr, ev)).toBe("verified");
  });
  it("treats missing evidence as insufficient (no 404 void proof)", () => {
    expect(verifyReceiptControlResult(original, { kind: "void" }, null)).toBe("insufficient");
  });
  it("a cancellation flag alone never verifies a void (journal effect unproven)", () => {
    expect(
      verifyReceiptControlResult(
        original,
        { kind: "void" },
        receiptSnapshot({ documentState: "voided" }),
      ),
    ).toBe("insufficient");
    expect(
      verifyReceiptControlResult(
        original,
        { kind: "void" },
        receiptSnapshot({ documentState: "unknown" }),
      ),
    ).toBe("insufficient");
    expect(verifyReceiptControlResult(original, { kind: "void" }, receiptSnapshot())).toBe(
      "mismatch",
    );
  });
  it("flags unexpected edits and changed identity as mismatch", () => {
    expect(verifyReceiptControlResult(original, corr, receiptSnapshot({ amountCents: 7000 }))).toBe(
      "mismatch",
    );
    expect(
      verifyReceiptControlResult(
        original,
        corr,
        receiptSnapshot({ amountCents: 8000, customerId: "other" }),
      ),
    ).toBe("mismatch");
    expect(
      verifyReceiptControlResult(
        original,
        corr,
        receiptSnapshot({ amountCents: 8000, matchingState: "unknown" }),
      ),
    ).toBe("insufficient");
  });
});

describe("review blockers: exact evidence binding", () => {
  it("binds the saved HotelHub reference and document code", async () => {
    for (const o of [{ referenceNo: "OTHER" }, { referenceNo: undefined }, { docCode: "OR-X/9" }]) {
      const { d } = deps({ detail: ok(receiptBody(o)) });
      expect(await errCode(readReceiptControlEvidence(actor, "d1", d))).toBe(
        "n3_evidence_mismatch",
      );
    }
  });
  it("rejects zero/negative totals, missing date and payment totals that do not add up", async () => {
    for (const o of [
      { totalAmount: 0 },
      { totalAmount: -5 },
      { docDate: undefined },
    ]) {
      const { d } = deps({ detail: ok(receiptBody(o)) });
      expect(await errCode(readReceiptControlEvidence(actor, "d1", d))).toBe(
        "n3_evidence_incomplete",
      );
    }
    const split = receiptBody({
      isMultiPayment: true,
      multiPayments: [
        { accountId: ACC, amount: 30 },
        { accountId: AR, amount: 10 },
      ],
    });
    expect(await errCode(readReceiptControlEvidence(actor, "d1", deps({ detail: ok(split) }).d))).toBe(
      "n3_evidence_mismatch",
    );
  });
  it("missing refund data is unknown, never silently zero", async () => {
    const { d } = deps({ detail: ok(receiptBody({ refundAmount: undefined })) });
    expect((await readReceiptControlEvidence(actor, "d1", d)).matchingState).toBe("unknown");
  });
  it("exact journal is required; balanced-but-wrong journals are not evidence", async () => {
    expect((await readReceiptControlEvidence(actor, "d1", deps().d)).journalExact).toBe(true);
    const bad: Array<[string, unknown[]]> = [
      ["debit to another bank", [gl(AR, 50, 0), gl(ACC, 0, 50)]],
      ["unexplained extra pair", [gl(ACC, 50, 0), gl(AR, 0, 50), gl(AR, 5, 0), gl(ACC, 0, 5)]],
      ["two credit accounts", [gl(ACC, 50, 0), gl(AR, 0, 30), gl(RID, 0, 20)]],
      ["wrong document", [gl(ACC, 50, 0, { docCode: "OR-OTHER" }), gl(AR, 0, 50)]],
      ["missing reference", [gl(ACC, 50, 0, { referenceNo: undefined }), gl(AR, 0, 50)]],
      ["credit on no account", [gl(ACC, 50, 0), { debit: 0, credit: 50 }]],
    ];
    for (const [, rows] of bad) {
      const snap = await readReceiptControlEvidence(
        actor,
        "d1",
        deps({ gl: ok(journal(50, rows)) }).d,
      );
      expect(snap.journalExact).toBe(false);
    }
  });
  it("a correction with an inexact journal cannot verify", () => {
    const original = receiptSnapshot();
    const ev = receiptSnapshot({
      amountCents: 8000,
      paymentLines: [{ ...original.paymentLines[0]!, amountCents: 8000 }],
      journalExact: false,
    });
    expect(
      verifyReceiptControlResult(
        original,
        { kind: "correction", amountCents: 8000, accountId: ACC, contact: original.contact },
        ev,
      ),
    ).toBe("insufficient");
  });
  it("changed document date or reference is a mismatch", () => {
    const original = receiptSnapshot();
    for (const o of [{ documentDate: "2026-09-30" }, { reference: "OTHER" }])
      expect(verifyReceiptControlResult(original, { kind: "void" }, receiptSnapshot(o))).toBe(
        "mismatch",
      );
  });
});

