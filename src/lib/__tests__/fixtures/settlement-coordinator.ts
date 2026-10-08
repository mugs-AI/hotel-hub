import { vi } from "vitest";
import { createSettlementStore, type SettlementRpc } from "../../settlement-store.server";
import {
  evidenceSnapshot,
  fixtureActor as actor,
  fixtureBillId as billId,
  fixtureIntentId as intentId,
  accountResponse,
} from "./settlement-evidence";
import type { StoredIntent } from "../../settlement-dispatch.server";
import { settlementFinalEvidenceForStore } from "../../settlement-evidence.server";
export { actor, billId, intentId };
export const balanceId = "33333333-3333-4333-8333-333333333333";
const ar = "55555555-5555-4555-8555-555555555555",
  sales = "66666666-6666-4666-8666-666666666666";
export function coordinatorFixture(ids: { billId?: string; balanceId?: string } = {}) {
  const fixtureBillId = ids.billId ?? billId;
  const fixtureBalanceId = ids.balanceId ?? balanceId;
  const snapshot = evidenceSnapshot();
  let intent: StoredIntent | null = null;
  const writes: string[] = [],
    calls: string[] = [];
  const fail = new Set<string>();
  const fault = {
    writeStatus: 200,
    malformed: false,
    timeout: false,
    readStatus: 200,
    badGL: false,
    extraOutstanding: 0,
    receiptExcess: 0,
  };
  let billExists = false,
    balanceExists = false,
    depositMatched = false,
    balanceMatched = false;
  const reference = "HH-B-" + intentId.replace(/-/g, "");
  const outstanding = () =>
    500 - (depositMatched ? 50 : 0) - (balanceMatched ? 450 : 0) + fault.extraOutstanding;
  const gl = (
    id: string,
    code: string,
    debit: number,
    credit: number,
    docCode: string,
    referenceNo: string,
    docDate: string,
  ) => ({
    isCancelled: false,
    accountId: id,
    account: { id, code },
    debit,
    credit,
    docCode,
    referenceNo,
    docDate,
    currencyId: 1,
    currencyRate: 1,
    customerId: 7,
  });
  const receipt = (balance: boolean) => {
    const r = snapshot.receipts[0],
      amount = balance ? 450 : 50,
      id = balance ? fixtureBalanceId : r.receiptId,
      date = balance ? "2026-10-08" : r.receiptDate,
      ref = balance ? reference : r.reference;
    const matched = balance ? balanceMatched : depositMatched,
      code = balance ? "OR-BALANCE" : "OR-DEPOSIT";
    return {
      detail: {
        isCancelled: false,
        id,
        docType: "AROR",
        docCode: code,
        docDate: date,
        referenceNo: ref,
        customerId: 7,
        customerCode: "SYNTHETIC-AR",
        currencyId: 1,
        currencyCode: "MYR",
        currencyRate: 1,
        totalAmount: amount,
        netTotalAmount: amount,
        accountId: r.payments[0].accountId,
        accountCode: r.payments[0].accountCode,
        isMultiPayment: false,
        customerName: "Synthetic guest",
        remark1: "",
        remark2: "",
        remark3: "",
        remark4: "",
        refundAmount: 0,
        outstandingAmount: matched ? fault.receiptExcess : amount,
        knockoff: matched
          ? [
              {
                customerId: 7,
                receiptDocType: "OR",
                receiptDocId: id,
                docType: "INV",
                docId: fixtureBillId,
                paymentAmount: amount,
                currencyCode: "MYR",
                currencyRate: 1,
              },
            ]
          : [],
      },
      journal: [
        gl(r.payments[0].accountId, r.payments[0].accountCode, amount, 0, code, ref, date),
        gl(ar, "SYNTHETIC-AR", 0, amount, code, ref, date),
      ],
    };
  };
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url),
      post = init?.method === "POST";
    if (post) {
      writes.push(path);
      if (path.includes("CashSales/Create")) billExists = true;
      else if (path.includes("ARReceipts/Create")) balanceExists = true;
      else if (path.includes("UpdateCustomerKnockoff")) {
        const rows = JSON.parse(String(init?.body));
        if (rows[0].receiptDocId === fixtureBalanceId) balanceMatched = true;
        else depositMatched = true;
      }
      if (fault.timeout) throw new Error("synthetic disconnect");
      return new Response(
        JSON.stringify(
          fault.malformed
            ? { code: "0000", data: {} }
            : {
                code: "0000",
                data: { id: path.includes("CashSales") ? fixtureBillId : fixtureBalanceId },
              },
        ),
        { status: fault.writeStatus },
      );
    }
    let data: unknown;
    if (path.includes("AccountCodes")) data = accountResponse();
    else if (path.includes("CashSales")) {
      if (!billExists) return new Response(JSON.stringify({ code: "4040" }), { status: 404 });
      data = path.includes("GLPosting")
        ? [
            gl(ar, "SYNTHETIC-AR", 500, 0, "CS-SYNTHETIC", reference, snapshot.billDate),
            gl(sales, "SYNTHETIC-SALES", 0, 500, "CS-SYNTHETIC", reference, snapshot.billDate),
          ]
        : {
            isCancelled: false,
            id: fixtureBillId,
            docType: "CS",
            docCode: "CS-SYNTHETIC",
            docDate: snapshot.billDate,
            referenceNo: reference,
            customerId: 7,
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
            outstandingAmount: outstanding(),
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
    } else {
      const balance = path.includes(fixtureBalanceId);
      if (balance && !balanceExists)
        return new Response(JSON.stringify({ code: "4040" }), { status: 404 });
      const r = receipt(balance);
      data = path.includes("GLPosting") ? r.journal : r.detail;
    }
    if (fault.badGL && path.includes("GLPosting")) data = [];
    return new Response(JSON.stringify({ code: "0000", data }), { status: fault.readStatus });
  });
  vi.stubGlobal("fetch", fetch);
  const rpc: SettlementRpc = async (name, args) => {
    calls.push(name);
    if (fail.has(name)) return { data: null, error: { message: "synthetic_storage_failure" } };
    if (name.endsWith("_freeze")) {
      if (!intent)
        intent = {
          id: intentId,
          tenantId: actor.tenantId,
          reservationId: actor.reservationId,
          snapshot: structuredClone(snapshot),
          revision: "1",
          state: "frozen",
          dispatches: [],
          evidence: [],
        };
    } else if (name.endsWith("_claim")) {
      if (!intent) throw new Error("no intent");
      if (
        intent.dispatches.some(
          (d) =>
            d.claim.kind === args.p_step && d.claim.receiptId === (args.p_receipt_id || undefined),
        )
      )
        return { data: null, error: null };
      if (intent.revision !== args.p_revision)
        return { data: null, error: { message: "settlement_stale_revision" } };
      intent.revision = String(BigInt(intent.revision) + 1n);
      const claim = {
        attemptId: `99999999-9999-4999-8999-${String(intent.dispatches.length + 1).padStart(12, "0")}`,
        intentId,
        kind: args.p_step,
        expectedRevision: intent.revision,
        payloadDigest: args.p_payload_digest,
        ...(args.p_receipt_id ? { receiptId: args.p_receipt_id } : {}),
      };
      intent.dispatches.push({
        claim: claim as never,
        outcome: null,
        facts: structuredClone(args.p_dispatch_facts) as never,
      });
      intent.state =
        args.p_step === "bill"
          ? "bill_dispatched"
          : args.p_step === "balance_receipt"
            ? "balance_dispatched"
            : "allocating";
      return { data: structuredClone(claim), error: null };
    } else if (name.endsWith("_outcome")) {
      const d = intent!.dispatches.find((d) => d.claim.attemptId === args.p_attempt_id)!;
      d.outcome = structuredClone(args.p_outcome) as StoredIntent["dispatches"][number]["outcome"];
      intent!.revision = String(BigInt(intent!.revision) + 1n);
      if (d.outcome?.kind !== "confirmed") intent!.state = "needs_review";
    } else if (name.endsWith("_prove")) {
      const proof = args.p_proof as Record<string, unknown>;
      if (intent!.revision !== args.p_revision)
        return { data: null, error: { message: "settlement_stale_revision" } };
      if (!intent!.evidence!.some((p) => p.digest === proof.digest)) {
        intent!.evidence!.push(structuredClone(proof));
        intent!.revision = String(BigInt(intent!.revision) + 1n);
        intent!.state =
          proof.kind === "settlement"
            ? "settled"
            : proof.kind === "allocation"
              ? "allocating"
              : proof.kind === "balance_receipt"
                ? "balance_dispatched"
                : "bill_verified";
      }
    } else if (name.endsWith("_close")) {
      intent!.state = "closed";
      intent!.revision = String(BigInt(intent!.revision) + 1n);
    }
    return { data: structuredClone(intent), error: null };
  };
  const store = createSettlementStore(rpc);
  return {
    snapshot,
    store,
    writes,
    calls,
    fail,
    fault,
    fetch,
    getIntent: () => structuredClone(intent),
    setEvidenceState: () => {
      billExists = true;
      depositMatched = true;
    },
    deps: {
      store,
      snapshot: async () => ({ kind: "confirmed" as const, value: structuredClone(snapshot) }),
      now: () => new Date(),
      invalidateSession: vi.fn(async () => {}),
    },
    finalStoreEvidence: settlementFinalEvidenceForStore,
  };
}
