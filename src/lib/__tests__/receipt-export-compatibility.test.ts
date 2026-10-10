import { afterEach, describe, expect, it, vi } from "vitest";
import rawFixture from "./fixtures/receipt-single-payment-shape.json";
import { receiptSnapshot } from "./fixtures/receipt-controls";
import { buildReceiptUpdatePayload, productionUpdateContract } from "../n3-receipt-update.server";
import {
  readReceiptControlEvidence,
  verifyReceiptControlResult,
  type ScopedDeposit,
} from "../receipt-controls-evidence.server";
import { n3Receipts } from "../n3-receipts.server";
import {
  prepareReceiptUpdateProof,
  proofPackageHash,
  type ProofDeps,
  type ProofPackage,
} from "../receipt-update-proof.server";

// Offline DTO shape from Owner export. All identities/contact are synthetic.
// No fixture is ever a live payload; HTTP is stubbed at the real fixed client.
const raw = () => structuredClone(rawFixture);
const original = () =>
  receiptSnapshot({
    docCode: rawFixture.docCode,
    documentDate: rawFixture.docDate,
    customerId: "12345",
    reference: null,
    contact: {
      customerName: rawFixture.customerName,
      remark1: "",
      remark2: "",
      remark3: "",
      remark4: "",
    },
  });
const proposal = () => ({
  kind: "correction" as const,
  amountCents: 6500,
  accountId: rawFixture.accountId,
  contact: original().contact,
});
const proofContract = () => ({ ...productionUpdateContract(), allowNullReferenceForProof: true });
const actor = {
  tenantId: "fixture-local",
  n3TenantKey: "fixture-test",
  n3UserKey: "owner",
  n3Token: "fixture-token",
  role: "owner" as const,
};
const pkg = (): ProofPackage => ({
  caseId: "single-increase",
  tenantKey: actor.n3TenantKey,
  companyName: "Fixture test company",
  receiptId: rawFixture.id,
  docCode: rawFixture.docCode,
  documentDate: rawFixture.docDate,
  reference: null,
  customerId: "12345",
  customerCode: rawFixture.customerCode,
  accountId: rawFixture.accountId,
  accountCode: rawFixture.accountCode,
  beforeCents: 5000,
  afterCents: 6500,
  expiresAt: 20000,
  budgetMs: 100,
  sourceRef: "a".repeat(40),
});
const deposit = (): ScopedDeposit => ({
  id: "d",
  reservationId: "r",
  status: "posted",
  n3ReceiptId: rawFixture.id,
  n3DocCode: rawFixture.docCode,
  n3CustomerId: "12345",
  n3CustomerCode: rawFixture.customerCode,
  n3ReferenceNo: null,
  currencyCode: "MYR",
  paymentLines: [
    { id: rawFixture.accountId, code: rawFixture.accountCode, name: "Fixture bank", amount: 50 },
  ],
});
const journal = () => [
  {
    id: 0,
    docCode: null,
    referenceNo: null,
    debit: 50,
    credit: 0,
    accountId: rawFixture.accountId,
    accountCode: null,
    account: { id: rawFixture.accountId, code: rawFixture.accountCode },
    customerId: null,
    customer: null,
  },
  {
    id: 0,
    docCode: null,
    referenceNo: null,
    debit: 0,
    credit: 50,
    accountId: null,
    account: null,
    accountCode: null,
    customerId: 12345,
    customer: { id: 12345, code: rawFixture.customerCode },
    fromAccount: { id: rawFixture.accountId, code: rawFixture.accountCode },
  },
];
function evidence(
  rows: unknown[] = journal(),
  proof = true,
  after: Record<string, unknown> = {},
  stable: Record<string, unknown> = {},
) {
  let reads = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect(init.method).toBe("GET");
    const path = new URL(url).pathname;
    const data = path.endsWith("GLPosting")
      ? rows
      : { ...raw(), ...stable, ...(reads++ ? after : {}) };
    return Response.json({ success: true, code: "0000", data });
  });
  return readReceiptControlEvidence(actor, "d", {
    loadDeposit: async () => deposit(),
    n3: n3Receipts,
    allowNullReferenceForProof: proof,
  });
}
afterEach(() => vi.unstubAllGlobals());
describe("exported single-payment receipt compatibility", () => {
  it("preserves same document/customer/detail IDs and updates every untaxed detail amount", () => {
    const input = raw();
    const result = buildReceiptUpdatePayload(input, original(), proposal(), proofContract());
    expect(result.body).toMatchObject({
      id: input.id,
      customerId: 12345,
      referenceNo: null,
      isMultiPayment: false,
      multiPayments: [],
      totalAmount: 65,
      netTotalAmount: 65,
      subtotalAmount: 65,
      totalAmountLocal: 65,
      outstandingAmount: 65,
      details: [
        {
          id: input.details[0]!.id,
          receiptId: input.id,
          customerId: 12345,
          amount: 65,
          amountLocal: 65,
          subAmount: 65,
          subAmountLocal: 65,
          netAmount: 65,
          netAmountLocal: 65,
          taxExclusiveAmount: 65,
          taxExclusiveAmountLocal: 65,
          description: input.details[0]!.description,
        },
      ],
    });
    expect(input).toEqual(rawFixture);
  });
  it("retains production reference protection", () => {
    expect(() =>
      buildReceiptUpdatePayload(raw(), original(), proposal(), productionUpdateContract()),
    ).toThrow();
  });
  it.each([
    { amountLocal: 49 },
    { customerId: 54321 },
    { receiptId: "alien" },
    { taxAmount: 1 },
    { serviceAmount: 1 },
    { amount: null },
    { unknownFinancialAmount: 50 },
  ])("holds ambiguous or unsupported detail %j", (patch) => {
    const input = raw();
    Object.assign(input.details[0]!, patch);
    expect(() =>
      buildReceiptUpdatePayload(input, original(), proposal(), proofContract()),
    ).toThrow();
  });
  it("holds multiple details instead of guessing how to split the correction", () => {
    const input = raw();
    input.details.push(structuredClone(input.details[0]!));
    expect(() =>
      buildReceiptUpdatePayload(input, original(), proposal(), proofContract()),
    ).toThrow();
  });
  it("prepares a numeric-customer null-reference case only from an approved server package", async () => {
    const p = pkg();
    const deps: ProofDeps = {
      enabled: true,
      packages: [p],
      contract: productionUpdateContract(),
      now: () => 1000,
      freshOwner: async () => {},
      isHotelReceipt: async () => false,
      read: async () => ({ snapshot: original(), raw: raw() }),
      send: async () => {
        throw Error("Prepare must never write");
      },
      db: {
        create: async (row) => ({
          ...row,
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          phase: "prepared",
          report: null,
        }),
        get: async () => null,
        claim: async () => false,
        finish: async () => {},
      },
    };
    const result = await prepareReceiptUpdateProof(
      actor,
      { caseId: p.caseId, receiptId: p.receiptId, approvedPackageHash: proofPackageHash(p) },
      deps,
    );
    expect(result.summary).toMatchObject({
      receiptId: p.receiptId,
      beforeCents: 5000,
      afterCents: 6500,
    });
  });
  it("binds customer-object credit by exact numeric identity and code after a real keyed transport read", async () => {
    const result = await evidence();
    expect(result).toMatchObject({
      customerId: "12345",
      reference: null,
      journalExact: true,
      amountCents: 5000,
    });
  });
  it("does not accept an unreferenced ordinary booking read", async () => {
    await expect(evidence(journal(), false)).rejects.toThrow();
  });
  it.each([
    { customerId: 54321 },
    { customer: { id: 54321, code: rawFixture.customerCode } },
    { customer: { id: 12345, code: "OTHER" } },
    { accountCode: "[redacted_text]" },
    { referenceNo: "[redacted_text]" },
    { referenceNo: undefined },
    { docCode: "OTHER" },
  ])("does not promote wrong or redacted journal identity to proof %j", async (patch) => {
    const rows = journal();
    Object.assign(rows[1]!, patch);
    const result = await evidence(rows);
    expect(result.journalExact).toBe(false);
  });
  it("rejects outside detail changes during the bracketed GL read", async () => {
    await expect(
      evidence(journal(), true, { updatedAt: rawFixture.updatedAt + 1 }),
    ).rejects.toThrow("n3_evidence_mismatch");
  });
  it.each([
    { amount: 49 },
    { amountLocal: 49 },
    { customerId: 54321 },
    { receiptId: "alien" },
    { id: null },
  ])(
    "does not verify stable header and GL amounts over an inconsistent detail %j",
    async (patch) => {
      const input = raw();
      Object.assign(input.details[0]!, patch);
      await expect(evidence(journal(), true, {}, { details: input.details })).rejects.toThrow(
        "n3_evidence_mismatch",
      );
    },
  );
  it("rejects a malformed explicit journal customer identity", async () => {
    const rows = journal();
    Object.assign(rows[1]!, {
      customerId: "x",
      customer: { id: "x", code: rawFixture.customerCode },
    });
    expect((await evidence(rows)).journalExact).toBe(false);
  });
  it.each([false, true])(
    "rejects mixed customers aggregated to the same AR account, reversed=%s",
    async (reverse) => {
      const rows = journal();
      const ar = {
        ...rows[1]!,
        accountId: "55555555-5555-4555-8555-555555555555",
        account: { id: "55555555-5555-4555-8555-555555555555", code: rawFixture.customerCode },
        credit: 25,
      };
      const other = {
        ...ar,
        customerId: 54321,
        customer: { id: 54321, code: rawFixture.customerCode },
      };
      expect(
        (await evidence([rows[0]!, ...(reverse ? [ar, other] : [other, ar])])).journalExact,
      ).toBe(false);
    },
  );
  it("does not verify a replacement detail ID on the same receipt", async () => {
    const before = await evidence();
    const input = raw();
    input.details[0]!.id = "66666666-6666-4666-8666-666666666666";
    const after = await evidence(journal(), true, {}, { details: input.details });
    expect(verifyReceiptControlResult(before, { ...proposal(), amountCents: 5000 }, after)).toBe(
      "mismatch",
    );
  });
  it.each([
    "netTotalAmount",
    "totalAmountLocal",
    "outstandingAmountLocal",
    "subtotalAmount",
    "taxExclusiveTotalAmount",
  ])("holds an inconsistent sibling header amount %s", async (key) => {
    await expect(evidence(journal(), true, {}, { [key]: 49 })).rejects.toThrow(
      "n3_evidence_mismatch",
    );
  });
  it.each([
    { customer: { id: 54321, code: rawFixture.customerCode } },
    { customer: { id: 12345, code: "OTHER" } },
    { customer: "invalid" },
  ])("holds conflicting header customer lookup %j", (patch) => {
    expect(() =>
      buildReceiptUpdatePayload({ ...raw(), ...patch }, original(), proposal(), proofContract()),
    ).toThrow();
  });
  it.each([
    { customer: { id: 12345, code: "OTHER" } },
    { id: "00000000-0000-0000-0000-000000000000" },
  ])("holds conflicting or sentinel detail identity %j", (patch) => {
    const input = raw();
    Object.assign(input.details[0]!, patch);
    expect(() =>
      buildReceiptUpdatePayload(input, original(), proposal(), proofContract()),
    ).toThrow();
  });
});
