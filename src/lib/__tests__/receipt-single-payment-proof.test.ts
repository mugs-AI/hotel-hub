import { afterEach, describe, expect, it, vi } from "vitest";
import rawFixture from "./fixtures/receipt-single-payment-shape.json";
import { productionUpdateContract, updateN3Receipt } from "../n3-receipt-update.server";
import { readReceiptControlEvidence } from "../receipt-controls-evidence.server";
import { n3Receipts } from "../n3-receipts.server";
import {
  checkReceiptUpdateProof,
  prepareReceiptUpdateProof,
  runReceiptUpdateProof,
  proofPackageHash,
  type ProofPackage,
  type ProofPermit,
  type ProofDeps,
} from "../receipt-update-proof.server";

// Real coordinator, payload builder and fixed N3 HTTP client; a synthetic HTTP
// server replaces the external service. This is never live acceptance evidence.
const actor = {
  tenantId: "offline-tenant",
  n3TenantKey: "offline-test",
  n3UserKey: "owner",
  n3Token: "offline-token",
  role: "owner" as const,
};
function fixture(corrupt: "none" | "detail-amount" | "detail-id") {
  let remote = structuredClone(rawFixture),
    posts = 0;
  let permit: ProofPermit | null = null;
  const pkg: ProofPackage = {
    caseId: "offline-increase",
    tenantKey: actor.n3TenantKey,
    companyName: "Offline test",
    receiptId: remote.id,
    docCode: remote.docCode,
    documentDate: remote.docDate,
    reference: null,
    customerId: "12345",
    customerCode: remote.customerCode,
    accountId: remote.accountId,
    accountCode: remote.accountCode,
    beforeCents: 5000,
    afterCents: 6500,
    expiresAt: Date.now() + 60000,
    budgetMs: 10000,
    sourceRef: "a".repeat(40),
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    if (init.method === "POST") {
      expect(parsed.pathname).toBe("/api/ARReceipts/Update");
      expect(parsed.searchParams.get("confirmedForBankRecon")).toBe("false");
      expect(parsed.searchParams.get("confirmedForKnockOff")).toBe("false");
      posts++;
      remote = JSON.parse(init.body as string) as typeof remote;
      if (corrupt === "detail-amount") remote.details[0]!.amount = 50;
      if (corrupt === "detail-id") remote.details[0]!.id = "66666666-6666-4666-8666-666666666666";
      return Response.json({ success: true, code: "0000", data: { id: remote.id } });
    }
    expect(init.method).toBe("GET");
    expect(
      parsed.pathname === `/api/ARReceipts/${pkg.receiptId}` ||
        parsed.pathname === "/api/ARReceipts/GLPosting",
    ).toBe(true);
    const amount = remote.totalAmount;
    const data = parsed.pathname.endsWith("GLPosting")
      ? [
          {
            docCode: null,
            referenceNo: null,
            debit: amount,
            credit: 0,
            accountId: remote.accountId,
            account: remote.account,
          },
          {
            docCode: null,
            referenceNo: null,
            debit: 0,
            credit: amount,
            accountId: null,
            account: null,
            customerId: remote.customerId,
            customer: remote.customer,
          },
        ]
      : remote;
    return Response.json({ success: true, code: "0000", data });
  });
  const deps: ProofDeps = {
    enabled: true,
    packages: [pkg],
    contract: productionUpdateContract(),
    now: Date.now,
    freshOwner: async () => {},
    isHotelReceipt: async () => false,
    async read(a, p, limit) {
      const snapshot = await readReceiptControlEvidence(a, "offline-deposit", {
        allowNullReferenceForProof: true,
        loadDeposit: async () => ({
          id: "offline-deposit",
          reservationId: "offline-reservation",
          status: "posted",
          n3ReceiptId: p.receiptId,
          n3DocCode: p.docCode,
          n3CustomerId: p.customerId,
          n3CustomerCode: p.customerCode,
          n3ReferenceNo: null,
          currencyCode: "MYR",
          paymentLines: [
            { id: p.accountId, code: p.accountCode, name: "Offline bank", amount: 50 },
          ],
        }),
        n3: {
          getById: (token, id) => n3Receipts.getById(token, id, limit),
          getGLPosting: (token, id) => n3Receipts.getGLPosting(token, id, limit),
        },
      });
      return { snapshot, raw: structuredClone(remote) };
    },
    send: updateN3Receipt,
    db: {
      create: async (row) =>
        (permit = {
          ...row,
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          phase: "prepared",
          report: null,
        }),
      get: async () => permit,
      claim: async () => {
        if (permit?.phase !== "prepared") return false;
        permit = { ...permit, phase: "reserved" };
        return true;
      },
      finish: async (_a, _id, phase, report) => {
        permit = { ...permit!, phase, report };
      },
    },
  };
  return { deps, pkg, posts: () => posts, remote: () => remote };
}
afterEach(() => vi.unstubAllGlobals());
describe("single-payment proof through the fixed N3 client", () => {
  it.each(["none", "detail-amount", "detail-id"] as const)(
    "updates the same receipt once and verifies or holds %s",
    async (corrupt) => {
      const f = fixture(corrupt);
      const prepared = await prepareReceiptUpdateProof(
        actor,
        {
          caseId: f.pkg.caseId,
          receiptId: f.pkg.receiptId,
          approvedPackageHash: proofPackageHash(f.pkg),
        },
        f.deps,
      );
      const expected = corrupt === "none" ? "verified" : "needs_review";
      expect((await runReceiptUpdateProof(actor, prepared.permitId, f.deps)).outcome).toBe(
        expected,
      );
      expect((await checkReceiptUpdateProof(actor, prepared.permitId, f.deps)).outcome).toBe(
        expected,
      );
      expect((await runReceiptUpdateProof(actor, prepared.permitId, f.deps)).outcome).toBe(
        expected,
      );
      expect(f.posts()).toBe(1);
      expect(f.remote()).toMatchObject({
        id: rawFixture.id,
        docCode: rawFixture.docCode,
        customerId: 12345,
        totalAmount: 65,
        isMultiPayment: false,
        multiPayments: [],
      });
      if (corrupt === "none")
        expect(f.remote().details[0]).toMatchObject({
          id: rawFixture.details[0]!.id,
          amount: 65,
          netAmount: 65,
          amountLocal: 65,
        });
    },
  );
});
