import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultReceiptProofDeps } from "../receipt-update-proof-deps.server";
import {
  prepareReceiptUpdateProof,
  proofPackageHash,
  receiptProofCases,
} from "../receipt-update-proof.server";

const actor = {
  tenantId: "075e94a3-3876-4293-8ec5-3c541c028a09",
  n3TenantKey: "ca75ed66-69ac-40d9-92f1-f6b3a8780fdd",
  n3UserKey: "offline-owner",
  n3Token: "offline-token",
  role: "owner" as const,
};
const beforeExpiry = Date.parse("2026-10-11T11:30:00+08:00");
afterEach(() => vi.unstubAllEnvs());

describe("designated OR2610/002 proof package", () => {
  it("offers only the two designated same-OR follow-up cases when explicitly enabled", () => {
    vi.stubEnv("HOTELHUB_RECEIPT_PROOF_ENABLED", "true");
    const deps = defaultReceiptProofDeps();
    deps.now = () => beforeExpiry;
    const cases = receiptProofCases(actor, deps);
    expect(cases).toHaveLength(2);
    expect(cases[0]).toMatchObject({
      caseId: "OR2610-002-65-to-50-20261011",
      companyName: "9AC-0D9-2F1 · MUGS AI LAB TEST SDN. BHD.",
      receiptId: "3a0d118c-de6d-40bd-3bc2-08df269c5e9f",
      docCode: "OR2610/002",
      documentDate: "2026-10-10",
      beforeCents: 6500,
      afterCents: 5000,
      expiresAt: Date.parse("2026-10-11T20:00:00+08:00"),
      sourceReference: "b5b168d323dbba002a2967dadf80a70c75a7c710",
    });
    expect(cases[1]).toMatchObject({
      caseId: "OR2610-002-50-to-65-20261011",
      receiptId: cases[0]!.receiptId,
      docCode: "OR2610/002",
      beforeCents: 5000,
      afterCents: 6500,
    });
    expect(deps.packages[0]).toMatchObject({
      tenantKey: actor.n3TenantKey,
      reference: null,
      customerId: "1382639",
      customerCode: "700-7001",
      accountId: "c3c22459-c2b7-4c43-8e43-8b52a9adabda",
      accountCode: "700-0310",
      budgetMs: 30000,
    });
  });

  it.each([undefined, "false", "TRUE"])("is dormant with flag %s", (value) => {
    vi.stubEnv("HOTELHUB_RECEIPT_PROOF_ENABLED", value);
    expect(defaultReceiptProofDeps().enabled).toBe(false);
    expect(receiptProofCases(actor, defaultReceiptProofDeps())).toEqual([]);
  });

  it("offers nothing to a different N3 tenant", () => {
    vi.stubEnv("HOTELHUB_RECEIPT_PROOF_ENABLED", "true");
    const deps = defaultReceiptProofDeps();
    deps.now = () => beforeExpiry;
    expect(receiptProofCases({ ...actor, n3TenantKey: "another-tenant" }, deps)).toEqual([]);
  });

  it("refuses Front Desk access", () => {
    vi.stubEnv("HOTELHUB_RECEIPT_PROOF_ENABLED", "true");
    expect(() =>
      receiptProofCases({ ...actor, role: "front_desk" }, defaultReceiptProofDeps()),
    ).toThrow("forbidden");
  });

  it("expires at the exact cutoff without automatic renewal", () => {
    vi.stubEnv("HOTELHUB_RECEIPT_PROOF_ENABLED", "true");
    const deps = defaultReceiptProofDeps();
    deps.now = () => Date.parse("2026-10-11T20:00:00+08:00");
    expect(receiptProofCases(actor, deps)).toEqual([]);
  });

  it("rejects the urgent original receipt before invoking any dependency", async () => {
    vi.stubEnv("HOTELHUB_RECEIPT_PROOF_ENABLED", "true");
    const deps = defaultReceiptProofDeps();
    deps.now = () => beforeExpiry;
    deps.freshOwner = async () => {
      throw Error("must not reach server reads");
    };
    await expect(
      prepareReceiptUpdateProof(
        actor,
        {
          caseId: "OR2610-002-65-to-50-20261011",
          receiptId: "8a39169c-2ddd-450c-8b58-bd155bfda8a5",
          approvedPackageHash: deps.packages[0]
            ? proofPackageHash(deps.packages[0])
            : "0".repeat(64),
        },
        deps,
      ),
    ).rejects.toThrow("proof_package_not_approved");
  });
});
