import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gates from "../settlement-contracts.server";
import { createSettlementStore } from "../settlement-store.server";
import { billingPayloadDigest, n3BillingClient } from "../n3-billing.server";
import { checkSavedDocuments, type SavedCheckDeps } from "../saved-documents-check.server";
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
  const rpc = vi.fn(async () => ({ data: structuredClone(saved), error: null }));
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

describe("fixed owned saved-document checks", () => {
  it("empty_empty_present_uses_three_observations", async () => {
    const f = await fixture(2);
    const result = await checkSavedDocuments(actor, intentId, f.deps);
    expect(result.status).toBe("confirmed");
    expect(result.observations).toBe(3);
    expect(f.waits).toEqual([1000, 2000]);
    expect(result.documents.map((d) => d.id)).toEqual([
      billId,
      f.saved.snapshot.receipts[0].receiptId,
    ]);
    expect(result.billOutstandingCents).toBe(0);
    expect(result.persistenceProven).toBe(false);
    expect(result.attempts[0].attemptId).toBe("12345678-1234-4234-8234-123456789012");
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(actor.n3Token);
    expect(JSON.stringify(result)).not.toContain("Synthetic guest");
  });
  it("three_empty_results_wait_without_post", async () => {
    const f = await fixture(3);
    const result = await checkSavedDocuments(actor, intentId, f.deps);
    expect(result.status).toBe("waiting");
    expect(result.observations).toBe(3);
    expect(result.billOutstandingCents).toBeNull();
    expect(f.waits).toEqual([1000, 2000]);
    expect(f.paths.filter((p) => p.includes("GLPosting"))).toHaveLength(6);
  });
  it("401_aborts_remaining_calls_and_discards_prior_money", async () => {
    const f = await fixture();
    const real = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) =>
        String(url).includes("ARReceipts/") ? new Response(null, { status: 401 }) : real(url, init),
      ),
    );
    const result = await checkSavedDocuments(actor, intentId, f.deps);
    expect(result.status).toBe("unauthorized");
    expect(result.billOutstandingCents).toBeNull();
    expect(result.checks.every((c) => c.status === "unavailable")).toBe(true);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(3);
    expect(f.deps.invalidateSession).toHaveBeenCalledTimes(1);
    expect(f.waits).toEqual([]);
  });
  it("shared_deadline_bounds_all_document_reads", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      ),
    );
    const pending = checkSavedDocuments(actor, intentId, {
      ...f.deps,
      deadlineAt: Date.now() + 50,
    });
    await vi.advanceTimersByTimeAsync(51);
    const result = await pending;
    expect(result.status).toBe("waiting");
    expect(result.code).toBe("verification_deadline");
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    expect(f.waits).toEqual([]);
  });
  it("wrong_scope_rejected_before_network", async () => {
    const f = await fixture();
    const result = await checkSavedDocuments(
      { ...actor, reservationId: "99999999-9999-4999-8999-999999999999" },
      intentId,
      f.deps,
    );
    expect(result.status).toBe("needs_review");
    expect(f.paths).toEqual([]);
  });
  it("copied_intent_and_unowned_id_rejected_before_network", async () => {
    const f = await fixture();
    const result = await checkSavedDocuments(actor, intentId, {
      ...f.deps,
      loadIntent: async () => structuredClone(f.saved) as never,
    });
    expect(result.status).toBe("needs_review");
    expect(f.paths).toEqual([]);
    const wrong = await checkSavedDocuments(actor, "99999999-9999-4999-8999-999999999999", f.deps);
    expect(wrong.status).toBe("needs_review");
    expect(f.paths).toEqual([]);
  });
  it("navigation_abort_stops_wait_and_all_later_reads", async () => {
    const f = await fixture(3),
      c = new AbortController();
    const result = await checkSavedDocuments(actor, intentId, {
      ...f.deps,
      signal: c.signal,
      wait: async () => {
        c.abort();
      },
    });
    expect(result.status).toBe("waiting");
    expect(result.code).toBe("verification_cancelled");
    expect(result.observations).toBe(1);
    expect(f.paths).toHaveLength(4);
  });
  it("scope_loss_between_reads_hides_completed_observations", async () => {
    const f = await fixture();
    let checks = 0;
    const result = await checkSavedDocuments(actor, intentId, {
      ...f.deps,
      authorize: async () => ++checks < 4,
    });
    expect(result.status).toBe("unauthorized");
    expect(result.billOutstandingCents).toBeNull();
    expect(f.paths).toHaveLength(2);
  });
  it("unknown_code_safe_fallback_distinguishes_dispatch_phase", () => {
    const refs = {
      bookingReference: "BK-SYNTHETIC",
      documents: [{ id: billId, code: "CS-SYNTHETIC" }],
    };
    expect(recoveryMessage("secret vendor body", "after_dispatch", refs)).toContain(
      "do not collect again",
    );
    expect(recoveryMessage("secret vendor body", "before_dispatch", refs)).toContain("not sent");
    expect(recoveryMessage("secret vendor body", "after_dispatch", refs)).not.toContain(
      "secret vendor body",
    );
  });
  it("wrong_booking_money_contradiction_is_not_retried_or_relabelled_confirmed", async () => {
    const f = await fixture(),
      real = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const r = await real(url, init);
        const b = await r.json();
        if (!String(url).includes("GLPosting")) b.data.customerId = 99;
        return Response.json(b);
      }),
    );
    const result = await checkSavedDocuments(actor, intentId, f.deps);
    expect(result.status).toBe("needs_review");
    expect(result.billOutstandingCents).toBeNull();
    expect(f.waits).toEqual([]);
  });
  it("oversized_first_response_stops_the_whole_check", async () => {
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("large", { headers: { "content-length": "2000001" } })),
    );
    const result = await checkSavedDocuments(actor, intentId, f.deps);
    expect(result.status).toBe("needs_review");
    expect(result.code).toBe("n3_response_too_large");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(f.waits).toEqual([]);
  });
  it("safe_business_status_packet_keeps_code_without_vendor_body", async () => {
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "0051", message: "private guest and token" })),
    );
    const result = await checkSavedDocuments(actor, intentId, f.deps);
    expect(result.status).toBe("needs_review");
    expect(result.responses[0]).toMatchObject({
      documentId: billId,
      operation: "detail",
      httpStatus: 200,
      businessCode: "0051",
    });
    expect(JSON.stringify(result)).not.toContain("private guest and token");
  });
  it("waiting_keeps_exact_saved_document_numbers_without_promoting_money", async () => {
    const f = await fixture(3);
    Object.assign(f.saved, {
      evidence: [
        { kind: "bill", bill: { id: billId, code: "CS-SYNTHETIC" } },
        {
          kind: "allocation",
          receipt: { receiptId: f.saved.snapshot.receipts[0].receiptId, code: "OR-SYNTHETIC" },
        },
      ],
    });
    const result = await checkSavedDocuments(actor, intentId, f.deps);
    expect(result.status).toBe("waiting");
    expect(result.documents.map((d) => d.code)).toEqual(["CS-SYNTHETIC", "OR-SYNTHETIC"]);
    expect(result.billOutstandingCents).toBeNull();
  });
  it("unknown_bill_without_id_keeps_saved_attempt_and_performs_no_GET", async () => {
    const f = await fixture();
    Object.assign(f.saved.dispatches[0], {
      outcome: { kind: "unknown", code: "n3_update_unknown" },
    });
    const result = await checkSavedDocuments(actor, intentId, f.deps);
    expect(result.attempts[0]).toMatchObject({
      attemptId: "12345678-1234-4234-8234-123456789012",
      operation: "bill",
    });
    expect(result.status).not.toBe("confirmed");
    expect(result.billOutstandingCents).toBeNull();
    expect(f.paths).toEqual([]);
  });
  it("unknown_balance_without_id_keeps_known_bill_and_both_attempts", async () => {
    const f = await fixture(),
      p = f.saved.snapshot.receipts[0].payments[0];
    const facts = {
      kind: "balance_receipt",
      snapshotDigest: f.saved.snapshot.digest,
      payload: { synthetic: true },
      input: {
        accountId: p.accountId,
        amountCents: 100,
        docDate: "2026-10-08",
        contact: { customerName: "Synthetic guest" },
      },
      account: { id: p.accountId, code: p.accountCode, name: p.accountName },
    };
    (f.saved.dispatches as unknown[]).push({
      claim: {
        intentId,
        attemptId: "98765432-1234-4234-8234-123456789012",
        expectedRevision: "2",
        kind: "balance_receipt",
        payloadDigest: billingPayloadDigest(facts.payload),
      },
      facts,
      outcome: { kind: "unknown", code: "n3_update_unknown" },
    });
    const result = await checkSavedDocuments(actor, intentId, f.deps);
    expect(result.attempts.map((a) => a.operation)).toEqual(["bill", "balance_receipt"]);
    expect(result.documents.map((d) => d.id)).toContain(billId);
    expect(result.status).not.toBe("confirmed");
    expect(result.billOutstandingCents).toBeNull();
    expect(f.paths).toEqual([]);
  });
  it("HTTP_deadline_retains_waiting_packet_and_saved_references", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const real = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) =>
        String(url).includes("GLPosting")
          ? new Promise<Response>((_resolve, reject) =>
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              ),
            )
          : real(url, init),
      ),
    );
    const { handleSavedDocumentCheckHttp } = await import("../saved-documents-check-http.server");
    const request = new Request("https://synthetic.test/check", {
      method: "POST",
      headers: { origin: "https://synthetic.test", "content-type": "application/json" },
      body: JSON.stringify({ intentId }),
    });
    const pending = handleSavedDocumentCheckHttp(request, actor.reservationId, {
      actor: async () => actor,
      exists: async () => true,
      check: (a, id, signal, deadlineAt) =>
        checkSavedDocuments(a, id, { ...f.deps, signal, deadlineAt }),
    });
    await vi.advanceTimersByTimeAsync(40001);
    const response = await pending;
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({
      status: "waiting",
      code: "verification_deadline",
      billOutstandingCents: null,
    });
    expect(data.attempts[0].attemptId).toBe("12345678-1234-4234-8234-123456789012");
    expect(data.documents.map((d: { id: string }) => d.id)).toContain(billId);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("401_cleanup_failure_or_delay_cannot_lose_auth_status_or_exceed_budget", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    let finished = false;
    let packet: Awaited<ReturnType<typeof checkSavedDocuments>> | undefined;
    const pending = checkSavedDocuments(actor, intentId, {
      ...f.deps,
      deadlineAt: Date.now() + 50,
      invalidateSession: () => new Promise<void>(() => {}),
    }).then((r) => {
      packet = r;
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(51);
    expect(finished).toBe(true);
    expect(packet).toMatchObject({ status: "unauthorized", billOutstandingCents: null });
    await pending;
  });
  it("404_is_unknown_observation_not_failed_creation", async () => {
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const result = await checkSavedDocuments(actor, intentId, f.deps);
    expect(result.status).toBe("waiting");
    expect(result.observations).toBe(3);
    expect(f.waits).toEqual([1000, 2000]);
    expect(result.billOutstandingCents).toBeNull();
  });
});
