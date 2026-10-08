import { createHash } from "node:crypto";
import type { N3Outcome } from "./n3-receipts.server";
import type { SettlementActor } from "./settlement-context.server";
import type { DispatchClaim, SettlementSnapshot, StepKind } from "./settlement";
import type { ReceiptContactFields } from "./receipt-contact";
import { billingContractGate } from "./settlement-contracts.server";
import { MAX_MONEY_CENTS } from "./checkout-money";

export type AllocationPostRow = {
  customerId: number;
  receiptDocType: "OR";
  receiptDocId: string;
  docType: "INV" | "DN";
  docId: string;
  paymentAmount: number;
};
export type BalanceReceiptInput = {
  customerId: number;
  currencyId: number;
  currencyRate: number;
  amountCents: number;
  accountId: string;
  docDate: string;
  contact: ReceiptContactFields;
};
export interface N3BillingClient {
  readPaymentAccount(actor: SettlementActor, id: string): Promise<N3Outcome>;
  readReceipt(actor: SettlementActor, id: string): Promise<N3Outcome>;
  readReceiptJournal(actor: SettlementActor, id: string): Promise<N3Outcome>;
  createBill(
    actor: SettlementActor,
    claim: DispatchClaim,
    snapshot: SettlementSnapshot,
  ): Promise<N3Outcome>;
  readBill(actor: SettlementActor, id: string): Promise<N3Outcome>;
  readBillJournal(actor: SettlementActor, id: string): Promise<N3Outcome>;
  writeAllocation(
    actor: SettlementActor,
    claim: DispatchClaim,
    rows: AllocationPostRow[],
  ): Promise<N3Outcome>;
  createBalanceReceipt(
    actor: SettlementActor,
    claim: DispatchClaim,
    payload: BalanceReceiptInput,
  ): Promise<N3Outcome>;
}
const BASE = "https://openapi.account.qne.cloud";
const BYTE_CAP = 2_000_000;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) &&
  !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v);
const masterId = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 2147483647;
const money = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= MAX_MONEY_CENTS;
const date = (d: unknown): d is string =>
  typeof d === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  Number.isFinite(Date.parse(d)) &&
  new Date(d).toISOString().slice(0, 10) === d;
const rate = (n: number) => Number.isFinite(n) && n > 0 && n <= 999999;
const hash = (s: string) => /^[a-f0-9]{64}$/.test(s);
export class BillingTransportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BillingTransportError";
  }
}
function requireInput(ok: unknown): asserts ok {
  if (!ok) throw new BillingTransportError("n3_billing_invalid_input");
}
function actorAccess(actor: SettlementActor, write = false) {
  if (!["owner", "front_desk"].includes(actor.role) || (write && actor.role !== "owner"))
    throw new BillingTransportError("forbidden");
  requireInput(
    uuid(actor.tenantId) &&
      uuid(actor.reservationId) &&
      typeof actor.n3UserKey === "string" &&
      actor.n3UserKey.length > 0 &&
      typeof actor.n3Token === "string" &&
      actor.n3Token.length > 0 &&
      !/[\r\n]/.test(actor.n3Token),
  );
}
function gate(kind: StepKind) {
  const g = billingContractGate(kind);
  if (g.kind !== "confirmed") throw new BillingTransportError(g.code);
  if (g.value.operation !== kind || !hash(g.value.evidenceHash))
    throw new BillingTransportError("n3_billing_contract_unverified");
  if (
    kind.includes("allocation") &&
    (!g.value.concurrencyProofHash ||
      !hash(g.value.concurrencyProofHash) ||
      g.value.allocationMode !== "preserve_existing")
  )
    throw new BillingTransportError("n3_allocation_concurrency_unverified");
}
function canonical(p: unknown): string {
  if (p === null || typeof p === "string" || typeof p === "boolean") return JSON.stringify(p);
  if (typeof p === "number" && Number.isFinite(p)) return JSON.stringify(p);
  if (Array.isArray(p)) return "[" + p.map(canonical).join(",") + "]";
  if (p && typeof p === "object" && Object.getPrototypeOf(p) === Object.prototype)
    return (
      "{" +
      Object.keys(p)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical((p as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    );
  throw new BillingTransportError("n3_billing_invalid_input");
}
export function billingPayloadDigest(p: unknown): string {
  return createHash("sha256").update(canonical(p)).digest("hex");
}
function reference(c: Pick<DispatchClaim, "intentId">) {
  requireInput(uuid(c.intentId));
  return "HH-B-" + c.intentId.replace(/-/g, "").toLowerCase();
}
function verifyClaim(c: DispatchClaim, kind: StepKind, payload: unknown) {
  if (
    !uuid(c.attemptId) ||
    !uuid(c.intentId) ||
    c.kind !== kind ||
    !/^(0|[1-9]\d{0,18})$/.test(c.expectedRevision) ||
    BigInt(c.expectedRevision) > 9223372036854775807n ||
    !hash(c.payloadDigest) ||
    billingPayloadDigest(payload) !== c.payloadDigest
  )
    throw new BillingTransportError("n3_billing_invalid_claim");
}
function splitAddress(s: string) {
  let cut = 300;
  const ch = s.charCodeAt(299);
  if (ch >= 0xd800 && ch <= 0xdbff) cut--;
  requireInput(s.length <= cut + 300);
  return [s.slice(0, cut), s.slice(cut)];
}
export function buildCashSalePayload(
  s: SettlementSnapshot,
  c: Pick<DispatchClaim, "intentId">,
): Record<string, unknown> {
  requireInput(
    masterId(s.customerId) &&
      masterId(s.currencyId) &&
      rate(s.currencyRate) &&
      date(s.billDate) &&
      money(s.totalCents) &&
      s.totalCents > 0,
  );
  requireInput(s.billTo && Object.values(s.billTo).every((v) => typeof v === "string"));
  const name = [s.billTo.company.trim(), s.billTo.name.trim()].filter(Boolean).join(", ");
  requireInput(
    name.length > 0 &&
      name.length <= 250 &&
      s.billTo.phone.length <= 100 &&
      s.billTo.email.length <= 300,
  );
  const [address1, address2] = splitAddress(s.billTo.address);
  requireInput(Array.isArray(s.lines) && s.lines.length > 0 && s.lines.length <= 1000);
  const itemDetails = s.lines.map((l, i) => {
    requireInput(
      masterId(l.stockId) &&
        masterId(l.uomId) &&
        masterId(l.taxCodeId) &&
        Number.isInteger(l.qty) &&
        l.qty > 0 &&
        l.qty <= 9999 &&
        [l.unitCents, l.subtotalCents, l.taxCents, l.totalCents].every(money) &&
        l.qty * l.unitCents === l.subtotalCents &&
        l.subtotalCents + l.taxCents === l.totalCents &&
        typeof l.description === "string" &&
        l.description.trim().length > 0 &&
        l.description.length <= 250,
    );
    return {
      pos: i + 1,
      stockId: l.stockId,
      uomId: l.uomId,
      taxCodeId: l.taxCodeId,
      qty: l.qty,
      unitPrice: l.unitCents / 100,
      amount: l.subtotalCents / 100,
      taxAmount: l.taxCents / 100,
      netAmount: l.totalCents / 100,
      description: l.description,
    };
  });
  requireInput(s.lines.reduce((sum, l) => sum + l.totalCents, 0) === s.totalCents);
  return {
    customerId: s.customerId,
    currencyId: s.currencyId,
    currencyRate: s.currencyRate,
    docDate: s.billDate,
    referenceNo: reference(c),
    isPostToAR: true,
    customerName: name,
    customerPhone: s.billTo.phone,
    email: s.billTo.email,
    address1,
    address2,
    itemDetails,
  };
}
export function buildBalanceReceiptPayload(
  p: BalanceReceiptInput,
  c: Pick<DispatchClaim, "intentId">,
): Record<string, unknown> {
  requireInput(
    masterId(p.customerId) &&
      masterId(p.currencyId) &&
      rate(p.currencyRate) &&
      money(p.amountCents) &&
      p.amountCents > 0 &&
      uuid(p.accountId) &&
      date(p.docDate),
  );
  const contact = p.contact;
  requireInput(
    contact &&
      typeof contact.customerName === "string" &&
      contact.customerName.trim().length > 0 &&
      contact.customerName.length <= 250 &&
      ["remark1", "remark2", "remark3", "remark4"].every(
        (k) =>
          typeof contact[k as keyof ReceiptContactFields] === "string" &&
          contact[k as keyof ReceiptContactFields].length <= 100,
      ),
  );
  return {
    docType: "AROR",
    docDate: p.docDate,
    customerId: p.customerId,
    currencyId: p.currencyId,
    currencyRate: p.currencyRate,
    accountId: p.accountId,
    totalAmount: p.amountCents / 100,
    referenceNo: reference(c),
    description: "HotelHub settlement balance",
    customerName: contact.customerName,
    remark1: contact.remark1,
    remark2: contact.remark2,
    remark3: contact.remark3,
    remark4: contact.remark4,
  };
}
// JSON.parse cannot preserve int64 or detect duplicate keys. Parse actual tokens,
// retaining oversized integer tokens as strings and rejecting rounded exponents.
function losslessJson(text: string): unknown {
  let at = 0;
  const ws = () => {
    while (/[\t\n\r ]/.test(text[at] ?? "x")) at++;
  };
  const fail = (): never => {
    throw new Error("invalid_n3_json");
  };
  function string(): string {
    const start = at++;
    while (at < text.length) {
      const ch = text[at++];
      if (ch === '"') return JSON.parse(text.slice(start, at)) as string;
      if (ch === "\\") at++;
    }
    return fail();
  }
  function value(depth: number): unknown {
    if (depth > 128) fail();
    ws();
    const ch = text[at];
    if (ch === '"') return string();
    if (ch === "{") {
      at++;
      ws();
      const o: Record<string, unknown> = {};
      const keys = new Set<string>();
      if (text[at] === "}") {
        at++;
        return o;
      }
      while (true) {
        ws();
        if (text[at] !== '"') fail();
        const k = string();
        if (keys.has(k)) fail();
        keys.add(k);
        ws();
        if (text[at++] !== ":") fail();
        const v = value(depth + 1);
        Object.defineProperty(o, k, {
          value: v,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        ws();
        const end = text[at++];
        if (end === "}") return o;
        if (end !== ",") fail();
      }
    }
    if (ch === "[") {
      at++;
      ws();
      const a: unknown[] = [];
      if (text[at] === "]") {
        at++;
        return a;
      }
      while (true) {
        a.push(value(depth + 1));
        ws();
        const end = text[at++];
        if (end === "]") return a;
        if (end !== ",") fail();
      }
    }
    for (const [token, v] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(token, at)) {
        at += token.length;
        return v;
      }
    }
    const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at))?.[0];
    if (!token) return fail();
    at += token.length;
    const n = Number(token);
    if (!Number.isFinite(n)) fail();
    if (/^-?\d+$/.test(token) && !Number.isSafeInteger(n)) return token;
    if (Math.abs(n) > Number.MAX_SAFE_INTEGER) fail();
    return n;
  }
  const result = value(0);
  ws();
  if (at !== text.length) fail();
  return result;
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
}
type Binding = {
  tenantId: string;
  reservationId: string;
  n3UserKey: string;
  token: string;
  receivedAt: number;
  id: string;
  operation: "detail" | "journal" | "receipt_detail" | "receipt_journal" | "payment_account";
};
const reads = new WeakMap<object, Binding>();
function bound(
  o: N3Outcome,
  a: SettlementActor,
  id: string,
  operation: Binding["operation"],
): boolean {
  const b = reads.get(o);
  return Boolean(
    b &&
    b.operation === operation &&
    Date.now() >= b.receivedAt &&
    Date.now() - b.receivedAt <= 60_000 &&
    b.tenantId === a.tenantId &&
    b.reservationId === a.reservationId &&
    b.n3UserKey === a.n3UserKey &&
    b.token === a.n3Token &&
    b.id === id.toLowerCase(),
  );
}
export function billingJournalBoundTo(o: N3Outcome, a: SettlementActor, id: string): boolean {
  return bound(o, a, id, "journal");
}
export function billingDocumentBoundTo(o: N3Outcome, a: SettlementActor, id: string): boolean {
  return bound(o, a, id, "detail");
}
async function request(
  actor: SettlementActor,
  path: string,
  payload?: unknown,
  binding?: { id: string; operation: Binding["operation"] },
): Promise<N3Outcome> {
  const started = Date.now(),
    controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const duration = () => Math.max(0, Date.now() - started);
  const timedOut = new Error("timeout"),
    tooLarge = new Error("too_large");
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => {
        reject(timedOut);
        controller.abort();
        void reader?.cancel().catch(() => {});
      },
      payload === undefined ? 20_000 : 30_000,
    );
  });
  const work = async (): Promise<N3Outcome> => {
    const response = await fetch(BASE + path, {
      method: payload === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + actor.n3Token },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: controller.signal,
      redirect: "error",
    });
    // Classify an observed401 before reading its potentially broken error body.
    // A dispatched write remains unknown and retains its durable fence.
    if (response.status === 401) {
      controller.abort();
      void response.body?.cancel().catch(() => {});
      return freeze({ kind: "response", status: 401, body: null, durationMs: duration() });
    }
    const length = response.headers.get("content-length");
    if (length && /^\d+$/.test(length) && Number(length) > BYTE_CAP) {
      controller.abort();
      void response.body?.cancel().catch(() => {});
      throw tooLarge;
    }
    let total = 0;
    const chunks: Uint8Array[] = [];
    if (response.body) {
      reader = response.body.getReader();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > BYTE_CAP) {
          controller.abort();
          void reader.cancel().catch(() => {});
          throw tooLarge;
        }
        chunks.push(part.value);
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let body: unknown = null,
      valid = false;
    try {
      body = losslessJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      valid = true;
    } catch {
      /* Malformed body cannot mint provenance. */
    }
    const out: N3Outcome = freeze({
      kind: "response",
      status: response.status,
      body,
      durationMs: duration(),
    });
    if (valid && binding)
      reads.set(out, {
        ...binding,
        id: binding.id.toLowerCase(),
        tenantId: actor.tenantId,
        reservationId: actor.reservationId,
        n3UserKey: actor.n3UserKey,
        token: actor.n3Token,
        receivedAt: Date.now(),
      });
    return out;
  };
  try {
    return await Promise.race([work(), deadline]);
  } catch (error) {
    return freeze({
      kind: "transport_error",
      reason: error === timedOut ? "timeout" : error === tooLarge ? "too_large" : "network",
      durationMs: duration(),
    });
  } finally {
    clearTimeout(timer);
  }
}
export function billingReceiptBoundTo(o: N3Outcome, a: SettlementActor, id: string): boolean {
  return bound(o, a, id, "receipt_detail");
}
export function billingReceiptJournalBoundTo(
  o: N3Outcome,
  a: SettlementActor,
  id: string,
): boolean {
  return bound(o, a, id, "receipt_journal");
}
export function billingPaymentAccountBoundTo(
  o: N3Outcome,
  a: SettlementActor,
  id: string,
): boolean {
  return bound(o, a, id, "payment_account");
}
export const n3BillingClient: N3BillingClient = {
  async readPaymentAccount(actor, id) {
    actorAccess(actor);
    requireInput(uuid(id));
    return request(actor, "/api/AccountCodes/" + id, undefined, {
      id,
      operation: "payment_account",
    });
  },
  async readReceipt(actor, id) {
    actorAccess(actor);
    requireInput(uuid(id));
    return request(actor, "/api/ARReceipts/" + id, undefined, { id, operation: "receipt_detail" });
  },
  async readReceiptJournal(actor, id) {
    actorAccess(actor);
    requireInput(uuid(id));
    return request(actor, "/api/ARReceipts/GLPosting?key=" + id, undefined, {
      id,
      operation: "receipt_journal",
    });
  },
  async createBill(actor, c, s) {
    actorAccess(actor, true);
    gate("bill");
    if (actor.tenantId !== s.tenantId || actor.reservationId !== s.reservationId)
      throw new BillingTransportError("n3_billing_scope_mismatch");
    const p = buildCashSalePayload(s, c);
    verifyClaim(c, "bill", p);
    return request(actor, "/api/CashSales/Create", p);
  },
  async readBill(actor, id) {
    actorAccess(actor);
    requireInput(uuid(id));
    return request(actor, "/api/CashSales/" + id, undefined, { id, operation: "detail" });
  },
  async readBillJournal(actor, id) {
    actorAccess(actor);
    requireInput(uuid(id));
    return request(actor, "/api/CashSales/GLPosting?key=" + id, undefined, {
      id,
      operation: "journal",
    });
  },
  async writeAllocation(actor, c, rows) {
    actorAccess(actor, true);
    requireInput(c.kind === "deposit_allocation" || c.kind === "balance_allocation");
    gate(c.kind);
    requireInput(
      uuid(c.receiptId) && Array.isArray(rows) && rows.length > 0 && rows.length <= 1000,
    );
    const customers = new Set(rows.map((r) => r.customerId)),
      docs = new Set(rows.map((r) => r.docType + ":" + r.docId));
    requireInput(
      customers.size === 1 &&
        docs.size === rows.length &&
        rows.every(
          (r) =>
            Object.keys(r).sort().join(",") ===
              "customerId,docId,docType,paymentAmount,receiptDocId,receiptDocType" &&
            masterId(r.customerId) &&
            r.receiptDocType === "OR" &&
            r.receiptDocId === c.receiptId &&
            (r.docType === "INV" || r.docType === "DN") &&
            uuid(r.docId) &&
            Number.isFinite(r.paymentAmount) &&
            r.paymentAmount > 0 &&
            money(Math.round(r.paymentAmount * 100)) &&
            Math.abs(r.paymentAmount * 100 - Math.round(r.paymentAmount * 100)) < 0.0000001,
        ),
    );
    verifyClaim(c, c.kind, rows);
    return request(actor, "/api/ARReceipts/UpdateCustomerKnockoff", rows);
  },
  async createBalanceReceipt(actor, c, payload) {
    actorAccess(actor, true);
    gate("balance_receipt");
    const p = buildBalanceReceiptPayload(payload, c);
    verifyClaim(c, "balance_receipt", p);
    return request(actor, "/api/ARReceipts/Create", p);
  },
};

export function billingAuthenticatedReadAt(
  o: N3Outcome,
  a: SettlementActor,
  id: string,
): number | null {
  const b = reads.get(o);
  return b && bound(o, a, id, b.operation) ? b.receivedAt : null;
}
