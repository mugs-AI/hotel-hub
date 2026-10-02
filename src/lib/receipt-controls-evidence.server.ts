// Server-only, read-only N3 receipt evidence for receipt controls.
// Uses only GET receipt detail and GET GL posting. Never writes to N3.
import { createHash } from "node:crypto";
import type { N3Outcome, N3ReceiptsClient } from "./n3-receipts.server";
import type { HotelRole } from "./rbac";
import {
  ReceiptControlError,
  type ReceiptControlProposal,
  type ReceiptSnapshot,
} from "./receipt-controls";

export type ReceiptControlActor = {
  tenantId: string;
  n3UserKey: string;
  n3Token: string;
  role: HotelRole;
};

export type ScopedDeposit = {
  id: string;
  reservationId: string;
  status: string;
  n3ReceiptId: string | null;
  n3DocCode: string | null;
  n3CustomerId: string | null;
  currencyCode: string;
  paymentLines: Array<{ id: string; code: string; name: string; amount: number }>;
};

export type EvidenceDeps = {
  loadDeposit(tenantId: string, depositId: string): Promise<ScopedDeposit | null>;
  n3: Pick<N3ReceiptsClient, "getById" | "getGLPosting">;
  now?: () => string;
};

/**
 * Automated modes stay off. The official document lists Update/Void paths, but
 * their journal, concurrency and idempotency semantics are unproven
 * (docs/HH_RECEIPT_CONTROL_N3_CONTRACT.md). Environment flags are deliberately
 * ignored until a reviewed change records proof and wires them here.
 */
export function receiptControlCapabilities(): {
  directEdit: boolean;
  voidReplace: boolean;
  manual: true;
} {
  const contractProven = false as boolean;
  return {
    directEdit: contractProven && process.env.HOTELHUB_RECEIPT_CONTROL_DIRECT_EDIT === "true",
    voidReplace: contractProven && process.env.HOTELHUB_RECEIPT_CONTROL_VOID_REPLACE === "true",
    manual: true,
  };
}

const pick = (o: unknown, k: string): unknown =>
  o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
function cents(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  return Number.isSafeInteger(c) && Math.abs(c - n * 100) < 1e-6 ? c : null;
}

function unwrap(body: unknown): unknown {
  if (!body || typeof body !== "object") return null;
  const code = pick(body, "code");
  if (code !== undefined && code !== 0 && code !== "0" && code !== 200) return null;
  if (pick(body, "success") === false) return null;
  let data = "data" in (body as object) ? pick(body, "data") : body;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data;
}

function failOutcome(o: N3Outcome): never {
  if (o.kind === "response" && o.status === 401) throw new ReceiptControlError("unauthorized");
  throw new ReceiptControlError("n3_evidence_unavailable");
}

type Journal = { digest: string; balancedCents: number | null; debits: Map<string, number> };

function readJournal(o: N3Outcome): Journal {
  if (o.kind !== "response" || o.status < 200 || o.status >= 300) failOutcome(o);
  const data = unwrap(o.body);
  const rows = Array.isArray(data) ? data : (pick(data, "details") ?? pick(data, "lines"));
  if (!Array.isArray(rows)) return { digest: "unreadable", balancedCents: null, debits: new Map() };
  let dr = 0,
    cr = 0,
    bad = false;
  const debits = new Map<string, number>();
  const norm: string[] = [];
  for (const row of rows) {
    const d = cents(pick(row, "debit") ?? pick(row, "debitAmount") ?? 0);
    const c = cents(pick(row, "credit") ?? pick(row, "creditAmount") ?? 0);
    const id = str(pick(row, "accountId") ?? pick(row, "glAccountId"))?.toLowerCase() ?? "";
    const code = str(pick(row, "accountCode") ?? pick(row, "glAccountCode")) ?? "";
    if (d === null || c === null || d < 0 || c < 0 || d > 0 === c > 0) bad = true;
    dr += d ?? 0;
    cr += c ?? 0;
    if ((d ?? 0) > 0 && id) debits.set(id, (debits.get(id) ?? 0) + (d ?? 0));
    norm.push(`${id}|${code}|${d}|${c}`);
  }
  norm.sort();
  return {
    digest: norm.join(";"),
    balancedCents: !bad && dr === cr && dr > 0 ? dr : null,
    debits,
  };
}

export function receiptFingerprint(snap: ReceiptSnapshot, journalDigest: string): string {
  const stable = {
    receiptId: snap.receiptId.toLowerCase(),
    docCode: snap.docCode,
    documentDate: snap.documentDate,
    customerId: snap.customerId.toLowerCase(),
    currency: snap.currency,
    amountCents: snap.amountCents,
    paymentLines: snap.paymentLines.map((l) => [l.accountId.toLowerCase(), l.amountCents]),
    contact: snap.contact,
    documentState: snap.documentState,
    matchingState: snap.matchingState,
    journal: journalDigest,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/** Read and normalize one deposit's current N3 receipt. GET-only. */
export async function readReceiptControlEvidence(
  actor: ReceiptControlActor,
  depositId: string,
  deps: EvidenceDeps,
): Promise<ReceiptSnapshot> {
  const dep = await deps.loadDeposit(actor.tenantId, depositId);
  if (!dep) throw new ReceiptControlError("deposit_not_found");
  if (dep.status !== "posted" || !dep.n3ReceiptId || !dep.n3CustomerId)
    throw new ReceiptControlError("deposit_not_controllable");
  const detail = await deps.n3.getById(actor.n3Token, dep.n3ReceiptId);
  if (detail.kind !== "response" || detail.status < 200 || detail.status >= 300)
    failOutcome(detail);
  const r = unwrap(detail.body);
  if (!r || typeof r !== "object") throw new ReceiptControlError("n3_evidence_unavailable");
  const id = str(pick(r, "id"));
  const docType = str(pick(r, "docType"));
  const currency = (
    str(pick(r, "currencyCode")) ?? str(pick(pick(r, "currency"), "code"))
  )?.toUpperCase();
  if (
    id?.toLowerCase() !== dep.n3ReceiptId.toLowerCase() ||
    (docType !== null && docType !== "AROR") ||
    str(pick(r, "customerId"))?.toLowerCase() !== dep.n3CustomerId.toLowerCase() ||
    currency !== dep.currencyCode.toUpperCase()
  )
    throw new ReceiptControlError("n3_evidence_mismatch");
  const amountCents = cents(pick(r, "totalAmount") ?? pick(r, "netTotalAmount"));
  const docCode = str(pick(r, "docCode"));
  const customerName = str(pick(r, "customerName"));
  if (amountCents === null || !docCode || !customerName)
    throw new ReceiptControlError("n3_evidence_incomplete");

  const cancelled = pick(r, "isCancelled");
  const documentState: ReceiptSnapshot["documentState"] =
    cancelled === true || str(pick(r, "cancelledDate"))
      ? "voided"
      : cancelled === false
        ? "active"
        : "unknown";
  const knockoff = pick(r, "knockoff");
  const refund = cents(pick(r, "refundAmount") ?? 0);
  const outstanding = cents(pick(r, "outstandingAmount"));
  const matchingState: ReceiptSnapshot["matchingState"] =
    refund !== null && refund > 0
      ? "refunded"
      : Array.isArray(knockoff) && knockoff.length > 0
        ? "matched"
        : Array.isArray(knockoff) && refund === 0 && outstanding === amountCents
          ? "unmatched"
          : "unknown";

  const saved = new Map(dep.paymentLines.map((l) => [l.id.toLowerCase(), l]));
  const multi = pick(r, "multiPayments");
  const rawLines: Array<{ accountId: string; code: string; amountCents: number | null }> =
    pick(r, "isMultiPayment") === true && Array.isArray(multi)
      ? multi.map((m) => ({
          accountId: str(pick(m, "accountId")) ?? "",
          code: str(pick(m, "accountCode")) ?? "",
          amountCents: cents(pick(m, "amount")),
        }))
      : [
          {
            accountId: str(pick(r, "accountId")) ?? "",
            code: str(pick(r, "accountCode")) ?? "",
            amountCents,
          },
        ];
  if (rawLines.some((l) => !l.accountId || l.amountCents === null))
    throw new ReceiptControlError("n3_evidence_incomplete");
  const paymentLines = rawLines.map((l) => {
    const s = saved.get(l.accountId.toLowerCase());
    return {
      accountId: l.accountId,
      code: l.code || s?.code || "",
      savedName: s?.name ?? l.code,
      amountCents: l.amountCents as number,
    };
  });
  const journal = readJournal(await deps.n3.getGLPosting(actor.n3Token, dep.n3ReceiptId));
  const contact = {
    customerName,
    remark1: str(pick(r, "remark1")) ?? "",
    remark2: str(pick(r, "remark2")) ?? "",
    remark3: str(pick(r, "remark3")) ?? "",
    remark4: str(pick(r, "remark4")) ?? "",
  };
  const snap: ReceiptSnapshot = {
    receiptId: id!,
    docCode,
    documentDate: (str(pick(r, "docDate")) ?? "").slice(0, 10),
    customerId: dep.n3CustomerId,
    currency: currency!,
    amountCents,
    paymentLines,
    contact,
    // A journal that does not balance to the receipt amount is not evidence.
    documentState:
      documentState === "active" && journal.balancedCents !== amountCents
        ? "unknown"
        : documentState,
    matchingState,
    sourceFingerprint: "",
    verifiedAt: (deps.now ?? (() => new Date().toISOString()))(),
  };
  snap.sourceFingerprint = receiptFingerprint(snap, journal.digest);
  return snap;
}

/**
 * Compare post-change evidence with the approved proposal. Absence (null) is
 * never proof; unknown states are insufficient; anything else unexpected is
 * a mismatch that must be held for Owner review.
 */
export function verifyReceiptControlResult(
  original: ReceiptSnapshot,
  proposal: ReceiptControlProposal,
  evidence: ReceiptSnapshot | null,
): "verified" | "mismatch" | "insufficient" {
  if (!evidence) return "insufficient";
  if (
    evidence.receiptId.toLowerCase() !== original.receiptId.toLowerCase() ||
    evidence.customerId.toLowerCase() !== original.customerId.toLowerCase() ||
    evidence.currency !== original.currency
  )
    return "mismatch";
  if (proposal.kind === "void") {
    if (evidence.documentState === "voided") return "verified";
    return evidence.documentState === "unknown" ? "insufficient" : "mismatch";
  }
  if (evidence.documentState === "voided") return "mismatch";
  if (evidence.documentState === "unknown" || evidence.matchingState === "unknown")
    return "insufficient";
  if (evidence.matchingState !== "unmatched") return "mismatch";
  const line = evidence.paymentLines;
  const same =
    evidence.amountCents === proposal.amountCents &&
    line.length === 1 &&
    line[0]!.accountId.toLowerCase() === proposal.accountId.toLowerCase() &&
    line[0]!.amountCents === proposal.amountCents &&
    (Object.keys(proposal.contact) as Array<keyof typeof proposal.contact>).every(
      (k) => evidence.contact[k] === proposal.contact[k],
    );
  return same ? "verified" : "mismatch";
}
