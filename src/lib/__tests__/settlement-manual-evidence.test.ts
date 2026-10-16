import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gates from "../settlement-contracts.server";
import { createSettlementStore } from "../settlement-store.server";
import { billingPayloadDigest } from "../n3-billing.server";
import {
  proveExternalMatching,
  externalMatchEvidenceForStore,
} from "../settlement-manual-evidence.server";
import {
  evidenceSnapshot,
  evidenceBill,
  evidenceReceipt,
  fixtureActor as actor,
  fixtureBillId as billId,
  fixtureIntentId as intentId,
  priorRow,
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture(surplus = 0) {
  const snapshot = evidenceSnapshot();
  snapshot.receipts[0].amountCents = 50000 + surplus;
  snapshot.receipts[0].payments[0].amountCents = 50000 + surplus;
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
  const rpc = vi.fn(async () => ({ data: structuredClone(saved), error: null }));
  const intent = (await createSettlementStore(rpc).read(actor))!;
  const bill = await evidenceBill(0, intent.snapshot);
  const receipt = await evidenceReceipt([priorRow(500, billId)], surplus / 100, intent.snapshot);
  return { intent, reads: { bill, receipts: [receipt] }, rpc };
}

describe("external matching evidence", () => {
  it("proof_carries_oldest_authenticated_read_time_without_extending_freshness", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const at = Date.now();
    const f = await fixture();
    vi.setSystemTime(at + 59000);
    const result = proveExternalMatching(actor, f.intent, f.reads);
    if (result.kind !== "confirmed") throw new Error(result.code);
    expect(Date.parse(result.value.checkedAt)).toBe(at);
    vi.setSystemTime(at + 61000);
    expect(externalMatchEvidenceForStore(result.value, actor, f.intent)).toBeNull();
  });
  it("identical_fresh_facts_keep_observation_digest_but_not_proof_identity", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const at = Date.now();
    const first = await fixture();
    const one = proveExternalMatching(actor, first.intent, first.reads);
    vi.setSystemTime(at + 1000);
    const second = await fixture();
    const two = proveExternalMatching(actor, second.intent, second.reads);
    if (one.kind !== "confirmed" || two.kind !== "confirmed")
      throw new Error("proof fixture unavailable");
    expect(typeof one.value.observationDigest).toBe("string");
    expect(two.value.observationDigest).toBe(one.value.observationDigest);
    expect(two.value.digest).not.toBe(one.value.digest);
  });
  it("external_match_has_no_hh_write_claim", async () => {
    const f = await fixture();
    const result = proveExternalMatching(actor, f.intent, f.reads);
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error(result.code);
    expect(result.value.provenance).toBe("external_n3_matching");
    expect(result.value.billOutstandingCents).toBe(0);
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET"),
    ).toBe(true);
    const stored = externalMatchEvidenceForStore(result.value, actor, f.intent);
    expect(stored?.provenance).toBe("external_n3_matching");
    expect(JSON.stringify(stored)).not.toContain(actor.n3Token);
    expect(JSON.stringify(stored)).not.toContain("synthetic-owner");
  });
  it("same_customer_foreign_or_rejected", async () => {
    const f = await fixture();
    const alien = structuredClone(f.reads.receipts[0]);
    alien.receipt.reservationId = "99999999-9999-4999-8999-999999999999";
    expect(proveExternalMatching(actor, f.intent, { ...f.reads, receipts: [alien] }).kind).not.toBe(
      "confirmed",
    );
  });
  it("journal_without_matching_rows_rejected", async () => {
    const f = await fixture();
    const receipt = await evidenceReceipt([], 500, f.intent.snapshot);
    expect(
      proveExternalMatching(actor, f.intent, { ...f.reads, receipts: [receipt] }).kind,
    ).not.toBe("confirmed");
  });
  it("unknown_refund_not_available_funds", async () => {
    const f = await fixture();
    const receipt = structuredClone(f.reads.receipts[0]);
    Object.assign(receipt, { refundCents: null, remainderCents: null });
    expect(
      proveExternalMatching(actor, f.intent, { ...f.reads, receipts: [receipt] }).kind,
    ).not.toBe("confirmed");
  });
  it("refund_overlap_not_double_counted", async () => {
    const f = await fixture();
    const receipt = structuredClone(f.reads.receipts[0]);
    Object.assign(receipt.allocations[0], { docType: "RF" });
    expect(
      proveExternalMatching(actor, f.intent, { ...f.reads, receipts: [receipt] }).kind,
    ).not.toBe("confirmed");
  });
  it("changed_or_bill_identity_rejected", async () => {
    const f = await fixture();
    const bill = structuredClone(f.reads.bill);
    bill.id = "99999999-9999-4999-8999-999999999999";
    expect(proveExternalMatching(actor, f.intent, { ...f.reads, bill }).kind).not.toBe("confirmed");
  });
  it("all_owned_receipts_required_once", async () => {
    const f = await fixture();
    expect(proveExternalMatching(actor, f.intent, { ...f.reads, receipts: [] }).kind).not.toBe(
      "confirmed",
    );
    expect(
      proveExternalMatching(actor, f.intent, {
        ...f.reads,
        receipts: [...f.reads.receipts, ...f.reads.receipts],
      }).kind,
    ).not.toBe("confirmed");
  });
  it("surplus_is_an_observation_not_spendable_credit_or_close_permission", async () => {
    const f = await fixture(5000);
    const result = proveExternalMatching(actor, f.intent, f.reads);
    expect(result.kind).toBe("confirmed");
    if (result.kind !== "confirmed") throw new Error(result.code);
    expect(result.value.receiptObservations[0].remainderCents).toBe(5000);
    expect(result.value).not.toHaveProperty("availableFundsCents");
    expect(result.value).not.toHaveProperty("canClose");
  });
  it("unpaid_guest_bill_is_never_external_settlement", async () => {
    const f = await fixture();
    const bill = await evidenceBill(0.01, f.intent.snapshot);
    expect(proveExternalMatching(actor, f.intent, { ...f.reads, bill }).kind).toBe("contradiction");
  });
  it("copied_or_mutated_persisted_intent_has_no_authority", async () => {
    const f = await fixture();
    expect(proveExternalMatching(actor, structuredClone(f.intent), f.reads).kind).not.toBe(
      "confirmed",
    );
    f.intent.snapshot.receipts[0].reference = "changed";
    expect(proveExternalMatching(actor, f.intent, f.reads).kind).not.toBe("confirmed");
  });
  it("copied_proof_or_changed_session_cannot_be_serialized", async () => {
    const f = await fixture();
    const result = proveExternalMatching(actor, f.intent, f.reads);
    if (result.kind !== "confirmed") throw new Error(result.code);
    expect(
      externalMatchEvidenceForStore(structuredClone(result.value), actor, f.intent),
    ).toBeNull();
    expect(
      externalMatchEvidenceForStore(result.value, { ...actor, n3Token: "other" }, f.intent),
    ).toBeNull();
    expect(
      externalMatchEvidenceForStore(result.value, { ...actor, role: "housekeeper" }, f.intent),
    ).toBeNull();
  });
  it("expired_evidence_is_rejected", async () => {
    const f = await fixture();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61000);
    expect(proveExternalMatching(actor, f.intent, f.reads).kind).not.toBe("confirmed");
  });
});
