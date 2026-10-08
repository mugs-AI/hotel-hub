import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  readSettlementSales,
  readSettlementCollections,
  type SettlementSourceDeps,
  type SettlementCandidate,
} from "../settlement-financial-source.server";
import { financialMonth } from "../financial-reporting";
import * as gates from "../settlement-contracts.server";
import {
  evidenceSnapshot,
  evidenceBill,
  evidenceReceipt,
  fixtureActor,
  fixtureBillId,
  fixtureIntentId,
} from "./fixtures/settlement-evidence";
const actor = fixtureActor,
  p = financialMonth("2026-10", "Asia/Kuala_Lumpur"),
  s = evidenceSnapshot();
const candidate: SettlementCandidate = {
  snapshot: s,
  intentId: fixtureIntentId,
  documentId: fixtureBillId,
  bookingReference: "SYNTHETIC",
  purpose: "sale",
};
function deps(
  candidates: SettlementCandidate[],
  prove: SettlementSourceDeps["prove"],
): SettlementSourceDeps {
  return {
    discover: vi.fn(async () => ({
      kind: "confirmed" as const,
      value: { complete: true, candidates },
    })),
    prove,
    now: Date.now,
  };
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
});
describe("authoritative settlement monthly sources", () => {
  it("absent complete discovery contract is unavailable, never a zero", async () => {
    expect((await readSettlementSales(actor, p)).status).toBe("unavailable");
    expect((await readSettlementCollections(actor, p)).rows).toEqual([]);
  });
  it("bill08/10 is October sales and original deposit30/09 is not settlement collections", async () => {
    const d = deps([candidate], async () => ({
      kind: "confirmed",
      value: await evidenceBill(450),
    }));
    expect((await readSettlementSales(actor, p, d)).rows[0].documentDate).toBe("2026-10-08");
    expect(
      (await readSettlementSales(actor, financialMonth("2026-09", "Asia/Kuala_Lumpur"), d)).rows,
    ).toEqual([]);
    const deposit = {
      ...candidate,
      purpose: "deposit" as const,
      documentId: s.receipts[0].receiptId,
    };
    expect(
      (
        await readSettlementCollections(
          actor,
          p,
          deps([deposit], async () => ({ kind: "confirmed", value: await evidenceReceipt() })),
        )
      ).rows,
    ).toEqual([]);
  });
  it("allocations contribute no sales or cash and duplicate documents are deduped", async () => {
    const d = deps([candidate, candidate, { ...candidate, purpose: "allocation" }], async () => ({
      kind: "confirmed",
      value: await evidenceBill(450),
    }));
    const r = await readSettlementSales(actor, p, d);
    expect(r.status).toBe("complete");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].amountCents).toBe(50000);
    expect(d.prove).toBeDefined();
  });
  it("a purpose-specific balance receipt appears once as settlement cash", async () => {
    const { depositId, ...saved } = s.receipts[0];
    expect(depositId).toBeTruthy();
    const r = {
      ...saved,
      purpose: "settlement" as const,
      intentId: fixtureIntentId,
      receiptId: "33333333-3333-4333-8333-333333333333",
      reference: "HH-B-" + fixtureIntentId.replaceAll("-", ""),
      receiptDate: "2026-10-08",
      amountCents: 45000,
      payments: s.receipts[0].payments.map((x) => ({ ...x, amountCents: 45000 })),
    };
    const c = { ...candidate, purpose: "settlement" as const, documentId: r.receiptId };
    const d = deps([c, c], async () => ({
      kind: "confirmed",
      value: await evidenceReceipt([], 450, s, r),
    }));
    const source = await readSettlementCollections(actor, p, d);
    expect(source.status).toBe("complete");
    expect(source.rows).toHaveLength(1);
    expect(source.rows[0].kind).toBe("settlement");
    expect(source.rows[0].amountCents).toBe(45000);
  });
  it("101 monthly receipt candidates, incomplete pages and missing refund proof never total partially", async () => {
    const prove = vi.fn(async () => ({
      kind: "unavailable" as const,
      code: "n3_evidence_incomplete",
    }));
    const candidates = Array.from({ length: 101 }, (_, i) => ({
      ...candidate,
      purpose: "settlement" as const,
      documentId: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`,
    }));
    expect((await readSettlementCollections(actor, p, deps(candidates, prove))).reasonCode).toBe(
      "verification_cap",
    );
    expect(prove).not.toHaveBeenCalled();
    const d = deps([candidate], prove);
    d.discover = async () => ({
      kind: "confirmed",
      value: { complete: false, candidates: [candidate] },
    });
    expect((await readSettlementSales(actor, p, d)).status).toBe("unavailable");
    expect((await readSettlementSales(actor, p, deps([candidate], prove))).rows).toEqual([]);
  });
  it("Owner, person/token, property, date and currency scopes remain binding", async () => {
    const b = await evidenceBill(450),
      d = deps([candidate], async () => ({ kind: "confirmed", value: b }));
    await expect(readSettlementSales({ ...actor, role: "front_desk" }, p, d)).rejects.toThrow(
      "forbidden",
    );
    expect((await readSettlementSales({ ...actor, n3Token: "alien-token" }, p, d)).status).toBe(
      "unavailable",
    );
    expect(
      (
        await readSettlementSales(
          { ...actor, tenantId: "99999999-9999-4999-8999-999999999999" },
          p,
          d,
        )
      ).status,
    ).toBe("unavailable");
    expect(
      (
        await readSettlementSales(
          actor,
          p,
          deps([{ ...candidate, snapshot: { ...s, currency: "USD" } }], async () => ({
            kind: "confirmed",
            value: b,
          })),
        )
      ).status,
    ).toBe("unavailable");
    await expect(readSettlementSales(actor, { ...p, startDate: "2026-09-01" }, d)).rejects.toThrow(
      "invalid_month",
    );
  });
});

it.each(["n3_session_expired", "unauthorized"])(
  "monthly discovery and proof propagate %s",
  async (code) => {
    const d = deps([candidate], async () => ({ kind: "unavailable", code }));
    await expect(readSettlementSales(actor, p, d)).rejects.toThrow("unauthorized");
    d.discover = async () => ({ kind: "unavailable", code });
    await expect(readSettlementSales(actor, p, d)).rejects.toThrow("unauthorized");
  },
);
