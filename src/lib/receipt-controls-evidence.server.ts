// Server-only, read-only N3 receipt evidence for receipt controls.
// Uses only GET receipt detail and GET GL posting. Never writes to N3.
import { fieldsAgree, successfulEnvelope, valuesFor } from "./deposits-store.server";
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
  /** Immutable customer code saved at posting; binds the AR credit line. */
  n3CustomerCode?: string | null;
  /** Immutable HotelHub reference saved at creation; bound on every read. */
  n3ReferenceNo: string;
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
/**
 * No official contract proves how an N3 cancellation neutralizes the original
 * journal. Until it does, a void can never be verified as financially done;
 * it always lands in Needs review for manual accounting confirmation.
 */
export const VOID_JOURNAL_CONTRACT_PROVEN = false as boolean;

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

/**
 * Strict N3 envelope, shared with the deposit adapter: business code must be
 * the official "0000" (every case variant agreeing), any success flag must be
 * true, and data / Value wrappers in any casing must not conflict.
 */
export function unwrap(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (!successfulEnvelope(body)) return null;
  const one = (o: unknown, k: string): { ok: boolean; v: unknown } => {
    const vs = valuesFor(o, [k]);
    if (vs.some((v) => JSON.stringify(v) !== JSON.stringify(vs[0]))) return { ok: false, v: null };
    return { ok: true, v: vs.length ? vs[0] : o };
  };
  const d = one(body, "data");
  if (!d.ok) return null;
  let data = d.v;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const v = one(data, "value");
    if (!v.ok) return null;
    data = v.v;
  }
  return data;
}

function failOutcome(o: N3Outcome): never {
  if (o.kind === "response" && o.status === 401) throw new ReceiptControlError("unauthorized");
  throw new ReceiptControlError("n3_evidence_unavailable");
}

type Journal = {
  digest: string;
  /** Exact per-account debit / credit cents; null when any row is unreadable. */
  debits: Map<string, number> | null;
  credits: Map<string, number> | null;
  /** Account code per credited account id (for AR/customer binding). */
  creditCodes: Map<string, string>;
  /** Every row carries the document code and HotelHub reference it posts. */
  docRefs: Array<{ docCode: string | null; reference: string | null }>;
};

function readJournal(o: N3Outcome): Journal {
  if (o.kind !== "response" || o.status < 200 || o.status >= 300) failOutcome(o);
  const data = unwrap(o.body);
  let rows: unknown = Array.isArray(data) ? data : null;
  if (!rows && data && typeof data === "object") {
    const forms = valuesFor(data, ["details", "lines", "value"]).filter(Array.isArray);
    // Conflicting journal forms are ambiguous: fail closed.
    if (forms.length && forms.every((f) => JSON.stringify(f) === JSON.stringify(forms[0])))
      rows = forms[0];
  }
  if (!Array.isArray(rows) || rows.length === 0)
    return { digest: "unreadable", debits: null, credits: null, creditCodes: new Map(), docRefs: [] };
  let bad = false;
  const debits = new Map<string, number>();
  const credits = new Map<string, number>();
  const creditCodes = new Map<string, string>();
  const docRefs: Journal["docRefs"] = [];
  const norm: string[] = [];
  for (const row of rows) {
    const d = cents(pick(row, "debit") ?? pick(row, "debitAmount") ?? 0);
    const c = cents(pick(row, "credit") ?? pick(row, "creditAmount") ?? 0);
    const id = str(pick(row, "accountId") ?? pick(row, "glAccountId"))?.toLowerCase() ?? "";
    const code = str(pick(row, "accountCode") ?? pick(row, "glAccountCode")) ?? "";
    if (!id || d === null || c === null || d < 0 || c < 0 || d > 0 === c > 0) bad = true;
    if ((d ?? 0) > 0) debits.set(id, (debits.get(id) ?? 0) + (d ?? 0));
    if ((c ?? 0) > 0) {
      credits.set(id, (credits.get(id) ?? 0) + (c ?? 0));
      const prev = creditCodes.get(id);
      if (!code || (prev !== undefined && prev !== code)) bad = true;
      creditCodes.set(id, code);
    }
    docRefs.push({
      docCode: str(pick(row, "docCode") ?? pick(row, "docNo")),
      reference: str(pick(row, "referenceNo") ?? pick(row, "reference")),
    });
    norm.push(`${id}|${code}|${d}|${c}`);
  }
  norm.sort();
  return {
    digest: norm.join(";"),
    debits: bad ? null : debits,
    credits: bad ? null : credits,
    creditCodes,
    docRefs,
  };
}

/**
 * Exact receipt journal: payment-account debits equal the saved payment lines
 * account-for-account, one customer (AR) credit equals the receipt total, and
 * every row names this document and HotelHub reference. Balanced alone is NOT
 * enough; any unexplained line fails.
 */
export function journalMatchesReceipt(
  j: Journal,
  receipt: { amountCents: number; docCode: string; reference: string; customerCode: string | null },
  paymentLines: ReadonlyArray<{ accountId: string; amountCents: number }>,
): boolean {
  if (!j.debits || !j.credits) return false;
  const expected = new Map<string, number>();
  for (const l of paymentLines) {
    const k = l.accountId.toLowerCase();
    expected.set(k, (expected.get(k) ?? 0) + l.amountCents);
  }
  if (expected.size !== j.debits.size) return false;
  for (const [k, v] of expected) if (j.debits.get(k) !== v) return false;
  if (j.credits.size !== 1) return false;
  const [creditAccount, creditCents] = [...j.credits][0]!;
  if (expected.has(creditAccount) || creditCents !== receipt.amountCents) return false;
  // The one credit must post to THIS deposit's saved customer (AR) code.
  if (!receipt.customerCode || j.creditCodes.get(creditAccount) !== receipt.customerCode)
    return false;
  return j.docRefs.every((r) => r.docCode === receipt.docCode && r.reference === receipt.reference);
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
    reference: snap.reference ?? null,
    journalExact: snap.journalExact ?? false,
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
    (dep.n3DocCode !== null && str(pick(r, "docCode")) !== dep.n3DocCode) ||
    str(pick(r, "referenceNo")) !== dep.n3ReferenceNo ||
    (docType !== null && docType !== "AROR") ||
    str(pick(r, "customerId"))?.toLowerCase() !== dep.n3CustomerId.toLowerCase() ||
    currency !== dep.currencyCode.toUpperCase()
  )
    throw new ReceiptControlError("n3_evidence_mismatch");
  const amountCents = cents(pick(r, "totalAmount") ?? pick(r, "netTotalAmount"));
  const docCode = str(pick(r, "docCode"));
  const customerName = str(pick(r, "customerName"));
  const documentDate = (str(pick(r, "docDate")) ?? "").slice(0, 10);
  if (
    amountCents === null ||
    amountCents <= 0 ||
    !docCode ||
    !customerName ||
    !/^\d{4}-\d{2}-\d{2}$/.test(documentDate)
  )
    throw new ReceiptControlError("n3_evidence_incomplete");

  const cancelled = pick(r, "isCancelled");
  const documentState: ReceiptSnapshot["documentState"] =
    cancelled === true || str(pick(r, "cancelledDate"))
      ? "voided"
      : cancelled === false
        ? "active"
        : "unknown";
  const knockoff = pick(r, "knockoff");
  // Missing refund data is UNKNOWN, never silently zero.
  const refundRaw = pick(r, "refundAmount");
  const refund = refundRaw === undefined || refundRaw === null ? null : cents(refundRaw);
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
  if (rawLines.some((l) => !l.accountId || l.amountCents === null || l.amountCents <= 0))
    throw new ReceiptControlError("n3_evidence_incomplete");
  const lineTotal = rawLines.reduce((sum, l) => sum + (l.amountCents ?? 0), 0);
  if (!Number.isSafeInteger(lineTotal) || lineTotal !== amountCents)
    throw new ReceiptControlError("n3_evidence_mismatch");
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
    documentDate,
    reference: dep.n3ReferenceNo,
    customerId: dep.n3CustomerId,
    currency: currency!,
    amountCents,
    paymentLines,
    contact,
    journalExact: journalMatchesReceipt(
      journal,
      {
        amountCents,
        docCode,
        reference: dep.n3ReferenceNo,
        customerCode: dep.n3CustomerCode ?? null,
      },
      paymentLines,
    ),
    // A journal that is not the exact receipt posting is not evidence.
    documentState,
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
    evidence.currency !== original.currency ||
    evidence.docCode !== original.docCode ||
    evidence.documentDate !== original.documentDate ||
    (evidence.reference ?? null) !== (original.reference ?? null)
  )
    return "mismatch";
  if (proposal.kind === "void") {
    if (evidence.documentState === "active") return "mismatch";
    // Cancellation flag alone is not proof the journal was neutralized.
    if (!VOID_JOURNAL_CONTRACT_PROVEN) return "insufficient";
    return evidence.documentState === "voided" ? "verified" : "insufficient";
  }
  if (evidence.documentState === "voided") return "mismatch";
  if (
    evidence.documentState === "unknown" ||
    evidence.matchingState === "unknown" ||
    evidence.journalExact !== true
  )
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
