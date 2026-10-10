import { describe, expect, it } from "vitest";
import {
  prepareReceiptUpdateProof,
  runReceiptUpdateProof,
  checkReceiptUpdateProof,
  readReceiptUpdateProofPermit,
  proofPackageHash,
  type ProofDeps,
  type ProofPermit,
} from "../receipt-update-proof.server";
import {
  RECEIPT_50,
  RECEIPT_50_RAW,
  UPDATE_CONTRACT_TEST_ONLY,
} from "./fixtures/receipt-automation";
const actor = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  n3TenantKey: "TEST-TENANT",
  n3UserKey: "owner-1",
  n3Token: "SECRET_TOKEN",
  role: "owner" as const,
};
const pkg = {
  caseId: "amount-increase",
  tenantKey: actor.n3TenantKey,
  companyName: "Designated test company",
  receiptId: RECEIPT_50.receiptId,
  docCode: RECEIPT_50.docCode,
  documentDate: RECEIPT_50.documentDate,
  reference: RECEIPT_50.reference!,
  customerId: RECEIPT_50.customerId,
  customerCode: "CUSTOMER-T",
  accountId: RECEIPT_50.paymentLines[0]!.accountId,
  accountCode: "BANK-T",
  beforeCents: 5000,
  afterCents: 6500,
  expiresAt: 20000,
  budgetMs: 100,
  sourceRef: "a".repeat(40),
};
function fixture() {
  let time = 1000,
    sent = 0,
    owner = true,
    hotelReceipt = false;
  let receipt = structuredClone(RECEIPT_50),
    raw = structuredClone(RECEIPT_50_RAW);
  let permit: ProofPermit | null = null;
  const deps: ProofDeps = {
    enabled: true,
    packages: [pkg],
    contract: UPDATE_CONTRACT_TEST_ONLY,
    now: () => time,
    freshOwner: async () => {
      if (!owner) throw Error("revoked");
    },
    isHotelReceipt: async () => hotelReceipt,
    read: async () => ({ snapshot: receipt, raw }),
    send: async () => {
      sent++;
      receipt = {
        ...receipt,
        amountCents: 6500,
        paymentLines: [{ ...receipt.paymentLines[0]!, amountCents: 6500 }],
      };
      return {
        kind: "response",
        status: 200,
        body: { code: "0000", success: true },
        durationMs: 1,
      };
    },
    db: {
      create: async (row) => {
        permit = {
          ...row,
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          phase: "prepared",
          report: null,
        };
        return permit;
      },
      get: async (a, id) =>
        permit?.tenantId === a.tenantId && permit?.ownerKey === a.n3UserKey && permit?.id === id
          ? permit
          : null,
      claim: async (_a, id, hash) => {
        if (
          !permit ||
          permit.id !== id ||
          permit.payloadHash !== hash ||
          permit.phase !== "prepared" ||
          permit.expiresAt <= time
        )
          return false;
        permit = { ...permit, phase: "reserved" };
        return true;
      },
      finish: async (_a, _id, phase, report) => {
        permit = { ...permit!, phase, report };
      },
    },
  };
  const prepare = () =>
    prepareReceiptUpdateProof(
      actor,
      { caseId: pkg.caseId, receiptId: pkg.receiptId, approvedPackageHash: proofPackageHash(pkg) },
      deps,
    );
  return {
    deps,
    prepare,
    sent: () => sent,
    permit: () => permit!,
    advancePastPermit: () => {
      time = 1006;
    },
    expire: () => {
      time = 30000;
    },
    revoke: () => {
      owner = false;
    },
    link: () => {
      hotelReceipt = true;
    },
    changeRaw: () => {
      raw = { ...raw, totalAmount: 60 };
    },
    changeSnapshot: () => {
      receipt = { ...receipt, sourceFingerprint: "external-change" };
    },
  };
}
describe("Owner receipt Update proof", () => {
  it("is disabled by default without an approved server package", async () => {
    const f = fixture();
    f.deps.enabled = false;
    await expect(f.prepare()).rejects.toThrow("proof_disabled");
    expect(f.sent()).toBe(0);
  });
  it("refuses a non-designated tenant", async () => {
    const f = fixture();
    await expect(
      prepareReceiptUpdateProof(
        { ...actor, n3TenantKey: "PRODUCTION" },
        {
          caseId: pkg.caseId,
          receiptId: pkg.receiptId,
          approvedPackageHash: proofPackageHash(pkg),
        },
        f.deps,
      ),
    ).rejects.toThrow();
  });
  it("refuses frontdesk access", async () => {
    const f = fixture();
    await expect(
      prepareReceiptUpdateProof(
        { ...actor, role: "front_desk" },
        {
          caseId: pkg.caseId,
          receiptId: pkg.receiptId,
          approvedPackageHash: proofPackageHash(pkg),
        },
        f.deps,
      ),
    ).rejects.toThrow();
  });
  it("refuses a receipt already linked to any HotelHub booking", async () => {
    const f = fixture();
    f.link();
    await expect(f.prepare()).rejects.toThrow("proof_hotel_receipt");
  });
  it("refuses an unapproved package hash", async () => {
    const f = fixture();
    await expect(
      prepareReceiptUpdateProof(
        actor,
        { caseId: pkg.caseId, receiptId: pkg.receiptId, approvedPackageHash: "0".repeat(64) },
        f.deps,
      ),
    ).rejects.toThrow();
  });
  it("prepares a precise summary without sending or returning contact/payload/token", async () => {
    const f = fixture();
    const r = await f.prepare();
    expect(r.summary).toMatchObject({
      beforeCents: 5000,
      afterCents: 6500,
      docCode: pkg.docCode,
      companyName: pkg.companyName,
    });
    expect(f.sent()).toBe(0);
    expect(JSON.stringify(r)).not.toMatch(/SECRET_TOKEN|guest@example|customerName|multiPayments/);
  });
  it("sends once and verifies the same receipt and exact journal", async () => {
    const f = fixture();
    const p = await f.prepare();
    expect((await runReceiptUpdateProof(actor, p.permitId, f.deps)).outcome).toBe("verified");
    expect((await runReceiptUpdateProof(actor, p.permitId, f.deps)).outcome).toBe("verified");
    expect(f.sent()).toBe(1);
  });
  it("concurrent execution claims one dispatch", async () => {
    const f = fixture();
    const p = await f.prepare();
    await Promise.all([
      runReceiptUpdateProof(actor, p.permitId, f.deps),
      runReceiptUpdateProof(actor, p.permitId, f.deps),
    ]);
    expect(f.sent()).toBe(1);
  });
  it("never sends after a permit expires during the post-claim Owner check", async () => {
    const f = fixture();
    f.deps.packages = [{ ...pkg, expiresAt: 1005 }];
    const p = await prepareReceiptUpdateProof(
      actor,
      {
        caseId: pkg.caseId,
        receiptId: pkg.receiptId,
        approvedPackageHash: proofPackageHash(f.deps.packages[0]!),
      },
      f.deps,
    );
    const claim = f.deps.db.claim;
    f.deps.db.claim = async (...args) => {
      const granted = await claim(...args);
      f.advancePastPermit();
      return granted;
    };
    expect((await runReceiptUpdateProof(actor, p.permitId, f.deps)).outcome).toBe("needs_review");
    expect(f.sent()).toBe(0);
  });
  it("reports a reservation, not a claimed N3 POST, after post-claim revocation", async () => {
    const f = fixture();
    const p = await f.prepare();
    const claim = f.deps.db.claim;
    f.deps.db.claim = async (...args) => {
      const granted = await claim(...args);
      f.revoke();
      return granted;
    };
    const result = await runReceiptUpdateProof(actor, p.permitId, f.deps);
    expect(result.safeReport).toHaveProperty("reservationCount", 1);
    expect(result.safeReport).not.toHaveProperty("dispatchCount");
    expect(f.sent()).toBe(0);
  });
  it("reads a prepared permit summary without sending or inspecting N3", async () => {
    const f = fixture();
    const p = await f.prepare();
    f.deps.read = async () => {
      throw Error("no financial read expected");
    };
    const status = await readReceiptUpdateProofPermit(actor, p.permitId, f.deps);
    expect(status).toMatchObject({
      phase: "prepared",
      summary: { docCode: pkg.docCode, beforeCents: 5000, afterCents: 6500 },
    });
    expect(f.sent()).toBe(0);
    expect(JSON.stringify(status)).not.toMatch(/SECRET_TOKEN|guest@example|customerName/);
  });
  it("denies expired permits", async () => {
    const f = fixture();
    const p = await f.prepare();
    f.expire();
    await expect(runReceiptUpdateProof(actor, p.permitId, f.deps)).rejects.toThrow();
    expect(f.sent()).toBe(0);
  });
  it("denies Owner revocation after preparation", async () => {
    const f = fixture();
    const p = await f.prepare();
    f.revoke();
    await expect(runReceiptUpdateProof(actor, p.permitId, f.deps)).rejects.toThrow();
    expect(f.sent()).toBe(0);
  });
  it("refuses changed payload before dispatch", async () => {
    const f = fixture();
    const p = await f.prepare();
    f.changeRaw();
    await expect(runReceiptUpdateProof(actor, p.permitId, f.deps)).rejects.toThrow();
    expect(f.sent()).toBe(0);
  });
  it("refuses an intervening external edit", async () => {
    const f = fixture();
    const p = await f.prepare();
    f.changeSnapshot();
    await expect(runReceiptUpdateProof(actor, p.permitId, f.deps)).rejects.toThrow();
    expect(f.sent()).toBe(0);
  });
  it("holds a lost response; checking performs reads without another send", async () => {
    const f = fixture();
    const p = await f.prepare();
    f.deps.send = async () => ({ kind: "transport_error", reason: "network", durationMs: 1 });
    expect((await runReceiptUpdateProof(actor, p.permitId, f.deps)).outcome).toBe("needs_review");
    expect((await checkReceiptUpdateProof(actor, p.permitId, f.deps)).outcome).toBe("needs_review");
    expect(f.permit().phase).toBe("unknown");
  });
  it("rejects a successful envelope when readback journal is unproven", async () => {
    const f = fixture();
    const p = await f.prepare();
    f.deps.send = async () => ({
      kind: "response",
      status: 200,
      body: { code: "0000", success: true },
      durationMs: 1,
    });
    expect((await runReceiptUpdateProof(actor, p.permitId, f.deps)).outcome).toBe("needs_review");
  });
  it("holds on deadline exhaustion and never retries the reserved send", async () => {
    const f = fixture();
    f.deps.packages = [{ ...pkg, budgetMs: 5 }];
    const p = await prepareReceiptUpdateProof(
      actor,
      {
        caseId: pkg.caseId,
        receiptId: pkg.receiptId,
        approvedPackageHash: proofPackageHash(f.deps.packages[0]!),
      },
      f.deps,
    );
    f.deps.send = async () => new Promise(() => {});
    expect((await runReceiptUpdateProof(actor, p.permitId, f.deps)).outcome).toBe("needs_review");
    expect(f.permit().phase).toBe("unknown");
  });
  it("refuses an alien Owner permit", async () => {
    const f = fixture();
    const p = await f.prepare();
    await expect(
      runReceiptUpdateProof({ ...actor, n3UserKey: "other" }, p.permitId, f.deps),
    ).rejects.toThrow();
  });
});
