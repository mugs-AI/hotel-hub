import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gates from "../settlement-contracts.server";
import { createSettlementStore } from "../settlement-store.server";
import { billingPayloadDigest, n3BillingClient } from "../n3-billing.server";
import {
  checkSavedDocuments,
  externalMatchingEvidenceForCheck,
  type SavedCheckDeps,
} from "../saved-documents-check.server";
import { recoveryMessage } from "../settlement-recovery-messages";
import {
  evidenceSnapshot,
  evidenceBill,
  evidenceReceipt,
  priorRow,
  fixtureActor as actor,
  fixtureBillId as billId,
  fixtureIntentId as intentId,
} from "./fixtures/settlement-evidence";

beforeEach(() =>
  vi.spyOn(gates, "billingContractGate").mockImplementation((operation) => ({
    kind: "confirmed",
    value: {
      operation,
      evidenceHash: "a".repeat(64),
      concurrencyProofHash: null,
      allocationMode: null,
      billTarget: "same_id_INV",
    },
  })),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function fixture(emptyObservations = 0) {
  const snapshot = evidenceSnapshot();
  snapshot.receipts[0].amountCents = 50000;
  snapshot.receipts[0].payments[0].amountCents = 50000;
  await evidenceBill(0, snapshot);
  const billFetch = fetch;
  await evidenceReceipt([priorRow(500, billId)], 0, snapshot);
  const receiptFetch = fetch;
  const paths: string[] = [],
    waits: number[] = [];
  let billReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const path = String(url);
      paths.push(path);
      if (init?.method !== "GET") throw new Error("financial write attempted");
      if (path.includes("CashSales/") && !path.includes("GLPosting")) billReads++;
      if (path.includes("GLPosting") && billReads <= emptyObservations)
        return Response.json({ code: "0000", data: [] });
      return (path.includes("CashSales") ? billFetch : receiptFetch)(url, init);
    }),
  );
  const facts = {
    kind: "bill" as const,
    snapshotDigest: snapshot.digest,
    payload: { synthetic: true },
  };
  const saved = {
    tenantId: actor.tenantId,
    reservationId: actor.reservationId,
    id: intentId,
    revision: "3",
    state: "bill_verified",
    snapshot,
    dispatches: [
      {
        claim: {
          intentId,
          attemptId: "12345678-1234-4234-8234-123456789012",
          expectedRevision: "1",
          kind: "bill",
          payloadDigest: billingPayloadDigest(facts.payload),
        },
        facts,
        outcome: { kind: "confirmed", code: "0000", documentId: billId },
      },
    ],
  };
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    data: structuredClone(saved),
    error: null,
  }));
  const store = createSettlementStore(rpc);
  const deps: SavedCheckDeps = {
    loadIntent: (a) => store.read(a),
    client: n3BillingClient,
    now: Date.now,
    wait: async (ms) => {
      waits.push(ms);
    },
    authorize: async () => true,
    invalidateSession: vi.fn(async () => {}),
  };
  return { deps, paths, waits, saved, rpc };
}

describe("booking-bound accountant matching", () => {
  it("verifies exact matching twice without creating or allocating money", async () => {
    const f = await fixture();
    const result = await checkSavedDocuments(
      actor,
      intentId,
      {
        ...f.deps,
        snapshot: async () => ({ kind: "confirmed", value: structuredClone(f.saved.snapshot) }),
      },
      "external_matching",
    );
    expect(result.code).toBe("external_matching_observed");
    expect(result.status).toBe("confirmed");
    expect(result.observations).toBe(2);
    expect(result.externalMatching).toMatchObject({
      provenance: "external_n3_matching",
      canClose: false,
    });
    expect(result.externalMatching?.matches).toEqual([
      { receiptId: f.saved.snapshot.receipts[0].receiptId, billId, amountCents: 50000 },
    ]);
    expect(f.paths).toHaveLength(8);
    expect(f.rpc.mock.calls.every(([name]) => name === "hotelhub_settlement_read")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(actor.n3Token);
  });
  it("zero bill balance without matching rows is not settlement", async () => {
    const f = await fixture();
    const base = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const response = await base(url, init);
        if (String(url).includes("/ARReceipts/") && !String(url).includes("GLPosting")) {
          const body = await response.json();
          body.data.knockoff = [];
          body.data.outstandingAmount = 500;
          return Response.json(body);
        }
        return response;
      }),
    );
    const result = await checkSavedDocuments(
      actor,
      intentId,
      {
        ...f.deps,
        snapshot: async () => ({ kind: "confirmed", value: structuredClone(f.saved.snapshot) }),
      },
      "external_matching",
    );
    expect(result.status).not.toBe("confirmed");
    expect(result.billOutstandingCents).toBeNull();
    expect(result.externalMatching).toBeUndefined();
  });
  it("requires current source facts before reading N3", async () => {
    const f = await fixture();
    const result = await checkSavedDocuments(actor, intentId, f.deps, "external_matching");
    expect(result.status).not.toBe("confirmed");
    expect(result.code).toBe("n3_settlement_master_contract_unverified");
    expect(f.paths).toEqual([]);
  });
  it("another booking's receipt is denied even for the shared walk-in customer", async () => {
    const f = await fixture();
    f.saved.snapshot.receipts[0].reservationId = "99999999-9999-4999-8999-999999999999";
    const result = await checkSavedDocuments(
      actor,
      intentId,
      {
        ...f.deps,
        snapshot: async () => ({ kind: "confirmed", value: structuredClone(f.saved.snapshot) }),
      },
      "external_matching",
    );
    expect(result.status).not.toBe("confirmed");
    expect(f.paths).toEqual([]);
  });
  it("a receipt changing between observations keeps checkout blocked", async () => {
    const f = await fixture();
    const base = fetch;
    let receiptReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const response = await base(url, init);
        if (String(url).includes("/ARReceipts/") && !String(url).includes("GLPosting")) {
          if (++receiptReads === 2) {
            const body = await response.json();
            body.data.description = "Changed externally";
            return Response.json(body);
          }
        }
        return response;
      }),
    );
    const result = await checkSavedDocuments(
      actor,
      intentId,
      {
        ...f.deps,
        snapshot: async () => ({ kind: "confirmed", value: structuredClone(f.saved.snapshot) }),
      },
      "external_matching",
    );
    expect(result.code).toBe("settlement_evidence_changed");
    expect(result.externalMatching).toBeUndefined();
  });
  it("source or intent revision changes during check invalidate the observation", async () => {
    const f = await fixture();
    let reads = 0;
    const result = await checkSavedDocuments(
      actor,
      intentId,
      {
        ...f.deps,
        snapshot: async () => {
          const s = structuredClone(f.saved.snapshot);
          if (++reads > 1) s.revision = "99";
          return { kind: "confirmed", value: s };
        },
      },
      "external_matching",
    );
    expect(result.status).not.toBe("confirmed");
    expect(result.externalMatching).toBeUndefined();
  });
});

it("exposes only privately bound fresh evidence to the later settlement integration", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const at = Date.now();
  const f = await fixture();
  const result = await checkSavedDocuments(
    actor,
    intentId,
    {
      ...f.deps,
      snapshot: async () => ({ kind: "confirmed", value: structuredClone(f.saved.snapshot) }),
    },
    "external_matching",
  );
  expect(externalMatchingEvidenceForCheck(result, actor, intentId)?.provenance).toBe(
    "external_n3_matching",
  );
  expect(externalMatchingEvidenceForCheck(structuredClone(result), actor, intentId)).toBeNull();
  expect(
    externalMatchingEvidenceForCheck(result, { ...actor, n3Token: "changed-token" }, intentId),
  ).toBeNull();
  expect(externalMatchingEvidenceForCheck(result, actor, billId)).toBeNull();
  vi.setSystemTime(at + 61000);
  expect(externalMatchingEvidenceForCheck(result, actor, intentId)).toBeNull();
});
it("does not treat an unknown creation as a failed or confirmed transaction", async () => {
  const f = await fixture();
  f.saved.dispatches[0].outcome.kind = "unknown";
  const result = await checkSavedDocuments(
    actor,
    intentId,
    {
      ...f.deps,
      snapshot: async () => ({ kind: "confirmed", value: structuredClone(f.saved.snapshot) }),
    },
    "external_matching",
  );
  expect(result.status).toBe("waiting");
  expect(result.code).toBe("settlement_pending_financial_operation");
  expect(result.externalMatching).toBeUndefined();
  expect(externalMatchingEvidenceForCheck(result, actor, intentId)).toBeNull();
});
it("own-token Front Desk can check external matching but Housekeeper cannot", async () => {
  const f = await fixture();
  const deps = {
    ...f.deps,
    snapshot: async () => ({
      kind: "confirmed" as const,
      value: structuredClone(f.saved.snapshot),
    }),
  };
  expect(
    (
      await checkSavedDocuments(
        { ...actor, role: "front_desk" },
        intentId,
        deps,
        "external_matching",
      )
    ).status,
  ).toBe("confirmed");
  f.paths.length = 0;
  expect(
    (
      await checkSavedDocuments(
        { ...actor, role: "housekeeper" },
        intentId,
        deps,
        "external_matching",
      )
    ).code,
  ).toBe("settlement_forbidden");
  expect(f.paths).toEqual([]);
});
it("401 in the second observation discards matching and stops subsequent reads", async () => {
  const f = await fixture();
  const base = fetch;
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) =>
      ++calls === 5 ? Response.json({}, { status: 401 }) : base(url, init),
    ),
  );
  const result = await checkSavedDocuments(
    actor,
    intentId,
    {
      ...f.deps,
      snapshot: async () => ({ kind: "confirmed", value: structuredClone(f.saved.snapshot) }),
    },
    "external_matching",
  );
  expect(result.status).toBe("unauthorized");
  expect(result.externalMatching).toBeUndefined();
  expect(result.billOutstandingCents).toBeNull();
  expect(calls).toBe(5);
});
it("durable intent drift during verification cannot become accepted matching", async () => {
  const f = await fixture();
  const base = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const response = await base(url, init);
      f.saved.revision = "4";
      return response;
    }),
  );
  const result = await checkSavedDocuments(
    actor,
    intentId,
    {
      ...f.deps,
      snapshot: async () => ({ kind: "confirmed", value: structuredClone(f.saved.snapshot) }),
    },
    "external_matching",
  );
  expect(result.code).toBe("settlement_stale_revision");
  expect(result.externalMatching).toBeUndefined();
});
