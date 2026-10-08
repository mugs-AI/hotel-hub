import type { SettlementActor, SettlementProof } from "./settlement-context.server";
import type {
  EvidenceResult,
  SettlementSnapshot,
  SettlementStepInput,
  SettlementView,
  StepKind,
  DispatchOutcome,
} from "./settlement";
import type { SettlementStore } from "./settlement-store.server";
import type { StoredIntent, StoredDispatch, DispatchFacts } from "./settlement-dispatch.server";
import type { N3Outcome } from "./n3-receipts.server";
import {
  n3BillingClient,
  billingPayloadDigest,
  buildCashSalePayload,
  buildBalanceReceiptPayload,
  type N3BillingClient,
} from "./n3-billing.server";
import { billingContractGate } from "./settlement-contracts.server";
import {
  proveBill,
  proveReceiptBefore,
  proveSettlement,
  makeBillProgressEvidence,
  makeReceiptProgressEvidence,
  settlementFinalEvidenceForStore,
  type VerifiedBill,
  type VerifiedReceiptBefore,
  type VerifiedAllocation,
  type SettlementReceipt,
} from "./settlement-evidence.server";
import { recoverAllocationEvidence } from "./settlement-recovery.server";
import {
  buildAllocationRows,
  buildBalanceIntent,
  verifySettlementPaymentAccount,
  orderedSettlementReceipts,
} from "./settlement-allocation.server";

export type SettlementDeps = {
  store: SettlementStore;
  snapshot(
    actor: SettlementActor,
    frozen?: SettlementSnapshot,
  ): Promise<EvidenceResult<SettlementSnapshot>>;
  client?: N3BillingClient;
  // Mounted only when a service-side exact-reference/completeness contract is proven.
  lookupExactReference?(
    actor: SettlementActor,
    kind: "bill" | "balance_receipt",
    reference: string,
  ): Promise<EvidenceResult<string[]>>;
  now(): Date;
  invalidateSession(reason: string): Promise<void>;
};
type Context = {
  intent: StoredIntent | null;
  bill: VerifiedBill | null;
  before: VerifiedReceiptBefore[];
  allocations: VerifiedAllocation[];
  proof: SettlementProof | null;
  snapshot?: SettlementSnapshot;
  blockers: string[];
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function code(e: unknown): string {
  return e instanceof Error && /^(settlement_|n3_)[a-z_]{1,90}$/.test(e.message)
    ? e.message
    : "settlement_unavailable";
}
function value<T>(r: EvidenceResult<T>): T {
  if (r.kind !== "confirmed") throw new Error(r.code);
  return r.value;
}
function authorized(a: SettlementActor, write = false) {
  if (
    !a.n3Token ||
    !a.n3UserKey ||
    !uuid(a.tenantId) ||
    !uuid(a.reservationId) ||
    (write ? a.role !== "owner" : !["owner", "front_desk"].includes(a.role))
  )
    throw new Error("settlement_forbidden");
}
async function outcomeRead<T>(
  a: SettlementActor,
  d: SettlementDeps,
  read: () => Promise<T>,
): Promise<T> {
  const result = await read();
  if (object(result) && result.kind === "response" && result.status === 401) {
    await d.invalidateSession("unauthorized");
    throw new Error("n3_session_expired");
  }
  return result;
}
function hasProgress(i: StoredIntent, kind: string, receiptId?: string): boolean {
  return Boolean(
    i.evidence?.some(
      (e) =>
        e.kind === kind && (!receiptId || (object(e.receipt) && e.receipt.receiptId === receiptId)),
    ),
  );
}
async function documentId(
  a: SettlementActor,
  d: SettlementDeps,
  i: StoredIntent,
  dispatch: StoredDispatch,
): Promise<string> {
  const known = dispatch.outcome?.documentId;
  if (uuid(known)) return known;
  const e = i.evidence?.find((e) =>
    dispatch.claim.kind === "bill"
      ? object(e.bill) && uuid(e.bill.id)
      : e.kind === "balance_receipt" && object(e.receipt) && uuid(e.receipt.receiptId),
  );
  const prior =
    dispatch.claim.kind === "bill"
      ? object(e?.bill)
        ? e.bill.id
        : null
      : object(e?.receipt)
        ? e.receipt.receiptId
        : null;
  if (uuid(prior)) return prior;
  if (!d.lookupExactReference) throw new Error("settlement_identity_requires_review");
  const reference =
    dispatch.facts?.payload && !Array.isArray(dispatch.facts.payload)
      ? dispatch.facts.payload.referenceNo
      : null;
  if (typeof reference !== "string") throw new Error("settlement_identity_requires_review");
  const ids = value(
    await d.lookupExactReference(a, dispatch.claim.kind as "bill" | "balance_receipt", reference),
  );
  if (ids.length !== 1 || !uuid(ids[0])) throw new Error("settlement_identity_requires_review");
  return ids[0];
}
function balanceReceipt(i: StoredIntent, d: StoredDispatch, id: string): SettlementReceipt {
  const f = d.facts;
  if (!f || f.kind !== "balance_receipt") throw new Error("settlement_invalid_dispatch_facts");
  return {
    purpose: "settlement",
    intentId: i.id,
    reservationId: i.reservationId,
    receiptId: id,
    reference: String(f.payload.referenceNo),
    customerId: i.snapshot.customerId,
    currency: i.snapshot.currency,
    amountCents: f.input.amountCents,
    receiptDate: f.input.docDate,
    payments: [
      {
        accountId: f.account.id,
        accountCode: f.account.code,
        accountName: f.account.name,
        amountCents: f.input.amountCents,
      },
    ],
  };
}
async function inspect(
  a: SettlementActor,
  d: SettlementDeps,
  requestedId?: string,
  persist = true,
): Promise<Context> {
  const c: Context = {
    intent: null,
    bill: null,
    before: [],
    allocations: [],
    proof: null,
    blockers: [],
  };
  try {
    authorized(a);
    let i = await d.store.read(a);
    c.intent = i;
    if (requestedId && i?.id !== requestedId) throw new Error("settlement_not_found");
    if (!i) {
      c.snapshot = value(await d.snapshot(a));
      return c;
    }
    if (i.state === "closed") return c;
    const s = i.snapshot,
      fresh = value(await d.snapshot(a, s));
    if (billingPayloadDigest(fresh) !== billingPayloadDigest(s))
      throw new Error("settlement_snapshot_changed");
    const dispatch = i.dispatches.find((x) => x.claim.kind === "bill");
    if (!dispatch) return c;
    const client = d.client || n3BillingClient;
    const id = await documentId(a, d, i, dispatch);
    const [detail, journal] = await Promise.all([
      outcomeRead(a, d, () => client.readBill(a, id)),
      outcomeRead(a, d, () => client.readBillJournal(a, id)),
    ]);
    const bill = value(proveBill(s, detail, journal, a, { intentId: i.id, billId: id }));
    c.bill = bill;
    if (persist && a.role === "owner" && !hasProgress(i, "bill")) {
      i = await d.store.recordProgress(
        a,
        i.id,
        i.revision,
        value(makeBillProgressEvidence(s, bill, a)),
      );
      c.intent = i;
    }
    const linked: SettlementReceipt[] = orderedSettlementReceipts(s);
    const balance = i.dispatches.find((x) => x.claim.kind === "balance_receipt");
    if (balance) linked.push(balanceReceipt(i, balance, await documentId(a, d, i, balance)));
    for (const r of linked) {
      const [rd, rj] = await Promise.all([
        outcomeRead(a, d, () => client.readReceipt(a, r.receiptId)),
        outcomeRead(a, d, () => client.readReceiptJournal(a, r.receiptId)),
      ]);
      const allocation = i.dispatches.find(
        (x) =>
          (x.claim.kind === "deposit_allocation" || x.claim.kind === "balance_allocation") &&
          x.claim.receiptId === r.receiptId,
      );
      if (allocation) {
        const proved = value(recoverAllocationEvidence(s, bill, allocation, rd, rj, a));
        c.allocations.push(proved);
        if (persist && a.role === "owner" && !hasProgress(i, "allocation", r.receiptId)) {
          i = await d.store.recordProgress(
            a,
            i.id,
            i.revision,
            value(makeReceiptProgressEvidence(s, bill, proved, a)),
          );
          c.intent = i;
        }
      } else {
        const before = value(proveReceiptBefore(s, r, rd, rj, a));
        if (before.allocations.some((x) => x.docId === bill.id))
          throw new Error("settlement_unowned_allocation");
        if (before.refundCents !== 0)
          throw new Error("settlement_excess_or_refund_requires_review");
        c.before.push(before);
        if (
          "purpose" in r &&
          persist &&
          a.role === "owner" &&
          !hasProgress(i, "balance_receipt", r.receiptId)
        ) {
          i = await d.store.recordProgress(
            a,
            i.id,
            i.revision,
            value(makeReceiptProgressEvidence(s, bill, before, a)),
          );
          c.intent = i;
        }
      }
    }
    // One bounded consistency pass, never a financial retry. Earlier receipt
    // reads must still match, followed by a final bill/detail+GL read. Any
    // change retains review instead of renewing a stale zero proof.
    let consistencyExpired = false;
    const consistentIntentId = i.id;
    const assertCurrent = () => {
      if (consistencyExpired) throw new Error("settlement_evidence_changed");
    };
    const consistent = async () => {
      for (const r of [...c.allocations, ...c.before]) {
        assertCurrent();
        const [rd, rj] = await Promise.all([
          outcomeRead(a, d, () => client.readReceipt(a, r.receipt.receiptId)),
          outcomeRead(a, d, () => client.readReceiptJournal(a, r.receipt.receiptId)),
        ]);
        const current = value(proveReceiptBefore(s, r.receipt, rd, rj, a));
        assertCurrent();
        if (billingPayloadDigest(current.fingerprints) !== billingPayloadDigest(r.fingerprints))
          throw new Error("settlement_evidence_changed");
      }
      assertCurrent();
      const [bd, bj] = await Promise.all([
        outcomeRead(a, d, () => client.readBill(a, id)),
        outcomeRead(a, d, () => client.readBillJournal(a, id)),
      ]);
      const current = value(proveBill(s, bd, bj, a, { intentId: consistentIntentId, billId: id }));
      assertCurrent();
      if (billingPayloadDigest(current) !== billingPayloadDigest(bill))
        throw new Error("settlement_evidence_changed");
      return current;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stableBill = await Promise.race([
      consistent(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          consistencyExpired = true;
          reject(new Error("settlement_evidence_changed"));
        }, 40_000);
      }),
    ]).finally(() => clearTimeout(timer));
    c.bill = stableBill;
    const owned = c.allocations.reduce((n, r) => n + r.allocatedToBillCents, 0);
    if (bill.totalCents !== s.totalCents || owned + bill.outstandingCents !== s.totalCents)
      throw new Error("settlement_conservation_mismatch");
    if (
      c.allocations.some((r) => r.remainderCents !== 0) ||
      c.before.some((r) => r.remainderCents <= 0)
    )
      throw new Error("settlement_excess_or_refund_requires_review");
    if (bill.outstandingCents === 0) {
      c.proof = value(proveSettlement(s, stableBill, c.allocations, d.now().toISOString()));
      if (persist && a.role === "owner") {
        i = await d.store.recordProof(a, i.id, i.revision, c.proof);
        c.intent = i;
      }
    }
  } catch (e) {
    c.blockers.push(code(e));
  }
  return c;
}
function view(a: SettlementActor, c: Context): SettlementView {
  const i = c.intent,
    b = c.bill;
  const v: SettlementView = {
    tenantId: a.tenantId,
    reservationId: a.reservationId,
    intentId: i?.id || null,
    snapshotDigest: i?.snapshot.digest || c.snapshot?.digest || null,
    revision: i?.revision || c.snapshot?.revision || "0",
    state: i?.state || null,
    currency: i?.snapshot.currency || c.snapshot?.currency || "MYR",
    bill: b
      ? {
          id: b.id,
          code: b.code,
          documentDate: b.documentDate,
          totalCents: b.totalCents,
          outstandingCents: b.outstandingCents,
        }
      : null,
    receipts: [...c.allocations, ...c.before].map((r) => ({
      id: r.receipt.receiptId,
      code: r.code,
      documentDate: r.receipt.receiptDate,
      amountCents: r.amountCents,
      allocatedCents: "allocatedToBillCents" in r ? Number(r.allocatedToBillCents) : 0,
      remainderCents: r.remainderCents,
    })),
    blockers: [...new Set(c.blockers)],
    allowedActions: [],
    verifiedAt: c.proof?.checkedAt || null,
  };
  if (a.role !== "owner" || v.blockers.length || i?.state === "closed") return v;
  if (!i || (!i.dispatches.length && i.state === "frozen")) {
    if (billingContractGate("bill").kind === "confirmed") v.allowedActions.push("post_bill");
    return v;
  }
  if (c.proof) {
    v.allowedActions.push("close");
    return v;
  }
  if (!b) return v;
  const deposits = c.before.filter((r) => !("purpose" in r.receipt));
  if (deposits.length) {
    if (billingContractGate("deposit_allocation").kind === "confirmed")
      v.allowedActions.push("apply_deposits");
  } else if (b.outstandingCents > 0) {
    const kind = c.before.some((r) => "purpose" in r.receipt)
      ? "balance_allocation"
      : "balance_receipt";
    if (billingContractGate(kind).kind === "confirmed")
      v.allowedActions.push(kind === "balance_allocation" ? "apply_balance" : "receive_balance");
  }
  return v;
}
export async function reconcileSettlement(
  a: SettlementActor,
  intentId: string,
  d: SettlementDeps,
): Promise<SettlementView> {
  return view(a, await inspect(a, d, intentId));
}
function acknowledgment(out: N3Outcome, kind: StepKind): DispatchOutcome {
  const status = out.kind === "response" ? out.status : undefined;
  let id: string | undefined;
  if (
    out.kind === "response" &&
    status! >= 200 &&
    status! < 300 &&
    object(out.body) &&
    out.body.code === "0000" &&
    object(out.body.data)
  ) {
    const data = out.body.data;
    const ids = Object.entries(data)
      .filter(([k]) => /^(id|key)$/i.test(k))
      .map(([, v]) => v);
    if (ids.length && ids.every((v) => uuid(v) && v === ids[0])) id = String(ids[0]).toLowerCase();
  }
  return {
    kind: "unknown",
    code:
      status === 401
        ? "n3_session_expired"
        : id
          ? "n3_acknowledged_requires_proof"
          : "n3_write_result_unknown",
    ...(id && kind !== "deposit_allocation" && kind !== "balance_allocation"
      ? { documentId: id }
      : {}),
    ...(status ? { httpStatus: status } : {}),
  };
}
export async function runSettlementStep(
  a: SettlementActor,
  input: SettlementStepInput,
  d: SettlementDeps,
): Promise<SettlementView> {
  let c: Context = {
    intent: null,
    bill: null,
    before: [],
    allocations: [],
    proof: null,
    blockers: [],
  };
  try {
    authorized(a, true);
    const entry = await d.store.read(a);
    if (entry && entry.revision !== input.expectedRevision)
      throw new Error("settlement_stale_revision");
    c = await inspect(a, d, input.intentId);
    if (c.blockers.length) return view(a, c);
    let i = c.intent;

    if (!i) {
      if (input.action !== "post_bill") throw new Error("settlement_not_found");
      const s = value(await d.snapshot(a));
      if (s.digest !== input.snapshotDigest || s.revision !== input.expectedRevision)
        throw new Error("settlement_snapshot_changed");
      value(billingContractGate("bill"));
      i = await d.store.freeze(a, s, input.clientRequestId);
      c.intent = i;
    }
    if (i.state === "closed") return view(a, c);
    if (input.action === "post_bill" && input.snapshotDigest !== i.snapshot.digest)
      throw new Error("settlement_snapshot_changed");
    if (!view(a, c).allowedActions.includes(input.action))
      throw new Error("settlement_action_unavailable");
    if (input.action === "close") {
      if (!c.proof) throw new Error("settlement_untrusted_proof");
      const stored = settlementFinalEvidenceForStore(c.proof, a, i.id);
      if (!stored) throw new Error("settlement_untrusted_proof");
      c.intent = await d.store.close(a, i.id, i.revision, String(stored.digest));
      return view(a, c);
    }
    const client = d.client || n3BillingClient;
    let facts: DispatchFacts;
    let receiptId: string | undefined;
    if (input.action === "post_bill") {
      facts = {
        kind: "bill",
        snapshotDigest: i.snapshot.digest,
        payload: buildCashSalePayload(i.snapshot, { intentId: i.id }),
      };
    } else {
      if (!c.bill) throw new Error("settlement_untrusted_proof");
      const prior =
        input.action === "apply_deposits"
          ? c.before.find((r) => !("purpose" in r.receipt))
          : c.before.find((r) => "purpose" in r.receipt);
      if (prior) {
        const kind = "purpose" in prior.receipt ? "balance_allocation" : "deposit_allocation";
        const planned = value(
          buildAllocationRows(i.snapshot, c.bill, prior, value(billingContractGate(kind))),
        );
        receiptId = prior.receipt.receiptId;
        facts = {
          kind,
          snapshotDigest: i.snapshot.digest,
          payload: planned.rows,
          billId: c.bill.id,
          receipt: prior.receipt,
          before: prior,
          expectedTotalToBillCents: planned.expectedTotalToBillCents,
          expectedAfterFingerprint: planned.expectedAfterFingerprint,
        };
      } else {
        if (
          input.action !== "receive_balance" ||
          i.dispatches.some((x) => x.claim.kind === "balance_receipt")
        )
          throw new Error("settlement_action_unavailable");
        value(billingContractGate("balance_receipt"));
        const accountResult = await verifySettlementPaymentAccount(
          i.snapshot,
          a,
          input.selectedAccountId || "",
        );
        if (accountResult.kind !== "confirmed" && accountResult.code === "unauthorized") {
          await d.invalidateSession("unauthorized");
          throw new Error("n3_session_expired");
        }
        const account = value(accountResult);
        const balance = value(buildBalanceIntent(i.snapshot, c.bill, account));
        facts = {
          kind: "balance_receipt",
          snapshotDigest: i.snapshot.digest,
          payload: buildBalanceReceiptPayload(balance.payload, { intentId: i.id }),
          input: balance.payload,
          account: { id: account.id, code: account.code, name: account.name },
        };
      }
    }
    // This is the only dispatch boundary. A lost response/lease never removes this fence.
    const claim = await d.store.claim(
      a,
      i.id,
      i.revision,
      { kind: facts.kind, receiptId, facts },
      billingPayloadDigest(facts.payload),
    );
    if (!claim) return view(a, await inspect(a, d, i.id));
    let out: N3Outcome;
    try {
      out =
        facts.kind === "bill"
          ? await client.createBill(a, claim, i.snapshot)
          : facts.kind === "balance_receipt"
            ? await client.createBalanceReceipt(a, claim, facts.input)
            : await client.writeAllocation(a, claim, facts.payload);
    } catch {
      out = { kind: "transport_error", reason: "network", durationMs: 0 };
    }
    const ack = acknowledgment(out, facts.kind);
    try {
      await d.store.recordOutcome(a, claim, ack);
    } finally {
      if (ack.httpStatus === 401) await d.invalidateSession("unauthorized");
    }
    if (ack.httpStatus === 401) {
      c.intent = await d.store.read(a);
      throw new Error("n3_session_expired");
    }
    return view(a, await inspect(a, d, i.id));
  } catch (e) {
    c.blockers.push(code(e));
    return view(a, c);
  }
}

/** Background/status GET never persists proof or dispatches. */
export async function readSettlementStatus(
  actor: SettlementActor,
  deps: SettlementDeps,
): Promise<SettlementView> {
  return view(actor, await inspect(actor, deps, undefined, false));
}
