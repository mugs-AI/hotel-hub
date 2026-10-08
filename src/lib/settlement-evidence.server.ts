import type { EvidenceResult, SettlementSnapshot, LinkedReceipt, ChargeLine } from "./settlement";
import type {
  SettlementActor,
  SettlementProof,
  SettlementProgressProof,
} from "./settlement-context.server";
import type { N3Outcome } from "./n3-receipts.server";
import {
  billingDocumentBoundTo,
  billingJournalBoundTo,
  billingReceiptBoundTo,
  billingReceiptJournalBoundTo,
  billingPayloadDigest,
  buildCashSalePayload,
  billingAuthenticatedReadAt,
} from "./n3-billing.server";
import { billingContractGate } from "./settlement-contracts.server";
import { verifyReceiptDetail, verifyReceiptJournal } from "./deposits-store.server";
import { formatReceiptContact } from "./receipt-contact";
import { MAX_MONEY_CENTS } from "./checkout-money";
import { receiptRemainder } from "./settlement-money";
import { persistedDispatchBoundTo } from "./settlement-store.server";
import type { StoredDispatch } from "./settlement-dispatch.server";

export type SettlementReceipt =
  | LinkedReceipt
  | (Omit<LinkedReceipt, "depositId"> & { purpose: "settlement"; intentId: string });
export type BillContext = { intentId: string; billId: string };
export type VerifiedBill = {
  id: string;
  intentId: string;
  targetId: string;
  targetType: "INV";
  totalCents: number;
  outstandingCents: number;
  documentDate: string;
  code: string;
  fingerprints: string[];
};
export type VerifiedReceiptBefore = {
  receipt: SettlementReceipt;
  code: string;
  amountCents: number;
  refundCents: number;
  remainderCents: number;
  allocations: AllocationEvidence[];
  fingerprints: string[];
  immutableHeaderFingerprint: string;
};
export type AllocationEvidence = {
  docType: "INV" | "DN";
  docId: string;
  amountCents: number;
  source: Record<string, unknown>;
};
export type VerifiedAllocation = VerifiedReceiptBefore & {
  billId: string;
  intentId: string;
  allocatedToBillCents: number;
  beforeFingerprints: string[];
};
type Meta = {
  verifiedAt: number;
  tenantId: string;
  reservationId: string;
  user: string;
  token: string;
  snapshotHash: string;
  snapshotDigest: string;
  intentId?: string;
};
const bills = new WeakMap<object, Meta>(),
  receipts = new WeakMap<object, Meta>(),
  allocations = new WeakMap<object, Meta>(),
  proofs = new WeakMap<object, Meta>();
class EvidenceError extends Error {
  constructor(
    readonly kind: "unavailable" | "contradiction",
    readonly code: string,
  ) {
    super(code);
  }
}
function missing(code: string): never {
  throw new EvidenceError("unavailable", code);
}
function mismatch(code: string): never {
  throw new EvidenceError("contradiction", code);
}
function attempt<T>(fn: () => T): EvidenceResult<T> {
  try {
    return { kind: "confirmed", value: fn() };
  } catch (e) {
    return e instanceof EvidenceError
      ? { kind: e.kind, code: e.code }
      : { kind: "unavailable", code: "n3_evidence_unreadable" };
  }
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) missing("n3_evidence_incomplete");
  return v as Record<string, unknown>;
}
function aliases(o: unknown, keys: string[]): unknown[] {
  const r = object(o),
    set = new Set(keys.map((k) => k.toLowerCase()));
  return Object.entries(r)
    .filter(([k]) => set.has(k.toLowerCase()))
    .map(([, v]) => v);
}
function same(
  values: unknown[],
  normalize: (v: unknown) => unknown = (v) => v,
  required = true,
): unknown {
  if (!values.length) {
    if (required) missing("n3_evidence_incomplete");
    return undefined;
  }
  const normalized = values.map(normalize),
    first = billingPayloadDigest(normalized[0]);
  if (normalized.some((v) => billingPayloadDigest(v) !== first))
    mismatch("n3_evidence_alias_conflict");
  return normalized[0];
}
const field = (o: unknown, keys: string[], normalize?: (v: unknown) => unknown, required = true) =>
  same(aliases(o, keys), normalize, required);
const string = (v: unknown): string => {
  if (typeof v !== "string" || !v.trim()) mismatch("n3_evidence_field_invalid");
  return v.trim();
};
const id = (v: unknown): string => {
  const s = string(v).toLowerCase();
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s) ||
    /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(s)
  )
    mismatch("n3_evidence_id_invalid");
  return s;
};
const master = (v: unknown): number => {
  const s = typeof v === "number" ? String(v) : string(v);
  if (!/^[1-9]\d*$/.test(s) || Number(s) > 2147483647) mismatch("n3_evidence_master_invalid");
  return Number(s);
};
const cents = (v: unknown): number => {
  const s = typeof v === "number" ? String(v) : string(v);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) mismatch("n3_evidence_money_invalid");
  const [units, frac = ""] = s.split(".");
  const c = Number(units) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(c) || c > MAX_MONEY_CENTS) mismatch("n3_evidence_money_invalid");
  return c;
};
const day = (v: unknown): string => {
  const s = string(v);
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s.slice(0, 10)).toISOString().slice(0, 10) !== s.slice(0, 10)
  )
    mismatch("n3_evidence_date_invalid");
  return s.slice(0, 10);
};
const number = (v: unknown): number => {
  if (typeof v !== "number" && typeof v !== "string") mismatch("n3_evidence_number_invalid");
  const n = Number(v);
  if (!Number.isFinite(n)) mismatch("n3_evidence_number_invalid");
  return n;
};
function assertEqual(a: unknown, b: unknown, code = "n3_evidence_mismatch") {
  if (a !== b) mismatch(code);
}
function nested(
  o: unknown,
  top: string[],
  parent: string[],
  child: string[],
  normalize: (v: unknown) => unknown,
  required = true,
): unknown {
  const values = aliases(o, top);
  for (const p of aliases(o, parent)) {
    if (p === null) mismatch("n3_evidence_alias_conflict");
    values.push(...aliases(p, child));
  }
  return same(values, normalize, required);
}
function unwrap(out: N3Outcome): unknown {
  if (out.kind !== "response") missing("n3_evidence_unavailable");
  if (out.status === 401) missing("unauthorized");
  if (out.status < 200 || out.status >= 300) missing("n3_evidence_unavailable");
  const body = object(out.body);
  assertEqual(field(body, ["code"], string), "0000", "n3_business_result_uncertain");
  for (const v of aliases(body, ["success", "isSuccess"]))
    assertEqual(v, true, "n3_business_result_uncertain");
  let data = field(body, ["data"]);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const wraps = aliases(data, ["value"]);
    if (wraps.length) data = same(wraps);
  }
  return data;
}
function active(o: unknown) {
  assertEqual(field(o, ["isCancelled", "isCanceled", "isVoided"]), false, "n3_document_inactive");
  for (const v of aliases(o, ["cancelledDate", "canceledDate", "voidedDate"]))
    if (v !== null && v !== "") mismatch("n3_document_inactive");
  for (const v of aliases(o, ["documentStatus", "status"]))
    if (v !== null && /^(void|voided|cancelled|canceled)$/i.test(String(v)))
      mismatch("n3_document_inactive");
}
function metadata(s: SettlementSnapshot, a: SettlementActor, intentId?: string): Meta {
  if (s.tenantId !== a.tenantId || s.reservationId !== a.reservationId)
    mismatch("settlement_scope_mismatch");
  if (!["owner", "front_desk"].includes(a.role) || !a.n3Token || !a.n3UserKey) missing("forbidden");
  return {
    verifiedAt: Date.now(),
    tenantId: a.tenantId,
    reservationId: a.reservationId,
    user: a.n3UserKey,
    token: a.n3Token,
    snapshotHash: billingPayloadDigest(s),
    snapshotDigest: s.digest,
    ...(intentId ? { intentId } : {}),
  };
}
function bound(m: Meta | undefined, s: SettlementSnapshot, a?: SettlementActor): boolean {
  return Boolean(
    m &&
    Date.now() >= m.verifiedAt &&
    Date.now() - m.verifiedAt <= 60_000 &&
    m.tenantId === s.tenantId &&
    m.reservationId === s.reservationId &&
    m.snapshotHash === billingPayloadDigest(s) &&
    (!a ||
      (m.user === a.n3UserKey &&
        m.token === a.n3Token &&
        m.tenantId === a.tenantId &&
        m.reservationId === a.reservationId)),
  );
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v;
}
function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
type Account = { id: string; code: string };
function mapping(l: ChargeLine, prefix: "ar" | "sales" | "tax"): Account {
  const m = l.mappingEvidence;
  if (!m || !m[prefix + "AccountId"] || !m[prefix + "AccountCode"])
    missing("n3_journal_mapping_unverified");
  return { id: id(m[prefix + "AccountId"]), code: string(m[prefix + "AccountCode"]) };
}
function arMapping(s: SettlementSnapshot): Account {
  if (!s.lines.length) missing("n3_journal_mapping_unverified");
  const ar = mapping(s.lines[0], "ar");
  for (const l of s.lines) {
    const a = mapping(l, "ar");
    assertEqual(a.id, ar.id);
    assertEqual(a.code, ar.code);
  }
  return ar;
}
function commonHeader(
  d: unknown,
  s: SettlementSnapshot,
  expected: { id: string; date: string; reference: string; total: number; docType: string },
) {
  active(d);
  assertEqual(field(d, ["id"], id), expected.id.toLowerCase());
  assertEqual(field(d, ["docType"], string), expected.docType);
  assertEqual(field(d, ["docDate"], day), expected.date);
  assertEqual(field(d, ["referenceNo", "reference"], string), expected.reference);
  assertEqual(nested(d, ["customerId"], ["customer"], ["id"], master), s.customerId);
  assertEqual(nested(d, ["currencyId"], ["currency"], ["id"], master), s.currencyId);
  assertEqual(
    nested(d, ["currencyCode"], ["currency"], ["code"], (v) => string(v).toUpperCase()),
    s.currency,
  );
  assertEqual(field(d, ["currencyRate"], number), s.currencyRate);
  if (s.currencyRate !== 1) missing("foreign_currency_settlement_unverified");
  assertEqual(field(d, ["totalAmount", "netTotalAmount"], cents), expected.total);
  for (const key of ["totalAmountLocal", "netTotalAmountLocal"])
    for (const value of aliases(d, [key])) assertEqual(cents(value), expected.total);
  return string(field(d, ["docCode", "docNo"], string));
}
function journalRows(out: N3Outcome): unknown[] {
  const d = unwrap(out);
  const rows = Array.isArray(d) ? d : field(d, ["details", "lines", "value"]);
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000) missing("n3_journal_incomplete");
  return rows;
}
type Posting = { account: Account; debit: number; credit: number };
function journalExact(
  out: N3Outcome,
  s: SettlementSnapshot,
  expected: Posting[],
  doc: { code: string; reference: string; date: string },
): void {
  const actual = new Map<string, { debit: number; credit: number }>(),
    want = new Map<string, { debit: number; credit: number }>();
  for (const p of expected) {
    const k = p.account.id + "|" + p.account.code;
    const old = want.get(k) ?? { debit: 0, credit: 0 };
    old.debit += p.debit;
    old.credit += p.credit;
    want.set(k, old);
  }
  for (const r of journalRows(out)) {
    active(r);
    const accountId = nested(
        r,
        ["accountId", "glAccountId"],
        ["account", "accountCodeLookup"],
        ["id"],
        id,
      ),
      accountCode = nested(
        r,
        ["accountCode", "glAccountCode"],
        ["account", "accountCodeLookup"],
        ["code"],
        string,
      );
    const debit = field(r, ["debit", "debitAmount"], cents) as number,
      credit = field(r, ["credit", "creditAmount"], cents) as number;
    if (debit > 0 === credit > 0) mismatch("n3_journal_extra_or_invalid_row");
    const codes = aliases(r, ["docCode", "docNo"]);
    if (!codes.length) missing("n3_journal_document_missing");
    same(codes, (v) => (v === null ? null : string(v)));
    for (const c of codes) if (c !== null) assertEqual(string(c), doc.code);
    assertEqual(field(r, ["referenceNo", "reference"], string), doc.reference);
    assertEqual(field(r, ["docDate"], day), doc.date);
    assertEqual(nested(r, ["currencyId"], ["currency"], ["id"], master), s.currencyId);
    assertEqual(field(r, ["currencyRate"], number), s.currencyRate);
    const customers = aliases(r, ["customerId"]);
    for (const c of customers) if (c !== null) assertEqual(master(c), s.customerId);
    for (const alias of [
      ["debitLocal", debit],
      ["creditLocal", credit],
    ] as const) {
      const values = aliases(r, [alias[0]]);
      for (const v of values) assertEqual(cents(v), alias[1]);
    }
    const k = accountId + "|" + accountCode;
    if (!want.has(k)) mismatch("n3_journal_account_mismatch");
    const a = actual.get(k) ?? { debit: 0, credit: 0 };
    a.debit += debit;
    a.credit += credit;
    if (a.debit > MAX_MONEY_CENTS || a.credit > MAX_MONEY_CENTS)
      mismatch("n3_journal_amount_mismatch");
    actual.set(k, a);
  }
  if (actual.size !== want.size) mismatch("n3_journal_amount_mismatch");
  for (const [k, w] of want) {
    const a = actual.get(k);
    if (!a || a.debit !== w.debit || a.credit !== w.credit) mismatch("n3_journal_amount_mismatch");
  }
  const ds = [...actual.values()].reduce((n, a) => n + a.debit, 0),
    cs = [...actual.values()].reduce((n, a) => n + a.credit, 0);
  if (ds !== cs) mismatch("n3_journal_unbalanced");
}
export function proveBill(
  s: SettlementSnapshot,
  d: N3Outcome,
  j: N3Outcome,
  a: SettlementActor,
  c?: BillContext,
): EvidenceResult<VerifiedBill> {
  return attempt(() => {
    const meta = metadata(s, a, c?.intentId);
    if (!c) missing("settlement_intent_identity_unavailable");
    id(c.intentId);
    id(c.billId);
    if (!billingDocumentBoundTo(d, a, c.billId) || !billingJournalBoundTo(j, a, c.billId))
      missing("n3_evidence_untrusted");
    const contract = billingContractGate("bill");
    if (
      contract.kind !== "confirmed" ||
      contract.value.operation !== "bill" ||
      contract.value.billTarget !== "same_id_INV" ||
      !/^[a-f0-9]{64}$/.test(contract.value.evidenceHash)
    )
      missing("n3_bill_inv_relationship_unverified");
    const detail = object(unwrap(d));
    const code = commonHeader(detail, s, {
      id: c.billId,
      date: s.billDate,
      reference: "HH-B-" + c.intentId.replace(/-/g, "").toLowerCase(),
      total: s.totalCents,
      docType: "CS",
    });
    const expectedContact = buildCashSalePayload(s, { intentId: c.intentId });
    for (const key of ["customerName", "customerPhone", "email", "address1", "address2"]) {
      const expected = expectedContact[key] as string;
      const observed = field(
        detail,
        [key],
        (v) => {
          if (v === null && expected === "") return "";
          if (typeof v !== "string") mismatch("n3_bill_contact_mismatch");
          return v;
        },
        expected !== "",
      );
      if (observed !== undefined) assertEqual(observed, expected, "n3_bill_contact_mismatch");
    }
    assertEqual(field(detail, ["isPostToAR"]), true);
    for (const key of ["roundingAdjustment", "bankChargesAmount"])
      for (const v of aliases(detail, [key])) assertEqual(cents(v), 0);
    for (const v of aliases(detail, ["accountId"]))
      if (v !== null) mismatch("n3_bill_embedded_payment");
    for (const v of aliases(detail, ["isMultiPayment"])) assertEqual(v, false);
    for (const v of aliases(detail, ["multiPayments", "paymentInfoItems"]))
      if (!Array.isArray(v) || v.length) mismatch("n3_bill_embedded_payment");
    assertEqual(
      field(detail, ["subtotalAmount"], cents),
      s.lines.reduce((n, l) => n + l.subtotalCents, 0),
    );
    assertEqual(
      field(detail, ["taxTotalAmount"], cents),
      s.lines.reduce((n, l) => n + l.taxCents, 0),
    );
    const lines = field(detail, ["itemDetails"]);
    if (!Array.isArray(lines) || lines.length !== s.lines.length)
      mismatch("n3_bill_lines_mismatch");
    const positions = new Set<number>();
    for (const l of lines) {
      const pos = field(l, ["pos"], master) as number;
      if (positions.has(pos) || pos > s.lines.length) mismatch("n3_bill_lines_mismatch");
      positions.add(pos);
      const e = s.lines[pos - 1];
      for (const key of ["stockId", "uomId", "taxCodeId"] as const)
        assertEqual(nested(l, [key], [key.slice(0, -2)], ["id"], master), e[key]);
      assertEqual(field(l, ["qty"], number), e.qty);
      assertEqual(field(l, ["description"], string), e.description);
      for (const [key, v] of [
        ["unitPrice", e.unitCents],
        ["amount", e.subtotalCents],
        ["taxAmount", e.taxCents],
        ["netAmount", e.totalCents],
      ] as const)
        assertEqual(field(l, [key], cents), v);
    }
    const ar = arMapping(s),
      posting: Posting[] = [{ account: ar, debit: s.totalCents, credit: 0 }];
    for (const l of s.lines) {
      const sales = mapping(l, "sales");
      if (sales.id === ar.id) mismatch("n3_journal_mapping_conflict");
      if (l.subtotalCents) posting.push({ account: sales, debit: 0, credit: l.subtotalCents });
      if (l.taxCents) {
        const tax = mapping(l, "tax");
        if (tax.id === ar.id) mismatch("n3_journal_mapping_conflict");
        posting.push({ account: tax, debit: 0, credit: l.taxCents });
      }
    }
    journalExact(j, s, posting, {
      code,
      reference: "HH-B-" + c.intentId.replace(/-/g, "").toLowerCase(),
      date: s.billDate,
    });
    const outstanding = field(detail, ["outstandingAmount"], cents) as number;
    if (outstanding > s.totalCents) mismatch("n3_bill_conservation_mismatch");
    const value = freeze({
      id: c.billId.toLowerCase(),
      intentId: c.intentId,
      targetId: c.billId.toLowerCase(),
      targetType: "INV" as const,
      totalCents: s.totalCents,
      outstandingCents: outstanding,
      documentDate: s.billDate,
      code,
      fingerprints: [
        billingPayloadDigest(d.kind === "response" ? d.body : null),
        billingPayloadDigest(j.kind === "response" ? j.body : null),
      ],
    });
    const readAt = [
      billingAuthenticatedReadAt(d, a, c.billId),
      billingAuthenticatedReadAt(j, a, c.billId),
    ];
    if (readAt.some((t) => t === null)) missing("n3_evidence_untrusted");
    meta.verifiedAt = Math.min(...(readAt as number[]));
    bills.set(value, meta);
    return value;
  });
}
function assertReceiptScope(s: SettlementSnapshot, r: SettlementReceipt) {
  if (
    r.reservationId !== s.reservationId ||
    r.customerId !== s.customerId ||
    r.currency !== s.currency
  )
    mismatch("receipt_scope_mismatch");
  if ("purpose" in r && r.purpose === "settlement") {
    if ("depositId" in r) mismatch("receipt_purpose_mismatch");
    id(r.intentId);
    assertEqual(r.reference, "HH-B-" + r.intentId.replace(/-/g, "").toLowerCase());
  } else {
    const candidate = s.receipts.find(
      (x) => x.receiptId.toLowerCase() === r.receiptId.toLowerCase(),
    );
    if (!candidate || billingPayloadDigest(candidate) !== billingPayloadDigest(r))
      mismatch("receipt_scope_mismatch");
  }
  if (r.payments.length !== 1 || r.payments[0].amountCents !== r.amountCents || r.amountCents <= 0)
    mismatch("receipt_payment_mismatch");
}
export function proveReceiptBefore(
  s: SettlementSnapshot,
  r: SettlementReceipt,
  d: N3Outcome,
  j: N3Outcome,
  a: SettlementActor,
): EvidenceResult<VerifiedReceiptBefore> {
  return attempt(() => {
    const meta = metadata(s, a);
    assertReceiptScope(s, r);
    if (
      !billingReceiptBoundTo(d, a, r.receiptId) ||
      !billingReceiptJournalBoundTo(j, a, r.receiptId)
    )
      missing("n3_evidence_untrusted");
    const detail = object(unwrap(d)),
      code = commonHeader(detail, s, {
        id: r.receiptId,
        date: r.receiptDate,
        reference: r.reference,
        total: r.amountCents,
        docType: "AROR",
      }),
      ar = arMapping(s),
      p = r.payments[0];
    assertEqual(nested(detail, ["accountId"], ["account"], ["id"], id), p.accountId.toLowerCase());
    assertEqual(nested(detail, ["accountCode"], ["account"], ["code"], string), p.accountCode);
    assertEqual(nested(detail, ["customerCode"], ["customer"], ["code"], string), ar.code);
    for (const v of aliases(detail, ["isMultiPayment"])) assertEqual(v, false);
    for (const v of aliases(detail, ["multiPayments"]))
      if (!Array.isArray(v) || v.length) mismatch("receipt_payment_mismatch");
    const refund = field(detail, ["refundAmount"], cents) as number,
      remainder = field(detail, ["outstandingAmount"], cents) as number;
    for (const v of aliases(detail, ["outstandingAmountLocal"])) assertEqual(cents(v), remainder);
    for (const v of aliases(detail, ["refundAmountLocal"])) assertEqual(cents(v), refund);
    const raw = field(detail, ["knockoff"]);
    if (!Array.isArray(raw) || raw.length > 1000) missing("receipt_allocations_unavailable");
    const rows: AllocationEvidence[] = [],
      seen = new Set<string>();
    for (const row of raw) {
      assertEqual(field(row, ["receiptDocType"], string), "OR");
      assertEqual(field(row, ["receiptDocId"], id), r.receiptId.toLowerCase());
      assertEqual(nested(row, ["customerId"], ["customer"], ["id"], master), s.customerId);
      const docType = field(row, ["docType"], string);
      if (docType !== "INV" && docType !== "DN") mismatch("receipt_allocation_type_invalid");
      const docId = nested(row, ["docId"], ["document"], ["id"], id) as string,
        amount = field(row, ["paymentAmount"], cents) as number;
      if (amount <= 0 || seen.has(docType + ":" + docId)) mismatch("receipt_allocation_invalid");
      seen.add(docType + ":" + docId);
      for (const v of aliases(row, ["currencyCode"]))
        assertEqual(string(v).toUpperCase(), s.currency);
      for (const v of aliases(row, ["currencyRate"])) assertEqual(number(v), s.currencyRate);
      rows.push({ docType, docId, amountCents: amount, source: copy(object(row)) });
    }
    const computed = receiptRemainder({
      amountCents: r.amountCents,
      allocatedCents: rows.reduce((n, v) => n + v.amountCents, 0),
      refundCents: refund,
    });
    if (computed.kind !== "confirmed") mismatch("receipt_conservation_mismatch");
    assertEqual(computed.value, remainder, "receipt_conservation_mismatch");
    journalExact(
      j,
      s,
      [
        {
          account: { id: p.accountId.toLowerCase(), code: p.accountCode },
          debit: r.amountCents,
          credit: 0,
        },
        { account: ar, debit: 0, credit: r.amountCents },
      ],
      { code, reference: r.reference, date: r.receiptDate },
    );
    // Only a newly created, still-unapplied balance uses the original creation guard.
    if ("purpose" in r && r.purpose === "settlement" && !rows.length && refund === 0) {
      const expected = {
        identity: { n3ReceiptId: r.receiptId, n3DocCode: code },
        customerId: String(s.customerId),
        customerCode: ar.code,
        currencyId: String(s.currencyId),
        currencyCode: s.currency,
        amount: r.amountCents / 100,
        referenceNo: r.reference,
        paymentLines: [{ id: p.accountId, code: p.accountCode, amount: r.amountCents / 100 }],
      };
      if (!verifyReceiptDetail(d, expected) || !verifyReceiptJournal(j, expected))
        mismatch("balance_creation_proof_mismatch");
      const contact = formatReceiptContact(s.billTo);
      for (const [k, v] of Object.entries(contact)) assertEqual(field(detail, [k]), v);
    }
    const value = freeze({
      immutableHeaderFingerprint: billingPayloadDigest(
        Object.fromEntries(
          Object.entries(detail).filter(
            ([k]) =>
              ![
                "knockoff",
                "outstandingamount",
                "outstandingamountlocal",
                "updatedat",
                "version",
              ].includes(k.toLowerCase()),
          ),
        ),
      ),
      receipt: copy(r),
      code,
      amountCents: r.amountCents,
      refundCents: refund,
      remainderCents: remainder,
      allocations: rows.sort((a, b) =>
        (a.docType + ":" + a.docId).localeCompare(b.docType + ":" + b.docId),
      ),
      fingerprints: [
        billingPayloadDigest(d.kind === "response" ? d.body : null),
        billingPayloadDigest(j.kind === "response" ? j.body : null),
      ],
    });
    const readAt = [
      billingAuthenticatedReadAt(d, a, r.receiptId),
      billingAuthenticatedReadAt(j, a, r.receiptId),
    ];
    if (readAt.some((t) => t === null)) missing("n3_evidence_untrusted");
    meta.verifiedAt = Math.min(...(readAt as number[]));
    receipts.set(value, meta);
    return value;
  });
}
type AllocationProofInput = {
  snapshot: SettlementSnapshot;
  bill: VerifiedBill;
  receipt: SettlementReceipt;
  before: VerifiedReceiptBefore;
  detail: N3Outcome;
  journal: N3Outcome;
  actor: SettlementActor;
  expectedTotalToBillCents: number;
};
export function proveReceiptAllocation(
  i: AllocationProofInput,
): EvidenceResult<VerifiedAllocation> {
  return allocationProof(i, false);
}
function allocationProof(
  i: AllocationProofInput,
  persistedHistory: boolean,
): EvidenceResult<VerifiedAllocation> {
  return attempt(() => {
    const { snapshot: s, bill: b, receipt: r, before, actor: a } = i;
    if (
      !bound(bills.get(b), s, a) ||
      (!persistedHistory && !bound(receipts.get(before), s, a)) ||
      billingPayloadDigest(before.receipt) !== billingPayloadDigest(r)
    )
      missing("n3_evidence_untrusted");
    if (
      !Number.isSafeInteger(i.expectedTotalToBillCents) ||
      i.expectedTotalToBillCents <= 0 ||
      i.expectedTotalToBillCents > r.amountCents
    )
      mismatch("receipt_allocation_expected_invalid");
    if ("purpose" in r && r.intentId !== b.intentId) mismatch("receipt_scope_mismatch");
    const result = proveReceiptBefore(s, r, i.detail, i.journal, a);
    if (result.kind !== "confirmed") throw new EvidenceError(result.kind, result.code);
    const after = result.value;
    assertEqual(after.refundCents, before.refundCents, "receipt_unrelated_state_changed");
    assertEqual(
      after.immutableHeaderFingerprint,
      before.immutableHeaderFingerprint,
      "receipt_immutable_header_changed",
    );
    assertEqual(after.fingerprints[1], before.fingerprints[1], "receipt_journal_changed");
    const prior = before.allocations.filter(
        (x) => x.docId !== b.targetId || x.docType !== b.targetType,
      ),
      actual = after.allocations.filter(
        (x) => x.docId !== b.targetId || x.docType !== b.targetType,
      );
    assertEqual(
      billingPayloadDigest(actual),
      billingPayloadDigest(prior),
      "receipt_unrelated_state_changed",
    );
    const target = after.allocations.find(
      (x) => x.docId === b.targetId && x.docType === b.targetType,
    );
    if (!target || target.amountCents !== i.expectedTotalToBillCents)
      mismatch("receipt_allocation_mismatch");
    const value = freeze({
      ...copy(after),
      billId: b.id,
      intentId: b.intentId,
      allocatedToBillCents: target.amountCents,
      beforeFingerprints: [...before.fingerprints],
    });
    const meta = metadata(s, a, b.intentId);
    meta.verifiedAt = Math.min(bills.get(b)!.verifiedAt, receipts.get(after)!.verifiedAt);
    allocations.set(value, meta);
    return value;
  });
}
// Saved pre-dispatch facts are historical comparisons, never fresh read authority.
// Only the exact service-read dispatch object can supply them for GET-only recovery.
export function provePersistedReceiptAllocation(
  snapshot: SettlementSnapshot,
  bill: VerifiedBill,
  dispatch: StoredDispatch,
  detail: N3Outcome,
  journal: N3Outcome,
  actor: SettlementActor,
): EvidenceResult<VerifiedAllocation> {
  return attempt(() => {
    const f = dispatch.facts;
    if (
      !persistedDispatchBoundTo(dispatch, actor, bill.intentId, snapshot.digest) ||
      !f ||
      (f.kind !== "deposit_allocation" && f.kind !== "balance_allocation") ||
      f.billId !== bill.id ||
      f.receipt.receiptId !== dispatch.claim.receiptId
    )
      missing("n3_evidence_untrusted");
    const result = allocationProof(
      {
        snapshot,
        bill,
        receipt: f.receipt,
        before: f.before,
        detail,
        journal,
        actor,
        expectedTotalToBillCents: f.expectedTotalToBillCents,
      },
      true,
    );
    if (result.kind !== "confirmed") throw new EvidenceError(result.kind, result.code);
    const r = result.value;
    assertEqual(
      billingPayloadDigest({
        receiptId: r.receipt.receiptId,
        amountCents: r.amountCents,
        refundCents: r.refundCents,
        remainderCents: r.remainderCents,
        allocations: r.allocations.map(({ docType, docId, amountCents }) => ({
          docType,
          docId,
          amountCents,
        })),
      }),
      f.expectedAfterFingerprint,
      "receipt_allocation_mismatch",
    );
    return r;
  });
}
export function verifiedBillBoundTo(p: VerifiedBill, s: SettlementSnapshot): boolean {
  return bound(bills.get(p), s);
}
export function verifiedReceiptBoundTo(p: VerifiedReceiptBefore, s: SettlementSnapshot): boolean {
  return bound(receipts.get(p), s);
}
export function proveSettlement(
  s: SettlementSnapshot,
  b: VerifiedBill,
  rows: VerifiedAllocation[],
  checkedAt: string,
): EvidenceResult<SettlementProof> {
  return attempt(() => {
    const meta = bills.get(b);
    if (!bound(meta, s)) missing("n3_evidence_untrusted");
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$|^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(
        checkedAt,
      ) ||
      !Number.isFinite(Date.parse(checkedAt))
    )
      mismatch("settlement_proof_time_invalid");
    if (Math.abs(Date.parse(checkedAt) - Date.now()) > 5000)
      mismatch("settlement_proof_time_invalid");
    const seen = new Set<string>();
    let total = 0,
      balanceCount = 0;
    for (const a of rows) {
      const am = allocations.get(a);
      if (
        !bound(am, s) ||
        am!.user !== meta!.user ||
        am!.token !== meta!.token ||
        a.intentId !== b.intentId ||
        a.billId !== b.id
      )
        missing("n3_evidence_untrusted");
      const rid = a.receipt.receiptId.toLowerCase();
      if (seen.has(rid)) mismatch("settlement_receipt_duplicate");
      seen.add(rid);
      if (a.remainderCents !== 0 || a.refundCents !== 0)
        missing("settlement_excess_or_refund_requires_review");
      if ("purpose" in a.receipt) {
        balanceCount++;
        if (balanceCount > 1 || a.receipt.intentId !== b.intentId)
          mismatch("receipt_scope_mismatch");
      }
      total += a.allocatedToBillCents;
      if (total > MAX_MONEY_CENTS) mismatch("settlement_conservation_mismatch");
    }
    if (s.receipts.some((r) => !seen.has(r.receiptId.toLowerCase())))
      missing("settlement_receipt_missing");
    if (b.outstandingCents !== 0 || total !== s.totalCents || b.totalCents !== s.totalCents)
      mismatch("settlement_conservation_mismatch");
    const verifiedAt = Math.min(
      meta!.verifiedAt,
      ...rows.map((r) => allocations.get(r)!.verifiedAt),
    );
    const facts = {
      tenantId: s.tenantId,
      reservationId: s.reservationId,
      billId: b.id,
      receiptIds: [...seen].sort(),
      billOutstandingCents: 0,
      receiptRemainders: rows
        .map((a) => ({ receiptId: a.receipt.receiptId, remainderCents: a.remainderCents }))
        .sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
      documentDates: [
        { documentId: b.id, date: b.documentDate },
        ...rows.map((a) => ({ documentId: a.receipt.receiptId, date: a.receipt.receiptDate })),
      ].sort((a, b) => a.documentId.localeCompare(b.documentId)),
      checkedAt: new Date(verifiedAt).toISOString(),
      evidenceFingerprints: [...b.fingerprints, ...rows.flatMap((a) => a.fingerprints)].sort(),
    };
    const proof = freeze({
      ...facts,
      digest: billingPayloadDigest({ intentId: b.intentId, snapshotDigest: s.digest, ...facts }),
    }) as SettlementProof;
    proofs.set(proof, { ...meta!, verifiedAt, intentId: b.intentId });
    finalComponents.set(proof, { bill: b, rows });
    return proof;
  });
}
export function settlementProofBoundTo(
  p: SettlementProof,
  a: SettlementActor,
  intentId: string,
): boolean {
  const m = proofs.get(p);
  return Boolean(
    m &&
    Date.now() >= m.verifiedAt &&
    Date.now() - m.verifiedAt <= 60_000 &&
    m.intentId === intentId &&
    m.tenantId === a.tenantId &&
    m.reservationId === a.reservationId &&
    m.user === a.n3UserKey &&
    m.token === a.n3Token,
  );
}

export function verifiedBillActorMatches(
  b: VerifiedBill,
  s: SettlementSnapshot,
  a: SettlementActor,
): boolean {
  return bound(bills.get(b), s, a);
}
export function verifiedEvidencePair(
  b: VerifiedBill,
  r: VerifiedReceiptBefore,
  s: SettlementSnapshot,
): boolean {
  const bm = bills.get(b),
    rm = receipts.get(r);
  return bound(bm, s) && bound(rm, s) && bm!.user === rm!.user && bm!.token === rm!.token;
}

const finalComponents = new WeakMap<
  SettlementProof,
  { bill: VerifiedBill; rows: VerifiedAllocation[] }
>();
const progressProofs = new WeakMap<SettlementProgressProof, Meta>();
function progress(
  s: SettlementSnapshot,
  b: VerifiedBill,
  a: SettlementActor,
  kind: SettlementProgressProof["kind"],
  receipt: Record<string, unknown> | null,
  verifiedAt = bills.get(b)!.verifiedAt,
): SettlementProgressProof {
  const facts = {
    kind,
    tenantId: s.tenantId,
    reservationId: s.reservationId,
    intentId: b.intentId,
    snapshotDigest: s.digest,
    checkedAt: new Date(verifiedAt).toISOString(),
    bill: copy(b) as unknown as Record<string, unknown>,
    receipt,
  };
  const proof = freeze({
    ...facts,
    digest: billingPayloadDigest(facts),
  }) as SettlementProgressProof;
  progressProofs.set(proof, { ...metadata(s, a, b.intentId), verifiedAt });
  return proof;
}
export function makeBillProgressEvidence(
  s: SettlementSnapshot,
  b: VerifiedBill,
  a: SettlementActor,
): EvidenceResult<SettlementProgressProof> {
  return attempt(() => {
    if (!bound(bills.get(b), s, a)) missing("n3_evidence_untrusted");
    return progress(s, b, a, "bill", null);
  });
}
function receiptProgressFacts(
  r: VerifiedReceiptBefore | VerifiedAllocation,
): Record<string, unknown> {
  return {
    receiptId: r.receipt.receiptId,
    code: r.code,
    reference: r.receipt.reference,
    documentDate: r.receipt.receiptDate,
    purpose: "purpose" in r.receipt ? "settlement" : "deposit",
    customerId: r.receipt.customerId,
    currency: r.receipt.currency,
    amountCents: r.amountCents,
    refundCents: r.refundCents,
    remainderCents: r.remainderCents,
    payments: copy(r.receipt.payments),
    allocations: r.allocations.map((x) => ({
      docId: x.docId,
      docType: x.docType,
      amountCents: x.amountCents,
    })),
    fingerprints: [...r.fingerprints],
    immutableHeaderFingerprint: r.immutableHeaderFingerprint,
    ...("allocatedToBillCents" in r
      ? {
          allocatedToBillCents: (r as VerifiedAllocation).allocatedToBillCents,
          beforeFingerprints: [...(r as VerifiedAllocation).beforeFingerprints],
        }
      : {}),
  };
}
export function makeReceiptProgressEvidence(
  s: SettlementSnapshot,
  b: VerifiedBill,
  r: VerifiedReceiptBefore | VerifiedAllocation,
  a: SettlementActor,
): EvidenceResult<SettlementProgressProof> {
  return attempt(() => {
    const allocation = allocations.get(r),
      before = receipts.get(r);
    if (!bound(bills.get(b), s, a) || !bound(allocation ?? before, s, a))
      missing("n3_evidence_untrusted");
    let kind: SettlementProgressProof["kind"];
    if (allocation) {
      const matched = r as VerifiedAllocation;
      if (matched.intentId !== b.intentId || matched.billId !== b.id)
        mismatch("receipt_scope_mismatch");
      kind = "allocation";
    } else {
      if (
        !("purpose" in r.receipt) ||
        r.receipt.intentId !== b.intentId ||
        r.allocations.length ||
        r.refundCents !== 0 ||
        r.remainderCents !== r.amountCents ||
        r.amountCents !== b.outstandingCents
      )
        mismatch("balance_creation_proof_mismatch");
      kind = "balance_receipt";
    }
    const receipt = receiptProgressFacts(r);
    return progress(
      s,
      b,
      a,
      kind,
      receipt,
      Math.min(bills.get(b)!.verifiedAt, (allocation ?? before)!.verifiedAt),
    );
  });
}
export function settlementProgressBoundTo(
  p: SettlementProgressProof,
  a: SettlementActor,
  intentId: string,
): boolean {
  const m = progressProofs.get(p);
  return Boolean(
    m &&
    Date.now() >= m.verifiedAt &&
    Date.now() - m.verifiedAt <= 60000 &&
    m.intentId === intentId &&
    m.tenantId === a.tenantId &&
    m.reservationId === a.reservationId &&
    m.user === a.n3UserKey &&
    m.token === a.n3Token,
  );
}
export function settlementFinalEvidenceForStore(
  p: SettlementProof,
  a: SettlementActor,
  intentId: string,
): Record<string, unknown> | null {
  if (!settlementProofBoundTo(p, a, intentId)) return null;
  const components = finalComponents.get(p);
  if (!components) return null;
  const facts = {
    kind: "settlement",
    tenantId: p.tenantId,
    reservationId: p.reservationId,
    intentId,
    snapshotDigest: proofs.get(p)!.snapshotDigest,
    checkedAt: p.checkedAt,
    bill: copy(components.bill),
    receipt: null,
    receipts: components.rows.map(receiptProgressFacts),
  };
  return { ...facts, digest: billingPayloadDigest(facts) };
}
