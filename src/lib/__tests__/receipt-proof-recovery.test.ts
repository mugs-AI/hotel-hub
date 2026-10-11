import { describe, expect, it } from "vitest";
import {
  receiptHeldProofs,
  readReceiptUpdateProofPermit,
  proofPackageHash,
  type ProofDeps,
  type ProofPermit,
} from "../receipt-update-proof.server";
import { RECEIPT_50, UPDATE_CONTRACT_TEST_ONLY } from "./fixtures/receipt-automation";
const actor = {
  tenantId: "tenant",
  n3TenantKey: "n3-tenant",
  n3UserKey: "owner",
  n3Token: "SECRET",
  role: "owner" as const,
};
const pkg = {
  caseId: "expired",
  tenantKey: actor.n3TenantKey,
  companyName: "Test company",
  receiptId: RECEIPT_50.receiptId,
  docCode: "OR2610/002",
  documentDate: RECEIPT_50.documentDate,
  reference: RECEIPT_50.reference!,
  customerId: RECEIPT_50.customerId,
  customerCode: "CUSTOMER",
  accountId: RECEIPT_50.paymentLines[0]!.accountId,
  accountCode: "BANK",
  beforeCents: 5000,
  afterCents: 6500,
  expiresAt: 1,
  budgetMs: 100,
  sourceRef: "a".repeat(40),
};
const held: ProofPermit = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  tenantId: actor.tenantId,
  ownerKey: actor.n3UserKey,
  package: pkg,
  packageHash: proofPackageHash(pkg),
  payloadHash: "PRIVATE_HASH",
  original: RECEIPT_50,
  expiresAt: 1,
  phase: "unknown",
  report: null,
};
function fixture(rows: ProofPermit[] = [held]) {
  let listings = 0;
  const forbidden = async (): Promise<never> => {
    throw Error("Recovery attempted a mutation or N3 request");
  };
  const deps: ProofDeps = {
    enabled: false,
    packages: [],
    now: () => 10000,
    contract: UPDATE_CONTRACT_TEST_ONLY,
    freshOwner: async () => {},
    isHotelReceipt: forbidden,
    read: forbidden,
    send: forbidden,
    db: {
      listHeld: async () => {
        listings++;
        return rows;
      },
      get: async (_a, id) => rows.find((r) => r.id === id) ?? null,
      create: forbidden,
      claim: forbidden,
      finish: forbidden,
    },
  };
  return { deps, listings: () => listings };
}
describe("read-only held receipt recovery", () => {
  it("discovers and restores an expired held permit without an enabled case or browser reference", async () => {
    const f = fixture();
    expect(await receiptHeldProofs(actor, f.deps)).toEqual([
      {
        permitId: held.id,
        phase: "unknown",
        summary: expect.objectContaining({ docCode: "OR2610/002", expiresAt: 1 }),
      },
    ]);
    expect(await readReceiptUpdateProofPermit(actor, held.id, f.deps)).toMatchObject({
      permitId: held.id,
      phase: "unknown",
      safeReport: null,
    });
    const safe = JSON.stringify(await receiptHeldProofs(actor, f.deps));
    for (const secret of ["SECRET", "PRIVATE_HASH", "ownerKey", "original", "n3Token", "tenantId"])
      expect(safe).not.toContain(secret);
  });
  it("lists only held records for the current Owner and both tenant identities", async () => {
    const f = fixture([
      held,
      { ...held, phase: "reserved" },
      { ...held, phase: "prepared" },
      { ...held, phase: "verified" },
      { ...held, ownerKey: "other" },
      { ...held, tenantId: "other" },
      { ...held, package: { ...pkg, tenantKey: "other" } },
      { ...held, packageHash: "tampered" },
    ]);
    expect((await receiptHeldProofs(actor, f.deps)).map((r) => r.phase)).toEqual([
      "unknown",
      "reserved",
    ]);
  });
  it("denies non-Owners before querying the store", async () => {
    const f = fixture();
    await expect(receiptHeldProofs({ ...actor, role: "front_desk" }, f.deps)).rejects.toThrow(
      "forbidden",
    );
    expect(f.listings()).toBe(0);
  });
  it("denies a revoked Owner before querying the store", async () => {
    const f = fixture();
    f.deps.freshOwner = async () => {
      throw Error("revoked");
    };
    await expect(receiptHeldProofs(actor, f.deps)).rejects.toThrow("revoked");
    expect(f.listings()).toBe(0);
  });
  it.each([
    { ...actor, tenantId: "other" },
    { ...actor, n3TenantKey: "other" },
    { ...actor, n3UserKey: "other" },
  ])("denies restoration outside the original identity", async (other) => {
    await expect(readReceiptUpdateProofPermit(other, held.id, fixture().deps)).rejects.toThrow(
      "proof_permit_not_found",
    );
  });
});
