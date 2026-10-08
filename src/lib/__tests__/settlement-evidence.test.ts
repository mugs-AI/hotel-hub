import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gates from "../settlement-contracts.server";
import { n3BillingClient } from "../n3-billing.server";
import {
  makeBillProgressEvidence,
  makeReceiptProgressEvidence,
  settlementProgressBoundTo,
  proveBill,
  proveReceiptBefore,
  proveReceiptAllocation,
  proveSettlement,
  settlementProofBoundTo,
  settlementFinalEvidenceForStore,
  type SettlementReceipt,
  type VerifiedBill,
  type VerifiedReceiptBefore,
  type VerifiedAllocation,
} from "../settlement-evidence.server";
import type { EvidenceResult } from "../settlement";
import type { SettlementActor } from "../settlement-context.server";
import { settlementFixture } from "./fixtures/settlement";
const actor: SettlementActor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  n3UserKey: "synthetic-owner",
  n3Token: "synthetic-token",
  role: "owner",
};
const billId = "22222222-2222-4222-8222-222222222222",
  intentId = "44444444-4444-4444-8444-444444444444",
  arId = "55555555-5555-4555-8555-555555555555",
  salesId = "66666666-6666-4666-8666-666666666666";
const ref = "HH-B-" + intentId.replace(/-/g, "");
function snapshot() {
  const s = settlementFixture();
  s.lines[0].mappingEvidence = {
    arAccountId: arId,
    arAccountCode: "SYNTHETIC-AR",
    salesAccountId: salesId,
    salesAccountCode: "SYNTHETIC-SALES",
  };
  return s;
}
const receipt = settlementFixture().receipts[0];
const envelope = (data: unknown) => ({ code: "0000", data });
const active = { isCancelled: false, cancelledDate: null };
function bill(outstanding = 500) {
  return {
    ...active,
    id: billId,
    docType: "CS",
    docCode: "CS-SYNTHETIC",
    docDate: "2026-10-08",
    referenceNo: ref,
    customerId: 7,
    customer: { id: 7 },
    currencyId: 1,
    currencyCode: "MYR",
    currencyRate: 1,
    isPostToAR: true,
    customerName: "Synthetic guest",
    customerPhone: "",
    email: "",
    address1: "",
    address2: "",
    totalAmount: 500,
    netTotalAmount: 500,
    subtotalAmount: 500,
    taxTotalAmount: 0,
    outstandingAmount: outstanding,
    roundingAdjustment: 0,
    itemDetails: [
      {
        pos: 1,
        stockId: 101,
        uomId: 1,
        taxCodeId: 8,
        qty: 1,
        unitPrice: 500,
        amount: 500,
        taxAmount: 0,
        netAmount: 500,
        description: "Room charge",
      },
    ],
  };
}
function journalRow(
  accountId: string,
  code: string,
  debit: number,
  credit: number,
  docCode: string,
  referenceNo: string,
  docDate: string,
) {
  return {
    ...active,
    accountId,
    account: { id: accountId, code },
    debit,
    credit,
    docCode,
    referenceNo,
    docDate,
    currencyId: 1,
    currencyRate: 1,
    customerId: 7,
  };
}
function billGL() {
  return [
    journalRow(arId, "SYNTHETIC-AR", 500, 0, "CS-SYNTHETIC", ref, "2026-10-08"),
    journalRow(salesId, "SYNTHETIC-SALES", 0, 500, "CS-SYNTHETIC", ref, "2026-10-08"),
  ];
}
function row(r: SettlementReceipt, amount: number, docId = billId) {
  return {
    customerId: 7,
    receiptDocType: "OR",
    receiptDocId: r.receiptId,
    docType: "INV",
    docId,
    paymentAmount: amount,
    currencyCode: "MYR",
    currencyRate: 1,
  };
}
function receiptDetail(
  r: SettlementReceipt = receipt,
  allocations: unknown[] = [],
  remainder = r.amountCents / 100,
) {
  return {
    ...active,
    id: r.receiptId,
    docCode: "OR-SYNTHETIC-" + r.receiptId.slice(0, 8),
    docType: "AROR",
    docDate: r.receiptDate,
    referenceNo: r.reference,
    customerId: 7,
    customerCode: "SYNTHETIC-AR",
    currencyId: 1,
    currencyCode: "MYR",
    currencyRate: 1,
    totalAmount: r.amountCents / 100,
    netTotalAmount: r.amountCents / 100,
    accountId: r.payments[0].accountId,
    accountCode: r.payments[0].accountCode,
    isMultiPayment: false,
    customerName: "Synthetic guest",
    remark1: "",
    remark2: "",
    remark3: "",
    remark4: "",
    knockoff: allocations,
    refundAmount: 0,
    outstandingAmount: remainder,
  };
}
function receiptGL(r: SettlementReceipt = receipt) {
  const code = receiptDetail(r).docCode;
  return [
    journalRow(
      r.payments[0].accountId,
      r.payments[0].accountCode,
      r.amountCents / 100,
      0,
      code,
      r.reference,
      r.receiptDate,
    ),
    journalRow(arId, "SYNTHETIC-AR", 0, r.amountCents / 100, code, r.reference, r.receiptDate),
  ];
}
async function reads(detail: unknown, gl: unknown, id = billId, isReceipt = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input) =>
        new Response(JSON.stringify(envelope(String(input).includes("GLPosting") ? gl : detail)), {
          status: 200,
        }),
    ),
  );
  return isReceipt
    ? {
        detail: await n3BillingClient.readReceipt(actor, id),
        journal: await n3BillingClient.readReceiptJournal(actor, id),
      }
    : {
        detail: await n3BillingClient.readBill(actor, id),
        journal: await n3BillingClient.readBillJournal(actor, id),
      };
}
function confirmed<T>(r: EvidenceResult<T>): T {
  expect(r.kind).toBe("confirmed");
  if (r.kind !== "confirmed") throw new Error(r.code);
  return r.value;
}
async function verifiedBill(outstanding = 500): Promise<VerifiedBill> {
  const r = await reads(bill(outstanding), billGL());
  return confirmed(proveBill(snapshot(), r.detail, r.journal, actor, { intentId, billId }));
}
async function before(
  r: SettlementReceipt = receipt,
  allocations: unknown[] = [],
  remainder = r.amountCents / 100,
): Promise<VerifiedReceiptBefore> {
  const out = await reads(
    receiptDetail(r, allocations, remainder),
    receiptGL(r),
    r.receiptId,
    true,
  );
  return confirmed(proveReceiptBefore(snapshot(), r, out.detail, out.journal, actor));
}
async function allocated(
  r: SettlementReceipt,
  expected: number,
  b: VerifiedBill,
  prev?: VerifiedReceiptBefore,
): Promise<VerifiedAllocation> {
  const prior = prev ?? (await before(r));
  const out = await reads(
    receiptDetail(
      r,
      [...prior.allocations.map((a) => a.source), row(r, expected / 100)],
      (r.amountCents -
        expected -
        prior.refundCents -
        prior.allocations.reduce((s, a) => s + a.amountCents, 0)) /
        100,
    ),
    receiptGL(r),
    r.receiptId,
    true,
  );
  return confirmed(
    proveReceiptAllocation({
      snapshot: snapshot(),
      bill: b,
      receipt: r,
      before: prior,
      ...out,
      actor,
      expectedTotalToBillCents: expected,
    }),
  );
}
beforeEach(() =>
  vi.spyOn(gates, "billingContractGate").mockImplementation((operation) => ({
    kind: "confirmed",
    value: {
      operation,
      evidenceHash: "a".repeat(64),
      concurrencyProofHash: "b".repeat(64),
      allocationMode: "preserve_existing",
      billTarget: "same_id_INV",
    },
  })),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("exact scoped settlement evidence", () => {
  function observedTaxBill() {
    const s = snapshot();
    s.totalCents = s.lines[0].totalCents = 32403;
    s.lines[0].unitCents = s.lines[0].subtotalCents = 30003;
    s.lines[0].taxCents = 2400;
    Object.assign(s.lines[0].mappingEvidence, {
      taxAccountId: "99999999-9999-4999-8999-999999999999",
      taxAccountCode: "SYNTHETIC-TAX",
    });
    const d = {
      ...bill(324.03),
      subtotalAmount: 300.03,
      totalAmount: 300.03,
      totalAmountLocal: 300.03,
      taxTotalAmount: 24,
      netTotalAmount: 324.03,
      netTotalAmountLocal: 324.03,
    };
    Object.assign(d.itemDetails[0], {
      unitPrice: 300.03,
      amount: 300.03,
      taxAmount: 24,
      netAmount: 324.03,
    });
    const gl = [
      journalRow(arId, "SYNTHETIC-AR", 324.03, 0, d.docCode, ref, s.billDate),
      journalRow(salesId, "SYNTHETIC-SALES", 0, 300.03, d.docCode, ref, s.billDate),
      journalRow(
        "99999999-9999-4999-8999-999999999999",
        "SYNTHETIC-TAX",
        0,
        24,
        d.docCode,
        ref,
        s.billDate,
      ),
    ];
    return { s, d, gl };
  }
  it("proves N3's distinct pre-tax and net bill totals without conflating them", async () => {
    const { s, d, gl } = observedTaxBill();
    const r = await reads(d, gl);
    expect(proveBill(s, r.detail, r.journal, actor, { intentId, billId })).toMatchObject({
      kind: "confirmed",
      value: { totalCents: 32403, outstandingCents: 32403 },
    });
  });
  it.each([
    { totalAmount: 324.03 },
    { totalAmountLocal: 324.03 },
    { netTotalAmount: 300.03 },
    { netTotalAmountLocal: 300.03 },
    { taxTotalAmount: 23.99 },
  ])("rejects a contradictory taxable bill amount %j", async (override) => {
    const { s, d, gl } = observedTaxBill();
    const r = await reads({ ...d, ...override }, gl);
    expect(proveBill(s, r.detail, r.journal, actor, { intentId, billId }).kind).toBe(
      "contradiction",
    );
  });
  it("requires the payable net bill total even when pre-tax and tax amounts are present", async () => {
    const { s, d, gl } = observedTaxBill();
    const { netTotalAmount: _net, ...missingNet } = d;
    const r = await reads(missingNet, gl);
    expect(proveBill(s, r.detail, r.journal, actor, { intentId, billId }).kind).toBe("unavailable");
  });
  it("contradictory local-currency bill totals cannot hide behind matching document totals", async () => {
    const r = await reads({ ...bill(), totalAmountLocal: 499 }, billGL());
    expect(proveBill(snapshot(), r.detail, r.journal, actor, { intentId, billId }).kind).toBe(
      "contradiction",
    );
  });
  it("contradictory local receipt remainder cannot prove conservation", async () => {
    const r = await reads(
      { ...receiptDetail(), outstandingAmountLocal: 49 },
      receiptGL(),
      receipt.receiptId,
      true,
    );
    expect(proveReceiptBefore(snapshot(), receipt, r.detail, r.journal, actor).kind).toBe(
      "contradiction",
    );
  });
  it("matching cannot silently change the receipt contact or other immutable header facts", async () => {
    const b = await verifiedBill(450),
      p = await before();
    const r = await reads(
      { ...receiptDetail(receipt, [row(receipt, 50)], 0), customerName: "OTHER" },
      receiptGL(),
      receipt.receiptId,
      true,
    );
    expect(
      proveReceiptAllocation({
        snapshot: snapshot(),
        bill: b,
        receipt,
        before: p,
        ...r,
        actor,
        expectedTotalToBillCents: 5000,
      }).kind,
    ).toBe("contradiction");
  });
  it("bill-to contact cannot silently differ from the immutable intended bill", async () => {
    const r = await reads(
      { ...bill(), customerName: "OTHER", customerPhone: "wrong-phone" },
      billGL(),
    );
    expect(proveBill(snapshot(), r.detail, r.journal, actor, { intentId, billId }).kind).toBe(
      "contradiction",
    );
  });
  it("balance creation progress requires the exact remaining bill balance", async () => {
    const r: SettlementReceipt = {
      ...receipt,
      receiptId: "77777777-7777-4777-8777-777777777777",
      reference: ref,
      amountCents: 45000,
      receiptDate: "2026-10-09",
      payments: [{ ...receipt.payments[0], amountCents: 45000 }],
      purpose: "settlement",
      intentId,
    };
    delete (r as Partial<typeof receipt>).depositId;
    const beforePayment = await verifiedBill(450),
      created = await before(r);
    const p = confirmed(makeReceiptProgressEvidence(snapshot(), beforePayment, created, actor));
    expect(p.kind).toBe("balance_receipt");
    expect(p.receipt?.documentDate).toBe("2026-10-09");
    const changedBill = await verifiedBill(500);
    expect(makeReceiptProgressEvidence(snapshot(), changedBill, created, actor).kind).toBe(
      "contradiction",
    );
  });
  it("late parsing cannot reset the original authenticated read freshness window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T00:00:00Z"));
    const r = await reads(bill(), billGL());
    vi.advanceTimersByTime(59000);
    const b = confirmed(proveBill(snapshot(), r.detail, r.journal, actor, { intentId, billId }));
    vi.advanceTimersByTime(1001);
    expect(makeBillProgressEvidence(snapshot(), b, actor).kind).toBe("unavailable");
  });
  it("progress is minted from exact verified accounting, never a copied DTO", async () => {
    const b = await verifiedBill(450);
    const progress = confirmed(makeBillProgressEvidence(snapshot(), b, actor));
    expect(progress.kind).toBe("bill");
    expect(progress.bill.outstandingCents).toBe(45000);
    expect(settlementProgressBoundTo(progress, actor, intentId)).toBe(true);
    expect(settlementProgressBoundTo(structuredClone(progress), actor, intentId)).toBe(false);
    expect(makeBillProgressEvidence(snapshot(), structuredClone(b), actor).kind).toBe(
      "unavailable",
    );
    expect(JSON.stringify(progress)).not.toContain(actor.n3Token);
    const { createSettlementStore } = await import("../settlement-store.server");
    const rpc = vi.fn(async () => ({
      data: {
        id: intentId,
        tenantId: actor.tenantId,
        reservationId: actor.reservationId,
        revision: "2",
        state: "bill_verified",
        snapshot: snapshot(),
        dispatches: [],
      },
      error: null,
    }));
    await createSettlementStore(rpc).recordProgress(actor, intentId, "1", progress);
    expect(rpc.mock.calls[0]).toMatchObject([
      "hotelhub_settlement_prove",
      { p_actor: actor.n3UserKey, p_intent_id: intentId, p_proof: progress },
    ]);
  });
  it("allocation progress preserves proof identity and no token/raw journal", async () => {
    const b = await verifiedBill(450),
      a = await allocated(receipt, 5000, b);
    const p = confirmed(makeReceiptProgressEvidence(snapshot(), b, a, actor));
    expect(p.kind).toBe("allocation");
    expect(p.receipt).toMatchObject({
      receiptId: receipt.receiptId,
      allocatedToBillCents: 5000,
      remainderCents: 0,
    });
    expect(settlementProgressBoundTo(p, actor, intentId)).toBe(true);
    expect(makeReceiptProgressEvidence(snapshot(), b, structuredClone(a), actor).kind).toBe(
      "unavailable",
    );
    expect(JSON.stringify(p)).not.toContain(actor.n3Token);
  });
  it("tax credit is exact and cannot be replaced by an equal sales credit", async () => {
    const s = snapshot();
    s.lines[0].unitCents = s.lines[0].subtotalCents = 45000;
    s.lines[0].taxCents = 5000;
    Object.assign(s.lines[0].mappingEvidence, {
      taxAccountId: "99999999-9999-4999-8999-999999999999",
      taxAccountCode: "SYNTHETIC-TAX",
    });
    const d = bill();
    d.totalAmount = 450;
    d.subtotalAmount = 450;
    d.taxTotalAmount = 50;
    Object.assign(d.itemDetails[0], { unitPrice: 450, amount: 450, taxAmount: 50 });
    const gl = billGL();
    gl[1].credit = 450;
    gl.push(
      journalRow(
        "99999999-9999-4999-8999-999999999999",
        "SYNTHETIC-TAX",
        0,
        50,
        d.docCode,
        ref,
        s.billDate,
      ),
    );
    const r = await reads(d, gl);
    expect(proveBill(s, r.detail, r.journal, actor, { intentId, billId }).kind).toBe("confirmed");
    gl[1].credit = 500;
    gl.pop();
    const changed = await reads(d, gl);
    expect(proveBill(s, changed.detail, changed.journal, actor, { intentId, billId }).kind).toBe(
      "contradiction",
    );
  });
  it.each([
    { currencyId: 2 },
    { currencyRate: 2 },
    { customerId: 8 },
    { account: { id: arId, code: "OTHER" } },
    { Debit: 501 },
    { docDate: "2026-10-09" },
    { docCode: "OTHER" },
  ])("contradictory journal %j blocks a correct detail", async (override) => {
    const gl = billGL();
    Object.assign(gl[1], override);
    const r = await reads(bill(), gl);
    expect(proveBill(snapshot(), r.detail, r.journal, actor, { intentId, billId }).kind).toBe(
      "contradiction",
    );
  });
  it("nested stock evidence cannot contradict an identical top-level line ID", async () => {
    const d = bill();
    Object.assign(d.itemDetails[0], { stock: { id: 999 } });
    const r = await reads(d, billGL());
    expect(proveBill(snapshot(), r.detail, r.journal, actor, { intentId, billId }).kind).toBe(
      "contradiction",
    );
  });
  it("stale authenticated reads cannot mint a new current proof", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T00:00:00Z"));
    const r = await reads(bill(), billGL());
    vi.advanceTimersByTime(60001);
    expect(proveBill(snapshot(), r.detail, r.journal, actor, { intentId, billId }).kind).toBe(
      "unavailable",
    );
    vi.useRealTimers();
  });
  it("contradictory nested knockoff document is refused", async () => {
    const d = receiptDetail(
      receipt,
      [{ ...row(receipt, 10), document: { id: "88888888-8888-4888-8888-888888888888" } }],
      40,
    );
    const r = await reads(d, receiptGL(), receipt.receiptId, true);
    expect(proveReceiptBefore(snapshot(), receipt, r.detail, r.journal, actor).kind).toBe(
      "contradiction",
    );
  });
  it("bill50000 equals AR debit and exact sales credit", async () => {
    const b = await verifiedBill(450);
    expect(b).toMatchObject({
      id: billId,
      targetId: billId,
      targetType: "INV",
      totalCents: 50000,
      outstandingCents: 45000,
    });
  });
  it("receipt5000 allocated5000 leaves0; balance45000 proves settled only with both bound journals", async () => {
    const b = await verifiedBill(0),
      a = await allocated(receipt, 5000, b);
    expect(a.remainderCents).toBe(0);
    const balance: SettlementReceipt = {
      ...receipt,
      receiptId: "77777777-7777-4777-8777-777777777777",
      amountCents: 45000,
      reference: ref,
      receiptDate: "2026-10-08",
      payments: [{ ...receipt.payments[0], amountCents: 45000 }],
      purpose: "settlement",
      intentId,
    };
    delete (balance as Partial<typeof receipt>).depositId;
    const a2 = await allocated(balance, 45000, b);
    const proof = confirmed(proveSettlement(snapshot(), b, [a, a2], new Date().toISOString()));
    expect(proof.billOutstandingCents).toBe(0);
    const stored = settlementFinalEvidenceForStore(proof, actor, intentId)!;
    expect(stored.bill).toEqual(b);
    expect(stored.receipts).toHaveLength(2);
    const { billingPayloadDigest } = await import("../n3-billing.server");
    const { digest, ...signed } = stored;
    expect(digest).toBe(billingPayloadDigest(signed));
    expect(settlementProofBoundTo(proof, actor, intentId)).toBe(true);
    expect(settlementProofBoundTo(structuredClone(proof), actor, intentId)).toBe(false);
    expect(settlementProofBoundTo(proof, { ...actor, n3Token: "other" }, intentId)).toBe(false);
  });
  it("success_then_contradictory_gl rejects balanced extra credits", async () => {
    const gl = billGL();
    gl.push({ ...gl[1], credit: 1 });
    gl[0].debit = 501;
    const r = await reads(bill(), gl);
    expect(proveBill(snapshot(), r.detail, r.journal, actor, { intentId, billId }).kind).toBe(
      "contradiction",
    );
  });
  it.each([
    { Id: receipt.receiptId },
    { customer: { id: 8 } },
    { currency: { id: 2, code: "MYR" } },
    { docDate: "2026-10-09" },
    { referenceNo: "HH-B-other" },
    { isCancelled: true },
    { cancelledDate: "2026-10-08" },
  ])("wrong/nested conflicting header %j fails", async (override) => {
    const r = await reads({ ...bill(), ...override }, billGL());
    expect(proveBill(snapshot(), r.detail, r.journal, actor, { intentId, billId }).kind).not.toBe(
      "confirmed",
    );
  });
  it("wrong line quantity, tax or master mapping cannot prove identical total", async () => {
    const d = bill();
    d.itemDetails[0].qty = 2;
    const r = await reads(d, billGL());
    expect(proveBill(snapshot(), r.detail, r.journal, actor, { intentId, billId }).kind).toBe(
      "contradiction",
    );
  });
  it("missing accepted CashSale-to-INV contract and missing intent cannot be guessed", async () => {
    const r = await reads(bill(), billGL());
    vi.mocked(gates.billingContractGate).mockReturnValue({
      kind: "unavailable",
      code: "n3_billing_contract_unverified",
    });
    expect(proveBill(snapshot(), r.detail, r.journal, actor, { intentId, billId }).kind).toBe(
      "unavailable",
    );
    expect(proveBill(snapshot(), r.detail, r.journal, actor).kind).toBe("unavailable");
  });
  it("copied bill/detail journal and another scope cannot mint authority", async () => {
    const r = await reads(bill(), billGL());
    expect(
      proveBill(snapshot(), structuredClone(r.detail), r.journal, actor, { intentId, billId }).kind,
    ).not.toBe("confirmed");
    expect(
      proveBill(snapshot(), r.detail, structuredClone(r.journal), actor, { intentId, billId }).kind,
    ).not.toBe("confirmed");
    expect(
      proveBill(
        snapshot(),
        r.detail,
        r.journal,
        { ...actor, tenantId: receipt.receiptId },
        { intentId, billId },
      ).kind,
    ).not.toBe("confirmed");
  });
  it("receipt_total_equals_allocations_plus_refunds_plus_remainder including prior matched rows", async () => {
    const priorId = "88888888-8888-4888-8888-888888888888";
    const d = receiptDetail(receipt, [row(receipt, 10, priorId)], 30);
    d.refundAmount = 10;
    const out = await reads(d, receiptGL(), receipt.receiptId, true);
    const p = confirmed(proveReceiptBefore(snapshot(), receipt, out.detail, out.journal, actor));
    expect(p).toMatchObject({
      amountCents: 5000,
      refundCents: 1000,
      remainderCents: 3000,
      allocations: [{ docId: priorId, amountCents: 1000 }],
    });
  });
  it("does not treat the observed refunded receipt's RF row as an ordinary invoice allocation", async () => {
    const r = {
      ...receipt,
      amountCents: 10001,
      payments: [{ ...receipt.payments[0], amountCents: 10001 }],
    };
    const s = snapshot();
    s.receipts = [r];
    const d = receiptDetail(
      r,
      [row(r, 60.01), { ...row(r, 40, "99999999-9999-4999-8999-999999999999"), docType: "RF" }],
      40,
    );
    d.refundAmount = 40;
    const out = await reads(d, receiptGL(r), r.receiptId, true);
    expect(proveReceiptBefore(s, r, out.detail, out.journal, actor)).toMatchObject({
      kind: "contradiction",
      code: "receipt_allocation_type_invalid",
    });
  });
  it("does not infer spendable money by dropping the RF row but retaining its outstanding field", async () => {
    const r = {
      ...receipt,
      amountCents: 10001,
      payments: [{ ...receipt.payments[0], amountCents: 10001 }],
    };
    const s = snapshot();
    s.receipts = [r];
    const d = receiptDetail(r, [row(r, 60.01)], 40);
    d.refundAmount = 40;
    const out = await reads(d, receiptGL(r), r.receiptId, true);
    expect(proveReceiptBefore(s, r, out.detail, out.journal, actor)).toMatchObject({
      kind: "contradiction",
      code: "receipt_conservation_mismatch",
    });
  });
  it.each([
    { refundAmount: undefined },
    { outstandingAmount: 49 },
    { account: { id: billId } },
    { currencyCode: "USD" },
    { customerId: 8 },
    { knockoff: [row(receipt, 51)] },
    { isCancelled: true, cancelledDate: "2026-10-08" },
  ])("receipt unsafe evidence %j cannot prove", async (override) => {
    const r = await reads(
      { ...receiptDetail(), ...override },
      receiptGL(),
      receipt.receiptId,
      true,
    );
    expect(proveReceiptBefore(snapshot(), receipt, r.detail, r.journal, actor).kind).not.toBe(
      "confirmed",
    );
  });
  it("same-customer receipt from a foreign reservation cannot enter settlement", async () => {
    const r = await reads(receiptDetail(), receiptGL(), receipt.receiptId, true);
    expect(
      proveReceiptBefore(
        snapshot(),
        { ...receipt, reservationId: billId },
        r.detail,
        r.journal,
        actor,
      ).kind,
    ).toBe("contradiction");
  });
  it("changed unrelated allocation or refund after matching blocks proof", async () => {
    const b = await verifiedBill(460),
      p = await before(receipt, [row(receipt, 10, "88888888-8888-4888-8888-888888888888")], 40);
    const d = receiptDetail(
      receipt,
      [row(receipt, 9, "88888888-8888-4888-8888-888888888888"), row(receipt, 40)],
      1,
    );
    const r = await reads(d, receiptGL(), receipt.receiptId, true);
    expect(
      proveReceiptAllocation({
        snapshot: snapshot(),
        bill: b,
        receipt,
        before: p,
        ...r,
        actor,
        expectedTotalToBillCents: 4000,
      }).kind,
    ).toBe("contradiction");
  });
  it("cross-device allocation recovery trusts only service-read immutable dispatch facts", async () => {
    const { createSettlementStore } = await import("../settlement-store.server");
    const { recoverAllocationEvidence } = await import("../settlement-recovery.server");
    const b = await verifiedBill(450),
      prior = await before();
    const payload = [
      {
        customerId: 7,
        receiptDocType: "OR",
        receiptDocId: receipt.receiptId,
        docType: "INV",
        docId: billId,
        paymentAmount: 50,
      },
    ];
    const { billingPayloadDigest } = await import("../n3-billing.server");
    const d = {
      claim: {
        attemptId: "99999999-9999-4999-8999-999999999999",
        intentId,
        kind: "deposit_allocation",
        receiptId: receipt.receiptId,
        expectedRevision: "1",
        payloadDigest: billingPayloadDigest(payload),
      },
      outcome: { kind: "unknown", code: "timeout" },
      facts: {
        kind: "deposit_allocation",
        snapshotDigest: snapshot().digest,
        payload,
        billId,
        receipt,
        before: structuredClone(prior),
        expectedTotalToBillCents: 5000,
        expectedAfterFingerprint: billingPayloadDigest({
          receiptId: receipt.receiptId,
          amountCents: 5000,
          refundCents: 0,
          remainderCents: 0,
          allocations: [{ docType: "INV", docId: billId, amountCents: 5000 }],
        }),
      },
    };
    const store = createSettlementStore(async () => ({
      data: {
        id: intentId,
        ...actor,
        snapshot: snapshot(),
        revision: "2",
        state: "needs_review",
        dispatches: [d],
      },
      error: null,
    }));
    const saved = (await store.read(actor))!;
    const r = await reads(
      receiptDetail(receipt, [row(receipt, 50)], 0),
      receiptGL(),
      receipt.receiptId,
      true,
    );
    expect(
      recoverAllocationEvidence(snapshot(), b, saved.dispatches[0], r.detail, r.journal, actor)
        .kind,
    ).toBe("confirmed");
    expect(
      recoverAllocationEvidence(
        snapshot(),
        b,
        structuredClone(saved.dispatches[0]),
        r.detail,
        r.journal,
        actor,
      ).kind,
    ).not.toBe("confirmed");
  });
  it("unexpected amount, forged prior state and empty match never prove allocation", async () => {
    const b = await verifiedBill(450),
      p = await before();
    const r = await reads(receiptDetail(), receiptGL(), receipt.receiptId, true);
    expect(
      proveReceiptAllocation({
        snapshot: snapshot(),
        bill: b,
        receipt,
        before: p,
        ...r,
        actor,
        expectedTotalToBillCents: 5000,
      }).kind,
    ).toBe("contradiction");
    expect(
      proveReceiptAllocation({
        snapshot: snapshot(),
        bill: b,
        receipt,
        before: structuredClone(p),
        ...r,
        actor,
        expectedTotalToBillCents: 5000,
      }).kind,
    ).not.toBe("confirmed");
  });
  it("zero outstanding alone or a copied VerifiedBill never closes", async () => {
    const b = await verifiedBill(0);
    expect(proveSettlement(snapshot(), b, [], "2026-10-08T00:00:00Z").kind).not.toBe("confirmed");
    expect(
      proveSettlement(snapshot(), structuredClone(b), [], "2026-10-08T00:00:00Z").kind,
    ).not.toBe("confirmed");
  });
  it("unapplied excess, missing linked receipt, duplicate receipt and invalid time cannot settle", async () => {
    const b = await verifiedBill(0),
      a = await allocated(receipt, 3000, b);
    expect(proveSettlement(snapshot(), b, [a], "2026-10-08T00:00:00Z").kind).not.toBe("confirmed");
    expect(proveSettlement(snapshot(), b, [a, a], "2026-10-08T00:00:00Z").kind).not.toBe(
      "confirmed",
    );
    expect(proveSettlement(snapshot(), b, [a], "not-a-time").kind).not.toBe("confirmed");
  });
});

it.each([
  { customer: { id: 8 } },
  { docId: "99999999-9999-4999-8999-999999999999" },
  { document: { id: "99999999-9999-4999-8999-999999999999", docCode: "ALIEN" } },
])("contradictory nested GL identity %j is refused", async (override) => {
  const rows = billGL().map((r) => ({ ...r, ...override }));
  const r = await reads(bill(), rows);
  expect(proveBill(snapshot(), r.detail, r.journal, actor, { intentId, billId }).kind).toBe(
    "contradiction",
  );
});
