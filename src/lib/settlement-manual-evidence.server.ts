import type { EvidenceResult } from "./settlement";
import type { SettlementActor } from "./settlement-context.server";
import type { StoredIntent } from "./settlement-dispatch.server";
import {
  verifiedBillActorMatches,
  verifiedReceiptActorMatches,
  verifiedBillReadAt,
  verifiedReceiptReadAt,
  type VerifiedBill,
  type VerifiedReceiptBefore,
} from "./settlement-evidence.server";
import { persistedIntentBoundTo, persistedDispatchBoundTo } from "./settlement-store.server";
import { billingPayloadDigest } from "./n3-billing.server";
import { MAX_MONEY_CENTS } from "./checkout-money";

declare const externalMatchBrand: unique symbol;
// This is evidence of matching done in N3, not allocation authority or a close proof.
export type ExternalMatchProof = {
  readonly [externalMatchBrand]: true;
  tenantId: string;
  reservationId: string;
  intentId: string;
  intentRevision: string;
  snapshotDigest: string;
  provenance: "external_n3_matching";
  billId: string;
  billOutstandingCents: number;
  matches: Array<{ receiptId: string; billId: string; amountCents: number }>;
  receiptObservations: Array<{ receiptId: string; refundCents: number; remainderCents: number }>;
  evidenceFingerprints: string[];
  checkedAt: string;
  observationDigest: string;
  digest: string;
};
export type ExternalMatchReads = { bill: VerifiedBill; receipts: VerifiedReceiptBefore[] };
const proofs = new WeakMap<
  ExternalMatchProof,
  {
    actor: SettlementActor;
    intent: StoredIntent;
    reads: ExternalMatchReads;
  }
>();
const unavailable = (code: string): EvidenceResult<never> => ({ kind: "unavailable", code });
const contradiction = (code: string): EvidenceResult<never> => ({ kind: "contradiction", code });
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
}
function trusted(a: SettlementActor, i: StoredIntent, reads: ExternalMatchReads): boolean {
  return (
    ["owner", "front_desk"].includes(a.role) &&
    persistedIntentBoundTo(i, a) &&
    verifiedBillActorMatches(reads.bill, i.snapshot, a) &&
    reads.receipts.every((r) => verifiedReceiptActorMatches(r, i.snapshot, a))
  );
}
export function proveExternalMatching(
  actor: SettlementActor,
  intent: StoredIntent,
  reads: ExternalMatchReads,
): EvidenceResult<ExternalMatchProof> {
  try {
    if (!trusted(actor, intent, reads)) return unavailable("n3_evidence_untrusted");
    const s = intent.snapshot,
      b = reads.bill;
    if (b.intentId !== intent.id || b.totalCents !== s.totalCents)
      return contradiction("settlement_scope_mismatch");
    const billDispatch = intent.dispatches.find(
      (d) =>
        d.claim.kind === "bill" &&
        persistedDispatchBoundTo(d, actor, intent.id, s.digest) &&
        d.outcome?.kind === "confirmed" &&
        d.outcome.documentId?.toLowerCase() === b.id,
    );
    if (!billDispatch) return unavailable("settlement_bill_identity_unavailable");
    if (intent.dispatches.some((d) => d.outcome === null || d.outcome.kind === "unknown"))
      return unavailable("settlement_pending_financial_operation");
    if (b.outstandingCents !== 0) return contradiction("settlement_guest_bill_unpaid");
    const seen = new Set<string>();
    const matches: ExternalMatchProof["matches"] = [];
    let total = 0;
    for (const r of reads.receipts) {
      const rid = r.receipt.receiptId.toLowerCase();
      if (seen.has(rid)) return contradiction("settlement_receipt_duplicate");
      seen.add(rid);
      // Deposit ownership comes from the saved snapshot. A created balance receipt
      // additionally needs its exact saved creation, never just a shared customer.
      if ("purpose" in r.receipt) {
        if (
          r.receipt.intentId !== intent.id ||
          !intent.dispatches.some(
            (d) =>
              d.claim.kind === "balance_receipt" &&
              persistedDispatchBoundTo(d, actor, intent.id, s.digest) &&
              d.outcome?.kind === "confirmed" &&
              d.outcome.documentId?.toLowerCase() === rid,
          )
        )
          return contradiction("receipt_scope_mismatch");
      } else if (
        !s.receipts.some((x) => billingPayloadDigest(x) === billingPayloadDigest(r.receipt))
      )
        return contradiction("receipt_scope_mismatch");
      const target = r.allocations.find(
        (x) => x.docType === b.targetType && x.docId === b.targetId,
      );
      if (!target || target.amountCents <= 0) return contradiction("receipt_allocation_mismatch");
      total += target.amountCents;
      if (!Number.isSafeInteger(total) || total > MAX_MONEY_CENTS)
        return contradiction("settlement_conservation_mismatch");
      matches.push({ receiptId: rid, billId: b.id, amountCents: target.amountCents });
    }
    if (s.receipts.some((r) => !seen.has(r.receiptId.toLowerCase())))
      return unavailable("settlement_receipt_missing");
    if (total !== b.totalCents) return contradiction("settlement_conservation_mismatch");
    const times = [
      verifiedBillReadAt(b, s, actor),
      ...reads.receipts.map((r) => verifiedReceiptReadAt(r, s, actor)),
    ];
    if (times.some((t) => t === null)) return unavailable("n3_evidence_untrusted");
    const facts = {
      tenantId: actor.tenantId,
      reservationId: actor.reservationId,
      intentId: intent.id,
      intentRevision: intent.revision,
      snapshotDigest: s.digest,
      provenance: "external_n3_matching" as const,
      billId: b.id,
      billOutstandingCents: 0,
      matches: matches.sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
      receiptObservations: reads.receipts
        .map((r) => ({
          receiptId: r.receipt.receiptId,
          refundCents: r.refundCents,
          remainderCents: r.remainderCents,
        }))
        .sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
      evidenceFingerprints: [
        ...b.fingerprints,
        ...reads.receipts.flatMap((r) => r.fingerprints),
      ].sort(),
      checkedAt: new Date(Math.min(...(times as number[]))).toISOString(),
    };
    const stableFacts = {
      tenantId: facts.tenantId,
      reservationId: facts.reservationId,
      intentId: facts.intentId,
      snapshotDigest: facts.snapshotDigest,
      billId: facts.billId,
      billOutstandingCents: facts.billOutstandingCents,
      matches: facts.matches,
      receiptObservations: facts.receiptObservations,
      evidenceFingerprints: facts.evidenceFingerprints,
    };
    const sealed = { ...facts, observationDigest: billingPayloadDigest(stableFacts) };
    const proof = freeze({ ...sealed, digest: billingPayloadDigest(sealed) }) as ExternalMatchProof;
    proofs.set(proof, {
      actor: { ...actor },
      intent,
      reads: { bill: b, receipts: [...reads.receipts] },
    });
    return { kind: "confirmed", value: proof };
  } catch {
    return unavailable("n3_external_matching_unavailable");
  }
}
export function externalMatchEvidenceForStore(
  proof: ExternalMatchProof,
  actor: SettlementActor,
  intent: StoredIntent,
): Record<string, unknown> | null {
  try {
    const m = proofs.get(proof);
    if (
      !m ||
      m.intent !== intent ||
      m.actor.n3Token !== actor.n3Token ||
      m.actor.n3UserKey !== actor.n3UserKey ||
      !trusted(actor, intent, m.reads)
    )
      return null;
    return JSON.parse(JSON.stringify(proof)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
